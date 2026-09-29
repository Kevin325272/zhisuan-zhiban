import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  studentLearningTaskActivationSchema,
  studentLearningTaskCompletionSchema,
  studentLearningTaskCompletionRequestSchema,
} from "@xuetu/contracts";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  LearningTaskCompletionError,
  type StudentLearningOrchestrationService,
} from "../services/orchestration/learning-orchestration-service.js";
import type { PlatformAccessService } from "../services/platform-access.js";

interface Options {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService | null;
  authentication?: LocalAuthenticationService | null;
}

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

export function registerStudentLearningOrchestrationRoutes(
  app: FastifyInstance,
  orchestration: StudentLearningOrchestrationService,
  options: Options,
) {
  app.get("/api/v1/student/learning-orchestration", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    return success(request.id, await orchestration.getSnapshot(actor.userId));
  });

  app.post<{ Body: unknown }>(
    "/api/v1/student/learning-orchestration/activate",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = studentLearningTaskCompletionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "LEARNING_TASK_ACTIVATION_INVALID",
          "学习任务激活请求无效。",
        ));
      }
      try {
        const activation = await orchestration.activateTask(actor.userId, parsed.data.task_id);
        return success(request.id, studentLearningTaskActivationSchema.parse(activation));
      } catch (error) {
        if (error instanceof LearningTaskCompletionError) {
          return reply.code(error.statusCode).send(failure(request.id, error.code, error.message));
        }
        throw error;
      }
    },
  );

  app.post<{ Body: unknown }>(
    "/api/v1/student/learning-orchestration/complete",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = studentLearningTaskCompletionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "LEARNING_TASK_COMPLETION_INVALID",
          "学习任务完成请求无效。",
        ));
      }
      try {
        return success(
          request.id,
          studentLearningTaskCompletionSchema.parse(
            await orchestration.completeTask(actor.userId, parsed.data.task_id),
          ),
        );
      } catch (error) {
        if (error instanceof LearningTaskCompletionError) {
          return reply.code(error.statusCode).send(failure(request.id, error.code, error.message));
        }
        throw error;
      }
    },
  );
}
