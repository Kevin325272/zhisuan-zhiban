import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { LocalAuthenticationService, PublicAccount } from "../src/services/auth/authentication.js";

const sessionStudent: PublicAccount = {
  user_id: "user_student_session",
  username: "student_session",
  display_name: "会话学生",
  account_status: "active",
  roles: ["student"],
  auth_source: "local_development",
  account_origin: "registered",
  data_boundary: "local_account",
  must_change_password: false,
  created_at: "2026-08-02T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
  last_login_at: null,
};

describe("student reliable-learning-loop routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("lists real choice mistakes and serves the existing learning record routes", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const learningLoop = {
      async listMistakes(...args: unknown[]) {
        calls.push({ method: "listMistakes", args });
        return { items: [{ mistake_id: "mistake_001", question_id: "2026-01", status: "needs_review" }] };
      },
      async updateMistake(...args: unknown[]) {
        calls.push({ method: "updateMistake", args });
        return { mistake_id: "mistake_001", status: "mastered" };
      },
      async getLearningRecord(...args: unknown[]) {
        calls.push({ method: "getLearningRecord", args });
        return { courses: [], generated_at: "2026-08-02T00:00:00.000Z" };
      },
      async getPersonalLearningDashboard(...args: unknown[]) {
        calls.push({ method: "getPersonalLearningDashboard", args });
        return {
          generated_at: "2026-08-02T00:00:00.000Z",
          totals: {
            course_count: 0,
            concept_count: 0,
            started_concept_count: 0,
            practice_attempt_count: 0,
            correct_count: 0,
            incorrect_count: 0,
            needs_review_count: 0,
          },
          courses: [],
        };
      },
    };
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      reliableLearningLoop: learningLoop as never,
      platformAccess: {
        async getActor(userId: string) {
          return {
            user: {
              user_id: userId,
              display_name: "本地联调学生",
              account_status: "active" as const,
              auth_source: "local_development" as const,
              created_at: "2026-08-02T00:00:00.000Z",
              updated_at: "2026-08-02T00:00:00.000Z",
            },
            roles: ["student" as const],
          };
        },
        async isCourseAssigned() { return true; },
      },
    } as never);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/student/practice-mistakes?course_id=course_408_ds&status=needs_review",
      headers: { "x-dev-user-id": "user_student_001" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items[0]).toMatchObject({ status: "needs_review" });

    const record = await app.inject({
      method: "GET",
      url: "/api/v1/student/learning-record?course_id=course_408_ds",
      headers: { "x-dev-user-id": "user_student_001" },
    });
    expect(record.statusCode).toBe(200);

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/v1/student/personal-learning-dashboard",
      headers: { "x-dev-user-id": "user_student_001" },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().data).toMatchObject({ courses: [] });
    expect(calls.map((call) => call.method)).toEqual([
      "listMistakes",
      "getLearningRecord",
      "getPersonalLearningDashboard",
    ]);
    expect(calls.at(-1)?.args).toEqual(["user_student_001"]);
  });

  it("rejects manual mastery and reopens only a mastered mistake through review state", async () => {
    const calls: string[] = [];
    const learningLoop = {
      async listMistakes() { return { items: [] }; },
      async updateMistake() { calls.push("legacy-update"); return { mistake_id: "mistake_001" }; },
      async getLearningRecord() { return { courses: [], generated_at: "2026-08-02T00:00:00.000Z" }; },
      async getPersonalLearningDashboard() { return { generated_at: "2026-08-02T00:00:00.000Z", totals: { course_count: 0, concept_count: 0, started_concept_count: 0, practice_attempt_count: 0, correct_count: 0, incorrect_count: 0, needs_review_count: 0 }, courses: [] }; },
    };
    const reopenMistake = async (userId: string, mistakeId: string) => {
      calls.push(`${userId}:${mistakeId}`);
      return {
        mistake_id: mistakeId,
        status: "needs_review" as const,
        next_review_at: "2026-08-02T08:00:00.000Z",
        consecutive_success_count: 0,
        next_review_interval_days: 0,
        last_processed_attempt_id: null,
      };
    };
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      reliableLearningLoop: learningLoop as never,
      mistakeRecommendation: { listRecommendations: async () => ({ algorithm_version: "evidence_weighted_v1", generated_at: "2026-08-02T00:00:00.000Z", items: [] }), reopenMistake },
      platformAccess: {
        async getActor(userId: string) {
          return {
            user: {
              user_id: userId,
              display_name: "本地联调学生",
              account_status: "active" as const,
              auth_source: "local_development" as const,
              created_at: "2026-08-02T00:00:00.000Z",
              updated_at: "2026-08-02T00:00:00.000Z",
            },
            roles: ["student" as const],
          };
        },
        async isCourseAssigned() { return true; },
      },
    } as never);

    const manualMastery = await app.inject({
      method: "PATCH",
      url: "/api/v1/student/practice-mistakes/mistake_001",
      headers: { "x-dev-user-id": "user_student_001" },
      payload: { status: "mastered" },
    });
    const reopen = await app.inject({
      method: "PATCH",
      url: "/api/v1/student/practice-mistakes/mistake_001",
      headers: { "x-dev-user-id": "user_student_001" },
      payload: { status: "needs_review" },
    });

    expect(manualMastery.statusCode).toBe(409);
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().data).toMatchObject({ status: "needs_review", next_review_interval_days: 0 });
    expect(calls).toEqual(["user_student_001:mistake_001"]);
  });

  it("binds learning records to the server session and ignores a spoofed development header", async () => {
    const calls: string[] = [];
    const learningLoop = {
      async listMistakes(userId: string) { calls.push(userId); return { items: [] }; },
      async updateMistake() { throw new Error("not used"); },
      async getLearningRecord() { return { courses: [], generated_at: "2026-08-02T00:00:00.000Z" }; },
    };
    const authentication = {
      async resolveSession(token: string) {
        return token === "valid-session" ? { account: sessionStudent } : null;
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      authentication,
      allowLocalDevAuth: true,
      reliableLearningLoop: learningLoop as never,
      platformAccess: {
        async getActor(userId: string) {
          return {
            user: {
              user_id: userId,
              display_name: "会话学生",
              account_status: "active" as const,
              auth_source: "local_development" as const,
              created_at: "2026-08-02T00:00:00.000Z",
              updated_at: "2026-08-02T00:00:00.000Z",
            },
            roles: ["student" as const],
          };
        },
        async isCourseAssigned() { return true; },
      },
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/practice-mistakes",
      headers: {
        cookie: "xuetu_session=valid-session",
        "x-dev-user-id": "user_admin_001",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([sessionStudent.user_id]);
  });
});
