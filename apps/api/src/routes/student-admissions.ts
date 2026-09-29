import {
  admissionsTargetSearchQuerySchema,
  admissionsTargetSelectionSchema,
} from "@xuetu/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  StudentAdmissionsError,
  type StudentAdmissionsService,
} from "../services/admissions/postgres-student-admissions.js";
import type { PlatformAccessService } from "../services/platform-access.js";

interface Options {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService | null;
  authentication?: LocalAuthenticationService | null;
}

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(
  requestId: string,
  code: string,
  message: string,
  retryable = false,
  details: Record<string, unknown> = {},
) {
  return {
    contract_version: "0.1",
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
    if (!options.authentication && !options.allowLocalDevAuth) {
      return { status: 503, body: failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "认证尚未配置。") };
    }
    return { status: 401, body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。") };
  }
  if (!options.platformAccess) {
    return { status: 503, body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "用户权限存储尚未配置。") };
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

function sendServiceError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (!(error instanceof StudentAdmissionsError)) throw error;
  return reply.code(error.statusCode).send(
    failure(request.id, error.code, error.message, error.retryable),
  );
}

export function registerStudentAdmissionsRoutes(
  app: FastifyInstance,
  admissions: StudentAdmissionsService,
  options: Options,
) {
  app.get<{ Querystring: unknown }>(
    "/api/v1/student/admissions/targets",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = admissionsTargetSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "ADMISSIONS_SEARCH_INVALID",
          "院校查询条件无效。",
          false,
          { issues: parsed.error.issues },
        ));
      }
      try {
        return success(request.id, await admissions.searchTargets(parsed.data));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.get("/api/v1/student/admissions/target", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    try {
      return success(request.id, await admissions.getCurrentTarget(actor.userId));
    } catch (error) {
      return sendServiceError(error, request, reply);
    }
  });

  app.put<{ Body: unknown }>(
    "/api/v1/student/admissions/target",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = admissionsTargetSelectionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "ADMISSIONS_TARGET_INVALID",
          "请选择有效的院校专业目标。",
          false,
          { issues: parsed.error.issues },
        ));
      }
      try {
        return success(
          request.id,
          await admissions.selectTarget(actor.userId, parsed.data.target_id),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.delete("/api/v1/student/admissions/target", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    try {
      return success(request.id, await admissions.clearTarget(actor.userId));
    } catch (error) {
      return sendServiceError(error, request, reply);
    }
  });
}
