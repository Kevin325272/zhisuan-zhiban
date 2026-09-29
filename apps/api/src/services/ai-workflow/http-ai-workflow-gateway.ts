import {
  aiWorkflowResponseSchema,
  type AiWorkflowCapability,
  type AiWorkflowRequest,
  type AiWorkflowResponse,
  type AiWorkflowRuntimeStatus,
} from "@xuetu/contracts";

import type { AiWorkflowGateway } from "./ai-workflow-gateway.js";
import { failedWorkflowResponse } from "./ai-workflow-gateway.js";
import {
  workflowResponseIsSafe,
  workflowFallbackMessage,
  workflowFailure,
} from "./model-workflow-response.js";
import {
  allowsUnverifiedSourceEgress,
  containsUnverifiedCourseSource,
} from "./source-egress-policy.js";
import { AiWorkflowRuntimeStatusTracker } from "./runtime-status.js";

interface HttpAiWorkflowGatewayOptions {
  baseUrl: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  allowUnverifiedSources?: boolean;
  runtimeStatusTtlMs?: number;
  now?: () => number;
}

function safeOutboundRequest(request: AiWorkflowRequest) {
  if (request.capability === "care") {
    return {
      contract_version: request.contract_version,
      request_id: request.request_id,
      capability: request.capability,
      slot: request.slot,
      course_id: request.course_id,
      concept_id: null,
      source_chunk_ids: [],
      learning_evidence: [],
      user_message: request.user_message,
      context: {
        course: request.context.course,
        care_check_in: request.context.care_check_in ?? null,
      },
    };
  }
  return {
    contract_version: request.contract_version,
    request_id: request.request_id,
    capability: request.capability,
    slot: request.slot,
    course_id: request.course_id,
    concept_id: request.concept_id,
    source_chunk_ids: request.source_chunk_ids,
    learning_evidence: request.learning_evidence,
    user_message: request.user_message,
    context: {
      course: request.context.course,
      concept: request.context.concept,
      source_chunks: request.context.source_chunks.map((chunk) => ({
        source_chunk_id: chunk.source_chunk_id,
        chapter: chunk.chapter,
        content: chunk.content,
      })),
      reading_progress: request.context.reading_progress
        ? {
            chunk_id: request.context.reading_progress.chunk_id,
            paragraph_index: request.context.reading_progress.paragraph_index,
            source_expanded: request.context.reading_progress.source_expanded,
          }
        : null,
      qa_case: request.context.qa_case
        ? {
            question: request.context.qa_case.question,
            course_example: request.context.qa_case.answer,
          }
        : null,
      attempt: request.context.attempt
        ? {
            subject: request.context.attempt.subject,
            question_text: request.context.attempt.question_text,
            options: request.context.attempt.options,
            selected_option_ids: request.context.attempt.selected_option_ids,
          }
        : null,
      evaluation: request.context.evaluation
        ? {
            grading_mode: request.context.evaluation.grading_mode,
            status: request.context.evaluation.status,
            is_correct: request.context.evaluation.is_correct,
            score: request.context.evaluation.score,
          }
        : null,
    },
  };
}

export class HttpAiWorkflowGateway implements AiWorkflowGateway {
  readonly #baseUrl: string;
  readonly #secret: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #allowUnverifiedSources: boolean;
  readonly #runtimeStatus: AiWorkflowRuntimeStatusTracker;

  constructor(options: HttpAiWorkflowGatewayOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.#secret = options.secret;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#allowUnverifiedSources = allowsUnverifiedSourceEgress(options.allowUnverifiedSources);
    this.#runtimeStatus = new AiWorkflowRuntimeStatusTracker({
      ttlMs: options.runtimeStatusTtlMs,
      now: options.now,
    });
  }

  status(capability: AiWorkflowCapability = "plan"): AiWorkflowRuntimeStatus {
    return this.#runtimeStatus.status(capability);
  }

  async run(request: AiWorkflowRequest): Promise<AiWorkflowResponse> {
    if (
      !this.#allowUnverifiedSources
      && containsUnverifiedCourseSource(request)
    ) {
      return workflowFailure(
        request,
        "insufficient_context",
        "CONTEXT_INCOMPLETE",
        "当前课程上下文暂不满足外部 AI 调用条件。",
        false,
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(
        `${this.#baseUrl}/v1/ai-workflows/${request.capability}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.#secret}`,
            "Content-Type": "application/json",
            "Idempotency-Key": request.request_id,
            "X-Xuetu-Contract-Version": "0.2",
          },
          body: JSON.stringify(safeOutboundRequest(request)),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          return this.#track(failedWorkflowResponse(request, "unavailable", {
            code: "UPSTREAM_UNAVAILABLE",
            message: "AI 学习工作流暂时不可用。",
            retryable: true,
            fallback_message: workflowFallbackMessage(request.capability),
          }));
        }
        return this.#track(failedWorkflowResponse(request, "failed", {
          code: "WORKFLOW_FAILED",
          message: `AI 学习工作流拒绝了请求（HTTP ${response.status}）。`,
          retryable: false,
          fallback_message: workflowFallbackMessage(request.capability),
        }));
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return this.#track(failedWorkflowResponse(request, "failed", {
          code: "WORKFLOW_FAILED",
          message: "AI 学习工作流返回了无法解析的数据。",
          retryable: false,
          fallback_message: workflowFallbackMessage(request.capability),
        }));
      }
      const parsed = aiWorkflowResponseSchema.safeParse(raw);
      if (!parsed.success || !workflowResponseIsSafe(request, parsed.data)) {
        return this.#track(failedWorkflowResponse(request, "failed", {
          code: "WORKFLOW_FAILED",
          message: "AI 学习工作流响应未通过契约或来源校验。",
          retryable: false,
          fallback_message: workflowFallbackMessage(request.capability),
        }));
      }
      return this.#track(parsed.data);
    } catch (error) {
      if (
        controller.signal.aborted
        || (error instanceof DOMException && error.name === "AbortError")
      ) {
        return this.#track(failedWorkflowResponse(request, "failed", {
          code: "WORKFLOW_TIMEOUT",
          message: "AI 学习工作流在20秒内未返回。",
          retryable: true,
          fallback_message: workflowFallbackMessage(request.capability),
        }));
      }
      return this.#track(failedWorkflowResponse(request, "unavailable", {
        code: "UPSTREAM_UNAVAILABLE",
        message: "无法连接 AI 学习工作流。",
        retryable: true,
        fallback_message: workflowFallbackMessage(request.capability),
      }));
    } finally {
      clearTimeout(timeout);
    }
  }

  #track(response: AiWorkflowResponse) {
    this.#runtimeStatus.record(response);
    return response;
  }

}
