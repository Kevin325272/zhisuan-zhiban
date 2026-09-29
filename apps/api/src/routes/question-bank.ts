import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  answerSubmissionSchema,
  mockExamStartRequestSchema,
  mockExamSubmitRequestSchema,
  practiceSelectionSchema,
} from "@xuetu/contracts";

import {
  QuestionNotFoundError,
  QuestionSubmissionError,
  type QuestionBankService,
} from "../services/question-bank/question-bank.js";
import {
  MockExamError,
  type MockExamService,
} from "../services/question-bank/mock-exam.js";
import { DEMO_408_COURSE_IDS } from "../config/student-registration.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import type { QuestionBankDirectory } from "../services/question-bank/question-bank-directory.js";

interface QuestionQuery {
  mode?: string;
  subject?: string;
  concept_id?: string;
  question_id?: string;
  year?: string;
  type?: string;
  tags?: string;
  tag_match?: string;
  limit?: string;
  offset?: string;
}

interface QuestionAssetParams {
  questionId: string;
  assetId: string;
}

interface QuestionAssetQuery {
  attempt_id?: string;
}

function boundedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(
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

function idempotencyKey(request: FastifyRequest) {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

async function hasQuestionBankMembership(
  platformAccess: PlatformAccessService,
  userId: string,
  courseId: string,
) {
  if (await platformAccess.isCourseAssigned(userId, courseId, "student")) return true;
  if (courseId !== "course_408_001") return false;

  // The question bank is a shared 408 container. A student only needs one
  // authorized subject course; the aggregate container must not be a second
  // hidden membership requirement.
  for (const subcourseId of DEMO_408_COURSE_IDS) {
    if (await platformAccess.isCourseAssigned(userId, subcourseId, "student")) return true;
  }
  return false;
}

async function localActorId(
  request: FastifyRequest,
  options: {
    allowLocalDevAuth: boolean;
    authentication?: LocalAuthenticationService | null;
    platformAccess: PlatformAccessService | null;
  },
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 503; body: unknown }> {
  const identity = await resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
  if (identity) return { ok: true, userId: identity.userId };
  if (!options.authentication && !options.allowLocalDevAuth) {
    return {
      ok: false,
      status: 503,
      body: failure(
        request.id,
        "AUTHENTICATION_NOT_CONFIGURED",
        "生产认证尚未接入；仅可在显式本地开发模式下使用开发身份头。",
        false,
      ),
    };
  }
  if (!options.authentication && options.allowLocalDevAuth) {
    const raw = request.headers["x-dev-user-id"];
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (userId && userId.length <= 200) return { ok: true, userId };
    return {
      ok: false,
      status: 401,
      body: failure(
        request.id,
        "AUTHENTICATION_REQUIRED",
        "本地开发模式需要 X-Dev-User-Id；该请求头不是生产认证。",
        false,
      ),
    };
  }
  if (options.authentication) {
    return {
      ok: false,
      status: 401,
      body: failure(
        request.id,
        "AUTHENTICATION_REQUIRED",
        "请先登录学生账户。",
        false,
      ),
    };
  }
  return { ok: false, status: 503, body: failure(request.id, "AUTHENTICATION_NOT_CONFIGURED", "认证尚未配置。", false) };
}

async function questionBankStudent(
  request: FastifyRequest,
  options: {
    allowLocalDevAuth: boolean;
    authentication?: LocalAuthenticationService | null;
    platformAccess: PlatformAccessService | null;
  },
  courseId: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403 | 503; body: unknown }> {
  const actor = await localActorId(request, options);
  if (!actor.ok) return actor;
  if (!options.platformAccess) {
    return {
      ok: false,
      status: 503,
      body: failure(
        request.id,
        "IDENTITY_STORE_NOT_CONFIGURED",
        "用户与课程授权存储尚未配置。",
        false,
      ),
    };
  }
  const platformActor = await options.platformAccess.getActor(actor.userId);
  if (!platformActor) {
    return {
      ok: false,
      status: 401,
      body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。", false),
    };
  }
  const courseAssigned = await hasQuestionBankMembership(
    options.platformAccess,
    actor.userId,
    courseId,
  );
  if (!platformActor.roles.includes("student") || !courseAssigned) {
    return {
      ok: false,
      status: 403,
      body: failure(
        request.id,
        "COURSE_ACCESS_DENIED",
        "只有已加入当前课程的学生可以访问题库。",
        false,
      ),
    };
  }
  return actor;
}

export function registerQuestionBankRoutes(
  app: FastifyInstance,
  questionBank: QuestionBankService,
  options: {
    allowLocalDevAuth: boolean;
    platformAccess: PlatformAccessService | null;
    authentication?: LocalAuthenticationService | null;
    mockExam?: MockExamService | null;
    directory?: QuestionBankDirectory | null;
  },
) {
  app.get(
    "/api/v1/question-bank/past-exams",
    async (request, reply) => {
      const actor = await questionBankStudent(request, options, questionBank.courseId);
      if (!actor.ok) return reply.code(actor.status).send(actor.body);
      return success(request.id, await questionBank.listPastExamPapers(actor.userId));
    },
  );

  app.get<{ Params: QuestionAssetParams; Querystring: QuestionAssetQuery }>(
    "/api/v1/question-bank/questions/:questionId/assets/:assetId",
    async (request, reply) => {
      const actor = await questionBankStudent(request, options, questionBank.courseId);
      if (!actor.ok) return reply.code(actor.status).send(actor.body);
      const questionId = boundedId(request.params.questionId);
      const assetId = boundedId(request.params.assetId);
      const attemptId = request.query.attempt_id === undefined
        ? undefined
        : boundedId(request.query.attempt_id);
      if (!questionId || !assetId || (request.query.attempt_id !== undefined && !attemptId)) {
        return reply.code(400).send(failure(
          request.id,
          "QUESTION_ASSET_REQUEST_INVALID",
          "图片请求参数无效。",
          false,
        ));
      }
      const bank = await options.directory?.forQuestion(questionId) ?? questionBank;
      if (bank !== questionBank) {
        const scopedActor = await questionBankStudent(request, options, bank.courseId);
        if (!scopedActor.ok) return reply.code(scopedActor.status).send(scopedActor.body);
      }
      const asset = await bank.openAsset(
        actor.userId,
        questionId,
        assetId,
        attemptId ?? undefined,
      );
      if (!asset) {
        return reply.code(404).send(failure(
          request.id,
          "QUESTION_ASSET_NOT_FOUND",
          "题目图片不存在或当前不可查看。",
          false,
        ));
      }
      return reply
        .header("Content-Type", asset.mimeType)
        .header("Content-Length", String(asset.byteLength))
        .header(
          "Cache-Control",
          asset.role === "explanation" || asset.role === "solution"
            ? "private, no-store"
            : "private, max-age=3600",
        )
        .header("X-Content-Type-Options", "nosniff")
        .send(asset.content);
    },
  );

  app.get<{ Querystring: QuestionQuery }>(
    "/api/v1/question-bank/questions",
    async (request, reply) => {
      const actor = await questionBankStudent(request, options, questionBank.courseId);
      if (!actor.ok) return reply.code(actor.status).send(actor.body);
      const parsed = practiceSelectionSchema.safeParse({
        mode: request.query.mode,
        subject: request.query.subject,
        concept_id: request.query.concept_id,
        question_id: request.query.question_id,
        year: request.query.year === undefined ? undefined : Number(request.query.year),
        type: request.query.type,
        tags:
          request.query.tags
            ?.split(",")
            .map((tag) => tag.trim())
            .filter(Boolean) ?? [],
        tag_match: request.query.tag_match,
        limit: request.query.limit === undefined ? undefined : Number(request.query.limit),
        offset: request.query.offset === undefined ? undefined : Number(request.query.offset),
      });
      if (!parsed.success) {
        return reply.code(400).send(
          failure(
            request.id,
            "QUESTION_BANK_FILTER_INVALID",
            "题库筛选参数无效。",
            false,
            { issues: parsed.error.issues },
          ),
        );
      }
      const bank = await options.directory?.forSelection(parsed.data) ?? questionBank;
      if (bank !== questionBank) {
        const scopedActor = await questionBankStudent(request, options, bank.courseId);
        if (!scopedActor.ok) return reply.code(scopedActor.status).send(scopedActor.body);
      }
      const result = await bank.select(actor.userId, parsed.data);
      // Course-owned questions come first, followed by older shared imports.
      // Count both sources on every page; an empty-only fallback hides shared
      // questions as soon as the source course gets its first eligible item.
      if (bank !== questionBank && !parsed.data.question_id) {
        const remaining = parsed.data.limit - result.items.length;
        const sharedResult = await questionBank.select(actor.userId, {
          ...parsed.data,
          offset: Math.max(0, parsed.data.offset - result.total),
          limit: Math.max(1, remaining),
        });
        return success(request.id, {
          ...result,
          items: [...result.items, ...sharedResult.items.slice(0, remaining)],
          total: result.total + sharedResult.total,
          limit: parsed.data.limit,
          offset: parsed.data.offset,
        });
      }
      return success(request.id, result);
    },
  );

  app.get<{ Params: { questionId: string } }>(
    "/api/v1/question-bank/questions/:questionId",
    async (request, reply) => {
      const actor = await questionBankStudent(request, options, questionBank.courseId);
      if (!actor.ok) return reply.code(actor.status).send(actor.body);
      const bank = await options.directory?.forQuestion(request.params.questionId) ?? questionBank;
      if (bank !== questionBank) {
        const scopedActor = await questionBankStudent(request, options, bank.courseId);
        if (!scopedActor.ok) return reply.code(scopedActor.status).send(scopedActor.body);
      }
      const question = await bank.get(request.params.questionId);
      if (!question) {
        return reply
          .code(404)
          .send(
            failure(request.id, "QUESTION_NOT_FOUND", "题目不存在。", false),
          );
      }
      return success(request.id, question);
    },
  );

  app.post<{ Body: unknown }>(
    "/api/v1/question-bank/evaluations",
    async (request, reply) => {
      const actor = await localActorId(request, options);
      if (!actor.ok) return reply.code(actor.status).send(actor.body);
      if (!options.platformAccess) {
        return reply.code(503).send(
          failure(
            request.id,
            "IDENTITY_STORE_NOT_CONFIGURED",
            "用户与课程授权存储尚未配置。",
            false,
          ),
        );
      }
      const platformActor = await options.platformAccess.getActor(actor.userId);
      if (!platformActor) {
        return reply.code(401).send(
          failure(
            request.id,
            "ACTOR_NOT_FOUND",
            "用户不存在或已停用。",
            false,
          ),
        );
      }
      const courseAssigned = await hasQuestionBankMembership(
        options.platformAccess,
        actor.userId,
        questionBank.courseId,
      );
      if (!platformActor.roles.includes("student") || !courseAssigned) {
        return reply.code(403).send(
          failure(
            request.id,
            "COURSE_ACCESS_DENIED",
            "只有已加入当前课程的学生可以提交作答。",
            false,
          ),
        );
      }
      const key = idempotencyKey(request);
      if (!key) {
        return reply.code(400).send(
          failure(request.id, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。", false),
        );
      }
      const parsed = answerSubmissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(
            request.id,
            "ANSWER_SUBMISSION_INVALID",
            "作答提交不符合接口契约。",
            false,
            { issues: parsed.error.issues },
          ),
        );
      }
      try {
        const bank = await options.directory?.forQuestion(parsed.data.question_id) ?? questionBank;
        if (bank !== questionBank) {
          const scopedActor = await questionBankStudent(request, options, bank.courseId);
          if (!scopedActor.ok) return reply.code(scopedActor.status).send(scopedActor.body);
        }
        const result = await bank.evaluate(actor.userId, parsed.data, key);
        const { idempotency_replayed: replayed = false, ...data } = result;
        if (replayed) reply.header("idempotency-replayed", "true");
        return reply.code(replayed ? 200 : 201).send(success(request.id, data));
      } catch (error) {
        if (error instanceof QuestionNotFoundError) {
          return reply
            .code(404)
            .send(failure(request.id, "QUESTION_NOT_FOUND", "题目不存在。", false));
        }
        if (error instanceof QuestionSubmissionError) {
          return reply
            .code(error.code === "IDEMPOTENCY_KEY_CONFLICT" ? 409 : 422)
            .send(failure(request.id, error.code, error.message, false));
        }
        throw error;
      }
    },
  );

  if (options.mockExam) {
    if (options.mockExam.courseId !== questionBank.courseId) {
      throw new Error("Question-bank and mock-exam course identifiers must match.");
    }
    app.post<{ Body: unknown }>(
      "/api/v1/question-bank/mock-exams",
      async (request, reply) => {
        const actor = await questionBankStudent(request, options, options.mockExam!.courseId);
        if (!actor.ok) return reply.code(actor.status).send(actor.body);
        const parsed = mockExamStartRequestSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send(failure(
            request.id,
            "MOCK_EXAM_START_INVALID",
            "模考开考参数无效。",
            false,
            { issues: parsed.error.issues },
          ));
        }
        try {
          const session = await options.mockExam!.start(actor.userId, parsed.data);
          return reply.code(session.resumed ? 200 : 201).send(success(request.id, session));
        } catch (error) {
          if (error instanceof MockExamError) {
            return reply.code(error.status).send(
              failure(request.id, error.code, error.message, false),
            );
          }
          throw error;
        }
      },
    );

    app.post<{ Params: { sessionId: string }; Body: unknown }>(
      "/api/v1/question-bank/mock-exams/:sessionId/submit",
      async (request, reply) => {
        const actor = await questionBankStudent(request, options, options.mockExam!.courseId);
        if (!actor.ok) return reply.code(actor.status).send(actor.body);
        const key = idempotencyKey(request);
        if (!key) {
          return reply.code(400).send(failure(
            request.id,
            "IDEMPOTENCY_KEY_REQUIRED",
            "缺少有效的 Idempotency-Key。",
            false,
          ));
        }
        const parsed = mockExamSubmitRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send(failure(
            request.id,
            "MOCK_EXAM_SUBMISSION_INVALID",
            "模考交卷内容不符合接口契约。",
            false,
            { issues: parsed.error.issues },
          ));
        }
        try {
          const result = await options.mockExam!.submit(
            actor.userId,
            request.params.sessionId,
            parsed.data,
            key,
          );
          const { idempotency_replayed: replayed = false, ...data } = result;
          if (replayed) reply.header("idempotency-replayed", "true");
          return reply.code(replayed ? 200 : 201).send(success(request.id, data));
        } catch (error) {
          if (error instanceof MockExamError) {
            return reply.code(error.status).send(
              failure(request.id, error.code, error.message, false),
            );
          }
          throw error;
        }
      },
    );
  }
}
