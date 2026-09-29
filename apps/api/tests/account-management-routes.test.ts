import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { LocalAuthenticationService, PublicAccount } from "../src/services/auth/authentication.js";

const admin: PublicAccount = {
  user_id: "user_admin_001", username: "admin_001", display_name: "管理员", account_status: "active",
  roles: ["admin"], auth_source: "local_development", account_origin: "seeded_admin", data_boundary: "local_account",
  must_change_password: false, created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z", last_login_at: null,
};
const student: PublicAccount = { ...admin, user_id: "user_student_002", username: "student_002", display_name: "学生", roles: ["student"], account_origin: "registered" };

function fakeAuth() {
  const service = {
    async resolveSession(token: string) {
      if (token === "admin-session") return { account: admin };
      if (token === "student-session") return { account: student };
      return null;
    },
    async listAccounts() { return [admin, student]; },
    async createAccount() { return student; },
    async updateAccountStatus() { return { ...student, account_status: "disabled" as const }; },
    async resetPassword() { return { ...student, must_change_password: true }; },
    async listAcademicClasses() {
      return [{
        class_id: "class_cs_2302",
        cohort_year: 2023,
        major: "计算机科学与技术",
        class_name: "计算机科学与技术2302班",
      }];
    },
    async approveTeacher() {
      return {
        ...student,
        user_id: "user_teacher_pending",
        username: "teacher_apply_01",
        display_name: "申请教师",
        roles: ["teacher" as const],
        account_status: "active" as const,
      };
    },
  } as unknown as LocalAuthenticationService;
  return service;
}

describe("admin account governance routes", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); });

  it("uses a server session and never exposes credential fields", async () => {
    app = buildApp({ authentication: fakeAuth() });
    const response = await app.inject({ method: "GET", url: "/api/v1/manage/accounts", headers: { cookie: "xuetu_session=admin-session" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(2);
    expect(response.body).not.toContain("password_hash");
    expect(response.body).not.toContain("session_token");
  });

  it("rejects a request without an authenticated admin session", async () => {
    app = buildApp({ authentication: fakeAuth() });
    const response = await app.inject({ method: "GET", url: "/api/v1/manage/accounts" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects an authenticated student before account governance executes", async () => {
    app = buildApp({ authentication: fakeAuth() });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/accounts",
      headers: { cookie: "xuetu_session=student-session" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ROLE_ACCESS_DENIED");
  });

  it("creates an administrator-entered teacher as a pending application", async () => {
    let received: Record<string, unknown> | undefined;
    const authentication = {
      ...fakeAuth(),
      async createAccount(_actor: PublicAccount, input: Record<string, unknown>) {
        received = input;
        return { ...student, roles: ["teacher" as const], account_status: "pending_approval" as const };
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({ authentication });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manage/accounts",
      headers: { cookie: "xuetu_session=admin-session" },
      payload: {
        username: "teacher_001",
        display_name: "试点教师",
        password: "StrongPassword123",
        role: "teacher",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.account.account_status).toBe("pending_approval");
    expect(received).toMatchObject({ role: "teacher" });
    expect(received).not.toHaveProperty("courseId");
  });

  it("lists academic classes and approves a teacher with explicit course and class scope", async () => {
    let approval: Record<string, unknown> | undefined;
    const authentication = {
      ...fakeAuth(),
      async approveTeacher(_actor: PublicAccount, _userId: string, input: Record<string, unknown>) {
        approval = input;
        return {
          ...student,
          user_id: "user_teacher_pending",
          username: "teacher_apply_01",
          roles: ["teacher" as const],
          account_status: "active" as const,
        };
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({ authentication });

    const classes = await app.inject({
      method: "GET",
      url: "/api/v1/manage/academic-classes",
      headers: { cookie: "xuetu_session=admin-session" },
    });
    expect(classes.statusCode).toBe(200);
    expect(classes.json().data.items).toEqual([
      expect.objectContaining({ class_id: "class_cs_2302", cohort_year: 2023 }),
    ]);

    const approved = await app.inject({
      method: "POST",
      url: "/api/v1/manage/accounts/user_teacher_pending/teacher-approval",
      headers: { cookie: "xuetu_session=admin-session" },
      payload: {
        teacher_number: "T2026001",
        department: "计算机科学与技术学院",
        professional_title: "讲师",
        course_id: "course_408_ds",
        class_ids: ["class_cs_2302"],
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approval).toEqual({
      teacherNumber: "T2026001",
      department: "计算机科学与技术学院",
      professionalTitle: "讲师",
      courseId: "course_408_ds",
      classIds: ["class_cs_2302"],
    });
  });

  it("rejects an invalid administrator password reset before invoking the service", async () => {
    let resetCalled = false;
    const authentication = {
      ...fakeAuth(),
      async resetPassword() {
        resetCalled = true;
        return { ...student, must_change_password: true };
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({ authentication });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manage/accounts/user_student_002/reset-password",
      headers: { cookie: "xuetu_session=admin-session" },
      payload: { password: " " },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ACCOUNT_PASSWORD_RESET_INVALID");
    expect(resetCalled).toBe(false);
  });
});
