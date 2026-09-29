import {
  type AiWorkflowCapability,
  type AiWorkflowRequest,
  type AiWorkflowResponse,
  type AiWorkflowRuntimeStatus,
} from "@xuetu/contracts";
import { z } from "zod";

import type { AiWorkflowGateway } from "./ai-workflow-gateway.js";
import {
  convertModelWorkflowAnswer,
  modelWorkflowAnswerSchema,
  workflowFailure,
} from "./model-workflow-response.js";
import {
  allowsUnverifiedSourceEgress,
  containsUnverifiedCourseSource,
} from "./source-egress-policy.js";
import { AiWorkflowRuntimeStatusTracker } from "./runtime-status.js";

interface DifyAiWorkflowGatewayOptions {
  endpoint: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  allowUnverifiedSources?: boolean;
  runtimeStatusTtlMs?: number;
  now?: () => number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function nativeOutputs(raw: unknown) {
  const envelope = asRecord(raw);
  const envelopeData = asRecord(envelope?.data);
  const data = asRecord(envelopeData?.data) ?? envelopeData;
  return asRecord(data?.outputs);
}

const difyDiagnoseAnswerSchema = z.object({
  status: z.enum(["ready", "unavailable", "failed", "insufficient_context"]),
  error_analysis: z.string().trim().min(1).max(8_000).optional(),
  step_by_step_hints: z.unknown().optional(),
  knowledge_references: z.unknown().optional(),
  next_actions: z.unknown().optional(),
}).passthrough();

function stringArray(value: unknown, maxItems: number) {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 1_000))
    .slice(0, maxItems);
}

function diagnoseReferenceIds(value: unknown, request: AiWorkflowRequest) {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(request.source_chunk_ids);
  return [...new Set(parsed.flatMap((item) => {
    if (typeof item === "string") return allowed.has(item) ? [item] : [];
    const record = asRecord(parseJsonValue(item));
    const candidates = [
      record?.source_chunk_id,
      record?.reference_id,
      record?.knowledge_id,
      record?.id,
    ];
    const id = candidates.find(
      (candidate): candidate is string => typeof candidate === "string" && allowed.has(candidate),
    );
    return id ? [id] : [];
  }))];
}

function diagnoseInputs(request: AiWorkflowRequest) {
  const attempt = request.context.attempt;
  const evaluation = request.context.evaluation;
  if (!attempt || !evaluation) return null;
  const knowledgePoints = request.context.concept
    ? [{
        concept_id: request.context.concept.concept_id,
        title: request.context.concept.title,
        learning_objective: request.context.concept.learning_objective,
        key_terms: request.context.concept.key_terms,
      }]
    : [];
  return {
    capability: request.capability,
    course: request.context.course.title,
    knowledge_points: JSON.stringify(knowledgePoints),
    task_content: [
      attempt.question_text,
      ...attempt.options.map((option) => `${option.option_id}. ${option.text}`),
    ].join("\n").slice(0, 12_000),
    user_text: userText(request),
    learner_response: attempt.selected_option_ids.join("、").slice(0, 1_000),
    deterministic_assessment: JSON.stringify({
      grading_mode: evaluation.grading_mode,
      status: evaluation.status,
      is_correct: evaluation.is_correct,
      score: evaluation.score,
    }),
    learning_evidence_bundle: JSON.stringify(
      request.learning_evidence.slice(0, 20).map((evidence) => ({
        kind: evidence.kind,
        summary: evidence.summary,
        observed_at: evidence.observed_at,
      })),
    ),
    backend_diagnosis_basis: JSON.stringify({
      assessment_status: evaluation.status,
      selected_option_ids: attempt.selected_option_ids,
      concept_id: request.concept_id,
    }),
    knowledge_reference_inputs: JSON.stringify(
      request.context.source_chunks.map((chunk) => ({
        source_chunk_id: chunk.source_chunk_id,
        reference_id: chunk.source_chunk_id,
        title: chunk.chapter,
        content: chunk.content.slice(0, 4_000),
      })),
    ),
    student_profile_summary: studentProfile(request),
    student_profile: studentProfile(request),
    textbook_snippets: sourceText(request),
    response_language: "zh-CN",
    request_id: request.request_id,
  };
}

function careInputs(request: AiWorkflowRequest) {
  const careCheckIn = request.context.care_check_in;
  if (!careCheckIn || !request.user_message) return null;
  return {
    capability: request.capability,
    care_check_in: JSON.stringify(careCheckIn),
    care_guardrails: [
      "只做学生明确同意后的支持性学习交流，并帮助其在现有任务与当天节奏选项之间做决定。",
      "普通回复只回应学生明确表达的感受；先降低当下压力；再提供选择；最后最多给出一个小步骤。",
      "不要说教、催促、强迫或替学生决定。",
      "明确自伤、轻生或立即危险表达由服务端确定性安全分支在调用模型前处理；若意外出现在输入中，不继续提供学习建议。",
      "不得诊断心理状态，不得推断焦虑、抑郁或疲劳。",
      "不得承诺保密、医疗效果或考试结果。",
      "不得修改成绩、掌握度、错题或任务状态。",
    ].join(" "),
    course: request.context.course.title,
    request_id: request.request_id,
    response_language: "zh-CN",
    user_text: request.user_message,
  };
}

function convertDifyDiagnoseResponse(
  request: AiWorkflowRequest,
  raw: unknown,
): AiWorkflowResponse | null {
  const parsed = difyDiagnoseAnswerSchema.safeParse(nativeOutputs(raw));
  if (!parsed.success) return null;
  if (parsed.data.status === "insufficient_context") {
    return workflowFailure(
      request,
      "insufficient_context",
      "CONTEXT_INCOMPLETE",
      "诊断工作流未获得足够的后端学习依据。",
      false,
    );
  }
  if (parsed.data.status === "unavailable") {
    return workflowFailure(
      request,
      "unavailable",
      "UPSTREAM_UNAVAILABLE",
      "诊断工作流暂时不可用。",
      true,
    );
  }
  if (parsed.data.status === "failed") {
    return workflowFailure(
      request,
      "failed",
      "WORKFLOW_FAILED",
      "诊断工作流未生成可安全展示的结果。",
      false,
    );
  }
  const hints = stringArray(parsed.data.step_by_step_hints, 10);
  const references = diagnoseReferenceIds(parsed.data.knowledge_references, request);
  const nextActions = stringArray(parsed.data.next_actions, 10);
  if (!parsed.data.error_analysis || hints.length === 0 || references.length === 0 || nextActions.length === 0) {
    return null;
  }
  return convertModelWorkflowAnswer(request, {
    status: "success",
    request_id: request.request_id,
    display_blocks: [
      { kind: "feedback", content: parsed.data.error_analysis },
      { kind: "hint", content: hints.join("\n") },
    ],
    reference_ids: references,
    next_actions: nextActions,
    failure_reasons: [],
  });
}

function parseAnswer(raw: unknown) {
  const envelope = asRecord(raw);
  const envelopeData = asRecord(envelope?.data);
  const data = asRecord(envelopeData?.data) ?? envelopeData;
  const outputs = asRecord(data?.outputs);
  const candidates: unknown[] = [outputs];
  let nested = outputs?.answer;
  if (typeof nested === "string") {
    try {
      nested = JSON.parse(nested) as unknown;
    } catch {
      nested = null;
    }
  }
  candidates.push(nested);
  for (const candidate of candidates) {
    const parsed = modelWorkflowAnswerSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function sourceText(request: AiWorkflowRequest) {
  if (request.context.source_chunks.length === 0) {
    return "[当前请求无可用课程来源片段；不得补写教材事实。]";
  }
  const chunks = request.context.source_chunks.map((chunk) => {
    const content = chunk.content.slice(0, 4_000);
    return `[片段ID: ${chunk.source_chunk_id}] ${chunk.chapter}\n${content}`;
  });
  return chunks.join("\n\n").slice(0, 20_000);
}

function studentProfile(request: AiWorkflowRequest) {
  const progress = request.context.reading_progress
    ? `当前阅读块 ${request.context.reading_progress.chunk_id}，段落 ${request.context.reading_progress.paragraph_index}`
    : "当前没有可用的阅读进度";
  const evidence = request.learning_evidence
    .slice(0, 20)
    .map((item) => item.summary)
    .join("；");
  return `${progress}。学习证据：${evidence || "暂无"}`.slice(0, 2_000);
}

function userText(request: AiWorkflowRequest) {
  const message = request.user_message?.trim() || "";
  const concept = request.context.concept;
  if (request.capability === "diagnose" && request.context.attempt) {
    const attempt = request.context.attempt;
    const evaluation = request.context.evaluation;
    const options = attempt.options
      .map((option) => `${option.option_id}. ${option.text}`)
      .join("；");
    return [
      message || "请诊断本次作答的错因，并给出不直接揭示标准答案的分步提示。",
      `题目：${attempt.question_text}`,
      `选项：${options}`,
      `学生作答：${attempt.selected_option_ids.join("、")}`,
      `确定性评测：${evaluation?.status === "correct" ? "正确" : "错误"}，得分 ${evaluation?.score ?? 0}`,
      "请只依据提供的课程片段，不要输出标准答案、正确选项或内部判题字段。",
    ].join("\n").slice(0, 12_000);
  }
  if (request.capability === "coach" && request.context.qa_case) {
    return [
      message || "请围绕这个案例给出分步提示和追问，不要直接代做。",
      `案例问题：${request.context.qa_case.question}`,
      `课程案例参考材料：${request.context.qa_case.answer}`,
    ].join("\n").slice(0, 12_000);
  }
  if (request.capability === "explain" && concept) {
    return [
      message || "请基于课程来源讲解当前知识点。",
      `知识点：${concept.title}`,
      `学习目标：${concept.learning_objective}`,
      `关键术语：${concept.key_terms.join("、")}`,
    ].join("\n").slice(0, 12_000);
  }
  if (request.capability === "plan") {
    return [
      message || "请根据当前课程和学习证据安排下一步学习任务。",
      `课程：${request.context.course.title}`,
    ].join("\n").slice(0, 12_000);
  }
  return (message || "请基于当前学习上下文提供下一步建议。").slice(0, 12_000);
}

export class DifyAiWorkflowGateway implements AiWorkflowGateway {
  readonly #endpoint: string;
  readonly #secret: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #allowUnverifiedSources: boolean;
  readonly #runtimeStatus: AiWorkflowRuntimeStatusTracker;

  constructor(options: DifyAiWorkflowGatewayOptions) {
    this.#endpoint = options.endpoint.replace(/\/$/u, "");
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
      const inputs = request.capability === "diagnose"
        ? diagnoseInputs(request)
        : request.capability === "care"
          ? careInputs(request)
          : {
            capability: request.capability,
            request_id: request.request_id,
            user_text: userText(request),
            textbook_snippets: sourceText(request),
            student_profile: studentProfile(request),
          };
      if (!inputs) {
        return workflowFailure(
          request,
          "insufficient_context",
          "CONTEXT_INCOMPLETE",
          request.capability === "care"
            ? "当前缺少有效的关怀交流同意或合法学习任务。"
            : "当前作答与确定性评测上下文不足。",
          false,
        );
      }
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#secret}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.request_id,
          "X-Xuetu-Contract-Version": "0.2",
        },
        body: JSON.stringify({
          inputs,
          response_mode: "blocking",
          user: "xuetu-ai-workflow",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          return this.#track(workflowFailure(
            request,
            "unavailable",
            "UPSTREAM_UNAVAILABLE",
            "AI 学习工作流暂时不可用。",
            true,
          ));
        }
        return this.#track(workflowFailure(
          request,
          "failed",
          "WORKFLOW_FAILED",
          `AI 学习工作流拒绝了请求（HTTP ${response.status}）。`,
          false,
        ));
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return this.#track(workflowFailure(
          request,
          "failed",
          "WORKFLOW_FAILED",
          "AI 学习工作流返回了无法解析的数据。",
          false,
        ));
      }
      const result = request.capability === "diagnose"
        ? convertDifyDiagnoseResponse(request, raw) ?? (() => {
            const answer = parseAnswer(raw);
            return answer ? convertModelWorkflowAnswer(request, answer) : null;
          })()
        : (() => {
            const answer = parseAnswer(raw);
            return answer ? convertModelWorkflowAnswer(request, answer) : null;
          })();
      if (!result) {
        return this.#track(workflowFailure(
          request,
          "failed",
          "WORKFLOW_FAILED",
          "AI 学习工作流响应未通过安全契约校验。",
          false,
        ));
      }
      return this.#track(result);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return this.#track(workflowFailure(
          request,
          "failed",
          "WORKFLOW_TIMEOUT",
          "AI 学习工作流在20秒内未返回。",
          true,
        ));
      }
      return this.#track(workflowFailure(
        request,
        "unavailable",
        "UPSTREAM_UNAVAILABLE",
        "无法连接 AI 学习工作流。",
        true,
      ));
    } finally {
      clearTimeout(timeout);
    }
  }

  #track(response: AiWorkflowResponse) {
    this.#runtimeStatus.record(response);
    return response;
  }
}
