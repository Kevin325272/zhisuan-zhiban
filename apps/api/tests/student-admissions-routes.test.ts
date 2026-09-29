import type {
  AdmissionsCurrentTarget,
  AdmissionsTargetSearchQuery,
  AdmissionsTargetSearchResponse,
} from "@xuetu/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type {
  LocalAuthenticationService,
  PublicAccount,
} from "../src/services/auth/authentication.js";

const now = "2026-08-12T08:00:00.000Z";
const sessionStudent: PublicAccount = {
  user_id: "user_session_student",
  username: "session_student",
  display_name: "会话学生",
  account_status: "active",
  roles: ["student"],
  auth_source: "local_development",
  account_origin: "registered",
  data_boundary: "local_account",
  must_change_password: false,
  created_at: now,
  updated_at: now,
  last_login_at: null,
};
const adminAccount: PublicAccount = { ...sessionStudent, user_id: "user_admin", username: "admin", roles: ["admin"] };

const target = {
  target_id: "admission_target_001",
  school: "中国科学技术大学",
  training_unit: "计算机科学与技术学院",
  program_code: "081200",
  program_name: "计算机科学与技术",
  study_mode: "全日制",
  available_years: [2026],
  retest_lines: [{
    line_id: "retest_001",
    year: 2026,
    retest_score: 315,
    subject_scores: { politics: 50, foreign_language: 50, business_course_1: 80, business_course_2: 80 },
    direction: null,
    source_url: "https://example.edu/retest",
    source_kind: "official" as const,
  }],
};

function searchResponse(): AdmissionsTargetSearchResponse {
  return {
    items: [target], total: 1, page: 1, page_size: 20, available_years: [2026],
    data_boundary: {
      scope: "retest_cutoff_information_only",
      notice: "复试线信息来自本地公开资料整理，选择前请以院校官网当年公告为准。",
    },
  };
}

function platformAccess() {
  return {
    async getActor(userId: string) {
      const roles = userId === adminAccount.user_id ? ["admin" as const] : ["student" as const];
      return {
        user: {
          user_id: userId,
          display_name: "本地账户",
          account_status: "active" as const,
          auth_source: "local_development" as const,
          created_at: now,
          updated_at: now,
        },
        roles,
      };
    },
    async isCourseAssigned() { return true; },
  };
}

describe("student admissions routes", () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => { await app?.close(); });

  it("validates search input and returns the student-safe target page", async () => {
    const calls: AdmissionsTargetSearchQuery[] = [];
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentAdmissions: {
        async searchTargets(query: AdmissionsTargetSearchQuery) { calls.push(query); return searchResponse(); },
        async getCurrentTarget() { return { target: null, saved_at: null }; },
        async selectTarget() { return { target, saved_at: now }; },
        async clearTarget() { return { target: null, saved_at: null }; },
      },
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/admissions/targets?q=%E7%A7%91%E5%A4%A7&year=2026&page=1&page_size=20",
      headers: { "x-dev-user-id": "user_student_001" },
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/student/admissions/targets?page_size=500&userId=another_student",
      headers: { "x-dev-user-id": "user_student_001" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toMatchObject({ school: "中国科学技术大学" });
    expect(calls).toEqual([{ q: "科大", year: 2026, page: 1, page_size: 20 }]);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("ADMISSIONS_SEARCH_INVALID");
    expect(response.body).not.toMatch(/license_status|review_status|dataset_id|user_id/iu);
  });

  it("uses the server session for get, replace and clear even with a conflicting dev header", async () => {
    const calls: Array<{ method: string; userId: string; targetId?: string }> = [];
    const authentication = {
      async resolveSession(token: string) {
        return token === "student-session" ? { account: sessionStudent } : null;
      },
    } as unknown as LocalAuthenticationService;
    const current: AdmissionsCurrentTarget = { target, saved_at: now };
    app = buildApp({
      answerModel: null,
      authentication,
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      studentAdmissions: {
        async searchTargets() { return searchResponse(); },
        async getCurrentTarget(userId: string) { calls.push({ method: "get", userId }); return current; },
        async selectTarget(userId: string, targetId: string) { calls.push({ method: "put", userId, targetId }); return current; },
        async clearTarget(userId: string) { calls.push({ method: "delete", userId }); return { target: null, saved_at: null }; },
      },
    } as never);
    const headers = { cookie: "xuetu_session=student-session", "x-dev-user-id": adminAccount.user_id };

    const get = await app.inject({ method: "GET", url: "/api/v1/student/admissions/target", headers });
    const put = await app.inject({ method: "PUT", url: "/api/v1/student/admissions/target", headers, payload: { target_id: target.target_id } });
    const clear = await app.inject({ method: "DELETE", url: "/api/v1/student/admissions/target", headers });

    expect([get.statusCode, put.statusCode, clear.statusCode]).toEqual([200, 200, 200]);
    expect(calls).toEqual([
      { method: "get", userId: sessionStudent.user_id },
      { method: "put", userId: sessionStudent.user_id, targetId: target.target_id },
      { method: "delete", userId: sessionStudent.user_id },
    ]);
  });

  it("rejects invalid target selection, unauthenticated access and an administrator session", async () => {
    const authentication = {
      async resolveSession(token: string) {
        return token === "admin-session" ? { account: adminAccount } : null;
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      answerModel: null,
      authentication,
      allowLocalDevAuth: false,
      platformAccess: platformAccess(),
      studentAdmissions: {
        async searchTargets() { return searchResponse(); },
        async getCurrentTarget() { return { target: null, saved_at: null }; },
        async selectTarget() { return { target, saved_at: now }; },
        async clearTarget() { return { target: null, saved_at: null }; },
      },
    } as never);

    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/student/admissions/target" });
    const forbidden = await app.inject({ method: "GET", url: "/api/v1/student/admissions/target", headers: { cookie: "xuetu_session=admin-session" } });
    const invalid = await app.inject({ method: "PUT", url: "/api/v1/student/admissions/target", headers: { cookie: "xuetu_session=admin-session" }, payload: { target_id: "" } });

    expect(unauthenticated.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(403);
  });
});
