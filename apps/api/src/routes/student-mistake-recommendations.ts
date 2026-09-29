import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { MistakeRecommendationService } from "../services/question-bank/postgres-mistake-recommendation.js";
import {
  requireStudent,
  type StudentLearningLoopRouteOptions,
} from "./student-learning-loop.js";

const querySchema = z.object({
  course_id: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
}).strict();

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

export function registerStudentMistakeRecommendationRoutes(
  app: FastifyInstance,
  service: MistakeRecommendationService,
  options: StudentLearningLoopRouteOptions,
) {
  app.get<{ Querystring: { course_id?: string; limit?: string } }>(
    "/api/v1/student/mistake-recommendations",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);

      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "MISTAKE_RECOMMENDATION_FILTER_INVALID", "错题推荐筛选参数无效。", false, {
            issues: parsed.error.issues,
          }),
        );
      }

      try {
        const data = await service.listRecommendations(actor.userId, {
          ...(parsed.data.course_id ? { courseId: parsed.data.course_id } : {}),
          limit: parsed.data.limit,
        });
        return success(request.id, data);
      } catch (error) {
        request.log.error(error);
        return reply.code(503).send(
          failure(request.id, "MISTAKE_RECOMMENDATION_UNAVAILABLE", "错题推荐暂时不可用，原错题列表仍可继续使用。", true),
        );
      }
    },
  );
}
