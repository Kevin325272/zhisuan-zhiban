import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  type AiWorkflowCapability,
  type AiWorkflowInvocation,
  type AiWorkflowRequest,
  type AiWorkflowResponse,
  type PlatformRole,
} from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import type { AiWorkflowGateway } from "../src/services/ai-workflow/ai-workflow-gateway.js";
import {
  WorkflowContextIncompleteError,
  type BuildWorkflowContextInput,
  type WorkflowContextRepository,
} from "../src/services/ai-workflow/workflow-context.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

function invocation(capability: AiWorkflowCapability): AiWorkflowInvocation {
  return {
    contract_version: "0.2",
    capability,
    course_id: "course_408_co",
    concept_id:
      capability === "explain" || capability === "coach"
        ? "co_c01_01"
        : null,
    qa_id: capability === "coach" ? "co_qa_001" : null,
    attempt_id: capability === "diagnose" ? "attempt_001" : null,
    ...(capability === "care" ? { conversation_id: "care_talk_001" } : {}),
    user_message: capability === "care" ? "我想聊聊今天怎么开始。" : null,
  };
}

function builtRequest(
  input: BuildWorkflowContextInput,
): AiWorkflowRequest {
  const concept = input.invocation.concept_id
    ? {
        concept_id: input.invocation.concept_id,
        title: "硬件、软件与计算机系统",
        learning_objective: "区分硬件与软件。",
        key_terms: ["硬件", "软件"],
      }
    : null;
  const sourceChunks = concept
    ? [{
        source_chunk_id: "co_chunk_001",
        chapter: "1 计算机系统概论",
        locator: "教材来源块",
        content: "计算机系统由硬件和软件共同组成。",
      }]
    : [];
  const attempt = input.invocation.attempt_id
    ? {
        attempt_id: input.invocation.attempt_id,
        question_id: "question_001",
        subject: "组成原理",
        question_text: "MAR用于保存什么？",
        options: [
          { option_id: "A", text: "地址" },
          { option_id: "B", text: "数据" },
        ],
        selected_option_ids: ["B"],
        submitted_at: "2026-07-28T00:00:00.000Z",
      }
    : null;
  return {
    contract_version: "0.2",
    request_id: input.requestId,
    capability: input.invocation.capability,
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY[input.invocation.capability],
    user_id: input.userId,
    course_id: input.invocation.course_id,
    concept_id: concept?.concept_id ?? null,
    source_chunk_ids: sourceChunks.map((item) => item.source_chunk_id),
    attempt_id: attempt?.attempt_id ?? null,
    learning_evidence: [],
    user_message: input.invocation.user_message,
    context: {
      student: { user_id: input.userId },
      course: {
        course_id: input.invocation.course_id,
        title: "计算机组成原理",
        discipline: "计算机科学与技术",
      },
      concept,
      source_chunks: sourceChunks,
      reading_progress: null,
      qa_case: input.invocation.qa_id
        ? {
            qa_id: input.invocation.qa_id,
            question: "什么是机器字长？",
            answer: "CPU一次能处理的二进制位数。",
          }
        : null,
      attempt,
      evaluation: attempt
        ? {
            evaluation_id: "evaluation_001",
            grading_mode: "deterministic_choice",
            status: "incorrect",
            is_correct: false,
            score: 0,
            correct_option_ids: ["A"],
            explanation: "MAR保存地址。",
            created_at: "2026-07-28T00:00:01.000Z",
          }
        : null,
      care_check_in: input.invocation.capability === "care"
        ? {
            conversation_id: input.invocation.conversation_id!,
            recent_turns: [],
            signal_code: "rhythm_drop",
            reason_summary: "最近一周完成学习任务的天数比此前少。",
            consented_at: "2026-08-20T01:05:00.000Z",
            current_task: {
              task_id: "task_current_001",
              task_type: "course_reading",
              course_id: input.invocation.course_id,
              course_title: "计算机组成原理",
              concept_title: null,
              title: "继续课程阅读",
              estimated_minutes: 20,
              href: "/student/courses/computer-organization",
            },
          }
        : null,
    },
  };
}

function unavailable(request: AiWorkflowRequest): AiWorkflowResponse {
  return {
    contract_version: "0.2",
    request_id: request.request_id,
    capability: request.capability,
    slot: request.slot,
    status: "unavailable",
    display_blocks: [],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure: {
      code: "WORKFLOW_NOT_CONNECTED",
      message: "AI 学习工作流尚未接入。",
      retryable: false,
      fallback_message: "先使用非AI学习路径继续。",
    },
  };
}

function readyCare(request: AiWorkflowRequest, content: string): AiWorkflowResponse {
  return {
    contract_version: "0.2",
    request_id: request.request_id,
    capability: "care",
    slot: "supportive_check_in",
    status: "ready",
    display_blocks: [{
      block_id: `${request.request_id}_summary`,
      kind: "summary",
      title: "学伴交流",
      content,
    }],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure: null,
  };
}

describe("student AI workflow routes", () => {
  let app: FastifyInstance;
  let actorRoles: PlatformRole[];
  let courseAssigned: boolean;
  let actorExists: boolean;
  let contextFailure: boolean;
  let contextInputs: BuildWorkflowContextInput[];
  let gatewayRequests: AiWorkflowRequest[];
  let gatewayRun: (request: AiWorkflowRequest) => Promise<AiWorkflowResponse>;
  let statusCapabilities: Array<AiWorkflowCapability | undefined>;

  beforeEach(() => {
    actorRoles = ["student"];
    courseAssigned = true;
    actorExists = true;
    contextFailure = false;
    contextInputs = [];
    gatewayRequests = [];
    gatewayRun = async (request) => unavailable(request);
    statusCapabilities = [];

    const platformAccess: PlatformAccessService = {
      async getActor(userId) {
        if (!actorExists) return null;
        return {
          user: {
            user_id: userId,
            display_name: "本地演示学生",
            account_status: "active",
            auth_source: "local_development",
            created_at: "2026-07-28T00:00:00.000Z",
            updated_at: "2026-07-28T00:00:00.000Z",
          },
          roles: actorRoles,
        };
      },
      async isCourseAssigned() {
        return courseAssigned;
      },
    };
    const workflowContext: WorkflowContextRepository = {
      async build(input) {
        contextInputs.push(input);
        if (contextFailure) throw new WorkflowContextIncompleteError("attempt");
        return builtRequest(input);
      },
    };
    const aiWorkflowGateway: AiWorkflowGateway = {
      status(capability) {
        statusCapabilities.push(capability);
        return {
          state: "configured",
          label: "AI 服务已配置，尚未验证",
          detail: "完成一次成功调用后才会显示可用。",
          checked_at: null,
        };
      },
      async run(request) {
        gatewayRequests.push(request);
        return gatewayRun(request);
      },
    };
    app = buildApp({
      answerModel: null,
      platformAccess,
      workflowContext,
      aiWorkflowGateway,
      allowLocalDevAuth: true,
    });
  });

  afterEach(async () => app.close());

  async function invoke(
    capability: AiWorkflowCapability,
    withIdentity = true,
    overrides: Partial<AiWorkflowInvocation> = {},
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/student/ai-workflows/${capability}`,
      ...(withIdentity
        ? { headers: { "x-dev-user-id": "user_student_001" } }
        : {}),
      payload: { ...invocation(capability), ...overrides },
    });
  }

  it("requires a real local student identity and active course membership", async () => {
    const anonymous = await invoke("plan", false);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("AUTHENTICATION_REQUIRED");

    actorExists = false;
    const missing = await invoke("plan");
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("ACTOR_NOT_FOUND");

    actorExists = true;
    actorRoles = ["teacher"];
    const teacher = await invoke("plan");
    expect(teacher.statusCode).toBe(403);

    actorRoles = ["student"];
    courseAssigned = false;
    const unassigned = await invoke("plan");
    expect(unassigned.statusCode).toBe(403);
    expect(contextInputs).toHaveLength(0);
  });

  it("reports the gateway runtime state without claiming a configured service is connected", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/ai-workflows/status?capability=diagnose",
      headers: { "x-dev-user-id": "user_student_001" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      state: "configured",
      label: "AI 服务已配置，尚未验证",
      detail: "完成一次成功调用后才会显示可用。",
      checked_at: null,
    });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("已连接专业知识库");
    expect(statusCapabilities).toEqual(["diagnose"]);
  });

  it("validates capability-specific browser input before context construction", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/ai-workflows/explain",
      headers: { "x-dev-user-id": "user_student_001" },
      payload: {
        ...invocation("explain"),
        concept_id: null,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("AI_WORKFLOW_INVOCATION_INVALID");
    expect(contextInputs).toHaveLength(0);
  });

  it("builds and returns honest unavailable responses for all five capabilities", async () => {
    for (const capability of ["plan", "explain", "coach", "diagnose", "care"] as const) {
      const response = await invoke(capability);
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        capability,
        status: "unavailable",
        failure: { code: "WORKFLOW_NOT_CONNECTED" },
      });
    }
    expect(contextInputs.map((input) => input.invocation.capability)).toEqual([
      "plan",
      "explain",
      "coach",
      "diagnose",
      "care",
    ]);
    expect(gatewayRequests).toHaveLength(5);
  });

  it("injects bounded server-owned history into the next turn of one care conversation", async () => {
    gatewayRun = async (request) => readyCare(
      request,
      gatewayRequests.length === 1
        ? "先从十分钟内能完成的一步开始。"
        : "可以，接着沿用刚才的轻量起点。",
    );

    const first = await invoke("care", true, { user_message: "我今天很难开始。" });
    const second = await invoke("care", true, { user_message: "那我先做哪一步？" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(gatewayRequests[0]?.context.care_check_in?.recent_turns).toEqual([]);
    expect(gatewayRequests[1]?.context.care_check_in?.recent_turns).toEqual([
      { role: "user", content: "我今天很难开始。" },
      { role: "assistant", content: "先从十分钟内能完成的一步开始。" },
    ]);
  });

  it("intercepts an explicit care crisis message before context construction or gateway access", async () => {
    const response = await invoke("care", true, {
      user_message: "我真的不想活了",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      capability: "care",
      slot: "supportive_check_in",
      status: "ready",
      display_blocks: [{
        kind: "notice",
        title: "先确保你的安全",
        content: expect.stringContaining("120 或 110"),
      }],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: null,
    });
    expect(response.body).toContain("立即联系一位身边可信任的人");
    expect(contextInputs).toHaveLength(0);
    expect(gatewayRequests).toHaveLength(0);
  });

  it("returns insufficient_context without revealing attempt existence", async () => {
    contextFailure = true;
    const response = await invoke("diagnose");

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: "insufficient_context",
      failure: { code: "CONTEXT_INCOMPLETE", retryable: false },
    });
    expect(response.body).not.toContain("attempt");
    expect(gatewayRequests).toHaveLength(0);
  });

  it("does not call the model when care talk consent is absent or stale", async () => {
    contextFailure = true;
    const response = await invoke("care");

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      capability: "care",
      status: "insufficient_context",
      citations: [],
      evidence_refs: [],
      failure: {
        code: "CONTEXT_INCOMPLETE",
        retryable: false,
        fallback_message: "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。",
      },
    });
    expect(gatewayRequests).toHaveLength(0);
  });

  it("never returns server secrets or upstream request answer fields", async () => {
    const response = await invoke("diagnose");
    expect(response.body).not.toContain("AI_WORKFLOW_SECRET");
    expect(response.body).not.toContain("correct_option_ids");
    expect(response.body).not.toContain("MAR保存地址");
  });
});
