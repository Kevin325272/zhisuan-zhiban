import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  accountCreateRequestSchema,
  adminPasswordResetRequestSchema,
  accountStatusUpdateSchema,
  accountCourseScopeSchema,
  academicClassOptionListSchema,
  teacherApprovalRequestSchema,
} from "@xuetu/contracts";

import {
  AuthenticationError,
  type LocalAuthenticationService,
  type PublicAccount,
} from "../services/auth/authentication.js";
import {
  resolveRequestIdentity,
  type RequestIdentityOptions,
} from "../services/auth/request-identity.js";
import type { PlatformAccessService } from "../services/platform-access.js";

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(requestId: string, code: string, message: string, details: Record<string, unknown> = {}) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: { code, message, retryable: false, details },
  };
}

function localDevAccount(identity: NonNullable<Awaited<ReturnType<typeof resolveRequestIdentity>>>) {
  if (identity.account) return identity.account;
  if (!identity.actor) return null;
  const now = new Date().toISOString();
  return {
    user_id: identity.actor.user.user_id,
    username: identity.actor.user.user_id.toLowerCase(),
    display_name: identity.actor.user.display_name,
    account_status: identity.actor.user.account_status,
    roles: identity.actor.roles,
    auth_source: identity.actor.user.auth_source,
    account_origin: "legacy_demo" as const,
    data_boundary: "legacy_demo" as const,
    must_change_password: false,
    created_at: identity.actor.user.created_at,
    updated_at: now,
    last_login_at: null,
  } satisfies PublicAccount;
}

function handleError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof AuthenticationError) {
    return reply.code(error.status).send(failure(request.id, error.code, error.message, error.details));
  }
  request.log.error(error);
  return reply.code(500).send(failure(request.id, "ACCOUNT_GOVERNANCE_FAILED", "账户治理暂时不可用。", { retryable: true }));
}

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RequestIdentityOptions,
) {
  const identity = await resolveRequestIdentity(request, options);
  const account = identity ? localDevAccount(identity) : null;
  if (!identity || !account) {
    reply.code(401).send(failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录管理员账户。"));
    return null;
  }
  if (!identity.roles.includes("admin")) {
    reply.code(403).send(failure(request.id, "ADMIN_ACCESS_REQUIRED", "只有管理员可以治理账户。"));
    return null;
  }
  return account;
}

export function registerAccountManagementRoutes(
  app: FastifyInstance,
  authentication: LocalAuthenticationService | null,
  options: { platformAccess?: PlatformAccessService | null; allowLocalDevAuth: boolean },
) {
  const identityOptions: RequestIdentityOptions = {
    authentication,
    platformAccess: options.platformAccess ?? null,
    allowLocalDevAuth: options.allowLocalDevAuth,
  };

  app.get("/api/v1/account/course-scope", async (request, reply) => {
    const identity = await resolveRequestIdentity(request, identityOptions);
    if (!identity) {
      return reply.code(401).send(failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录账户。"));
    }
    const membershipRole = identity.roles.includes("teacher")
      ? "teacher"
      : identity.roles.includes("student")
        ? "student"
        : null;
    if (!membershipRole) {
      return reply.code(403).send(failure(request.id, "ACCOUNT_SCOPE_FORBIDDEN", "当前账户没有可展示的课程成员范围。"));
    }
    const listAssignedCourses = options.platformAccess?.listAssignedCourses;
    if (!listAssignedCourses) {
      return reply.code(503).send(failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "课程成员存储尚未配置。"));
    }
    try {
      const data = accountCourseScopeSchema.parse({
        items: await listAssignedCourses.call(options.platformAccess, identity.userId, membershipRole),
        visibility: "active_memberships_only",
      });
      return success(request.id, data);
    } catch (error) {
      return handleError(request, reply, error);
    }
  });

  app.get("/api/v1/manage/accounts", async (request, reply) => {
    if (!authentication) {
      return reply.code(503).send(failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "本地账户认证尚未配置。"));
    }
    const actor = await requireAdmin(request, reply, identityOptions);
    if (!actor) return;
    try {
      return success(request.id, { items: await authentication.listAccounts(actor) });
    } catch (error) {
      return handleError(request, reply, error);
    }
  });

  app.get("/api/v1/manage/academic-classes", async (request, reply) => {
    if (!authentication) {
      return reply.code(503).send(failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "本地账户认证尚未配置。"));
    }
    const actor = await requireAdmin(request, reply, identityOptions);
    if (!actor) return;
    try {
      const data = academicClassOptionListSchema.parse({
        items: await authentication.listAcademicClasses(actor),
      });
      return success(request.id, data);
    } catch (error) {
      return handleError(request, reply, error);
    }
  });

  app.post<{ Body: unknown }>("/api/v1/manage/accounts", async (request, reply) => {
    if (!authentication) {
      return reply.code(503).send(failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "本地账户认证尚未配置。"));
    }
    const actor = await requireAdmin(request, reply, identityOptions);
    if (!actor) return;
    const parsed = accountCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(failure(request.id, "ACCOUNT_INPUT_INVALID", "账户信息无效。", { issues: parsed.error.issues }));
    }
    try {
      const created = await authentication.createAccount(actor, {
        username: parsed.data.username,
        displayName: parsed.data.display_name,
        password: parsed.data.password,
        role: parsed.data.role,
      });
      return reply.code(201).send(success(request.id, { account: created }));
    } catch (error) {
      return handleError(request, reply, error);
    }
  });

  app.patch<{ Params: { userId: string }; Body: unknown }>("/api/v1/manage/accounts/:userId/status", async (request, reply) => {
    if (!authentication) {
      return reply.code(503).send(failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "本地账户认证尚未配置。"));
    }
    const actor = await requireAdmin(request, reply, identityOptions);
    if (!actor) return;
    const parsed = accountStatusUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(failure(request.id, "ACCOUNT_STATUS_INVALID", "账户状态无效。"));
    try {
      const updated = await authentication.updateAccountStatus(actor, request.params.userId, parsed.data.status);
      return success(request.id, { account: updated });
    } catch (error) {
      return handleError(request, reply, error);
    }
  });

  app.post<{ Params: { userId: string }; Body: unknown }>(
    "/api/v1/manage/accounts/:userId/teacher-approval",
    async (request, reply) => {
      if (!authentication) {
        return reply.code(503).send(failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "本地账户认证尚未配置。"));
      }
      const actor = await requireAdmin(request, reply, identityOptions);
      if (!actor) return;
      const parsed = teacherApprovalRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "TEACHER_APPROVAL_INPUT_INVALID",
          "教师审核信息不完整。",
          { issues: parsed.error.issues },
        ));
      }
      try {
        const account = await authentication.approveTeacher(actor, request.params.userId, {
          teacherNumber: parsed.data.teacher_number,
          department: parsed.data.department,
          professionalTitle: parsed.data.professional_title,
          courseId: parsed.data.course_id,
          classIds: parsed.data.class_ids,
        });
        return success(request.id, { account });
      } catch (error) {
        return handleError(request, reply, error);
      }
    },
  );

  app.post<{ Params: { userId: string }; Body: unknown }>("/api/v1/manage/accounts/:userId/reset-password", async (request, reply) => {
    if (!authentication) {
      return reply.code(503).send(failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "本地账户认证尚未配置。"));
    }
    const actor = await requireAdmin(request, reply, identityOptions);
    if (!actor) return;
    const parsed = adminPasswordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(failure(request.id, "ACCOUNT_PASSWORD_RESET_INVALID", "密码格式无效。", {
        issues: parsed.error.issues,
      }));
    }
    try {
      const updated = await authentication.resetPassword(actor, request.params.userId, parsed.data.password);
      return success(request.id, { account: updated });
    } catch (error) {
      return handleError(request, reply, error);
    }
  });
}
