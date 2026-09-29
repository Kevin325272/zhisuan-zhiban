import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  onboardingDiagnosticAnswerSchema,
  onboardingGoalInputSchema,
  onboardingSelfAssessmentsUpdateSchema,
} from "@xuetu/contracts";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  StudentOnboardingError,
  type StudentOnboardingService,
} from "../services/onboarding/student-onboarding.js";
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

function sendServiceError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!(error instanceof StudentOnboardingError)) throw error;
  return reply.code(error.statusCode).send(
    failure(request.id, error.code, error.message, error.retryable),
  );
}

export function registerStudentOnboardingRoutes(
  app: FastifyInstance,
  onboarding: StudentOnboardingService,
  options: Options,
) {
  app.get("/api/v1/student/onboarding", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    try {
      return success(request.id, await onboarding.getState(actor.userId));
    } catch (error) {
      return sendServiceError(error, request, reply);
    }
  });

  app.get("/api/v1/student/onboarding/diagnostic/questions", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    try {
      return success(request.id, await onboarding.getDiagnosticQuestions(actor.userId));
    } catch (error) {
      return sendServiceError(error, request, reply);
    }
  });

  app.put<{ Body: unknown }>(
    "/api/v1/student/onboarding/diagnostic/answers",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = onboardingDiagnosticAnswerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "ONBOARDING_DIAGNOSTIC_ANSWER_INVALID", "起步筛查答案无效。", false, {
            issues: parsed.error.issues,
          }),
        );
      }
      try {
        return success(
          request.id,
          await onboarding.saveDiagnosticAnswer(actor.userId, parsed.data),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v1/student/onboarding/diagnostic/complete",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        return success(request.id, await onboarding.completeDiagnostic(actor.userId));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.put<{ Body: unknown }>(
    "/api/v1/student/onboarding/goals",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = onboardingGoalInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "ONBOARDING_GOALS_INVALID", "目标与时间约束无效。", false, {
            issues: parsed.error.issues,
          }),
        );
      }
      try {
        return success(request.id, await onboarding.saveGoals(actor.userId, parsed.data));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.put<{ Body: unknown }>(
    "/api/v1/student/onboarding/self-assessments",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = onboardingSelfAssessmentsUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "ONBOARDING_SELF_ASSESSMENTS_INVALID", "四门课程自评无效。", false, {
            issues: parsed.error.issues,
          }),
        );
      }
      try {
        return success(
          request.id,
          await onboarding.saveSelfAssessments(actor.userId, parsed.data),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v1/student/onboarding/complete",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        return success(request.id, await onboarding.completeSetup(actor.userId));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );
}
