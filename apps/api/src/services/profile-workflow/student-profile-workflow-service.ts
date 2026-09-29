import {
  aiWorkflowFailureSchema,
  studentProfileWorkflowResponseSchema,
  type AiWorkflowRuntimeStatus,
  type StudentProfileWorkflowResponse,
} from "@xuetu/contracts";

import type {
  ProfileWorkflowContext,
  ProfileWorkflowContextRepository,
} from "./profile-workflow-context.js";

export interface StudentProfileWorkflowGateway {
  configured?: boolean;
  run(context: ProfileWorkflowContext): Promise<StudentProfileWorkflowResponse>;
}

const PROFILE_STATUS_TTL_MS = 5 * 60 * 1_000;

function configuredStatus(): AiWorkflowRuntimeStatus {
  return {
    state: "configured",
    label: "AI 画像服务已配置，尚未验证",
    detail: "完成一次真实画像调用后才会显示可用。",
    checked_at: null,
  };
}

function notConfiguredStatus(): AiWorkflowRuntimeStatus {
  return {
    state: "not_configured",
    label: "AI 画像服务待连接",
    detail: "尚未配置外部 AI 画像工作流。",
    checked_at: null,
  };
}

function statusForResponse(
  response: StudentProfileWorkflowResponse,
  checkedAt: string,
): AiWorkflowRuntimeStatus {
  if (response.status === "ready") {
    const trace = response.model_trace;
    const detail = trace?.provider_model
      ? trace.matched
        ? `上游报告模型 ${trace.provider_model}，耗时 ${trace.latency_ms} ms。`
        : `上游报告模型 ${trace.provider_model}，与请求模型 ${trace.requested_model} 不一致；耗时 ${trace.latency_ms} ms。`
      : null;
    return {
      state: "available",
      label: "AI 画像解读可用",
      detail,
      checked_at: checkedAt,
    };
  }
  return {
    state: "unavailable",
    label: "AI 画像服务暂不可用",
    detail: "最近一次画像工作流调用未成功，确定性画像仍可查看。",
    checked_at: checkedAt,
  };
}

function insufficientContext(requestId: string): StudentProfileWorkflowResponse {
  return studentProfileWorkflowResponseSchema.parse({
    contract_version: "0.2",
    request_id: requestId,
    status: "insufficient_context",
    profile_summary: "先完成首次学习设置，平台再为你生成画像解读。",
    course_progress: [],
    strengths: [],
    priority_gaps: [],
    evidence_summary: {
      objective_evidence_count: 0,
      subjective_evidence_count: 0,
      reading_progress_count: 0,
      practice_attempt_count: 0,
      needs_review_count: 0,
      explanation: "首次学习设置尚未完成，暂不调用画像工作流。",
    },
    next_tasks: [],
    failure: aiWorkflowFailureSchema.parse({
      code: "CONTEXT_INCOMPLETE",
      message: "当前学习设置不足以生成画像解读。",
      retryable: false,
      fallback_message: "先完成目标与四门课程自评，课程学习入口仍可使用。",
    }),
  });
}

export class StudentProfileWorkflowService {
  #observation: { status: AiWorkflowRuntimeStatus; expiresAt: number } | null = null;

  constructor(
    private readonly contextRepository: ProfileWorkflowContextRepository,
    private readonly gateway: StudentProfileWorkflowGateway,
  ) {}

  status(): AiWorkflowRuntimeStatus {
    if (this.gateway.configured === false) return notConfiguredStatus();
    if (!this.#observation || this.#observation.expiresAt <= Date.now()) {
      this.#observation = null;
      return configuredStatus();
    }
    return { ...this.#observation.status };
  }

  async generate(
    userId: string,
    requestId: string,
    courseId: string,
  ): Promise<StudentProfileWorkflowResponse> {
    const context = await this.contextRepository.build(userId, requestId, courseId);
    if (!context) return insufficientContext(requestId);
    const response = studentProfileWorkflowResponseSchema.parse(await this.gateway.run(context));
    if (response.status !== "insufficient_context") {
      const observedAt = Date.now();
      this.#observation = {
        status: statusForResponse(response, new Date(observedAt).toISOString()),
        expiresAt: observedAt + PROFILE_STATUS_TTL_MS,
      };
    }
    return response;
  }
}
