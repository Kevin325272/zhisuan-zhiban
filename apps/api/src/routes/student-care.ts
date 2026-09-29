import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  studentCarePreferenceReadSchema,
  studentCarePreferenceSchema,
  studentCarePreferenceUpdateSchema,
  studentCareRespondRequestSchema,
  studentCareResponseResultSchema,
  studentCareStatusSchema,
} from "@xuetu/contracts";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  StudentCareInteractionError,
  type StudentCareService,
} from "../services/student-care/student-care-service.js";
import type { PlatformAccessService } from "../services/platform-access.js";

interface Options {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService | null;
  authentication?: LocalAuthenticationService | null;
}

const interactionParamsSchema = z.object({
  interactionId: z.string().trim().min(1).max(200),
}).strict();

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(requestId: string, code: string, message: string) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: { code, message, retryable: false, details: {} },
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
      return {
        status: 503,
        body: failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "认证尚未配置。"),
      };
    }
    return {
      status: 401,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。"),
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
    return {
      status: 401,
      body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
    };
  }
  if (!actor.roles.includes("student")) {
    return {
      status: 403,
      body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前接口仅供学生访问。"),
    };
  }
  return { userId: identity.userId };
}

export function registerStudentCareRoutes(
  app: FastifyInstance,
  studentCare: StudentCareService,
  options: Options,
) {
  app.get("/api/v1/student/care", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    return success(
      request.id,
      studentCareStatusSchema.parse(await studentCare.getStatus(actor.userId)),
    );
  });

  app.get("/api/v1/student/care/preferences", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    return success(
      request.id,
      studentCarePreferenceReadSchema.parse(await studentCare.getPreference(actor.userId)),
    );
  });

  app.post<{ Params: unknown; Body: unknown }>(
    "/api/v1/student/care/:interactionId/respond",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = interactionParamsSchema.safeParse(request.params);
      const body = studentCareRespondRequestSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(failure(
          request.id,
          "CARE_RESPONSE_INVALID",
          "关怀响应请求无效。",
        ));
      }
      try {
        return success(
          request.id,
          studentCareResponseResultSchema.parse(
            await studentCare.respond(actor.userId, params.data.interactionId, body.data.action),
          ),
        );
      } catch (error) {
        if (error instanceof StudentCareInteractionError) {
          return reply.code(error.statusCode).send(failure(request.id, error.code, error.message));
        }
        throw error;
      }
    },
  );

  app.put<{ Body: unknown }>(
    "/api/v1/student/care/preferences",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const body = studentCarePreferenceUpdateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send(failure(
          request.id,
          "CARE_PREFERENCE_INVALID",
          "关怀提醒设置无效。",
        ));
      }
      return success(
        request.id,
        studentCarePreferenceSchema.parse(
          await studentCare.updatePreference(actor.userId, body.data.enabled),
        ),
      );
    },
  );
}
