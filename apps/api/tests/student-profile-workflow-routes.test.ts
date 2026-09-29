import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";
import type { StudentProfileWorkflowService } from "../src/services/profile-workflow/student-profile-workflow-service.js";

describe("student profile workflow route", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
  });

  function platformAccess(role: "student" | "admin" = "student"): PlatformAccessService {
    return {
      async getActor(userId) {
        return {
          user: {
            user_id: userId,
            display_name: "本地学生",
            account_status: "active",
            auth_source: "local_development",
            created_at: "2026-08-18T00:00:00.000Z",
            updated_at: "2026-08-18T00:00:00.000Z",
          },
          roles: [role],
        };
      },
      async isCourseAssigned() { return true; },
    };
  }

  it("requires a student identity and never accepts a browser user id", async () => {
    const service = { generate: async () => { throw new Error("must not run"); } } as never as StudentProfileWorkflowService;
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentProfileWorkflow: service,
    });

    const anonymous = await app.inject({ method: "POST", url: "/api/v1/student/profile/ai", payload: { userId: "other" } });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("passes the server-resolved student and request id to the profile service", async () => {
    const calls: Array<{ userId: string; requestId: string; courseId: string }> = [];
    const service = {
      async generate(userId: string, requestId: string, courseId: string) {
        calls.push({ userId, requestId, courseId });
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
            subjective_evidence_count: 1,
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
        } as const;
      },
    } as never as StudentProfileWorkflowService;
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentProfileWorkflow: service,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/profile/ai",
      headers: { "x-dev-user-id": "student_001" },
      payload: { request_id: "profile_request_001", course_id: "course_408_co", userId: "other" },
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([{
      userId: "student_001",
      requestId: "profile_request_001",
      courseId: "course_408_co",
    }]);
    expect(response.json().data.status).toBe("unavailable");
    expect(response.body).not.toContain("userId");
    expect(response.body).not.toContain("secret");
  });

  it("exposes the profile workflow runtime status separately from plan status", async () => {
    const service = {
      status() {
        return {
          state: "available",
          label: "AI 画像解读可用",
          detail: null,
          checked_at: "2026-08-21T00:00:00.000Z",
        } as const;
      },
      async generate() { throw new Error("must not run"); },
    } as never as StudentProfileWorkflowService;
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentProfileWorkflow: service,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/profile/ai/status",
      headers: { "x-dev-user-id": "student_001" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      state: "available",
      label: "AI 画像解读可用",
    });
  });
});
