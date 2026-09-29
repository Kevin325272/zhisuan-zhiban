import { createHash } from "node:crypto";

import {
  externalQuestionConfirmationSchema,
  externalQuestionDetailSchema,
  externalQuestionExplanationRequestSchema,
  externalQuestionListSchema,
  externalQuestionSaveRequestSchema,
  type ExternalQuestionDetail,
  type ExternalQuestionListItem,
  type PlatformRole,
} from "@xuetu/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { EXTERNAL_QUESTION_LIMITS } from "../config/external-questions.js";
import type { PerUserAiRequestLimiter } from "../services/ai-request-limiter.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import type { ExternalQuestionConceptMatcher } from "../services/external-questions/concept-matcher.js";
import {
  ExternalQuestionAiError,
  ExternalQuestionRequestAbortedError,
  ExternalQuestionRepositoryError,
  type ExternalQuestionAiGateway,
  type ExternalQuestionRepository,
  type StoredExternalQuestion,
} from "../services/external-questions/external-question.js";
import {
  ExternalQuestionImageError,
  type NormalizedExternalQuestionImage,
} from "../services/external-questions/image-service.js";
import type { PlatformAccessService } from "../services/platform-access.js";

export interface ExternalQuestionImageAccess {
  normalize(input: {
    bytes: Buffer;
    declaredMimeType: string;
    originalName: string;
  }): Promise<NormalizedExternalQuestionImage>;
  read(storageRef: string): Promise<Buffer>;
  remove(storageRef: string): Promise<boolean>;
}

export interface ExternalQuestionRouteServices {
  repository: ExternalQuestionRepository;
  imageService: ExternalQuestionImageAccess;
  gateway: ExternalQuestionAiGateway;
  conceptMatcher: ExternalQuestionConceptMatcher;
  cleanup?: () => Promise<void>;
}

interface Options {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService | null;
  authentication?: LocalAuthenticationService | null;
  aiRequestLimiter: Pick<PerUserAiRequestLimiter, "acquire">;
}

const COURSE_408_IDS = [
  "course_408_ds",
  "course_408_co",
  "course_408_os",
  "course_408_cn",
] as const;

const paramsSchema = z.object({
  externalQuestionId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/u),
}).strict();

function success(requestId: string, data: unknown) {
  return { contract_version: "0.2", request_id: requestId, data };
}

function failure(
  requestId: string,
  code: string,
  message: string,
  retryable = false,
  details: Record<string, unknown> = {},
) {
  return {
    contract_version: "0.2",
    request_id: requestId,
    error: { code, message, retryable, details },
  };
}

async function require408Student(
  request: FastifyRequest,
  options: Options,
): Promise<{ userId: string } | { status: 401 | 403 | 503; body: unknown }> {
  const identity = await resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
  if (!identity) {
    const configured = Boolean(options.authentication) || options.allowLocalDevAuth;
    return {
      status: configured ? 401 : 503,
      body: failure(
        request.id,
        configured ? "AUTHENTICATION_REQUIRED" : "AUTHENTICATION_NOT_CONFIGURED",
        configured ? "请先登录学生账户。" : "学生认证尚未配置。",
      ),
    };
  }
  if (!identity.roles.includes("student" as PlatformRole)) {
    return {
      status: 403,
      body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前接口仅供学生访问。"),
    };
  }
  if (!options.platformAccess) {
    return {
      status: 503,
      body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "课程权限存储尚未配置。"),
    };
  }
  const assigned = await Promise.all(
    COURSE_408_IDS.map((courseId) =>
      options.platformAccess!.isCourseAssigned(identity.userId, courseId, "student")
    ),
  );
  if (!assigned.some(Boolean)) {
    return {
      status: 403,
      body: failure(
        request.id,
        "EXTERNAL_QUESTION_408_ACCESS_REQUIRED",
        "当前学生尚未加入可用的 408 课程。",
      ),
    };
  }
  return { userId: identity.userId };
}

function readIdempotencyKey(request: FastifyRequest) {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && !/[\r\n\0]/u.test(value)
    ? value
    : null;
}

function detail(question: StoredExternalQuestion): ExternalQuestionDetail {
  return externalQuestionDetailSchema.parse({
    external_question_id: question.externalQuestionId,
    status: question.status,
    content_revision: question.contentRevision,
    image_url: `/api/v1/student/external-questions/${encodeURIComponent(question.externalQuestionId)}/image`,
    recognition: question.recognition,
    confirmation: question.confirmation,
    concept_candidates: question.conceptCandidates,
    explanations: question.explanations.map((item) => ({
      ...item.explanation,
      explanation_id: item.explanationId,
      content_revision: item.contentRevision,
      created_at: item.createdAt,
    })),
    saved_at: question.savedAt,
    expires_at: question.expiresAt,
    created_at: question.createdAt,
    updated_at: question.updatedAt,
  });
}

function listItem(question: StoredExternalQuestion): ExternalQuestionListItem {
  const subject = question.confirmation?.subject
    ?? (question.recognition?.subject === "unknown" ? null : question.recognition?.subject)
    ?? null;
  const rawExcerpt = question.confirmation?.question_text
    ?? question.recognition?.question_text
    ?? "";
  const questionExcerpt = rawExcerpt.trim().slice(0, 240) || null;
  return {
    external_question_id: question.externalQuestionId,
    status: question.status,
    subject,
    question_excerpt: questionExcerpt,
    image_url: `/api/v1/student/external-questions/${encodeURIComponent(question.externalQuestionId)}/image`,
    saved_at: question.savedAt,
    expires_at: question.expiresAt,
    updated_at: question.updatedAt,
  };
}

function mappedError(
  request: FastifyRequest,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  if (error instanceof ExternalQuestionRepositoryError) {
    return {
      status: error.statusCode,
      body: failure(request.id, error.code, error.message, false, details),
    };
  }
  if (error instanceof ExternalQuestionAiError) {
    return {
      status: error.statusCode,
      body: failure(request.id, error.code, error.message, error.retryable, details),
    };
  }
  if (error instanceof ExternalQuestionImageError) {
    const status = error.code === "IMAGE_TOO_LARGE" || error.code === "IMAGE_PIXEL_LIMIT"
      ? 413
      : error.code === "IMAGE_TYPE_UNSUPPORTED" || error.code === "IMAGE_TYPE_MISMATCH"
        ? 415
        : error.code === "IMAGE_NOT_FOUND"
          ? 404
          : 400;
    return { status, body: failure(request.id, error.code, error.message) };
  }
  return null;
}

function requireParams(request: FastifyRequest) {
  return paramsSchema.safeParse(request.params);
}

function bindRequestAbort(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const requestRaw = request.raw;
  const responseRaw = reply.raw;
  let responseFinished = responseRaw.writableFinished || responseRaw.writableEnded;
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onRequestClose = () => {
    if (!requestRaw.complete) abort();
  };
  const onResponseFinish = () => {
    responseFinished = true;
  };
  const onResponseClose = () => {
    if (!responseFinished && !responseRaw.writableFinished && !responseRaw.writableEnded) abort();
  };
  requestRaw.once("aborted", abort);
  requestRaw.once("close", onRequestClose);
  responseRaw.once("finish", onResponseFinish);
  responseRaw.once("close", onResponseClose);
  if (requestRaw.aborted || (requestRaw.destroyed && !requestRaw.complete)) abort();
  return {
    signal: controller.signal,
    dispose() {
      requestRaw.removeListener("aborted", abort);
      requestRaw.removeListener("close", onRequestClose);
      responseRaw.removeListener("finish", onResponseFinish);
      responseRaw.removeListener("close", onResponseClose);
    },
  };
}

async function runAi<T>(
  request: FastifyRequest,
  reply: { header(name: string, value: string | number): unknown; code(status: number): { send(body: unknown): unknown } },
  userId: string,
  limiter: Pick<PerUserAiRequestLimiter, "acquire">,
  externalQuestionId: string,
  signal: AbortSignal,
  operation: () => Promise<T>,
) {
  if (signal.aborted) {
    return { limited: false as const, aborted: true as const };
  }
  const lease = limiter.acquire(userId);
  if (!lease.allowed) {
    if (signal.aborted) {
      return { limited: false as const, aborted: true as const };
    }
    reply.header("Retry-After", lease.retryAfterSeconds);
    return {
      limited: true as const,
      response: reply.code(429).send(failure(
        request.id,
        "AI_REQUEST_LIMITED",
        "AI 讲题请求过于频繁，请稍后重试。",
        true,
        { external_question_id: externalQuestionId, reason: lease.reason },
      )),
    };
  }
  try {
    if (signal.aborted) {
      return { limited: false as const, aborted: true as const };
    }
    try {
      const value = await operation();
      if (signal.aborted) {
        return { limited: false as const, aborted: true as const };
      }
      return { limited: false as const, value };
    } catch (error) {
      if (signal.aborted || error instanceof ExternalQuestionRequestAbortedError) {
        return { limited: false as const, aborted: true as const };
      }
      throw error;
    }
  } finally {
    lease.release();
  }
}

export function registerExternalQuestionRoutes(
  app: FastifyInstance,
  services: ExternalQuestionRouteServices,
  options: Options,
) {
  app.post(
    "/api/v1/student/external-questions",
    async (request, reply) => {
      const actor = await require408Student(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const key = readIdempotencyKey(request);
      if (!key) {
        return reply.code(400).send(failure(
          request.id,
          "IDEMPOTENCY_KEY_REQUIRED",
          "缺少有效的 Idempotency-Key。",
        ));
      }
      if (!request.isMultipart()) {
        return reply.code(415).send(failure(
          request.id,
          "MULTIPART_REQUIRED",
          "请使用 multipart/form-data 上传题目图片。",
        ));
      }

      try {
        const requestAbort = bindRequestAbort(request, reply);
        try {
          let uploaded: { bytes: Buffer; mimetype: string; filename: string } | null = null;
          let fileCount = 0;
          try {
            for await (const part of request.parts({
              limits: {
                fileSize: EXTERNAL_QUESTION_LIMITS.maxUploadBytes,
                files: 2,
                fields: 0,
                parts: 2,
              },
            })) {
              if (part.type !== "file") {
                return reply.code(400).send(failure(
                  request.id,
                  "EXTERNAL_QUESTION_IMAGE_SINGLE_REQUIRED",
                  "只能上传一个 image 图片字段。",
                ));
              }
              fileCount += 1;
              const bytes = await part.toBuffer();
              if (part.fieldname === "image" && uploaded === null) {
                uploaded = { bytes, mimetype: part.mimetype, filename: part.filename };
              }
            }
          } catch (error) {
            if (requestAbort.signal.aborted) return;
            if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
              return reply.code(413).send(failure(
                request.id,
                "IMAGE_TOO_LARGE",
                "题目图片超过 5 MiB 限制。",
              ));
            }
            if (
              error instanceof app.multipartErrors.FilesLimitError
              || error instanceof app.multipartErrors.PartsLimitError
              || error instanceof app.multipartErrors.FieldsLimitError
            ) {
              return reply.code(400).send(failure(
                request.id,
                "EXTERNAL_QUESTION_IMAGE_SINGLE_REQUIRED",
                "只能上传一个 image 图片字段。",
              ));
            }
            throw error;
          }
          if (fileCount !== 1 || uploaded === null) {
            return reply.code(400).send(failure(
              request.id,
              "EXTERNAL_QUESTION_IMAGE_SINGLE_REQUIRED",
              "请选择一张题目图片。",
            ));
          }

          let normalized: NormalizedExternalQuestionImage;
          try {
            normalized = await services.imageService.normalize({
              bytes: uploaded.bytes,
              declaredMimeType: uploaded.mimetype,
              originalName: uploaded.filename,
            });
          } catch (error) {
            if (requestAbort.signal.aborted) return;
            const mapped = mappedError(request, error);
            if (mapped) return reply.code(mapped.status).send(mapped.body);
            throw error;
          }

          let created;
          const createdAt = new Date();
          try {
            created = await services.repository.createTemporary({
              userId: actor.userId,
              image: normalized,
              idempotencyKey: key,
              requestFingerprint: createHash("sha256")
                .update(`${normalized.sha256}:${normalized.byteSize}:${normalized.width}x${normalized.height}`)
                .digest("hex"),
              now: createdAt,
              expiresAt: new Date(createdAt.getTime() + EXTERNAL_QUESTION_LIMITS.temporaryTtlMs),
            });
          } catch (error) {
            await services.imageService.remove(normalized.storageRef).catch(() => false);
            if (requestAbort.signal.aborted) return;
            const mapped = mappedError(request, error);
            if (mapped) return reply.code(mapped.status).send(mapped.body);
            throw error;
          }

          if (created.idempotencyReplayed) {
            await services.imageService.remove(normalized.storageRef).catch(() => false);
            if (requestAbort.signal.aborted) return;
            reply.header("Idempotency-Replayed", "true");
            try {
              return success(
                request.id,
                detail(await services.repository.getOwned(actor.userId, created.externalQuestionId, new Date())),
              );
            } catch (error) {
              if (requestAbort.signal.aborted) return;
              const mapped = mappedError(request, error);
              if (mapped) return reply.code(mapped.status).send(mapped.body);
              throw error;
            }
          }

          if (services.cleanup) {
            void services.cleanup().catch(() => {
              request.log.warn({ event: "external_question_cleanup_after_upload_failed" });
            });
          }

          const ai = await runAi(
            request,
            reply,
            actor.userId,
            options.aiRequestLimiter,
            created.externalQuestionId,
            requestAbort.signal,
            async () => services.gateway.recognize({
              requestId: request.id,
              imageBytes: await services.imageService.read(normalized.storageRef),
              signal: requestAbort.signal,
            }),
          ).catch((error: unknown) => ({ aiError: error } as const));
          if (requestAbort.signal.aborted) return;
          if ("aborted" in ai && ai.aborted) return;
          if ("limited" in ai && ai.limited) return ai.response;
          if ("aiError" in ai) {
            if (ai.aiError instanceof ExternalQuestionRequestAbortedError) return;
            const mapped = mappedError(request, ai.aiError, {
              external_question_id: created.externalQuestionId,
            });
            if (mapped) return reply.code(mapped.status).send(mapped.body);
            throw ai.aiError;
          }
          const recognized = ai.value;
          if (requestAbort.signal.aborted) return;
          await services.repository.recordRecognition({
            userId: actor.userId,
            externalQuestionId: created.externalQuestionId,
            status: recognized.recognition.status,
            recognition: recognized.recognition,
            modelTrace: recognized.modelTrace,
            idempotencyKey: key,
            now: new Date(),
          });
          if (requestAbort.signal.aborted) return;
          return reply.code(201).send(success(
            request.id,
            detail(await services.repository.getOwned(actor.userId, created.externalQuestionId, new Date())),
          ));
        } finally {
          requestAbort.dispose();
        }
      } catch (error) {
        if (error instanceof ExternalQuestionRequestAbortedError) return;
        throw error;
      }
    },
  );

  app.post<{ Params: unknown; Body: unknown }>(
    "/api/v1/student/external-questions/:externalQuestionId/recognition",
    async (request, reply) => {
      const actor = await require408Student(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = requireParams(request);
      const key = readIdempotencyKey(request);
      if (!params.success || request.body === null || typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body as object).length > 0) {
        return reply.code(400).send(failure(request.id, "EXTERNAL_QUESTION_RECOGNITION_INVALID", "识别重试请求无效。"));
      }
      if (!key) return reply.code(400).send(failure(request.id, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。"));
      const requestAbort = bindRequestAbort(request, reply);
      try {
        const current = await services.repository.getOwned(actor.userId, params.data.externalQuestionId, new Date());
        if (requestAbort.signal.aborted) return;
        const replay = await services.repository.findRecognitionReplay({
          userId: actor.userId,
          externalQuestionId: current.externalQuestionId,
          idempotencyKey: key,
        });
        if (requestAbort.signal.aborted) return;
        if (replay) {
          reply.header("Idempotency-Replayed", "true");
          return success(request.id, detail(current));
        }
        if (current.status === "confirmed") {
          return reply.code(409).send(failure(
            request.id,
            "EXTERNAL_QUESTION_INVALID_STATE",
            "已确认题目不能重新执行识别。",
          ));
        }
        const ai = await runAi(
          request,
          reply,
          actor.userId,
          options.aiRequestLimiter,
          current.externalQuestionId,
          requestAbort.signal,
          async () => services.gateway.recognize({
            requestId: request.id,
            imageBytes: await services.imageService.read(current.image.storageRef),
            signal: requestAbort.signal,
          }),
        );
        if (requestAbort.signal.aborted || ("aborted" in ai && ai.aborted)) return;
        if (ai.limited) return ai.response;
        await services.repository.recordRecognition({
          userId: actor.userId,
          externalQuestionId: current.externalQuestionId,
          status: ai.value.recognition.status,
          recognition: ai.value.recognition,
          modelTrace: ai.value.modelTrace,
          idempotencyKey: key,
          now: new Date(),
        });
        if (requestAbort.signal.aborted) return;
        return success(request.id, detail(await services.repository.getOwned(actor.userId, current.externalQuestionId, new Date())));
      } catch (error) {
        if (requestAbort.signal.aborted || error instanceof ExternalQuestionRequestAbortedError) return;
        const mapped = mappedError(request, error, { external_question_id: params.data.externalQuestionId });
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw error;
      } finally {
        requestAbort.dispose();
      }
    },
  );

  app.put<{ Params: unknown; Body: unknown }>(
    "/api/v1/student/external-questions/:externalQuestionId/confirmation",
    async (request, reply) => {
      const actor = await require408Student(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = requireParams(request);
      const body = externalQuestionConfirmationSchema.safeParse(request.body);
      const key = readIdempotencyKey(request);
      if (!params.success || !body.success) {
        return reply.code(400).send(failure(request.id, "EXTERNAL_QUESTION_CONFIRMATION_INVALID", "确认后的题目内容无效。"));
      }
      if (!key) return reply.code(400).send(failure(request.id, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。"));
      try {
        const current = await services.repository.getOwned(actor.userId, params.data.externalQuestionId, new Date());
        const conceptCandidates = await services.conceptMatcher.match({
          userId: actor.userId,
          subject: body.data.subject,
          text: body.data.question_text,
          formulae: body.data.formulae,
          diagramDescription: body.data.diagram_description,
          keywords: current.recognition?.knowledge_keywords ?? [],
        });
        await services.repository.confirm({
          userId: actor.userId,
          externalQuestionId: params.data.externalQuestionId,
          confirmation: body.data,
          conceptCandidates,
          idempotencyKey: key,
          now: new Date(),
        });
        return success(request.id, detail(await services.repository.getOwned(actor.userId, params.data.externalQuestionId, new Date())));
      } catch (error) {
        const mapped = mappedError(request, error);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw error;
      }
    },
  );

  app.post<{ Params: unknown; Body: unknown }>(
    "/api/v1/student/external-questions/:externalQuestionId/explanations",
    async (request, reply) => {
      const actor = await require408Student(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = requireParams(request);
      const body = externalQuestionExplanationRequestSchema.safeParse(request.body);
      const key = readIdempotencyKey(request);
      if (!params.success || !body.success) {
        return reply.code(400).send(failure(request.id, "EXTERNAL_QUESTION_EXPLANATION_INVALID", "讲解深度请求无效。"));
      }
      if (!key) return reply.code(400).send(failure(request.id, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。"));
      const requestAbort = bindRequestAbort(request, reply);
      try {
        const current = await services.repository.getOwned(actor.userId, params.data.externalQuestionId, new Date());
        if (requestAbort.signal.aborted) return;
        if (!current.confirmation) {
          return reply.code(409).send(failure(request.id, "EXTERNAL_QUESTION_CONFIRMATION_REQUIRED", "请先确认题目内容。"));
        }
        const replay = await services.repository.findExplanationReplay({
          userId: actor.userId,
          externalQuestionId: current.externalQuestionId,
          contentRevision: current.contentRevision,
          depth: body.data.depth,
          idempotencyKey: key,
        });
        if (requestAbort.signal.aborted) return;
        if (replay) {
          reply.header("Idempotency-Replayed", "true");
          return success(request.id, detail(current));
        }
        const ai = await runAi(
          request,
          reply,
          actor.userId,
          options.aiRequestLimiter,
          current.externalQuestionId,
          requestAbort.signal,
          () => services.gateway.explain({
            requestId: request.id,
            confirmation: current.confirmation!,
            conceptCandidates: current.conceptCandidates,
            depth: body.data.depth,
            signal: requestAbort.signal,
          }),
        );
        if (requestAbort.signal.aborted || ("aborted" in ai && ai.aborted)) return;
        if (ai.limited) return ai.response;
        await services.repository.storeExplanation({
          userId: actor.userId,
          externalQuestionId: current.externalQuestionId,
          expectedContentRevision: current.contentRevision,
          explanation: ai.value.explanation,
          conceptIds: ai.value.explanation.knowledge_points.map((point) => point.concept_id),
          modelTrace: ai.value.modelTrace,
          idempotencyKey: key,
          now: new Date(),
        });
        if (requestAbort.signal.aborted) return;
        return success(request.id, detail(await services.repository.getOwned(actor.userId, current.externalQuestionId, new Date())));
      } catch (error) {
        if (requestAbort.signal.aborted || error instanceof ExternalQuestionRequestAbortedError) return;
        const mapped = mappedError(request, error);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw error;
      } finally {
        requestAbort.dispose();
      }
    },
  );

  app.post<{ Params: unknown; Body: unknown }>(
    "/api/v1/student/external-questions/:externalQuestionId/save",
    async (request, reply) => {
      const actor = await require408Student(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = requireParams(request);
      const body = externalQuestionSaveRequestSchema.safeParse(request.body);
      const key = readIdempotencyKey(request);
      if (!params.success || !body.success) {
        return reply.code(400).send(failure(request.id, "EXTERNAL_QUESTION_SAVE_INVALID", "保存请求无效。"));
      }
      if (!key) return reply.code(400).send(failure(request.id, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。"));
      try {
        await services.repository.save({
          userId: actor.userId,
          externalQuestionId: params.data.externalQuestionId,
          idempotencyKey: key,
          now: new Date(),
        });
        return success(request.id, detail(await services.repository.getOwned(actor.userId, params.data.externalQuestionId, new Date())));
      } catch (error) {
        const mapped = mappedError(request, error);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw error;
      }
    },
  );

  app.get("/api/v1/student/external-questions", async (request, reply) => {
    const actor = await require408Student(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    const questions = await services.repository.listOwned(actor.userId, new Date());
    return success(request.id, externalQuestionListSchema.parse({ items: questions.map(listItem) }));
  });

  app.get<{ Params: unknown }>(
    "/api/v1/student/external-questions/:externalQuestionId",
    async (request, reply) => {
      const actor = await require408Student(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = requireParams(request);
      if (!params.success) return reply.code(400).send(failure(request.id, "EXTERNAL_QUESTION_ID_INVALID", "题目标识无效。"));
      try {
        return success(request.id, detail(await services.repository.getOwned(actor.userId, params.data.externalQuestionId, new Date())));
      } catch (error) {
        const mapped = mappedError(request, error);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw error;
      }
    },
  );

  app.get<{ Params: unknown }>(
    "/api/v1/student/external-questions/:externalQuestionId/image",
    async (request, reply) => {
      const actor = await require408Student(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = requireParams(request);
      if (!params.success) return reply.code(400).send(failure(request.id, "EXTERNAL_QUESTION_ID_INVALID", "题目标识无效。"));
      try {
        const current = await services.repository.getOwned(actor.userId, params.data.externalQuestionId, new Date());
        const bytes = await services.imageService.read(current.image.storageRef);
        return reply
          .header("Content-Type", "image/webp")
          .header("Cache-Control", "private, no-store")
          .header("X-Content-Type-Options", "nosniff")
          .send(bytes);
      } catch (error) {
        const mapped = mappedError(request, error);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw error;
      }
    },
  );

  app.delete<{ Params: unknown }>(
    "/api/v1/student/external-questions/:externalQuestionId",
    async (request, reply) => {
      const actor = await require408Student(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const params = requireParams(request);
      const key = readIdempotencyKey(request);
      if (!params.success) return reply.code(400).send(failure(request.id, "EXTERNAL_QUESTION_ID_INVALID", "题目标识无效。"));
      if (!key) return reply.code(400).send(failure(request.id, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。"));
      try {
        const deleted = await services.repository.markDeleted({
          userId: actor.userId,
          externalQuestionId: params.data.externalQuestionId,
          idempotencyKey: key,
          now: new Date(),
        });
        if (deleted.cleanupRef) {
          try {
            await services.imageService.remove(deleted.cleanupRef.storageRef);
            const finalized = await services.repository.finalizeCleanup({
              ...deleted.cleanupRef,
              now: new Date(),
            });
            if (!finalized) {
              throw new Error("External-question cleanup claim could not be finalized.");
            }
          } catch {
            await services.repository.releaseCleanup(deleted.cleanupRef).catch(() => false);
            request.log.warn({
              event: "external_question_cleanup_deferred",
              externalQuestionId: deleted.cleanupRef.externalQuestionId,
            });
          }
        }
        return success(request.id, { deleted: true });
      } catch (error) {
        const mapped = mappedError(request, error);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw error;
      }
    },
  );
}
