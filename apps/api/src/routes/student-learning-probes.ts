import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  learningProbeEventRequestSchema,
} from "@xuetu/contracts";

import { requireStudent, type StudentLearningLoopRouteOptions } from "./student-learning-loop.js";
import {
  LearningProbeError,
  type LearningProbeService,
} from "../services/question-bank/learning-probe-service.js";

const attemptQuerySchema = z.object({
  attempt_id: z.string().trim().min(1).max(200),
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

function idempotencyKey(request: { headers: Record<string, unknown> }) {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

function mapProbeError(requestId: string, reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown) {
  if (!(error instanceof LearningProbeError)) throw error;
  return reply.code(error.status).send(failure(requestId, error.code, error.message, error.status >= 500));
}

export function registerStudentLearningProbeRoutes(
  app: FastifyInstance,
  service: LearningProbeService,
  options: StudentLearningLoopRouteOptions,
) {
  app.get<{ Querystring: { attempt_id?: string } }>(
    "/api/v1/student/learning-probes/offer",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = attemptQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send(failure(request.id, "LEARNING_PROBE_QUERY_INVALID", "探针请求参数无效。", false, {
          issues: parsed.error.issues,
        }));
      }
      try {
        const data = await service.offerForAttempt(actor.userId, parsed.data.attempt_id);
        return success(request.id, data);
      } catch (error) {
        return mapProbeError(request.id, reply, error);
      }
    },
  );

  app.post<{ Params: { probeSessionId: string } }>(
    "/api/v1/student/learning-probes/:probeSessionId/start",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        const data = await service.start(actor.userId, request.params.probeSessionId);
        return success(request.id, data);
      } catch (error) {
        return mapProbeError(request.id, reply, error);
      }
    },
  );

  app.post<{ Params: { probeSessionId: string } }>(
    "/api/v1/student/learning-probes/:probeSessionId/skip",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        const data = await service.skip(actor.userId, request.params.probeSessionId);
        return success(request.id, data);
      } catch (error) {
        return mapProbeError(request.id, reply, error);
      }
    },
  );

  app.post<{ Params: { probeSessionId: string }; Body: unknown }>(
    "/api/v1/student/learning-probes/:probeSessionId/submit",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const key = idempotencyKey(request as unknown as { headers: Record<string, unknown> });
      if (!key) return reply.code(400).send(failure(request.id, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。"));
      const parsed = learningProbeEventRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(request.id, "LEARNING_PROBE_SUBMISSION_INVALID", "探针对照题作答无效。", false, {
          issues: parsed.error.issues,
        }));
      }
      try {
        const data = await service.submit(actor.userId, request.params.probeSessionId, parsed.data, key);
        const { idempotency_replayed: replayed = false, ...payload } = data;
        if (replayed) reply.header("idempotency-replayed", "true");
        return reply.code(replayed ? 200 : 201).send(success(request.id, payload));
      } catch (error) {
        return mapProbeError(request.id, reply, error);
      }
    },
  );

  app.get<{ Params: { probeSessionId: string } }>(
    "/api/v1/student/learning-probes/:probeSessionId/offer",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        const data = await service.getOffer(actor.userId, request.params.probeSessionId);
        if (!data) return reply.code(404).send(failure(request.id, "LEARNING_PROBE_NOT_FOUND", "探针记录不存在或已结束。"));
        return success(request.id, data);
      } catch (error) {
        return mapProbeError(request.id, reply, error);
      }
    },
  );

  app.get<{ Params: { probeSessionId: string } }>(
    "/api/v1/student/learning-probes/:probeSessionId",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        const data = await service.getSession(actor.userId, request.params.probeSessionId);
        if (!data) return reply.code(404).send(failure(request.id, "LEARNING_PROBE_NOT_FOUND", "探针记录不存在。"));
        return success(request.id, data);
      } catch (error) {
        return mapProbeError(request.id, reply, error);
      }
    },
  );
}
