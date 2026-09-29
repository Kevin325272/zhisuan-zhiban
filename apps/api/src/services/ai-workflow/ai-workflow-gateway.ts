import {
  type AiWorkflowCapability,
  type AiWorkflowFailure,
  type AiWorkflowRequest,
  type AiWorkflowResponse,
  type AiWorkflowRuntimeStatus,
} from "@xuetu/contracts";

export interface AiWorkflowGateway {
  status(capability?: AiWorkflowCapability): AiWorkflowRuntimeStatus;
  run(request: AiWorkflowRequest): Promise<AiWorkflowResponse>;
}

export class CapabilityRoutedAiWorkflowGateway implements AiWorkflowGateway {
  constructor(
    private readonly defaultGateway: AiWorkflowGateway,
    private readonly overrides: Partial<Record<AiWorkflowCapability, AiWorkflowGateway>>,
  ) {}

  status(capability: AiWorkflowCapability = "plan"): AiWorkflowRuntimeStatus {
    return this.gatewayFor(capability).status(capability);
  }

  run(request: AiWorkflowRequest): Promise<AiWorkflowResponse> {
    return this.gatewayFor(request.capability).run(request);
  }

  private gatewayFor(capability: AiWorkflowCapability) {
    return this.overrides[capability] ?? this.defaultGateway;
  }
}

type FailureStatus = Extract<
  AiWorkflowResponse["status"],
  "unavailable" | "failed" | "insufficient_context"
>;

export function failedWorkflowResponse(
  request: AiWorkflowRequest,
  status: FailureStatus,
  failure: AiWorkflowFailure,
): AiWorkflowResponse {
  return {
    contract_version: "0.2",
    request_id: request.request_id,
    capability: request.capability,
    slot: request.slot,
    status,
    display_blocks: [],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure,
  };
}

export class UnavailableAiWorkflowGateway implements AiWorkflowGateway {
  status(): AiWorkflowRuntimeStatus {
    return {
      state: "not_configured",
      label: "AI 服务待连接",
      detail: "尚未配置外部 AI 学习工作流。",
      checked_at: null,
    };
  }

  async run(request: AiWorkflowRequest): Promise<AiWorkflowResponse> {
    return failedWorkflowResponse(request, "unavailable", {
      code: "WORKFLOW_NOT_CONNECTED",
      message: "AI 学习工作流尚未接入。",
      retryable: false,
      fallback_message: request.capability === "care"
        ? "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。"
        : "先使用课程资料、案例和确定性评测继续学习。",
    });
  }
}
