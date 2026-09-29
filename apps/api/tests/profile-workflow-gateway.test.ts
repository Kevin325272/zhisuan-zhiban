import { describe, expect, it, vi } from "vitest";

import {
  DifyProfileWorkflowGateway,
  type ProfileWorkflowContext,
} from "../src/services/profile-workflow/dify-profile-workflow-gateway.js";

function context(overrides: Partial<ProfileWorkflowContext> = {}): ProfileWorkflowContext {
  return {
    request_id: "profile_workflow_001",
    user_id: "user_student_001",
    profile_id: "onboarding_profile_001",
    inputs: {
      profile_id: "onboarding_profile_001",
      learning_goal: JSON.stringify({ target_exam_year: 2027, preparation_stage: "foundation" }),
      course_self_assessments: JSON.stringify({ course_408_co: "weak" }),
      backend_portrait_basis: JSON.stringify({ courses: [] }),
      learning_evidence_summary: JSON.stringify({ objective_evidence_count: 1 }),
      response_language: "zh-CN",
      request_id: "profile_workflow_001",
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

function upstreamResponse(outputs: Record<string, unknown>) {
  return new Response(JSON.stringify({
    task_id: "task_upstream_private",
    workflow_run_id: "run_upstream_private",
    data: {
      status: "succeeded",
      outputs,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Dify profile workflow gateway", () => {
  it("sends the locked profile inputs and maps data.outputs without exposing upstream ids", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse({
      status: "ready",
      strengths: [{ candidate_id: "strength_course_408_co_knowledge_coverage" }],
      priority_gaps: [{ candidate_id: "gap_course_408_co_mistake_recovery_co_c01_01" }],
      next_tasks: [{ candidate_id: "task_course_408_co_review_mistakes_co_c01_01" }],
    }));
    const gateway = new DifyProfileWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-profile-secret",
      fetchImpl,
    });

    const result = await gateway.run(context());

    expect(result.status).toBe("ready");
    expect(result.profile_summary).toContain("需要复习");
    expect(result.profile_summary).toContain("阅读已启动");
    expect(result.strengths[0]).toEqual({
      course_id: "course_408_co",
      title: "阅读已启动",
      detail: "已有阅读证据。",
      evidence_ids: ["evidence_001"],
    });
    expect(result.strengths[0]?.evidence_ids).toEqual(["evidence_001"]);
    expect(result.priority_gaps[0]?.evidence_ids).toEqual(["evidence_001"]);
    expect(result.next_tasks[0]?.evidence_ids).toEqual(["evidence_001"]);
    expect(result.course_progress).toEqual(context().course_progress);
    expect(result).not.toHaveProperty("workflow_run_id");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://workflow.example.test/v1/workflows/run");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer server-only-profile-secret");
    const body = JSON.parse(String(init?.body)) as {
      inputs: Record<string, string>;
      response_mode: string;
      user: string;
    };
    expect(body.response_mode).toBe("blocking");
    expect(body.user).toBe("xuetu-profile-workflow");
    expect(body.inputs.profile_id).toBe("onboarding_profile_001");
    expect(body.inputs.learning_goal).toContain("target_exam_year");
    expect(String(init?.body)).not.toContain("server-only-profile-secret");
  });

  it("accepts the portrait workflow's documented summary fields while resolving only backend candidates", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse({
      status: "ready",
      profile_summary: "工作流侧摘要，仅作扩展字段。",
      learning_goal: { target_exam_year: 2027 },
      course_progress: [{ course_id: "course_408_co", score: 42 }],
      evidence_summary: { objective_evidence_count: 999 },
      strengths: [{ candidate_id: "strength_course_408_co_knowledge_coverage" }],
      priority_gaps: [{ candidate_id: "gap_course_408_co_mistake_recovery_co_c01_01" }],
      next_tasks: [{ candidate_id: "task_course_408_co_review_mistakes_co_c01_01" }],
    }));

    const result = await new DifyProfileWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-profile-secret",
      fetchImpl,
    }).run(context());

    expect(result.status).toBe("ready");
    expect(result.profile_summary).toContain("需要复习");
    expect(result.profile_summary).not.toContain("工作流侧摘要");
    expect(result.evidence_summary.objective_evidence_count).toBe(1);
    expect(result.strengths[0]?.title).toBe("阅读已启动");
  });

  it("fails closed when the workflow selects an unknown candidate id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse({
      status: "ready",
      strengths: [{ candidate_id: "strength_not_from_backend" }],
      priority_gaps: [{ candidate_id: "gap_course_408_co_mistake_recovery_co_c01_01" }],
      next_tasks: [{ candidate_id: "task_course_408_co_review_mistakes_co_c01_01" }],
    }));

    const result = await new DifyProfileWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-profile-secret",
      fetchImpl,
    }).run(context());

    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      strengths: [],
      priority_gaps: [],
      next_tasks: [],
    });
  });

  it("fails closed when the workflow adds model-authored profile facts", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse({
      status: "ready",
      profile_summary: "模型自造的画像结论。",
      strengths: [{
        candidate_id: "strength_course_408_co_knowledge_coverage",
        title: "模型自造优势",
      }],
      priority_gaps: [{ candidate_id: "gap_course_408_co_mistake_recovery_co_c01_01" }],
      next_tasks: [{ candidate_id: "task_course_408_co_review_mistakes_co_c01_01" }],
    }));

    const result = await new DifyProfileWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-profile-secret",
      fetchImpl,
    }).run(context());

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("WORKFLOW_FAILED");
  });

  it("fails closed when a selected backend candidate has no evidence", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse({
      status: "ready",
      strengths: [{ candidate_id: "strength_without_evidence" }],
      priority_gaps: [{ candidate_id: "gap_course_408_co_mistake_recovery_co_c01_01" }],
      next_tasks: [{ candidate_id: "task_course_408_co_review_mistakes_co_c01_01" }],
    }));

    const result = await new DifyProfileWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-profile-secret",
      fetchImpl,
    }).run(context({
      strength_candidates: new Map([
        ["strength_without_evidence", {
          course_id: "course_408_co",
          title: "没有证据的候选",
          detail: "不得展示。",
          evidence_ids: [],
        }],
      ]),
    }));

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("WORKFLOW_FAILED");
  });

  it("fails closed when the upstream response has no structured outputs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse({}));
    const result = await new DifyProfileWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-profile-secret",
      fetchImpl,
    }).run(context());

    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      strengths: [],
      priority_gaps: [],
      next_tasks: [],
    });
  });

  it("returns a retryable timeout while leaving deterministic progress intact", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    ));
    const result = await new DifyProfileWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-profile-secret",
      timeoutMs: 5,
      fetchImpl,
    }).run(context());

    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ code: "WORKFLOW_TIMEOUT", retryable: true });
    expect(result.course_progress[0]?.course_id).toBe("course_408_co");
  });
});
