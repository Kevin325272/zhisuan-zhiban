import { describe, expect, it, vi } from "vitest";

import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  type AiWorkflowRequest,
  type AiWorkflowResponse,
} from "@xuetu/contracts";

import {
  AiWorkflowConfigurationError,
  readAiWorkflowConfig,
} from "../src/config/ai-workflow.js";
import {
  UnavailableAiWorkflowGateway,
} from "../src/services/ai-workflow/ai-workflow-gateway.js";
import {
  HttpAiWorkflowGateway,
} from "../src/services/ai-workflow/http-ai-workflow-gateway.js";
import {
  convertModelWorkflowAnswer,
  runtimeStatusForWorkflowResponse,
} from "../src/services/ai-workflow/model-workflow-response.js";

function request(): AiWorkflowRequest {
  return {
    contract_version: "0.2",
    request_id: "workflow_req_001",
    capability: "explain",
    slot: "contextual_explanation",
    user_id: "user_student_001",
    course_id: "course_408_co",
    concept_id: "co_c01_01",
    source_chunk_ids: ["co_chunk_k0012"],
    attempt_id: null,
    learning_evidence: [{
      evidence_id: "evidence_001",
      kind: "reading_progress",
      summary: "已阅读当前知识点。",
      observed_at: "2026-07-28T00:00:00.000Z",
    }],
    user_message: null,
    context: {
      student: { user_id: "user_student_001" },
      course: {
        course_id: "course_408_co",
        title: "计算机组成原理",
        discipline: "计算机科学与技术",
      },
      concept: {
        concept_id: "co_c01_01",
        title: "硬件、软件与计算机系统",
        learning_objective: "区分硬件与软件。",
        key_terms: ["硬件", "软件"],
      },
      source_chunks: [{
        source_chunk_id: "co_chunk_k0012",
        chapter: "1 计算机系统概论",
        locator: "教材来源块 k0012",
        content: "计算机系统由硬件和软件共同组成。",
      }],
      reading_progress: null,
      qa_case: null,
      attempt: null,
      evaluation: null,
    },
  };
}

function careRequest(): AiWorkflowRequest {
  return {
    contract_version: "0.2",
    request_id: "workflow_care_private_001",
    capability: "care",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.care,
    user_id: "user_student_001",
    course_id: "course_408_co",
    concept_id: null,
    source_chunk_ids: [],
    attempt_id: null,
    learning_evidence: [],
    user_message: "我想先找一个今天能开始的步骤。",
    context: {
      student: { user_id: "user_student_001" },
      course: {
        course_id: "course_408_co",
        title: "计算机组成原理",
        discipline: "计算机科学与技术",
      },
      concept: null,
      source_chunks: [],
      reading_progress: null,
      qa_case: null,
      attempt: null,
      evaluation: null,
      care_check_in: {
        conversation_id: "care_talk_001",
        recent_turns: [
          { role: "assistant", content: "今天想先从哪里开始？" },
          { role: "user", content: "我想把任务拆小一点。" },
        ],
        signal_code: "rhythm_drop",
        reason_summary: "最近一周完成学习任务的天数比此前少。",
        consented_at: "2026-08-20T01:05:00.000Z",
        current_task: {
          task_id: "task_current_001",
          task_type: "course_reading",
          course_id: "course_408_co",
          course_title: "计算机组成原理",
          concept_title: null,
          title: "继续课程阅读",
          estimated_minutes: 20,
          href: "/student/courses/computer-organization",
        },
      },
    },
  };
}

function readyResponse(overrides: Partial<AiWorkflowResponse> = {}): AiWorkflowResponse {
  return {
    contract_version: "0.2",
    request_id: "workflow_req_001",
    capability: "explain",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.explain,
    status: "ready",
    display_blocks: [{
      block_id: "block_001",
      kind: "summary",
      title: "理解起点",
      content: "硬件执行，软件描述任务。",
    }],
    citations: [{
      citation_id: "citation_001",
      source_chunk_id: "co_chunk_k0012",
      label: "当前课程资料",
      locator: null,
    }],
    evidence_refs: [{
      evidence_id: "evidence_001",
      label: "当前阅读证据",
      summary: "已阅读当前知识点。",
    }],
    next_actions: [],
    failure: null,
    ...overrides,
  };
}

describe("AI workflow server-only configuration", () => {
  it("treats an entirely absent configuration as an honest unconnected state", () => {
    expect(readAiWorkflowConfig({})).toBeNull();
    expect(readAiWorkflowConfig({
      AI_WORKFLOW_BASE_URL: " ",
      AI_WORKFLOW_SECRET: " ",
    })).toBeNull();
  });

  it("rejects partial credentials and insecure remote HTTP", () => {
    expect(() => readAiWorkflowConfig({
      AI_WORKFLOW_BASE_URL: "http://127.0.0.1:4310",
    })).toThrow(AiWorkflowConfigurationError);
    expect(() => readAiWorkflowConfig({
      AI_WORKFLOW_BASE_URL: "http://workflow.example.com",
      AI_WORKFLOW_SECRET: "server-only-secret",
    })).toThrow("HTTPS");
  });

  it("accepts the server-only Dify provider and keeps the full workflow endpoint", () => {
    expect(readAiWorkflowConfig({
      AI_WORKFLOW_PROVIDER: "dify",
      AI_WORKFLOW_BASE_URL: "https://workflow.example.test/v1/workflows/run/",
      AI_WORKFLOW_SECRET: "server-only-secret",
    })).toEqual({
      provider: "dify",
      baseUrl: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      timeoutMs: 20_000,
    });
  });

  it("keeps the OpenAI-compatible provider authoritative when legacy workflow credentials remain", () => {
    expect(readAiWorkflowConfig({
      AI_WORKFLOW_PROVIDER: "openai_compatible",
      AI_WORKFLOW_BASE_URL: "https://legacy-workflow.example.test/v1/workflows/run",
      AI_WORKFLOW_SECRET: "legacy-workflow-secret",
    })).toEqual({
      provider: "openai_compatible",
      timeoutMs: 20_000,
    });
  });

  it("routes diagnose to its dedicated gateway without changing the other three providers", async () => {
    const gatewayModule = await import(
      "../src/services/ai-workflow/ai-workflow-gateway.js"
    ) as unknown as {
      CapabilityRoutedAiWorkflowGateway?: new (
        defaultGateway: {
          status(): ReturnType<UnavailableAiWorkflowGateway["status"]>;
          run(value: AiWorkflowRequest): Promise<AiWorkflowResponse>;
        },
        overrides: Partial<Record<AiWorkflowRequest["capability"], {
          status(): ReturnType<UnavailableAiWorkflowGateway["status"]>;
          run(value: AiWorkflowRequest): Promise<AiWorkflowResponse>;
        }>>,
      ) => {
        status(capability?: AiWorkflowRequest["capability"]): ReturnType<UnavailableAiWorkflowGateway["status"]>;
        run(value: AiWorkflowRequest): Promise<AiWorkflowResponse>;
      };
    };
    expect(gatewayModule.CapabilityRoutedAiWorkflowGateway).toBeTypeOf("function");
    const calls: string[] = [];
    const createGateway = (name: string) => ({
      status() {
        return new UnavailableAiWorkflowGateway().status();
      },
      async run(value: AiWorkflowRequest) {
        calls.push(`${name}:${value.capability}`);
        return new UnavailableAiWorkflowGateway().run(value);
      },
    });
    const RoutedGateway = gatewayModule.CapabilityRoutedAiWorkflowGateway!;
    const routed = new RoutedGateway(createGateway("default"), {
      diagnose: createGateway("diagnose"),
    });

    await routed.run(request());
    await routed.run({
      ...request(),
      capability: "diagnose",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
    });

    expect(calls).toEqual(["default:explain", "diagnose:diagnose"]);
  });
});

describe("AI workflow gateway", () => {
  it("fails closed when care output diagnoses distress, promises secrecy, or mutates learning state", async () => {
    const unsafeContents = [
      "我判断你已经患有焦虑症。",
      "你说的内容我会绝对保密，不会告诉任何人。",
      "我已经把你的掌握度和任务状态调低了。",
    ];

    for (const [index, unsafeContent] of unsafeContents.entries()) {
      const converted = convertModelWorkflowAnswer(careRequest(), {
        status: "success",
        request_id: "workflow_care_private_001",
        display_blocks: unsafeContent,
        reference_ids: [],
        next_actions: [{
          kind: "read",
          label: "继续当前课程阅读",
          target: "/student/courses/computer-organization",
        }],
        failure_reasons: [],
      });

      expect(converted, unsafeContent).toBeNull();

      const unsafeResponse = readyResponse({
        request_id: "workflow_care_private_001",
        capability: "care",
        slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.care,
        display_blocks: [{
          block_id: `care_block_unsafe_${index}`,
          kind: "summary",
          title: "学伴交流",
          content: unsafeContent,
        }],
        citations: [],
        evidence_refs: [],
        next_actions: [{
          action_id: `care_action_unsafe_${index}`,
          kind: "continue_learning",
          label: "继续当前课程阅读",
          target: "/student/courses/computer-organization",
        }],
      });
      const gateway = new HttpAiWorkflowGateway({
        baseUrl: "http://127.0.0.1:4310",
        secret: "server-only-secret",
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify(unsafeResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
        allowUnverifiedSources: true,
      });

      await expect(gateway.run(careRequest()), unsafeContent).resolves.toMatchObject({
        status: "failed",
        failure: { code: "WORKFLOW_FAILED" },
        display_blocks: [],
      });
    }
  });

  it("exports only the consent-gated care DTO and keeps an honest offline fallback", async () => {
    const outbound = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(readyResponse({
        request_id: "workflow_care_private_001",
        capability: "care",
        slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.care,
        display_blocks: [{
          block_id: "care_block_001",
          kind: "summary",
          title: "学伴交流",
          content: "先从当前阅读任务中选一个容易开始的步骤。",
        }],
        citations: [],
        evidence_refs: [],
        next_actions: [{
          action_id: "care_action_001",
          kind: "continue_learning",
          label: "继续当前课程阅读",
          target: "/student/courses/computer-organization",
        }],
      })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const gateway = new HttpAiWorkflowGateway({
      baseUrl: "http://127.0.0.1:4310",
      secret: "server-only-secret",
      fetchImpl: outbound,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(careRequest())).resolves.toMatchObject({
      capability: "care",
      status: "ready",
      citations: [],
      evidence_refs: [],
    });
    const body = JSON.parse(String(outbound.mock.calls[0]?.[1]?.body)) as {
      context: Record<string, unknown>;
    };
    expect(Object.keys(body.context).sort()).toEqual(["care_check_in", "course"]);
    expect(body.context).toMatchObject({
      care_check_in: {
        conversation_id: "care_talk_001",
        recent_turns: [
          { role: "assistant", content: "今天想先从哪里开始？" },
          { role: "user", content: "我想把任务拆小一点。" },
        ],
        signal_code: "rhythm_drop",
        reason_summary: "最近一周完成学习任务的天数比此前少。",
        current_task: { task_id: "task_current_001" },
      },
    });
    expect(JSON.stringify(body)).not.toContain("user_student_001");
    expect(JSON.stringify(body)).not.toContain("attempt");
    expect(JSON.stringify(body)).not.toContain("evaluation");

    const offline = new HttpAiWorkflowGateway({
      baseUrl: "http://127.0.0.1:4310",
      secret: "server-only-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("unavailable", { status: 503 }),
      ),
      allowUnverifiedSources: true,
    });
    await expect(offline.run(careRequest())).resolves.toMatchObject({
      capability: "care",
      status: "unavailable",
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        fallback_message: "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。",
      },
    });
  });

  it("does not call insufficient-context responses available", () => {
    const status = runtimeStatusForWorkflowResponse({
      ...readyResponse(),
      status: "insufficient_context",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      failure: {
        code: "CONTEXT_INCOMPLETE",
        message: "上下文不足。",
        retryable: false,
        fallback_message: "继续课程学习。",
      },
    });

    expect(status).toMatchObject({
      state: "degraded",
      label: "AI 服务需更多学习依据",
    });
  });

  it("reports not configured before any external workflow is available", () => {
    expect(new UnavailableAiWorkflowGateway().status()).toEqual({
      state: "not_configured",
      label: "AI 服务待连接",
      detail: "尚未配置外部 AI 学习工作流。",
      checked_at: null,
    });
  });

  it("returns unavailable without fabricating content when no service is configured", async () => {
    const result = await new UnavailableAiWorkflowGateway().run(request());

    expect(result).toMatchObject({
      status: "unavailable",
      failure: { code: "WORKFLOW_NOT_CONNECTED", retryable: false },
      display_blocks: [],
      citations: [],
      evidence_refs: [],
    });

    await expect(new UnavailableAiWorkflowGateway().run(careRequest())).resolves.toMatchObject({
      capability: "care",
      status: "unavailable",
      failure: {
        code: "WORKFLOW_NOT_CONNECTED",
        fallback_message: "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。",
      },
    });
  });

  it("calls the capability endpoint with server authentication and idempotency", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(readyResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const gateway = new HttpAiWorkflowGateway({
      baseUrl: "http://127.0.0.1:4310",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    expect(gateway.status()).toMatchObject({
      state: "configured",
      checked_at: null,
    });

    const result = await gateway.run(request());

    expect(result.status).toBe("ready");
    expect(gateway.status("explain")).toMatchObject({
      state: "available",
      label: "AI 学伴可用",
      checked_at: expect.any(String),
    });
    expect(gateway.status("plan")).toMatchObject({
      state: "configured",
      checked_at: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:4310/v1/ai-workflows/explain");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer server-only-secret");
    expect(headers.get("Idempotency-Key")).toBe("workflow_req_001");
    expect(headers.get("X-Xuetu-Contract-Version")).toBe("0.2");
    expect(String(init?.body)).not.toContain("server-only-secret");
  });

  it("exports only a privacy-filtered diagnose DTO and rejects a short correct-option leak", async () => {
    const diagnoseRequest: AiWorkflowRequest = {
      ...request(),
      request_id: "workflow_diagnose_private_001",
      capability: "diagnose",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
      attempt_id: "attempt_internal_001",
      context: {
        ...request().context,
        attempt: {
          attempt_id: "attempt_internal_001",
          question_id: "question_internal_001",
          subject: "计算机组成原理",
          question_text: "该题应选择哪一项？",
          options: [
            { option_id: "A", text: "甲" },
            { option_id: "B", text: "乙" },
          ],
          selected_option_ids: ["A"],
          submitted_at: "2026-08-20T00:00:00.000Z",
        },
        evaluation: {
          evaluation_id: "evaluation_internal_001",
          grading_mode: "deterministic_choice",
          status: "incorrect",
          is_correct: false,
          score: 0,
          correct_option_ids: ["B"],
          explanation: "标准答案相关内部判题说明。",
          created_at: "2026-08-20T00:00:01.000Z",
        },
      },
    };
    const upstreamResponse = readyResponse({
      request_id: diagnoseRequest.request_id,
      capability: "diagnose",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
      display_blocks: [{
        block_id: "block_diagnose_001",
        kind: "feedback",
        title: "错因反馈",
        content: "这里应使用乙。",
      }, {
        block_id: "block_diagnose_002",
        kind: "hint",
        title: "下一步提示",
        content: "先区分两个选项的作用。",
      }],
      evidence_refs: [],
      next_actions: [{
        action_id: "action_diagnose_001",
        kind: "start_practice",
        label: "继续练习",
        target: diagnoseRequest.concept_id,
      }],
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(upstreamResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await new HttpAiWorkflowGateway({
      baseUrl: "http://127.0.0.1:4310",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    }).run(diagnoseRequest);

    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).not.toContain("user_student_001");
    expect(body).not.toContain("attempt_internal_001");
    expect(body).not.toContain("question_internal_001");
    expect(body).not.toContain("evaluation_internal_001");
    expect(body).not.toContain("correct_option_ids");
    expect(body).not.toContain("标准答案相关内部判题说明");
    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      display_blocks: [],
    });
  });

  it("rejects citations and evidence references outside the submitted context", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(readyResponse({
        citations: [{
          citation_id: "citation_bad",
          source_chunk_id: "co_chunk_not_submitted",
          label: "越界来源",
          locator: null,
        }],
      })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await new HttpAiWorkflowGateway({
      baseUrl: "http://127.0.0.1:4310",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    }).run(request());

    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED", retryable: false },
    });
    expect(result.display_blocks).toEqual([]);
  });

  it("maps timeout and upstream availability without throwing into the student route", async () => {
    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const timedOut = await new HttpAiWorkflowGateway({
      baseUrl: "http://127.0.0.1:4310",
      secret: "server-only-secret",
      timeoutMs: 5,
      fetchImpl: timeoutFetch,
      allowUnverifiedSources: true,
    }).run(request());
    expect(timedOut).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_TIMEOUT", retryable: true },
    });

    const unavailable = await new HttpAiWorkflowGateway({
      baseUrl: "http://127.0.0.1:4310",
      secret: "server-only-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("unavailable", { status: 503 }),
      ),
      allowUnverifiedSources: true,
    }).run(request());
    expect(unavailable).toMatchObject({
      status: "unavailable",
      failure: { code: "UPSTREAM_UNAVAILABLE", retryable: true },
    });
  });

  it("does not send local-demo textbook chunks to a remote workflow by default", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const gateway = new HttpAiWorkflowGateway({
      baseUrl: "https://workflow.example.test",
      secret: "server-only-secret",
      fetchImpl,
    });
    const result = await gateway.run(request());

    expect(result).toMatchObject({
      status: "insufficient_context",
      failure: { code: "CONTEXT_INCOMPLETE" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gateway.status("explain")).toMatchObject({
      state: "configured",
      checked_at: null,
    });
  });
});
