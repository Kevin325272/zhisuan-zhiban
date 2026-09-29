import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  authLoginRequestSchema,
  authRegistrationResponseSchema,
  authRegisterRequestSchema,
  passwordChangeRequestSchema,
  studentRegistrationPolicySchema,
} from "@xuetu/contracts";

import {
  DEMO_408_COURSE_IDS,
  type StudentRegistrationConfig,
} from "../config/student-registration.js";
import {
  AuthenticationError,
  type LocalAuthenticationService,
} from "../services/auth/authentication.js";
import {
  FixedWindowAuthRateLimiter,
  resolveAuthRateLimitOptions,
  type AuthRateLimitOptions,
} from "../services/auth/auth-rate-limiter.js";

export { resolveAuthCookieSecure } from "../services/auth/auth-security.js";

export const AUTH_SESSION_COOKIE = "xuetu_session";
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(
  requestId: string,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  retryable = false,
) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: { code, message, retryable, details },
  };
}

function cookieValue(request: FastifyRequest, name: string) {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const item of raw.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  options: { ttlSeconds: number; secure: boolean },
) {
  const secure = options.secure ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${options.ttlSeconds}; HttpOnly; SameSite=Lax${secure}`,
  );
}

function clearSessionCookie(reply: FastifyReply, secure: boolean) {
  const suffix = secure ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${AUTH_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${suffix}`,
  );
}

function errorResponse(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof AuthenticationError) {
    return reply
      .code(error.status)
      .send(failure(request.id, error.code, error.message, error.details));
  }
  request.log.error(error);
  return reply
    .code(500)
    .send(failure(request.id, "AUTHENTICATION_FAILED", "认证服务暂时不可用。", {}, true));
}

export function registerAuthRoutes(
  app: FastifyInstance,
  authentication: LocalAuthenticationService | null,
  options: {
    secureCookies?: boolean;
    sessionTtlSeconds?: number;
    rateLimit?: AuthRateLimitOptions;
    registration?: StudentRegistrationConfig;
  } = {},
) {
  const secureCookies = options.secureCookies ?? false;
  const sessionTtlSeconds = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const rateLimit = resolveAuthRateLimitOptions(options.rateLimit);
  const registration = options.registration ?? {
    mode: "controlled" as const,
    courseIds: DEMO_408_COURSE_IDS,
  };
  const loginLimiter = new FixedWindowAuthRateLimiter(rateLimit.login, rateLimit);
  const registerLimiter = new FixedWindowAuthRateLimiter(rateLimit.register, rateLimit);

  const consume = (
    request: FastifyRequest,
    reply: FastifyReply,
    limiter: FixedWindowAuthRateLimiter,
  ) => {
    const decision = limiter.consume(request.ip);
    if (decision.allowed) return decision;
    reply.header("Retry-After", String(decision.retryAfterSeconds));
    reply.code(429).send(failure(
      request.id,
      "AUTH_RATE_LIMITED",
      "请求过于频繁，请稍后再试。",
      { retry_after_seconds: decision.retryAfterSeconds },
      true,
    ));
    return null;
  };

  const unavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(503)
      .send(failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "本地账户认证尚未配置。"));

  app.get("/api/v1/auth/registration-policy", async (request) => {
    const policy = studentRegistrationPolicySchema.parse({
      mode: registration.mode,
      self_registration: registration.mode === "self_service",
      teacher_registration: "approval_required",
      course_ids: [...registration.courseIds],
      notice: registration.mode === "controlled"
        ? "当前试点由管理员创建账户并绑定课程，暂不开放自行注册。"
        : "注册后即可开始四门 408 课程的起步设置。",
    });
    return success(request.id, policy);
  });

  app.post<{ Body: unknown }>("/api/v1/auth/register", async (request, reply) => {
    if (!authentication) return unavailable(request, reply);
    if (!consume(request, reply, registerLimiter)) return;
    const parsed = authRegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(
        failure(request.id, "ACCOUNT_INPUT_INVALID", "注册信息无效。", {
          issues: parsed.error.issues,
        }),
      );
    }
    try {
      if (parsed.data.role === "teacher") {
        const account = await authentication.registerTeacher({
          username: parsed.data.username,
          displayName: parsed.data.display_name,
          password: parsed.data.password,
        });
        const data = authRegistrationResponseSchema.parse({
          account,
          authenticated: false,
          next_step: "await_teacher_approval",
        });
        return reply.code(201).send(success(request.id, data));
      }
      const result = await authentication.registerStudent({
        username: parsed.data.username,
        displayName: parsed.data.display_name,
        password: parsed.data.password,
      });
      setSessionCookie(reply, result.sessionToken, {
        ttlSeconds: sessionTtlSeconds,
        secure: secureCookies,
      });
      const data = authRegistrationResponseSchema.parse({
        account: result.account,
        authenticated: true,
        next_step: "student_onboarding",
      });
      return reply.code(201).send(success(request.id, data));
    } catch (error) {
      return errorResponse(request, reply, error);
    }
  });

  app.post<{ Body: unknown }>("/api/v1/auth/login", async (request, reply) => {
    if (!authentication) return unavailable(request, reply);
    const loginReservation = consume(request, reply, loginLimiter);
    if (!loginReservation) return;
    const parsed = authLoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(failure(request.id, "LOGIN_INPUT_INVALID", "用户名或密码格式无效。"));
    }
    try {
      const result = await authentication.login(parsed.data);
      loginLimiter.release(request.ip, loginReservation.windowResetAt);
      setSessionCookie(reply, result.sessionToken, {
        ttlSeconds: sessionTtlSeconds,
        secure: secureCookies,
      });
      return success(request.id, { account: result.account });
    } catch (error) {
      // AuthenticationError deliberately uses the same message for unknown,
      // disabled and wrong-password accounts to prevent account enumeration.
      return errorResponse(request, reply, error);
    }
  });

  app.get<{ Querystring: { optional?: string } }>("/api/v1/auth/session", async (request, reply) => {
    if (!authentication) return unavailable(request, reply);
    const optional = request.query.optional === "1" || request.query.optional === "true";
    const token = cookieValue(request, AUTH_SESSION_COOKIE);
    if (!token) {
      if (optional) return success(request.id, { account: null });
      return reply.code(401).send(failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录。"));
    }
    try {
      const session = await authentication.resolveSession(token);
      if (!session) {
        clearSessionCookie(reply, secureCookies);
        if (optional) return success(request.id, { account: null });
        return reply.code(401).send(failure(request.id, "SESSION_INVALID", "登录已失效，请重新登录。"));
      }
      return success(request.id, { account: session.account });
    } catch (error) {
      return errorResponse(request, reply, error);
    }
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    if (!authentication) return unavailable(request, reply);
    const token = cookieValue(request, AUTH_SESSION_COOKIE);
    try {
      if (token) await authentication.revokeSession(token);
      clearSessionCookie(reply, secureCookies);
      return success(request.id, { logged_out: true });
    } catch (error) {
      return errorResponse(request, reply, error);
    }
  });

  app.post<{ Body: unknown }>("/api/v1/auth/password", async (request, reply) => {
    if (!authentication) return unavailable(request, reply);
    const token = cookieValue(request, AUTH_SESSION_COOKIE);
    if (!token) return reply.code(401).send(failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录。"));
    const session = await authentication.resolveSession(token);
    if (!session) {
      clearSessionCookie(reply, secureCookies);
      return reply.code(401).send(failure(request.id, "SESSION_INVALID", "登录已失效，请重新登录。"));
    }
    const parsed = passwordChangeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(failure(request.id, "PASSWORD_INPUT_INVALID", "密码格式无效。", { issues: parsed.error.issues }));
    }
    try {
      const account = await authentication.changePassword(
        session.account.user_id,
        parsed.data.current_password,
        parsed.data.new_password,
      );
      // Password changes revoke all sessions, including this one.
      clearSessionCookie(reply, secureCookies);
      return success(request.id, { account });
    } catch (error) {
      return errorResponse(request, reply, error);
    }
  });
}

export { cookieValue, clearSessionCookie, setSessionCookie };
