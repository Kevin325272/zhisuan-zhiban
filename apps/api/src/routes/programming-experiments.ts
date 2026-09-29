import crypto from "node:crypto";

import {
  programmingExperimentAttemptRecordSchema,
  programmingExperimentAttemptSubmitSchema,
  programmingExperimentCatalogSchema,
  programmingExperimentOverviewSchema,
  type PlatformRole,
} from "@xuetu/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import { InvalidCustomInputError } from "../services/code-runner.js";
import {
  CodeEvaluatorError,
  type CodeEvaluator,
} from "../services/evaluator/code-evaluator.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import {
  diagnoseProgrammingExperiment,
  getProgrammingExperimentDefinition,
  listProgrammingExperimentDefinitions,
} from "../services/programming-experiments/programming-experiment.js";
import type { ProgrammingExperimentRepository } from "../services/programming-experiments/postgres-programming-experiment.js";

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
    const authAvailable = Boolean(options.authentication) || options.allowLocalDevAuth;
    return {
      status: authAvailable ? 401 : 503,
      body: failure(
        request.id,
        authAvailable ? "AUTHENTICATION_REQUIRED" : "AUTHENTICATION_NOT_CONFIGURED",
        authAvailable ? "请先登录学生账户。" : "学生认证尚未配置。",
      ),
    };
  }
  if (!identity.roles.includes("student" as PlatformRole)) {
    return {
      status: 403,
      body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前接口仅供学生访问。"),
    };
  }
  return { userId: identity.userId };
}

function idempotencyKey(request: FastifyRequest) {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length >= 1 && value.length <= 200
    ? value
    : null;
}

function evaluatorFailure(request: FastifyRequest, caught: unknown) {
  if (caught instanceof InvalidCustomInputError) {
    return {
      status: 400,
      body: failure(request.id, "INVALID_CUSTOM_INPUT", caught.message),
    } as const;
  }
  if (caught instanceof CodeEvaluatorError) {
    return {
      status: caught.statusCode,
      body: failure(request.id, caught.code, caught.message, caught.retryable, caught.details),
    };
  }
  throw caught;
}

export function registerProgrammingExperimentRoutes(
  app: FastifyInstance,
  repository: ProgrammingExperimentRepository,
  evaluator: CodeEvaluator,
  options: Options,
) {
  app.get(
    "/api/v1/student/programming-experiments",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const items = await Promise.all(
        listProgrammingExperimentDefinitions().map(async (definition) => {
          const history = await repository.listAttempts(actor.userId, definition.experiment_id, 1);
          return {
            definition,
            latest_attempt: history.items[0] ?? null,
            attempt_count: history.total,
          };
        }),
      );
      return success(request.id, programmingExperimentCatalogSchema.parse({ items }));
    },
  );

  app.get<{ Params: { experimentId: string } }>(
    "/api/v1/student/programming-experiments/:experimentId",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const definition = getProgrammingExperimentDefinition(request.params.experimentId);
      if (!definition) {
        return reply.code(404).send(
          failure(request.id, "PROGRAMMING_EXPERIMENT_NOT_FOUND", "编程实验不存在。"),
        );
      }
      const history = await repository.listAttempts(actor.userId, definition.experiment_id, 1);
      return success(request.id, programmingExperimentOverviewSchema.parse({
        definition,
        latest_attempt: history.items[0] ?? null,
        attempt_count: history.total,
      }));
    },
  );

  app.get<{ Params: { experimentId: string }; Querystring: { limit?: string } }>(
    "/api/v1/student/programming-experiments/:experimentId/attempts",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const definition = getProgrammingExperimentDefinition(request.params.experimentId);
      if (!definition) {
        return reply.code(404).send(
          failure(request.id, "PROGRAMMING_EXPERIMENT_NOT_FOUND", "编程实验不存在。"),
        );
      }
      const limit = request.query.limit ? Number(request.query.limit) : 12;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return reply.code(400).send(
          failure(request.id, "PROGRAMMING_EXPERIMENT_LIMIT_INVALID", "提交记录数量参数无效。"),
        );
      }
      return success(request.id, await repository.listAttempts(actor.userId, definition.experiment_id, limit));
    },
  );

  app.post<{ Params: { experimentId: string }; Body: unknown }>(
    "/api/v1/student/programming-experiments/:experimentId/runs",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const definition = getProgrammingExperimentDefinition(request.params.experimentId);
      if (!definition) {
        return reply.code(404).send(
          failure(request.id, "PROGRAMMING_EXPERIMENT_NOT_FOUND", "编程实验不存在。"),
        );
      }
      const parsed = programmingExperimentAttemptSubmitSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "PROGRAMMING_EXPERIMENT_INPUT_INVALID", "实验代码参数无效。", false, {
            issues: parsed.error.issues,
          }),
        );
      }
      try {
        return success(request.id, await evaluator.evaluate(definition.task_id, parsed.data));
      } catch (caught) {
        const mapped = evaluatorFailure(request, caught);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post<{ Params: { experimentId: string }; Body: unknown }>(
    "/api/v1/student/programming-experiments/:experimentId/attempts",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const definition = getProgrammingExperimentDefinition(request.params.experimentId);
      if (!definition) {
        return reply.code(404).send(
          failure(request.id, "PROGRAMMING_EXPERIMENT_NOT_FOUND", "编程实验不存在。"),
        );
      }
      const key = idempotencyKey(request);
      if (!key) {
        return reply.code(400).send(
          failure(request.id, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。"),
        );
      }
      const parsed = programmingExperimentAttemptSubmitSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "PROGRAMMING_EXPERIMENT_INPUT_INVALID", "实验代码参数无效。", false, {
            issues: parsed.error.issues,
          }),
        );
      }
      const replay = await repository.findIdempotent(
        actor.userId,
        definition.experiment_id,
        key,
      );
      if (replay) {
        reply.header("idempotency-replayed", "true");
        return reply.code(200).send(success(request.id, replay));
      }
      try {
        const result = await evaluator.evaluate(definition.task_id, parsed.data);
        if (result.execution_mode !== "sandbox" || result.degraded_reason) {
          return reply.code(503).send(
            failure(
              request.id,
              "EXPERIMENT_REQUIRES_SANDBOX",
              "隔离评测服务当前不可用，本次结果不会写入正式实验记录。",
              true,
              { execution_mode: result.execution_mode },
            ),
          );
        }
        const record = programmingExperimentAttemptRecordSchema.parse({
          attempt_id: `prog_attempt_${crypto.randomUUID()}`,
          experiment_id: definition.experiment_id,
          course_id: definition.course_id,
          concept_id: definition.concept_id,
          task_id: definition.task_id,
          language: parsed.data.language,
          source: parsed.data.source,
          result,
          diagnosis: diagnoseProgrammingExperiment(result),
          created_at: new Date().toISOString(),
        });
        const stored = await repository.saveAttempt({
          userId: actor.userId,
          idempotencyKey: key,
          record,
        });
        return reply.code(201).send(success(request.id, stored));
      } catch (caught) {
        const mapped = evaluatorFailure(request, caught);
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );
}
