import type { StudentCareService } from "../src/services/student-care/student-care-service.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { StudentCareInteractionError } from "../src/services/student-care/student-care-service.js";

function platformAccess(role: "student" | "admin" = "student") {
  return {
    async getActor(userId: string) {
      return {
        user: {
          user_id: userId,
          display_name: "本地账户",
          account_status: "active" as const,
          auth_source: "local_development" as const,
          created_at: "2026-08-02T00:00:00.000Z",
          updated_at: "2026-08-02T00:00:00.000Z",
        },
        roles: [role],
      };
    },
    async isCourseAssigned() { return true; },
  };
}

const talkFallbackStep = {
  task_id: "task_ds_read",
  task_type: "course_reading" as const,
  course_id: "course_408_ds",
  course_title: "数据结构",
  title: "回到上次阅读位置",
  detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
  estimated_minutes: 10,
  href: "/student/courses/data-structures",
};

function careService(overrides: Partial<StudentCareService> = {}): StudentCareService {
  return {
    async getPreference() { return { enabled: true, updated_at: null }; },
    async getStatus() { return { kind: "none", preference_enabled: true }; },
    async respond() {
      return {
        action: "continue",
        idempotent: false,
        status: { kind: "none", preference_enabled: true },
        talk: null,
      };
    },
    async updatePreference(_userId, enabled) {
      return { enabled, updated_at: "2026-08-21T08:00:00.000Z" };
    },
    ...overrides,
  };
}

describe("student care routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("reads only the authenticated student's care state", async () => {
    const calls: string[] = [];
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentCare: careService({
        async getStatus(userId) {
          calls.push(userId);
          return { kind: "none", preference_enabled: true };
        },
      }),
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/care",
      headers: { "x-dev-user-id": "student_001" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ kind: "none", preference_enabled: true });
    expect(calls).toEqual(["student_001"]);
  });

  it("reads only the authenticated student's preference without evaluating care status", async () => {
    const calls: string[] = [];
    const getStatus = vi.fn(async () => {
      throw new Error("preference reads must not evaluate care status");
    });
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentCare: careService({
        getStatus,
        async getPreference(userId) {
          calls.push(userId);
          return { enabled: true, updated_at: null };
        },
      }),
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/care/preferences",
      headers: { "x-dev-user-id": "student_001" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ enabled: true, updated_at: null });
    expect(calls).toEqual(["student_001"]);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated and administrator requests", async () => {
    app = buildApp({
      allowLocalDevAuth: false,
      platformAccess: platformAccess("admin"),
      studentCare: careService(),
    } as never);

    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/student/care" });

    expect(unauthenticated.statusCode).toBe(503);

    await app.close();
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess("admin"),
      studentCare: careService(),
    } as never);
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/student/care",
      headers: { "x-dev-user-id": "admin_001" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("accepts one strict response action and maps interaction conflicts", async () => {
    const calls: Array<[string, string, string]> = [];
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentCare: careService({
        async respond(userId, interactionId, action) {
          calls.push([userId, interactionId, action]);
          return {
            action,
            idempotent: false,
            status: { kind: "none", preference_enabled: true },
            talk: action === "talk" ? {
              capability: "care",
              course_id: "course_408_ds",
              conversation_id: "care_001",
              fallback_step: talkFallbackStep,
            } : null,
          };
        },
      }),
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/care/care_001/respond",
      headers: { "x-dev-user-id": "student_001" },
      payload: { action: "talk" },
    });
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/student/care/care_001/respond",
      headers: { "x-dev-user-id": "student_001" },
      payload: { action: "talk", user_id: "other" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.talk).toEqual({
      capability: "care",
      course_id: "course_408_ds",
      conversation_id: "care_001",
      fallback_step: talkFallbackStep,
    });
    expect(forged.statusCode).toBe(400);
    expect(calls).toEqual([["student_001", "care_001", "talk"]]);

    await app.close();
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentCare: careService({
        async respond() {
          throw new StudentCareInteractionError(
            "CARE_INTERACTION_ALREADY_RESPONDED",
            "这条关怀提示已经处理。",
            409,
          );
        },
      }),
    } as never);
    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/student/care/care_001/respond",
      headers: { "x-dev-user-id": "student_001" },
      payload: { action: "continue" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("CARE_INTERACTION_ALREADY_RESPONDED");
  });

  it("updates only the current student's reversible preference", async () => {
    const calls: Array<[string, boolean]> = [];
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentCare: careService({
        async updatePreference(userId, enabled) {
          calls.push([userId, enabled]);
          return { enabled, updated_at: "2026-08-21T08:00:00.000Z" };
        },
      }),
    } as never);

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/student/care/preferences",
      headers: { "x-dev-user-id": "student_001" },
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ enabled: false, updated_at: "2026-08-21T08:00:00.000Z" });
    expect(calls).toEqual([["student_001", false]]);
  });
});
