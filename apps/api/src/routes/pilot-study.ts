import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  pilotConsentRequestSchema,
  pilotFeedbackRequestSchema,
  pilotParticipantEnrollmentSchema,
  pilotTaskCompletionRequestSchema,
  pilotTaskEvaluationRequestSchema,
} from "@xuetu/contracts";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  PilotStudyError,
  serializePilotReportCsv,
  type PilotStudyService,
} from "../services/pilot-study/pilot-study.js";
import type { PlatformAccessService } from "../services/platform-access.js";

interface Options {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService | null;
  authentication?: LocalAuthenticationService | null;
}

const taskParamsSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
}).strict();

const reportQuerySchema = z.object({
  include_synthetic: z.enum(["true", "false"]).optional(),
}).strict();

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(
  requestId: string,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: { code, message, retryable: false, details },
  };
}

async function requireRole(
  request: FastifyRequest,
  role: "student" | "admin",
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
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录后再访问试用任务。"),
    };
  }
  if (!identity.roles.includes(role)) {
    return {
      status: 403,
      body: failure(
        request.id,
        role === "admin" ? "ADMIN_ACCESS_REQUIRED" : "STUDENT_ACCESS_REQUIRED",
        role === "admin" ? "当前接口仅供管理员访问。" : "当前接口仅供学生访问。",
      ),
    };
  }
  return { userId: identity.userId };
}

const pilotErrorStatus: Record<PilotStudyError["code"], 400 | 404 | 409 | 503> = {
  PILOT_NOT_ENROLLED: 404,
  PILOT_STUDY_NOT_ACTIVE: 409,
  PILOT_CONSENT_VERSION_MISMATCH: 409,
  PILOT_CONSENT_REQUIRED: 409,
  PILOT_TASK_NOT_FOUND: 404,
  PILOT_TASK_SEQUENCE_INVALID: 409,
  PILOT_TASK_NOT_STARTED: 409,
  PILOT_EVIDENCE_NOT_FOUND: 409,
  PILOT_TASKS_INCOMPLETE: 409,
  PILOT_ACCOUNT_NOT_FOUND: 404,
  PILOT_ACCOUNT_NOT_STUDENT: 400,
  PILOT_PARTICIPANT_EXISTS: 409,
  PILOT_FEEDBACK_ALREADY_SUBMITTED: 409,
  PILOT_EVALUATION_NOT_CONFIGURED: 503,
};

function sendServiceError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!(error instanceof PilotStudyError)) throw error;
  return reply.code(pilotErrorStatus[error.code]).send(
    failure(request.id, error.code, error.message, error.details),
  );
}

function invalidInput(
  request: FastifyRequest,
  reply: FastifyReply,
  issues: unknown,
) {
  return reply.code(400).send(
    failure(request.id, "PILOT_INPUT_INVALID", "试用请求参数无效。", { issues }),
  );
}

function requestIdempotencyKey(request: FastifyRequest) {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

export function registerPilotStudyRoutes(
  app: FastifyInstance,
  pilotStudy: PilotStudyService,
  options: Options,
) {
  app.get("/api/v1/student/pilot-study", async (request, reply) => {
    const actor = await requireRole(request, "student", options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    try {
      return success(request.id, await pilotStudy.getStudentStudy(actor.userId));
    } catch (error) {
      return sendServiceError(error, request, reply);
    }
  });

  app.post<{ Body: unknown }>(
    "/api/v1/student/pilot-study/consent",
    async (request, reply) => {
      const actor = await requireRole(request, "student", options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const body = pilotConsentRequestSchema.safeParse(request.body);
      if (!body.success) return invalidInput(request, reply, body.error.issues);
      try {
        return success(request.id, await pilotStudy.recordConsent(actor.userId, body.data));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Params: unknown }>(
    "/api/v1/student/pilot-study/tasks/:taskId/start",
    async (request, reply) => {
      const actor = await requireRole(request, "student", options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = taskParamsSchema.safeParse(request.params);
      if (!params.success) return invalidInput(request, reply, params.error.issues);
      try {
        return success(
          request.id,
          await pilotStudy.startTask(actor.userId, params.data.taskId),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Params: unknown; Body: unknown }>(
    "/api/v1/student/pilot-study/tasks/:taskId/complete",
    async (request, reply) => {
      const actor = await requireRole(request, "student", options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = taskParamsSchema.safeParse(request.params);
      const body = pilotTaskCompletionRequestSchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return invalidInput(request, reply, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
        ]);
      }
      const completion = body.data.attempt_id === undefined
        ? {}
        : { attempt_id: body.data.attempt_id };
      try {
        return success(
          request.id,
          await pilotStudy.completeTask(actor.userId, params.data.taskId, completion),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Params: unknown; Body: unknown }>(
    "/api/v1/student/pilot-study/tasks/:taskId/evaluate",
    async (request, reply) => {
      const actor = await requireRole(request, "student", options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = taskParamsSchema.safeParse(request.params);
      const body = pilotTaskEvaluationRequestSchema.safeParse(request.body ?? {});
      const idempotencyKey = requestIdempotencyKey(request);
      if (!params.success || !body.success || !idempotencyKey) {
        return invalidInput(request, reply, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
          ...(!idempotencyKey ? [{ path: ["Idempotency-Key"], message: "缺少有效的 Idempotency-Key。" }] : []),
        ]);
      }
      try {
        return success(
          request.id,
          await pilotStudy.evaluateChoiceTask(
            actor.userId,
            params.data.taskId,
            body.data.selected_option_ids,
            idempotencyKey,
          ),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Body: unknown }>(
    "/api/v1/student/pilot-study/feedback",
    async (request, reply) => {
      const actor = await requireRole(request, "student", options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const body = pilotFeedbackRequestSchema.safeParse(request.body);
      if (!body.success) return invalidInput(request, reply, body.error.issues);
      try {
        return success(request.id, await pilotStudy.submitFeedback(actor.userId, body.data));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.get<{ Querystring: unknown }>(
    "/api/v1/manage/pilot-study",
    async (request, reply) => {
      const actor = await requireRole(request, "admin", options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const query = reportQuerySchema.safeParse(request.query);
      if (!query.success) return invalidInput(request, reply, query.error.issues);
      try {
        return success(
          request.id,
          await pilotStudy.getManagementReport(query.data.include_synthetic === "true"),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Body: unknown }>(
    "/api/v1/manage/pilot-study/participants",
    async (request, reply) => {
      const actor = await requireRole(request, "admin", options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const body = pilotParticipantEnrollmentSchema.safeParse(request.body);
      if (!body.success) return invalidInput(request, reply, body.error.issues);
      try {
        const participant = await pilotStudy.enrollParticipant(actor.userId, body.data);
        return reply.code(201).send(success(request.id, participant));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  const exportReport = async (
    request: FastifyRequest<{ Querystring: unknown }>,
    reply: FastifyReply,
    format: "json" | "csv",
  ) => {
    const actor = await requireRole(request, "admin", options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    const query = reportQuerySchema.safeParse(request.query);
    if (!query.success) return invalidInput(request, reply, query.error.issues);
    try {
      const report = await pilotStudy.getManagementReport(
        query.data.include_synthetic === "true",
      );
      const date = report.generated_at.slice(0, 10);
      reply.header(
        "content-disposition",
        `attachment; filename="xuetu-pilot-${date}.${format}"`,
      );
      if (format === "csv") {
        return reply.type("text/csv; charset=utf-8").send(serializePilotReportCsv(report));
      }
      return reply.type("application/json; charset=utf-8").send(report);
    } catch (error) {
      return sendServiceError(error, request, reply);
    }
  };

  app.get<{ Querystring: unknown }>(
    "/api/v1/manage/pilot-study/export.json",
    (request, reply) => exportReport(request, reply, "json"),
  );
  app.get<{ Querystring: unknown }>(
    "/api/v1/manage/pilot-study/export.csv",
    (request, reply) => exportReport(request, reply, "csv"),
  );
}
