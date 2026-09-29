import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  LocalAuthenticationService,
  type AuthRepository,
} from "../src/services/auth/authentication.js";
import { ScryptPasswordHasher } from "../src/services/auth/password-hasher.js";

function memoryRepository(onCreateAccount?: (input: {
  role: string;
  courseId?: string;
  courseIds?: readonly string[];
}) => void): AuthRepository {
  const accounts = new Map<string, any>();
  const sessions = new Map<string, any>();
  return {
    async findByUsername(username) {
      return [...accounts.values()].find((account) => account.username === username) ?? null;
    },
    async findById(userId) {
      return accounts.get(userId) ?? null;
    },
    async createStudent(input) {
      const account = {
        user_id: `user_${accounts.size + 1}`,
        username: input.username,
        display_name: input.displayName,
        account_status: "active" as const,
        auth_source: "local_development" as const,
        account_origin: "registered" as const,
        must_change_password: false,
        password_hash: input.passwordHash,
        roles: ["student" as const],
        created_at: "2026-08-02T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      };
      accounts.set(account.user_id, account);
      return account;
    },
    async createTeacherApplication(input) {
      const account = {
        user_id: `user_${accounts.size + 1}`,
        username: input.username,
        display_name: input.displayName,
        account_status: "pending_approval" as const,
        auth_source: "local_development" as const,
        account_origin: "registered" as const,
        must_change_password: input.mustChangePassword,
        password_hash: input.passwordHash,
        roles: ["teacher" as const],
        created_at: "2026-08-25T00:00:00.000Z",
        updated_at: "2026-08-25T00:00:00.000Z",
      };
      accounts.set(account.user_id, account);
      return account;
    },
    async createAccount(input) {
      onCreateAccount?.(input);
      const account = {
        user_id: `user_${accounts.size + 1}`,
        username: input.username,
        display_name: input.displayName,
        account_status: "active" as const,
        auth_source: "local_development" as const,
        account_origin: input.role === "admin" ? ("seeded_admin" as const) : ("registered" as const),
        must_change_password: input.mustChangePassword,
        password_hash: input.passwordHash,
        roles: [input.role] as ["student"] | ["admin"],
        created_at: "2026-08-02T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      };
      accounts.set(account.user_id, account);
      return account;
    },
    async createSession(input) {
      sessions.set(input.tokenHash, {
        session_id: input.sessionId,
        user_id: input.userId,
        token_hash: input.tokenHash,
        created_at: input.createdAt,
        expires_at: input.expiresAt,
        last_seen_at: input.createdAt,
        revoked_at: null,
      });
    },
    async findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session) return null;
      return { ...session, account: accounts.get(session.user_id) };
    },
    async touchSession() {},
    async revokeSession(tokenHash) { sessions.delete(tokenHash); },
    async revokeAllSessions() { sessions.clear(); },
    async updateLastLogin() {},
    async updatePassword(userId, passwordHash, mustChangePassword, updatedAt) {
      const account = accounts.get(userId);
      if (!account) throw new Error("account missing");
      account.password_hash = passwordHash;
      account.must_change_password = mustChangePassword;
      account.updated_at = updatedAt;
      return account;
    },
    async replacePasswordAndRevokeSessions(userId, passwordHash, mustChangePassword, updatedAt, expectedPasswordHash) {
      const account = accounts.get(userId);
      if (!account || (expectedPasswordHash !== null && account.password_hash !== expectedPasswordHash)) return null;
      account.password_hash = passwordHash;
      account.must_change_password = mustChangePassword;
      account.updated_at = updatedAt;
      sessions.clear();
      return account;
    },
    async listAccounts() { return [...accounts.values()]; },
    async listAcademicClasses() {
      return [{
        class_id: "class_cs_2302",
        cohort_year: 2023,
        major: "计算机科学与技术",
        class_name: "计算机科学与技术2302班",
      }];
    },
    async approveTeacher(input) {
      const account = accounts.get(input.userId);
      if (!account) return { status: "not_found" as const };
      if (!account.roles.includes("teacher") || account.account_status !== "pending_approval") {
        return { status: "not_approvable_teacher" as const };
      }
      account.account_status = "active";
      account.updated_at = input.updatedAt;
      return { status: "approved" as const, account };
    },
    async updateAccountStatus(userId, status, updatedAt) {
      const account = accounts.get(userId);
      if (!account) return null;
      account.account_status = status;
      account.updated_at = updatedAt;
      return account;
    },
    async updateAccountStatusAndRevokeSessions(userId, status, updatedAt) {
      const account = accounts.get(userId);
      if (!account) return { status: "not_found" as const };
      const activeAdmins = [...accounts.values()].filter((item) => (
        item.account_status === "active" && item.roles.includes("admin")
      ));
      if (status === "disabled" && account.roles.includes("admin") && activeAdmins.length <= 1) {
        return { status: "last_admin_protected" as const };
      }
      account.account_status = status;
      account.updated_at = updatedAt;
      if (status === "disabled") sessions.clear();
      return { status: "updated" as const, account };
    },
    async countActiveAdmins() { return 1; },
  };
}

describe("local authentication service", () => {
  it("registers a student, never returns a password hash, and resolves a revocable session", async () => {
    const service = new LocalAuthenticationService(memoryRepository(), new ScryptPasswordHasher());
    const registered = await service.registerStudent({
      username: "Alice_01",
      displayName: "Alice",
      password: "StrongPassword123",
    });

    expect(registered.account).toMatchObject({ username: "alice_01", roles: ["student"] });
    expect(registered).toHaveProperty("sessionToken");
    expect(JSON.stringify(registered)).not.toContain("password_hash");

    const resolved = await service.resolveSession(registered.sessionToken);
    expect(resolved?.account.user_id).toBe(registered.account.user_id);

    await service.revokeSession(registered.sessionToken);
    await expect(service.resolveSession(registered.sessionToken)).resolves.toBeNull();
  });

  it("registers and logs in a student with a one-character username and a simple password", async () => {
    const service = new LocalAuthenticationService(memoryRepository(), new ScryptPasswordHasher());
    const registered = await service.registerStudent({
      username: "X",
      displayName: "X",
      password: "123456",
    });

    expect(registered.account).toMatchObject({ username: "x", display_name: "X" });
    await expect(service.login({ username: "X", password: "123456" }))
      .resolves.toMatchObject({ account: { username: "x" } });
  });

  it("treats canonically equivalent Unicode usernames as one account", async () => {
    const service = new LocalAuthenticationService(memoryRepository(), new ScryptPasswordHasher());
    const registered = await service.registerStudent({
      username: "É",
      displayName: "Unicode Student",
      password: "123456",
    });

    expect(registered.account.username).toBe("é");
    await expect(service.login({ username: "E\u0301", password: "123456" }))
      .resolves.toMatchObject({ account: { user_id: registered.account.user_id } });
    await expect(service.registerStudent({
      username: "E\u0301",
      displayName: "Duplicate Unicode Student",
      password: "123456",
    })).rejects.toMatchObject({ code: "ACCOUNT_CREATION_FAILED", status: 409 });
  });

  it("blocks public registration when the pilot is in controlled mode", async () => {
    const service = new LocalAuthenticationService(
      memoryRepository(),
      new ScryptPasswordHasher(),
      { registration: { mode: "controlled", courseIds: ["course_408_ds"] } },
    );

    await expect(service.registerStudent({
      username: "controlled_01",
      displayName: "受控试点学生",
      password: "StrongPassword123",
    })).rejects.toMatchObject({
      code: "STUDENT_REGISTRATION_CONTROLLED",
      status: 403,
    });
  });

  it("registers a teacher application without issuing a session and keeps it unable to log in", async () => {
    const service = new LocalAuthenticationService(memoryRepository(), new ScryptPasswordHasher());

    const applied = await service.registerTeacher({
      username: "Teacher_Apply_01",
      displayName: "申请教师",
      password: "StrongPassword123",
    });

    expect(applied).toMatchObject({
      username: "teacher_apply_01",
      roles: ["teacher"],
      account_status: "pending_approval",
    });
    expect(applied).not.toHaveProperty("sessionToken");
    await expect(service.login({
      username: "teacher_apply_01",
      password: "StrongPassword123",
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
  });

  it("requires the dedicated approval path before a teacher can become active", async () => {
    const repository = memoryRepository();
    const service = new LocalAuthenticationService(repository, new ScryptPasswordHasher(), {
      registration: { mode: "controlled", courseIds: ["course_408_ds"] },
    });
    const admin: import("../src/services/auth/authentication.js").PublicAccount = {
      user_id: "user_admin_001",
      username: "admin_001",
      display_name: "管理员",
      account_status: "active",
      roles: ["admin"],
      auth_source: "local_development",
      account_origin: "seeded_admin",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
      last_login_at: null,
    };
    const pending = await service.registerTeacher({
      username: "teacher_apply_02",
      displayName: "待审教师",
      password: "StrongPassword123",
    });

    await expect(service.updateAccountStatus(admin, pending.user_id, "active"))
      .rejects.toMatchObject({ code: "TEACHER_APPROVAL_REQUIRED", status: 409 });

    const approved = await service.approveTeacher(admin, pending.user_id, {
      teacherNumber: "T2026002",
      department: "计算机科学与技术学院",
      professionalTitle: "讲师",
      courseId: "course_408_ds",
      classIds: ["class_cs_2302"],
    });
    expect(approved).toMatchObject({ account_status: "active", roles: ["teacher"] });
    await expect(service.login({
      username: "teacher_apply_02",
      password: "StrongPassword123",
    })).resolves.toMatchObject({ account: { user_id: pending.user_id } });
    await expect(service.listAcademicClasses(admin)).resolves.toHaveLength(1);
  });

  it("rejects a controlled student binding outside the configured pilot courses", async () => {
    const service = new LocalAuthenticationService(
      memoryRepository(),
      new ScryptPasswordHasher(),
      { registration: { mode: "controlled", courseIds: ["course_408_ds"] } },
    );
    const admin: import("../src/services/auth/authentication.js").PublicAccount = {
      user_id: "user_admin_001",
      username: "admin_001",
      display_name: "管理员",
      account_status: "active",
      roles: ["admin"],
      auth_source: "local_development",
      account_origin: "seeded_admin",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
      last_login_at: null,
    };

    await expect(service.createAccount(admin, {
      username: "student_outside",
      displayName: "越界学生",
      password: "StrongPassword123",
      role: "student",
      courseId: "course_408_cn",
    })).rejects.toMatchObject({
      code: "COURSE_BINDING_INVALID",
      status: 400,
    });
  });

  it("grants a controlled 408 student every configured course used by onboarding", async () => {
    let receivedCourseIds: readonly string[] | undefined;
    const configuredCourseIds = [
      "course_408_ds",
      "course_408_co",
      "course_408_os",
      "course_408_cn",
    ];
    const service = new LocalAuthenticationService(
      memoryRepository((input) => { receivedCourseIds = input.courseIds; }),
      new ScryptPasswordHasher(),
      { registration: { mode: "controlled", courseIds: configuredCourseIds } },
    );
    const admin: import("../src/services/auth/authentication.js").PublicAccount = {
      user_id: "user_admin_001",
      username: "admin_001",
      display_name: "管理员",
      account_status: "active",
      roles: ["admin"],
      auth_source: "local_development",
      account_origin: "seeded_admin",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
      last_login_at: null,
    };

    await service.createAccount(admin, {
      username: "student_all_408",
      displayName: "四科学生",
      password: "StrongPassword123",
      role: "student",
    });

    expect(receivedCourseIds).toEqual(configuredCourseIds);
  });

  it("uses one generic login error for unknown, wrong-password, and disabled accounts", async () => {
    const repository = memoryRepository();
    const service = new LocalAuthenticationService(repository, new ScryptPasswordHasher());
    await service.registerStudent({
      username: "Alice_02",
      displayName: "Alice",
      password: "StrongPassword123",
    });

    const errors = await Promise.all([
      service.login({ username: "missing_user", password: "WrongPassword123" }).catch((error) => error),
      service.login({ username: "alice_02", password: "WrongPassword123" }).catch((error) => error),
    ]);
    expect(errors[0]).toBeInstanceOf(AuthenticationError);
    expect(errors[1]).toBeInstanceOf(AuthenticationError);
    expect(errors[0].code).toBe("INVALID_CREDENTIALS");
    expect(errors[1].message).toBe(errors[0].message);
  });

  it("runs an equal-cost password verification for an unknown username", async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const service = new LocalAuthenticationService(memoryRepository(), {
      hash: vi.fn().mockResolvedValue("unused"),
      verify,
    });

    await expect(service.login({
      username: "missing_user",
      password: "WrongPassword123",
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(verify).toHaveBeenCalledOnce();
    expect(verify.mock.calls[0]?.[1]).toMatch(/^scrypt\$/u);
  });

  it("rejects an expired server session even when its token is otherwise valid", async () => {
    let currentTime = new Date("2026-08-02T00:00:00.000Z");
    const service = new LocalAuthenticationService(
      memoryRepository(),
      new ScryptPasswordHasher(),
      { now: () => currentTime, sessionTtlMs: 1_000 },
    );
    const registered = await service.registerStudent({
      username: "alice_03",
      displayName: "Alice",
      password: "StrongPassword123",
    });

    currentTime = new Date("2026-08-02T00:00:01.001Z");
    await expect(service.resolveSession(registered.sessionToken)).resolves.toBeNull();
  });

  it("changes a password without returning hashes and revokes existing sessions", async () => {
    const service = new LocalAuthenticationService(memoryRepository(), new ScryptPasswordHasher());
    const registered = await service.registerStudent({
      username: "alice_04",
      displayName: "Alice",
      password: "StrongPassword123",
    });

    const updated = await service.changePassword(
      registered.account.user_id,
      "StrongPassword123",
      "NewStrongPassword456",
    );
    expect(updated).toMatchObject({ user_id: registered.account.user_id });
    expect(JSON.stringify(updated)).not.toContain("password_hash");
    await expect(service.resolveSession(registered.sessionToken)).resolves.toBeNull();
    await expect(service.login({ username: "alice_04", password: "StrongPassword123" }))
      .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(service.login({ username: "alice_04", password: "NewStrongPassword456" }))
      .resolves.toMatchObject({ account: { user_id: registered.account.user_id } });
  });

  it("rejects weak passwords and duplicate usernames without account enumeration", async () => {
    const service = new LocalAuthenticationService(memoryRepository(), new ScryptPasswordHasher());
    await expect(service.registerStudent({ username: "ab", displayName: "A", password: "short" }))
      .rejects.toMatchObject({ code: "ACCOUNT_INPUT_INVALID" });
  });

  it("keeps an administrator-created teacher pending until full approval", async () => {
    const repository = memoryRepository();
    const teacherApplicationSpy = vi.spyOn(repository, "createTeacherApplication");
    const service = new LocalAuthenticationService(repository, new ScryptPasswordHasher());
    const admin: import("../src/services/auth/authentication.js").PublicAccount = {
      user_id: "user_admin_001",
      username: "admin_001",
      display_name: "管理员",
      account_status: "active",
      roles: ["admin"],
      auth_source: "local_development",
      account_origin: "seeded_admin",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
      last_login_at: null,
    };

    const created = await service.createAccount(admin, {
      username: "teacher_001",
      displayName: "试点教师",
      password: "StrongPassword123",
      role: "teacher",
    });

    expect(created).toMatchObject({
      username: "teacher_001",
      roles: ["teacher"],
      account_status: "pending_approval",
    });
    expect(created.must_change_password).toBe(true);
    expect(teacherApplicationSpy).toHaveBeenCalledWith(expect.objectContaining({
      mustChangePassword: true,
    }));
    await expect(service.login({ username: "teacher_001", password: "StrongPassword123" }))
      .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(JSON.stringify(created)).not.toContain("password_hash");
  });

  it("rejects direct course binding when an administrator creates a teacher", async () => {
    const service = new LocalAuthenticationService(
      memoryRepository(),
      new ScryptPasswordHasher(),
      { registration: { mode: "controlled", courseIds: ["course_408_ds"] } },
    );
    const admin: import("../src/services/auth/authentication.js").PublicAccount = {
      user_id: "user_admin_001",
      username: "admin_001",
      display_name: "管理员",
      account_status: "active",
      roles: ["admin"],
      auth_source: "local_development",
      account_origin: "seeded_admin",
      data_boundary: "local_account",
      must_change_password: false,
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
      last_login_at: null,
    };

    await expect(service.createAccount(admin, {
      username: "teacher_outside",
      displayName: "越界教师",
      password: "StrongPassword123",
      role: "teacher",
      courseId: "course_408_cn",
    })).rejects.toMatchObject({
      code: "TEACHER_APPROVAL_REQUIRED",
      status: 409,
    });
  });
});
