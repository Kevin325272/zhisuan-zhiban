import type { FastifyInstance, FastifyRequest } from "fastify";
import { studentProfileWorkflowRequestSchema } from "@xuetu/contracts";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import type { StudentProfileWorkflowService } from "../services/profile-workflow/student-profile-workflow-service.js";
import type { PerUserAiRequestLimiter } from "../services/ai-request-limiter.js";
import type { StudentAiPreferencesStore } from "../services/student-ai-preferences.js";

interface Options {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService | null;
  authentication?: LocalAuthenticationService | null;
  aiRequestLimiter: PerUserAiRequestLimiter;
  studentAiPreferences?: StudentAiPreferencesStore | null;
}

function success(requestId: string, data: unknown) {
  return { contract_version: "0.2", request_id: requestId, data };
}

function failure(
  requestId: string,
  code: string,
  message: string,
  retryable = false,
  details: Record<string, unknown> = {},
) {
  return {
    contract_version: "0.2",
    request_id: requestId,
    error: { code, message, retryable, details },
  };
}

async function requireStudent(
  request: FastifyRequest,
  options: Options,
): Promise<{ userId: string } | { status: 401 | 403 | 503; body: unknown }> {
  const identity = await resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
  if (!identity) {
    const status = options.authentication || options.allowLocalDevAuth ? 401 : 503;
    const code = options.authentication || options.allowLocalDevAuth
      ? "AUTHENTICATION_REQUIRED"
      : "AUTHENTICATION_NOT_CONFIGURED";
    return {
      status,
      body: failure(
        request.id,
        code,
        status === 401 ? "请先登录学生账户。" : "认证尚未配置。",
      ),
    };
  }
  if (!options.platformAccess) {
    return {
      status: 503,
      body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "用户权限存储尚未配置。"),
    };
  }
  const actor = await options.platformAccess.getActor(identity.userId);
  if (!actor) {
    return { status: 401, body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。") };
  }
  if (!actor.roles.includes("student")) {
    return { status: 403, body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前接口仅供学生访问。") };
  }
  return { userId: identity.userId };
}

export function registerStudentProfileWorkflowRoutes(
  app: FastifyInstance,
  service: StudentProfileWorkflowService,
  options: Options,
) {
  app.get(
    "/api/v1/student/profile/ai/status",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      return success(request.id, service.status());
    },
  );

  app.post<{ Body: unknown }>(
    "/api/v1/student/profile/ai",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);

      const parsed = studentProfileWorkflowRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "PROFILE_WORKFLOW_REQUEST_INVALID", "画像请求无效。", false, {
            issues: parsed.error.issues,
          }),
        );
      }
      const requestId = parsed.data.request_id ?? `profile_${request.id}`;
      const preferences = await options.studentAiPreferences?.get(actor.userId);
      if (preferences?.collaboration_enabled === false) {
        return reply.code(409).send(failure(request.id, "AI_COLLABORATION_DISABLED", "AI 多智能体协作已关闭，可在账户设置中开启。"));
      }
      const lease = options.aiRequestLimiter.acquire(actor.userId);
      if (!lease.allowed) {
        return reply
          .header("Retry-After", String(lease.retryAfterSeconds))
          .code(429)
          .send(failure(
            request.id,
            "AI_REQUEST_LIMITED",
            "AI 学习请求较多，请稍后再试。",
            true,
          ));
      }
      try {
        return success(
          request.id,
          await service.generate(actor.userId, requestId, parsed.data.course_id),
        );
      } finally {
        lease.release();
      }
    },
  );
}
