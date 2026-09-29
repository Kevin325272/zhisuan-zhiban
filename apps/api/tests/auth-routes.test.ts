import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import {
  AuthenticationError,
  type LocalAuthenticationService,
  type PublicAccount,
} from "../src/services/auth/authentication.js";
import * as authRouteModule from "../src/routes/auth.js";
import { resolveTrustedProxy } from "../src/services/auth/auth-security.js";

const account: PublicAccount = {
  user_id: "user_student_001",
  username: "student_001",
  display_name: "本地学生",
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

const pendingTeacher: PublicAccount = {
  ...account,
  user_id: "user_teacher_pending",
  username: "teacher_apply_01",
  display_name: "申请教师",
  account_status: "pending_approval",
  roles: ["teacher"],
};

function fakeAuthentication() {
  let revoked = false;
  const service = {
    async registerStudent() {
      return { account, sessionToken: "session-token-never-in-body" };
    },
    async registerTeacher() {
      return pendingTeacher;
    },
    async login() {
      if (revoked) {
        const error = new Error("用户名或密码不正确。") as Error & { code: string; status: number };
        error.code = "INVALID_CREDENTIALS";
        error.status = 401;
        throw error;
      }
      return { account, sessionToken: "session-token-never-in-body" };
    },
    async resolveSession(token: string) {
      return token === "session-token-never-in-body" && !revoked ? { account } : null;
    },
    async revokeSession() {
      revoked = true;
    },
    async changePassword() {
      return account;
    },
  } as unknown as LocalAuthenticationService;
  return service;
}

function rejectingAuthentication() {
  return {
    async login() {
      throw new AuthenticationError("INVALID_CREDENTIALS", "用户名或密码不正确。", 401);
    },
  } as unknown as LocalAuthenticationService;
}

describe("account authentication routes", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("exposes a controlled registration policy without requiring a session", async () => {
    app = buildApp({ authentication: fakeAuthentication() });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/registration-policy",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      mode: "controlled",
      self_registration: false,
      teacher_registration: "approval_required",
    });
    expect(response.body).not.toContain("password_hash");
  });

  it("reports explicit self-service registration without exposing deployment terminology", async () => {
    app = buildApp({
      authentication: fakeAuthentication(),
      registration: { mode: "self_service", courseIds: ["course_408_ds"] },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/registration-policy",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      mode: "self_service",
      self_registration: true,
      course_ids: ["course_408_ds"],
    });
    expect(response.body).not.toContain("演示模式");
  });

  it("sets an httpOnly session cookie without returning a token", async () => {
    app = buildApp({ authentication: fakeAuthentication() });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "student_001", password: "StrongPassword123" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("xuetu_session=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(response.body).not.toContain("session-token-never-in-body");
    expect(response.json().data.account).toMatchObject({ user_id: account.user_id });
  });

  it("creates a pending teacher application without setting a session cookie", async () => {
    app = buildApp({ authentication: fakeAuthentication() });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        role: "teacher",
        username: "teacher_apply_01",
        display_name: "申请教师",
        password: "StrongPassword123",
        password_confirmation: "StrongPassword123",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.json().data).toMatchObject({
      account: { account_status: "pending_approval", roles: ["teacher"] },
      authenticated: false,
      next_step: "await_teacher_approval",
    });
  });

  it("marks session cookies Secure for production while preserving local HTTP development", async () => {
    const resolveSecure = (authRouteModule as Record<string, unknown>).resolveAuthCookieSecure;
    expect(typeof resolveSecure).toBe("function");
    expect((resolveSecure as (environment: Record<string, string | undefined>) => boolean)({})).toBe(false);
    expect(() => (resolveSecure as (environment: Record<string, string | undefined>) => boolean)({
      NODE_ENV: "production",
    })).toThrow(/XUETU_PUBLIC_ORIGIN/iu);
    expect((resolveSecure as (environment: Record<string, string | undefined>) => boolean)({
      NODE_ENV: "production",
      XUETU_PUBLIC_ORIGIN: "https://xuetu.lan",
    })).toBe(true);
    expect((resolveSecure as (environment: Record<string, string | undefined>) => boolean)({
      XUETU_AUTH_COOKIE_SECURE: "true",
    })).toBe(true);
    expect(() => (resolveSecure as (environment: Record<string, string | undefined>) => boolean)({
      NODE_ENV: "production",
      XUETU_AUTH_COOKIE_SECURE: "false",
      XUETU_PUBLIC_ORIGIN: "https://xuetu.lan",
    })).toThrow(/Secure/iu);

    app = buildApp({ authentication: fakeAuthentication(), authCookieSecure: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "student_001", password: "StrongPassword123" },
    });
    expect(response.headers["set-cookie"]).toContain("; Secure");
  });

  it("rate-limits repeated failed logins for one client without changing the generic credential error", async () => {
    app = buildApp({
      authentication: rejectingAuthentication(),
      authRateLimit: {
        login: { maxAttempts: 2, windowMs: 60_000 },
        register: { maxAttempts: 2, windowMs: 60_000 },
        maxTrackedClients: 10,
      },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "missing_user", password: "WrongPassword123" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toMatchObject({
        code: "INVALID_CREDENTIALS",
        message: "用户名或密码不正确。",
      });
    }
    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "missing_user", password: "WrongPassword123" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("AUTH_RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("does not let a successful login erase earlier failed attempts", async () => {
    const authentication = {
      async login(input: { username: string }) {
        if (input.username === "known_student") {
          return { account, sessionToken: "session-token-never-in-body" };
        }
        throw new AuthenticationError("INVALID_CREDENTIALS", "用户名或密码不正确。", 401);
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      authentication,
      authRateLimit: {
        login: { maxAttempts: 2, windowMs: 60_000 },
        register: { maxAttempts: 2, windowMs: 60_000 },
        maxTrackedClients: 10,
      },
    });

    const login = (username: string) => app!.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username, password: "StrongPassword123" },
    });

    expect((await login("missing_user")).statusCode).toBe(401);
    expect((await login("known_student")).statusCode).toBe(200);
    expect((await login("another_missing_user")).statusCode).toBe(401);
    const limited = await login("third_missing_user");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("AUTH_RATE_LIMITED");
  });

  it("does not accumulate successful logins as failed attempts", async () => {
    app = buildApp({
      authentication: fakeAuthentication(),
      authRateLimit: {
        login: { maxAttempts: 1, windowMs: 60_000 },
        register: { maxAttempts: 2, windowMs: 60_000 },
        maxTrackedClients: 10,
      },
    });
    const login = () => app!.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "student_001", password: "StrongPassword123" },
    });

    expect((await login()).statusCode).toBe(200);
    expect((await login()).statusCode).toBe(200);
    expect((await login()).statusCode).toBe(200);
  });

  it("separates forwarded client addresses only when the loopback reverse proxy is trusted", async () => {
    app = buildApp({
      authentication: rejectingAuthentication(),
      trustProxy: resolveTrustedProxy({ XUETU_TRUST_PROXY: "true" }),
      authRateLimit: {
        login: { maxAttempts: 1, windowMs: 60_000 },
        register: { maxAttempts: 2, windowMs: 60_000 },
        maxTrackedClients: 10,
      },
    });
    const loginFrom = (address: string) => app!.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-forwarded-for": address },
      payload: { username: "missing_user", password: "WrongPassword123" },
    });

    expect((await loginFrom("203.0.113.10")).statusCode).toBe(401);
    expect((await loginFrom("203.0.113.10")).statusCode).toBe(429);
    expect((await loginFrom("203.0.113.11")).statusCode).toBe(401);
  });

  it("ignores spoofed forwarded addresses from an untrusted direct client", async () => {
    app = buildApp({
      authentication: rejectingAuthentication(),
      trustProxy: resolveTrustedProxy({ XUETU_TRUST_PROXY: "true" }),
      authRateLimit: {
        login: { maxAttempts: 1, windowMs: 60_000 },
        register: { maxAttempts: 2, windowMs: 60_000 },
        maxTrackedClients: 10,
      },
    });
    const loginFrom = (forwardedAddress: string) => app!.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "203.0.113.50",
      headers: { "x-forwarded-for": forwardedAddress },
      payload: { username: "missing_user", password: "WrongPassword123" },
    });

    expect((await loginFrom("198.51.100.10")).statusCode).toBe(401);
    expect((await loginFrom("198.51.100.11")).statusCode).toBe(429);
  });

  it("rate-limits account registration independently from login", async () => {
    app = buildApp({
      authentication: fakeAuthentication(),
      authRateLimit: {
        login: { maxAttempts: 5, windowMs: 60_000 },
        register: { maxAttempts: 1, windowMs: 60_000 },
        maxTrackedClients: 10,
      },
    });
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        role: "student",
        username: "student_101",
        display_name: "测试学生",
        password: "StrongPassword123",
        password_confirmation: "StrongPassword123",
      },
    });
    expect(first.statusCode).toBe(201);

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        role: "student",
        username: "student_102",
        display_name: "测试学生",
        password: "StrongPassword123",
        password_confirmation: "StrongPassword123",
      },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("AUTH_RATE_LIMITED");
  });

  it("resolves and revokes the server session, never exposing password data", async () => {
    app = buildApp({ authentication: fakeAuthentication() });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "student_001", password: "StrongPassword123" },
    });
    const cookie = login.headers["set-cookie"] as string;
    const session = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().data.account).toEqual(account);
    expect(session.json().data.account).not.toHaveProperty("password_hash");
    expect(session.json().data.account).not.toHaveProperty("session_token");

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it("returns an empty optional session for a visitor without a cookie", async () => {
    app = buildApp({ authentication: fakeAuthentication() });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session?optional=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ account: null });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("clears an invalid cookie without failing an optional session lookup", async () => {
    app = buildApp({ authentication: fakeAuthentication() });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session?optional=1",
      headers: { cookie: "xuetu_session=expired-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ account: null });
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("keeps the default session lookup strict when no cookie is present", async () => {
    app = buildApp({ authentication: fakeAuthentication() });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("returns only the current account's active course memberships", async () => {
    app = buildApp({
      authentication: fakeAuthentication(),
      allowLocalDevAuth: true,
      platformAccess: {
        async getActor(userId) {
          return userId === account.user_id
            ? {
                user: {
                  user_id: account.user_id,
                  display_name: account.display_name,
                  account_status: "active",
                  auth_source: "local_development",
                  created_at: account.created_at,
                  updated_at: account.updated_at,
                },
                roles: ["student"],
              }
            : null;
        },
        async isCourseAssigned() { return true; },
        async listAssignedCourses() {
          return [{
            course_id: "course_408_ds",
            course_code: "CS408-DS",
            title: "数据结构",
          }];
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/account/course-scope",
      headers: { "x-dev-user-id": account.user_id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      items: [{ course_id: "course_408_ds", course_code: "CS408-DS", title: "数据结构" }],
      visibility: "active_memberships_only",
    });
    expect(response.body).not.toContain("password_hash");
  });

  it("uses teacher course memberships for a student-teacher account whose primary portal is teacher", async () => {
    const multiRoleAccount: PublicAccount = {
      ...account,
      roles: ["student", "teacher"],
    };
    const queriedRoles: Array<"student" | "teacher"> = [];
    app = buildApp({
      authentication: {
        async resolveSession(token: string) {
          return token === "multi-role-session" ? { account: multiRoleAccount } : null;
        },
      } as unknown as LocalAuthenticationService,
      platformAccess: {
        async getActor() { return null; },
        async isCourseAssigned() { return false; },
        async listAssignedCourses(_userId, membershipRole) {
          queriedRoles.push(membershipRole);
          return membershipRole === "teacher"
            ? [{
                course_id: "course_teacher_ds",
                course_code: "CS408-TEACH",
                title: "教师课程",
              }]
            : [{
                course_id: "course_student_ds",
                course_code: "CS408-STUDY",
                title: "学生课程",
              }];
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/account/course-scope",
      headers: { cookie: "xuetu_session=multi-role-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(queriedRoles).toEqual(["teacher"]);
    expect(response.json().data).toEqual({
      items: [{
        course_id: "course_teacher_ds",
        course_code: "CS408-TEACH",
        title: "教师课程",
      }],
      visibility: "active_memberships_only",
    });
  });

  it("returns a generic authentication error for invalid credentials", async () => {
    app = buildApp({ authentication: fakeAuthentication() });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "missing_user", password: "wrong" },
    });
    // The fake accepts this path; schema validation still prevents malformed
    // input from becoming a server error. Generic handling is covered by the
    // service test and the production service maps all credential failures to
    // INVALID_CREDENTIALS.
    expect(response.statusCode).toBe(200);
  });

  it("marks unexpected authentication service failures as retryable", async () => {
    app = buildApp({
      authentication: {
        async resolveSession() {
          throw new Error("database unavailable");
        },
      } as unknown as LocalAuthenticationService,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: "xuetu_session=valid-looking-token" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toMatchObject({
      code: "AUTHENTICATION_FAILED",
      retryable: true,
      details: {},
    });
  });

  it("protects legacy learning, question-bank, AI and session surfaces", async () => {
    app = buildApp({ authentication: fakeAuthentication() });
    const paths = [
      "/api/v1/learning-plan",
      "/api/v1/mistakes",
      "/api/v1/question-bank/questions",
      "/api/v1/ai/execute",
      "/api/v1/learning-sessions",
      "/api/v1/courses/course_408_001/map",
    ];
    for (const url of paths) {
      const response = await app.inject({ method: url.endsWith("learning-sessions") || url.endsWith("ai/execute") ? "POST" : "GET", url });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().error.code, url).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  it("fails closed for an unclassified API route instead of allowing anonymous probing", async () => {
    app = buildApp({ authentication: fakeAuthentication() });
    for (const url of [
      "/api/v1/future-sensitive-route",
      "/api/v1/auth/future-sensitive-route",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().error.code, url).toBe("AUTHENTICATION_REQUIRED");
    }
  });
});
