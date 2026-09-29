import { describe, expect, it, vi } from "vitest";

import {
  OpenAiCompatibleProfileWorkflowGateway,
  type ProfileWorkflowContext,
} from "../src/services/profile-workflow/openai-compatible-profile-workflow-gateway.js";

function context(overrides: Partial<ProfileWorkflowContext> = {}): ProfileWorkflowContext {
  return {
    request_id: "profile_openai_001",
    user_id: "user_student_private_001",
    profile_id: "onboarding_profile_private_001",
    inputs: {
      profile_id: "onboarding_profile_private_001",
      learning_goal: JSON.stringify({ target_exam_year: 2027, preparation_stage: "foundation" }),
      course_self_assessments: JSON.stringify({ course_408_co: "weak" }),
      backend_portrait_basis: JSON.stringify({
        courses: [{
          course_id: "course_408_co",
          evidence_level: "limited",
          practice_attempt_count: 1,
          incorrect_count: 1,
        }],
        strength_candidates: [{
          candidate_id: "strength_course_408_co_knowledge_coverage",
          title: "阅读已启动",
        }],
        priority_gap_candidates: [{
          candidate_id: "gap_course_408_co_mistake_recovery_co_c01_01",
          title: "需要复习",
        }],
        allowed_next_tasks: [{
          candidate_id: "task_course_408_co_review_mistakes_co_c01_01",
          title: "继续组成原理",
        }],
      }),
      learning_evidence_summary: JSON.stringify({
        objective_evidence_count: 1,
        evidence_ids: ["evidence_001"],
      }),
      response_language: "zh-CN",
      request_id: "profile_openai_001",
    },
    course_progress: [{
      course_id: "course_408_co",
      course_title: "计算机组成原理",
      evidence_level: "limited",
      concept_count: 20,
      started_concept_count: 4,
      practice_attempt_count: 1,
      correct_count: 0,
      incorrect_count: 1,
      needs_review_count: 1,
    }],
    evidence_summary: {
      objective_evidence_count: 1,
      subjective_evidence_count: 4,
      reading_progress_count: 1,
      practice_attempt_count: 1,
      needs_review_count: 1,
      explanation: "真实证据正在形成。",
    },
    allowed_course_ids: new Set(["course_408_co"]),
    allowed_concept_ids: new Set(["co_c01_01"]),
    allowed_evidence_ids: new Set(["evidence_001"]),
    strength_candidates: new Map([
      ["strength_course_408_co_knowledge_coverage", {
        course_id: "course_408_co",
        title: "阅读已启动",
        detail: "已有阅读证据。",
        evidence_ids: ["evidence_001"],
      }],
    ]),
    gap_candidates: new Map([
      ["gap_course_408_co_mistake_recovery_co_c01_01", {
        course_id: "course_408_co",
        title: "需要复习",
        detail: "待复习证据。",
        evidence_ids: ["evidence_001"],
      }],
    ]),
    task_candidates: new Map([
      ["task_course_408_co_review_mistakes_co_c01_01", {
        title: "继续组成原理",
        reason: "先完成当前课程学习。",
        course_id: "course_408_co",
        concept_id: "co_c01_01",
        estimated_minutes: 20,
        evidence_ids: ["evidence_001"],
      }],
    ]),
    ...overrides,
  };
}

function completion(outputs: Record<string, unknown>) {
  return new Response(JSON.stringify({
    model: "gpt-5.6-terra",
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(outputs) }],
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function validSelections(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    strengths: [{ candidate_id: "strength_course_408_co_knowledge_coverage" }],
    priority_gaps: [{ candidate_id: "gap_course_408_co_mistake_recovery_co_c01_01" }],
    next_tasks: [{ candidate_id: "task_course_408_co_review_mistakes_co_c01_01" }],
    ...overrides,
  };
}

describe("OpenAI-compatible profile workflow gateway", () => {
  it.each([false, true])("validates backend-owned selections over Chat Completions (invalid=%s)", async (invalid) => {
    const model = "ZHIPU/GLM-5.3-Flash";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model, choices: [{ finish_reason: "stop", message: {
        content: JSON.stringify(validSelections(invalid ? { next_tasks: [{ candidate_id: "invented_task" }] } : {})),
        reasoning_content: "private reasoning",
      } }],
    }), { headers: { "Content-Type": "application/json" } }));
    const gateway = new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://provider.example.test/v1", apiKey: "fixture-key", model,
      apiFormat: "chat_completions", reasoningEffort: "low", maxOutputTokens: 4096, fetchImpl,
    });
    const result = await gateway.run(context());
    expect(result.status).toBe(invalid ? "failed" : "ready");
    if (!invalid) expect(result.next_tasks[0]?.title).toBe("继续组成原理");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toMatch(/\/chat\/completions$/u);
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({ reasoning_effort: "low", max_tokens: 4096 });
    expect(body).not.toContain("user_student_private_001");
    expect(body).not.toContain("onboarding_profile_private_001");
    expect(JSON.stringify(result)).not.toContain("private reasoning");
  });

  it("sends only the privacy-filtered portrait basis and resolves backend-owned candidates", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion(validSelections()));
    const gateway = new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://relay.example.test/v1/",
      apiKey: "server-only-profile-key",
      model: "gpt-5.6-terra",
      fetchImpl,
    });

    const result = await gateway.run(context());

    expect(result).toMatchObject({
      status: "ready",
      model_trace: {
        requested_model: "gpt-5.6-terra",
        provider_model: "gpt-5.6-terra",
        matched: true,
      },
      strengths: [{ title: "阅读已启动", evidence_ids: ["evidence_001"] }],
      priority_gaps: [{ title: "需要复习", evidence_ids: ["evidence_001"] }],
      next_tasks: [{ title: "继续组成原理", evidence_ids: ["evidence_001"] }],
      failure: null,
    });
    expect(result.profile_summary).toContain("需要复习");
    expect(result.profile_summary).toContain("阅读已启动");
    expect(result.course_progress).toEqual(context().course_progress);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://relay.example.test/v1/responses");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer server-only-profile-key");
    expect(headers.get("Idempotency-Key")).toBe("profile_openai_001");
    const bodyText = String(init?.body);
    expect(bodyText).not.toContain("server-only-profile-key");
    expect(bodyText).not.toContain("user_student_private_001");
    expect(bodyText).not.toContain("onboarding_profile_private_001");

    const body = JSON.parse(bodyText) as {
      model: string;
      stream: boolean;
      input: string;
      max_output_tokens: number;
      reasoning: { effort: string };
    };
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      stream: false,
      max_output_tokens: 300,
      reasoning: { effort: "minimal" },
    });
    expect(body).not.toHaveProperty("instructions");
    const modelContext = JSON.parse(
      body.input.split("\n\nINPUT_JSON:\n")[1] ?? "null",
    ) as Record<string, unknown>;
    expect(modelContext).toMatchObject({
      request_id: "profile_openai_001",
      response_language: "zh-CN",
    });
    expect(modelContext).not.toHaveProperty("user_id");
    expect(modelContext).not.toHaveProperty("profile_id");
    expect(modelContext).not.toHaveProperty("backend_portrait_basis");
    expect(modelContext).toHaveProperty("candidate_options");
    expect(bodyText).not.toContain("evidence_001");
    expect(Buffer.byteLength(bodyText, "utf8")).toBeLessThan(4_500);
  });

  it("ignores model-authored status and narrative while keeping server-owned facts", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion(validSelections({
      status: [],
      profile_summary: "模型自造的画像事实。",
      evidence_summary: { objective_evidence_count: 999 },
    })));

    const result = await new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-profile-key",
      model: "gpt-5.6-terra",
      fetchImpl,
    }).run(context());

    expect(result.status).toBe("ready");
    expect(result.profile_summary).not.toContain("模型自造");
    expect(result.evidence_summary.objective_evidence_count).toBe(1);
  });

  it("accepts upstream bare candidate IDs and still resolves server-owned candidates", async () => {
    const result = await new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-profile-key",
      model: "gpt-5.6-terra",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(completion(validSelections({
        strengths: ["strength_course_408_co_knowledge_coverage"],
        priority_gaps: ["gap_course_408_co_mistake_recovery_co_c01_01"],
        next_tasks: ["task_course_408_co_review_mistakes_co_c01_01"],
      }))),
    }).run(context());

    expect(result).toMatchObject({
      status: "ready",
      strengths: [{ title: "阅读已启动", evidence_ids: ["evidence_001"] }],
      priority_gaps: [{ title: "需要复习", evidence_ids: ["evidence_001"] }],
      next_tasks: [{ title: "继续组成原理", evidence_ids: ["evidence_001"] }],
      failure: null,
    });
  });

  it.each([
    ["unknown candidate", validSelections({
      strengths: [{ candidate_id: "strength_not_from_backend" }],
    })],
    ["duplicate candidate", validSelections({
      strengths: [
        { candidate_id: "strength_course_408_co_knowledge_coverage" },
        { candidate_id: "strength_course_408_co_knowledge_coverage" },
      ],
    })],
    ["empty selection", validSelections({
      strengths: [],
      priority_gaps: [],
      next_tasks: [],
    })],
  ])("fails closed for %s", async (_name, outputs) => {
    const result = await new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-profile-key",
      model: "gpt-5.6-terra",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(completion(outputs)),
    }).run(context());

    expect(result).toMatchObject({
      status: "failed",
      strengths: [],
      priority_gaps: [],
      next_tasks: [],
      failure: { code: "WORKFLOW_FAILED", retryable: false },
    });
  });

  it("rejects a selected backend candidate whose evidence is outside the request whitelist", async () => {
    const unsafeContext = context({
      strength_candidates: new Map([
        ["strength_course_408_co_knowledge_coverage", {
          course_id: "course_408_co",
          title: "越界候选",
          detail: "不得展示。",
          evidence_ids: ["evidence_outside_request"],
        }],
      ]),
    });
    const result = await new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-profile-key",
      model: "gpt-5.6-terra",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(completion(validSelections())),
    }).run(unsafeContext);

    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
    });
  });

  it("degrades safely for malformed output, upstream failure and timeout", async () => {
    const malformed = await new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-profile-key",
      model: "gpt-5.6-terra",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(completion({ status: "ready" })),
    }).run(context());
    expect(malformed).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED", retryable: false },
    });

    const unavailable = await new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-profile-key",
      model: "gpt-5.6-terra",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("busy", { status: 503 })),
    }).run(context());
    expect(unavailable).toMatchObject({
      status: "unavailable",
      failure: { code: "UPSTREAM_UNAVAILABLE", retryable: true },
    });

    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })
    ));
    const timedOut = await new OpenAiCompatibleProfileWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-profile-key",
      model: "gpt-5.6-terra",
      timeoutMs: 5,
      fetchImpl: timeoutFetch,
    }).run(context());
    expect(timedOut).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_TIMEOUT", retryable: true },
    });
    expect(timedOut.course_progress).toEqual(context().course_progress);
  });
});
