import { describe, expect, it } from "vitest";

import {
  accountCreateRequestSchema,
  accountStatusUpdateSchema,
  academicClassOptionSchema,
  authAccountSchema,
  canonicalizeUsername,
  authLoginRequestSchema,
  authRegistrationResponseSchema,
  authRegisterRequestSchema,
  passwordChangeRequestSchema,
  studentRegistrationPolicySchema,
  teacherApprovalRequestSchema,
} from "../src/index.js";

describe("account authentication contracts", () => {
  it("accepts minimum registration and login inputs but never models a session token in account data", () => {
    expect(authRegisterRequestSchema.safeParse({
      role: "student",
      username: "alice_01",
      display_name: "Alice",
      password: "StrongPassword123",
      password_confirmation: "StrongPassword123",
    }).success).toBe(true);
    expect(authLoginRequestSchema.safeParse({ username: "alice_01", password: "StrongPassword123" }).success).toBe(true);
    expect(authAccountSchema.safeParse({
      user_id: "user_001",
      username: "alice_01",
      display_name: "Alice",
      account_status: "active",
      roles: ["student"],
      auth_source: "local_development",
      account_origin: "registered",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
      last_login_at: null,
    }).success).toBe(true);
    expect(authAccountSchema.safeParse({ session_token: "secret" }).success).toBe(false);
  });

  it("canonicalizes username inputs while account DTOs require canonical storage", () => {
    const registration = authRegisterRequestSchema.parse({
      role: "student",
      username: "Xie2787620039",
      display_name: "谢",
      password: "StrongPassword123",
      password_confirmation: "StrongPassword123",
    });
    const accountCreate = accountCreateRequestSchema.parse({
      username: "Ops_Admin",
      display_name: "Ops",
      password: "StrongPassword123",
      role: "admin",
    });
    expect(registration.username).toBe("xie2787620039");
    expect(accountCreate.username).toBe("ops_admin");
    expect(authAccountSchema.safeParse({
      user_id: "user_002",
      username: "xie2787620039",
      display_name: "谢",
      account_status: "active",
      roles: ["student"],
      auth_source: "local_development",
      account_origin: "registered",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
      last_login_at: null,
    }).success).toBe(true);
    expect(authAccountSchema.safeParse({
      user_id: "user_uppercase",
      username: "Xie2787620039",
      display_name: "谢",
      account_status: "active",
      roles: ["student"],
      auth_source: "local_development",
      account_origin: "registered",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
      last_login_at: null,
    }).success).toBe(false);
  });

  it("uses one NFKC username identity across composed and compatibility forms", () => {
    expect(canonicalizeUsername("  E\u0301  ")).toBe("é");
    expect(canonicalizeUsername("ＡＬＩＣＥ")).toBe("alice");

    const registration = authRegisterRequestSchema.parse({
      role: "student",
      username: "  E\u0301  ",
      display_name: "Student",
      password: "123456",
      password_confirmation: "123456",
    });
    const login = authLoginRequestSchema.parse({
      username: "É",
      password: "123456",
    });
    expect(registration.username).toBe("é");
    expect(login.username).toBe("é");
  });

  it("accepts short or Chinese usernames with simple six-character passwords", () => {
    const baseRequest = {
      role: "student" as const,
      display_name: "X",
      password: "123456",
      password_confirmation: "123456",
    };

    expect(authRegisterRequestSchema.safeParse({ ...baseRequest, username: "X" }).success).toBe(true);
    expect(authRegisterRequestSchema.safeParse({ ...baseRequest, username: "小谢" }).success).toBe(true);
    expect(authRegisterRequestSchema.safeParse({
      ...baseRequest,
      username: "X",
      password: "12345",
      password_confirmation: "12345",
    }).success).toBe(false);
    expect(authRegisterRequestSchema.safeParse({ ...baseRequest, username: " " }).success).toBe(false);
    expect(authAccountSchema.safeParse({
      user_id: "user_short_name",
      username: "x",
      display_name: "X",
      account_status: "active",
      roles: ["student"],
      auth_source: "local_development",
      account_origin: "registered",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      last_login_at: null,
    }).success).toBe(true);
  });

  it("keeps admin account operations explicit and validates status changes", () => {
    expect(accountCreateRequestSchema.safeParse({
      username: "ops_admin",
      display_name: "Ops",
      password: "StrongPassword123",
      role: "admin",
    }).success).toBe(true);
    expect(accountStatusUpdateSchema.safeParse({ status: "disabled" }).success).toBe(true);
    expect(accountStatusUpdateSchema.safeParse({ status: "pending_approval" }).success).toBe(false);
    expect(passwordChangeRequestSchema.safeParse({
      current_password: "OldPassword123",
      new_password: "NewPassword123",
      new_password_confirmation: "NewPassword123",
    }).success).toBe(true);
  });

  it("models teacher registration as an unauthenticated approval request", () => {
    const request = authRegisterRequestSchema.safeParse({
      role: "teacher",
      username: "teacher_apply_01",
      display_name: "申请教师",
      password: "StrongPassword123",
      password_confirmation: "StrongPassword123",
    });
    expect(request.success).toBe(true);

    const account = {
      user_id: "user_teacher_pending",
      username: "teacher_apply_01",
      display_name: "申请教师",
      account_status: "pending_approval",
      roles: ["teacher"],
      auth_source: "local_development",
      account_origin: "registered",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      last_login_at: null,
    };
    expect(authAccountSchema.safeParse(account).success).toBe(true);
    expect(authRegistrationResponseSchema.safeParse({
      account,
      authenticated: false,
      next_step: "await_teacher_approval",
    }).success).toBe(true);
  });

  it("requires complete course and class scope for teacher approval", () => {
    expect(teacherApprovalRequestSchema.safeParse({
      teacher_number: "T2026001",
      department: "计算机科学与技术学院",
      professional_title: "讲师",
      course_id: "course_408_ds",
      class_ids: ["class_cs_2302"],
    }).success).toBe(true);
    expect(teacherApprovalRequestSchema.safeParse({
      teacher_number: "T2026001",
      department: "计算机科学与技术学院",
      professional_title: "讲师",
      course_id: "course_408_ds",
      class_ids: [],
    }).success).toBe(false);
    expect(academicClassOptionSchema.safeParse({
      class_id: "class_cs_2302",
      cohort_year: 2023,
      major: "计算机科学与技术",
      class_name: "计算机科学与技术2302班",
    }).success).toBe(true);
  });

  it("accepts a teacher account request before course and class approval", () => {
    expect(accountCreateRequestSchema.safeParse({
      username: "teacher_001",
      display_name: "试点教师",
      password: "StrongPassword123",
      role: "teacher",
      course_id: "course_408_001",
    }).success).toBe(false);
    expect(accountCreateRequestSchema.safeParse({
      username: "teacher_002",
      display_name: "未绑定教师",
      password: "StrongPassword123",
      role: "teacher",
    }).success).toBe(true);
  });

  it("describes registration policy without exposing account or credential fields", () => {
    expect(studentRegistrationPolicySchema.safeParse({
      mode: "self_service",
      self_registration: true,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds", "course_408_cn"],
      notice: "注册后即可开始四门 408 课程的起步设置。",
    }).success).toBe(true);
    expect(studentRegistrationPolicySchema.safeParse({
      mode: "controlled",
      self_registration: false,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds", "course_408_cn"],
      notice: "当前试点由管理员创建账户并绑定课程。",
    }).success).toBe(true);
    expect(studentRegistrationPolicySchema.safeParse({
      mode: "controlled",
      self_registration: false,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds"],
      notice: "受控试点",
      password_hash: "must-not-cross-boundary",
    }).success).toBe(false);
    expect(studentRegistrationPolicySchema.safeParse({
      mode: "demo_open",
      self_registration: true,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds"],
      notice: "legacy mode must not cross the public boundary",
    }).success).toBe(false);
  });
});
