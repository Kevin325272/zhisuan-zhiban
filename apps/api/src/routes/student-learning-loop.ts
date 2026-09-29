import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  practiceMistakeStatusUpdateSchema,
  type PlatformRole,
} from "@xuetu/contracts";

import type { PlatformAccessService } from "../services/platform-access.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  PracticeMistakeNotFoundError,
  type ReliableLearningLoopService,
} from "../services/question-bank/reliable-learning-loop.js";
import {
  PracticeMistakeNotMasteredError,
  type MistakeRecommendationService,
} from "../services/question-bank/postgres-mistake-recommendation.js";

export interface StudentLearningLoopRouteOptions {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService | null;
  authentication?: LocalAuthenticationService | null;
  mistakeRecommendation?: MistakeRecommendationService | null;
}

const filterSchema = z.object({
  course_id: z.string().trim().min(1).max(100).optional(),
  concept_id: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["needs_review", "mastered"]).optional(),
}).strict();

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(requestId: string, code: string, message: string, retryable = false, details: Record<string, unknown> = {}) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: { code, message, retryable, details },
  };
}

export async function requireStudent(
  request: FastifyRequest,
  options: StudentLearningLoopRouteOptions,
): Promise<{ userId: string } | { status: 401 | 403 | 503; body: unknown }> {
  const identity = await resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
  if (!identity && !options.authentication && options.allowLocalDevAuth) {
    const raw = request.headers["x-dev-user-id"];
    const headerUserId = Array.isArray(raw) ? raw[0] : raw;
    if (headerUserId) {
      // Keep the legacy route distinction (actor missing vs. header missing)
      // for local API tests while browser traffic uses server sessions.
      return await checkStudentActor(request, options, headerUserId);
    }
  }
  if (!identity) {
    if (options.authentication) {
      return { status: 401, body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。") };
    }
    if (!options.allowLocalDevAuth) {
    return {
      status: 503,
      body: failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "生产认证尚未接入。"),
    };
    }
    return {
      status: 401,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "本地开发模式需要 X-Dev-User-Id。"),
    };
  }
  return await checkStudentActor(request, options, identity.userId);
}

async function checkStudentActor(
  request: FastifyRequest,
  options: StudentLearningLoopRouteOptions,
  userId: string,
): Promise<{ userId: string } | { status: 401 | 403 | 503; body: unknown }> {
  if (!options.platformAccess) {
    return {
      status: 503 as const,
      body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "用户与课程授权存储尚未配置。"),
    };
  }
  const actor = await options.platformAccess.getActor(userId);
  if (!actor) {
    return { status: 401 as const, body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。") };
  }
  if (!actor.roles.includes("student" as PlatformRole)) {
    return { status: 403 as const, body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前接口仅供学生访问。") };
  }
  return { userId };
}

export function registerStudentLearningLoopRoutes(
  app: FastifyInstance,
  learningLoop: ReliableLearningLoopService,
  options: StudentLearningLoopRouteOptions,
) {
  app.get<{ Querystring: { course_id?: string; concept_id?: string; status?: string } }>(
    "/api/v1/student/practice-mistakes",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = filterSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send(failure(request.id, "MISTAKE_FILTER_INVALID", "错题筛选参数无效。", false, { issues: parsed.error.issues }));
      }
      return success(request.id, await learningLoop.listMistakes(actor.userId, {
        ...(parsed.data.course_id ? { courseId: parsed.data.course_id } : {}),
        ...(parsed.data.concept_id ? { conceptId: parsed.data.concept_id } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      }));
    },
  );

  app.patch<{ Params: { mistakeId: string }; Body: unknown }>(
    "/api/v1/student/practice-mistakes/:mistakeId",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = practiceMistakeStatusUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(request.id, "MISTAKE_STATUS_INVALID", "错题状态无效。", false, { issues: parsed.error.issues }));
      }
      if (parsed.data.status === "mastered") {
        return reply.code(409).send(failure(
          request.id,
          "MISTAKE_MASTERY_REQUIRES_REPRACTICE",
          "已掌握状态只能由后续可核验的正确重练更新。",
        ));
      }
      if (!options.mistakeRecommendation) {
        return reply.code(503).send(failure(
          request.id,
          "MISTAKE_REVIEW_STATE_UNAVAILABLE",
          "错题复习状态暂时不可用，请稍后重试。",
          true,
        ));
      }
      try {
        const state = await options.mistakeRecommendation.reopenMistake(actor.userId, request.params.mistakeId);
        return success(request.id, state);
      } catch (error) {
        if (error instanceof PracticeMistakeNotFoundError) {
          return reply.code(404).send(failure(request.id, "MISTAKE_NOT_FOUND", "错题记录不存在。"));
        }
        if (error instanceof PracticeMistakeNotMasteredError) {
          return reply.code(409).send(failure(request.id, "MISTAKE_NOT_MASTERED", "该错题当前已在待复习队列中。"));
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { course_id?: string } }>(
    "/api/v1/student/learning-record",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const courseId = request.query.course_id?.trim() || undefined;
      if (courseId && courseId.length > 100) {
        return reply.code(400).send(failure(request.id, "LEARNING_RECORD_FILTER_INVALID", "课程筛选参数无效。"));
      }
      return success(request.id, await learningLoop.getLearningRecord(actor.userId, courseId));
    },
  );

  app.get(
    "/api/v1/student/personal-learning-dashboard",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      return success(
        request.id,
        await learningLoop.getPersonalLearningDashboard(actor.userId),
      );
    },
  );
}
