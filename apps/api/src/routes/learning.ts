import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  codeRunRequestSchema,
  submissionRequestSchema,
  validationAttemptRequestSchema,
} from "@xuetu/contracts";
import type { z } from "zod";

import type { DemoState } from "../domain/demo-state.js";
import type { DemoFlow } from "../services/demo-flow.js";
import {
  InvalidCustomInputError,
} from "../services/code-runner.js";
import {
  CodeEvaluatorError,
  type CodeEvaluator,
} from "../services/evaluator/code-evaluator.js";

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function error(
  requestId: string,
  code: string,
  message: string,
  retryable: boolean,
  details: Record<string, unknown> = {},
) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: { code, message, retryable, details },
  };
}

function idempotencyKey(headers: Record<string, unknown>) {
  const value = headers["idempotency-key"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validationIssues(error: z.ZodError) {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function sendFlowResult(
  requestId: string,
  reply: FastifyReply,
  result:
    | Awaited<ReturnType<DemoFlow["submitTask"]>>
    | Awaited<ReturnType<DemoFlow["submitValidation"]>>,
) {
  if (!result.ok) {
    return reply
      .code(result.statusCode)
      .send(error(requestId, result.code, result.message, result.retryable, result.details));
  }
  if (result.replayed) reply.header("idempotency-replayed", "true");
  return reply.code(result.replayed ? 200 : 201).send(success(requestId, result.data));
}

export function registerLearningRoutes(
  app: FastifyInstance,
  getContext: (request: FastifyRequest) => { state: DemoState; flow: DemoFlow },
  codeEvaluator: CodeEvaluator,
) {
  app.get<{ Params: { taskId: string } }>(
    "/api/v1/tasks/:taskId/submissions",
    async (request, reply) => {
      const { state, flow } = getContext(request);
      const task = state.tasks.get(request.params.taskId);
      if (!task || task.is_independent_validation) {
        return reply
          .code(404)
          .send(error(request.id, "RESOURCE_NOT_FOUND", "学习任务不存在。", false));
      }
      return success(request.id, {
        task_id: task.task_id,
        items: flow.listSubmissions(task.task_id),
      });
    },
  );

  app.post<{ Params: { taskId: string }; Body: unknown }>(
    "/api/v1/tasks/:taskId/runs",
    async (request, reply) => {
      const { state } = getContext(request);
      const task = state.tasks.get(request.params.taskId);
      if (!task || task.is_independent_validation) {
        return reply
          .code(404)
          .send(error(request.id, "RESOURCE_NOT_FOUND", "学习任务不存在。", false));
      }

      const parsed = codeRunRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          error(request.id, "VALIDATION_ERROR", "代码运行参数不完整。", false, {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          }),
        );
      }

      try {
        return success(
          request.id,
          await codeEvaluator.evaluate(request.params.taskId, parsed.data),
        );
      } catch (caught) {
        if (caught instanceof InvalidCustomInputError) {
          return reply
            .code(400)
            .send(error(request.id, "INVALID_CUSTOM_INPUT", caught.message, false));
        }
        if (caught instanceof CodeEvaluatorError) {
          return reply
            .code(caught.statusCode)
            .send(
              error(
                request.id,
                caught.code,
                caught.message,
                caught.retryable,
                caught.details,
              ),
            );
        }
        throw caught;
      }
    },
  );

  app.post<{ Params: { taskId: string }; Body: unknown }>(
    "/api/v1/tasks/:taskId/submissions",
    async (request, reply) => {
      const { flow } = getContext(request);
      const key = idempotencyKey(request.headers);
      if (!key) {
        return reply
          .code(400)
          .send(error(request.id, "VALIDATION_ERROR", "缺少 Idempotency-Key。", false));
      }
      const parsed = submissionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            error(
              request.id,
              "VALIDATION_ERROR",
              "提交参数不完整或格式错误。",
              false,
              validationIssues(parsed.error),
            ),
          );
      }
      try {
        return sendFlowResult(
          request.id,
          reply,
          await flow.submitTask(request.params.taskId, parsed.data, key),
        );
      } catch (caught) {
        if (caught instanceof InvalidCustomInputError) {
          return reply
            .code(400)
            .send(error(request.id, "INVALID_CUSTOM_INPUT", caught.message, false));
        }
        if (caught instanceof CodeEvaluatorError) {
          return reply
            .code(caught.statusCode)
            .send(
              error(
                request.id,
                caught.code,
                caught.message,
                caught.retryable,
                caught.details,
              ),
            );
        }
        throw caught;
      }
    },
  );

  app.get<{ Params: { submissionId: string } }>(
    "/api/v1/submissions/:submissionId",
    async (request, reply) => {
      const { flow } = getContext(request);
      const submission = flow.getSubmission(request.params.submissionId);
      return submission
        ? success(request.id, submission)
        : reply
            .code(404)
            .send(error(request.id, "RESOURCE_NOT_FOUND", "提交记录不存在。", false));
    },
  );

  app.get<{ Params: { submissionId: string } }>(
    "/api/v1/submissions/:submissionId/evidence",
    async (request, reply) => {
      const { flow } = getContext(request);
      const evidence = flow.getEvidence(request.params.submissionId);
      return evidence
        ? success(request.id, { items: evidence })
        : reply
            .code(404)
            .send(error(request.id, "RESOURCE_NOT_FOUND", "提交证据不存在。", false));
    },
  );

  app.get<{ Params: { diagnosisId: string } }>(
    "/api/v1/diagnoses/:diagnosisId",
    async (request, reply) => {
      const { flow } = getContext(request);
      const diagnosis = flow.getDiagnosis(request.params.diagnosisId);
      return diagnosis
        ? success(request.id, diagnosis)
        : reply
            .code(404)
            .send(error(request.id, "RESOURCE_NOT_FOUND", "诊断记录不存在。", false));
    },
  );

  app.get("/api/v1/mistakes", async (request) => {
    const { flow } = getContext(request);
    return success(request.id, { items: flow.listMistakes(), next_cursor: null });
  });

  app.get<{ Querystring: { course_id?: string } }>(
    "/api/v1/learning-plan",
    async (request, reply) => {
      const { state } = getContext(request);
      if (request.query.course_id && request.query.course_id !== state.course.course_id) {
        return reply
          .code(404)
          .send(error(request.id, "RESOURCE_NOT_FOUND", "课程不存在。", false));
      }
      return success(request.id, {
        course_id: state.course.course_id,
        learning_state_version: state.learning_state_version,
        items: state.plan_items,
      });
    },
  );

  app.post<{ Params: { validationId: string }; Body: unknown }>(
    "/api/v1/validations/:validationId/attempts",
    async (request, reply) => {
      const { flow } = getContext(request);
      const key = idempotencyKey(request.headers);
      if (!key) {
        return reply
          .code(400)
          .send(error(request.id, "VALIDATION_ERROR", "缺少 Idempotency-Key。", false));
      }
      const parsed = validationAttemptRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            error(
              request.id,
              "VALIDATION_ERROR",
              "独立验证提交参数不完整或格式错误。",
              false,
              validationIssues(parsed.error),
            ),
          );
      }
      try {
        return sendFlowResult(
          request.id,
          reply,
          await flow.submitValidation(request.params.validationId, parsed.data, key),
        );
      } catch (caught) {
        if (caught instanceof CodeEvaluatorError) {
          return reply
            .code(caught.statusCode)
            .send(
              error(
                request.id,
                caught.code,
                caught.message,
                caught.retryable,
                caught.details,
              ),
            );
        }
        throw caught;
      }
    },
  );
}
