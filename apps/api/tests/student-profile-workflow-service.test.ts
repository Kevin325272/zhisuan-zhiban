import { describe, expect, it, vi } from "vitest";

import type { StudentProfileWorkflowResponse } from "@xuetu/contracts";

import { StudentProfileWorkflowService } from "../src/services/profile-workflow/student-profile-workflow-service.js";

function unavailable(requestId: string): StudentProfileWorkflowResponse {
  return {
    contract_version: "0.2",
    request_id: requestId,
    status: "unavailable",
    profile_summary: "AI 画像解读暂不可用，确定性画像仍可查看。",
    course_progress: [],
    strengths: [],
    priority_gaps: [],
    evidence_summary: {
      objective_evidence_count: 0,
      subjective_evidence_count: 0,
      reading_progress_count: 0,
      practice_attempt_count: 0,
      needs_review_count: 0,
      explanation: "证据正在积累。",
    },
    next_tasks: [],
    failure: {
      code: "WORKFLOW_NOT_CONNECTED",
      message: "画像工作流尚未接入。",
      retryable: true,
      fallback_message: "确定性画像仍可查看。",
    },
  };
}

describe("student profile workflow service", () => {
  it("does not call the workflow before the initial profile is complete", async () => {
    const context = { build: vi.fn().mockResolvedValue(null) };
    const gateway = { configured: true, run: vi.fn() };
    const service = new StudentProfileWorkflowService(context, gateway);

    const result = await service.generate("student_001", "profile_req_001", "course_408_co");

    expect(context.build).toHaveBeenCalledWith("student_001", "profile_req_001", "course_408_co");
    expect(gateway.run).not.toHaveBeenCalled();
    expect(result.status).toBe("insufficient_context");
    expect(result.failure?.code).toBe("CONTEXT_INCOMPLETE");
    expect(service.status()).toMatchObject({ state: "configured", checked_at: null });
  });

  it("tracks profile workflow health independently after a real gateway result", async () => {
    const context = { build: vi.fn().mockResolvedValue({ request_id: "profile_req_ready" }) };
    const gateway = {
      configured: true,
      run: vi.fn().mockResolvedValue({
        ...unavailable("profile_req_ready"),
        status: "ready",
        profile_summary: "基于当前平台证据，先复习待巩固知识点。",
        failure: null,
      }),
    };
    const service = new StudentProfileWorkflowService(context, gateway);

    expect(service.status()).toMatchObject({ state: "configured", checked_at: null });
    await service.generate("student_001", "profile_req_ready", "course_408_co");
    expect(service.status()).toMatchObject({ state: "available" });
  });

  it("keeps the gateway response scoped to the current request", async () => {
    const context = { build: vi.fn().mockResolvedValue({ request_id: "profile_req_002" }) };
    const gateway = { run: vi.fn().mockResolvedValue(unavailable("profile_req_002")) };
    const service = new StudentProfileWorkflowService(context, gateway);

    const result = await service.generate("student_001", "profile_req_002", "course_408_co");

    expect(gateway.run).toHaveBeenCalledWith({ request_id: "profile_req_002" });
    expect(result.request_id).toBe("profile_req_002");
    expect(result).not.toHaveProperty("secret");
  });
});
