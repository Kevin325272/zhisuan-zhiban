import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  communityLikeRequestSchema,
  communityPostCreateRequestSchema,
  communityPostListQuerySchema,
  communityPostUpdateRequestSchema,
  communityReplyCreateRequestSchema,
  communityReplyListQuerySchema,
  communityReplyUpdateRequestSchema,
} from "@xuetu/contracts";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  CommunityError,
  type CommunityService,
} from "../services/community/community.js";
import type { PlatformAccessService } from "../services/platform-access.js";

interface Options {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService;
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
): Promise<{ userId: string } | { status: 401 | 403; body: unknown }> {
  const identity = await resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
  if (!identity) {
    return {
      status: 401,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。"),
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
      body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前入口仅供学生访问。"),
    };
  }
  return { userId: identity.userId };
}

function sendServiceError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (!(error instanceof CommunityError)) throw error;
  return reply.code(error.statusCode).send(
    failure(request.id, error.code, error.message, error.statusCode === 429),
  );
}

function readIdempotencyKey(request: FastifyRequest) {
  const raw = request.headers["idempotency-key"];
  const key = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  return /^[A-Za-z0-9:_-]{8,128}$/u.test(key) ? key : null;
}

function invalidRequest(request: FastifyRequest, reply: FastifyReply, issues: unknown) {
  return reply.code(400).send(failure(
    request.id,
    "COMMUNITY_REQUEST_INVALID",
    "提交内容或查询条件不符合要求。",
    false,
    { issues },
  ));
}

export function registerCommunityRoutes(
  app: FastifyInstance,
  service: CommunityService,
  options: Options,
) {
  app.get("/api/v1/student/community/circles", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    try {
      return success(request.id, await service.listCircles(actor.userId));
    } catch (error) {
      return sendServiceError(error, request, reply);
    }
  });

  app.get<{ Querystring: unknown }>(
    "/api/v1/student/community/posts",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = communityPostListQuerySchema.safeParse(request.query);
      if (!parsed.success) return invalidRequest(request, reply, parsed.error.issues);
      try {
        return success(request.id, await service.listPosts(actor.userId, parsed.data));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Body: unknown }>(
    "/api/v1/student/community/posts",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const idempotencyKey = readIdempotencyKey(request);
      if (!idempotencyKey) return invalidRequest(request, reply, ["Idempotency-Key"]);
      const parsed = communityPostCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) return invalidRequest(request, reply, parsed.error.issues);
      try {
        return reply.code(201).send(success(
          request.id,
          await service.createPost(actor.userId, parsed.data, idempotencyKey),
        ));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.get<{ Params: { postId: string }; Querystring: unknown }>(
    "/api/v1/student/community/posts/:postId",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = communityReplyListQuerySchema.safeParse(request.query);
      if (!parsed.success) return invalidRequest(request, reply, parsed.error.issues);
      try {
        return success(
          request.id,
          await service.getPost(actor.userId, request.params.postId, parsed.data),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.patch<{ Params: { postId: string }; Body: unknown }>(
    "/api/v1/student/community/posts/:postId",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = communityPostUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) return invalidRequest(request, reply, parsed.error.issues);
      try {
        return success(
          request.id,
          await service.updatePost(actor.userId, request.params.postId, parsed.data),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.delete<{ Params: { postId: string } }>(
    "/api/v1/student/community/posts/:postId",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        return success(request.id, await service.deletePost(actor.userId, request.params.postId));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Params: { postId: string }; Body: unknown }>(
    "/api/v1/student/community/posts/:postId/replies",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const idempotencyKey = readIdempotencyKey(request);
      if (!idempotencyKey) return invalidRequest(request, reply, ["Idempotency-Key"]);
      const parsed = communityReplyCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) return invalidRequest(request, reply, parsed.error.issues);
      try {
        return reply.code(201).send(success(
          request.id,
          await service.createReply(
            actor.userId,
            request.params.postId,
            parsed.data,
            idempotencyKey,
          ),
        ));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.patch<{ Params: { replyId: string }; Body: unknown }>(
    "/api/v1/student/community/replies/:replyId",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = communityReplyUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) return invalidRequest(request, reply, parsed.error.issues);
      try {
        return success(
          request.id,
          await service.updateReply(actor.userId, request.params.replyId, parsed.data),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.delete<{ Params: { replyId: string } }>(
    "/api/v1/student/community/replies/:replyId",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        return success(request.id, await service.deleteReply(actor.userId, request.params.replyId));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.put<{ Params: { postId: string }; Body: unknown }>(
    "/api/v1/student/community/posts/:postId/like",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = communityLikeRequestSchema.safeParse(request.body);
      if (!parsed.success) return invalidRequest(request, reply, parsed.error.issues);
      try {
        return success(
          request.id,
          await service.setPostLike(actor.userId, request.params.postId, parsed.data.liked),
        );
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );
}
