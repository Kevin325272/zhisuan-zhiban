import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { localActorId } from "./ai-workflows.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import type { PerUserAiRequestLimiter } from "../services/ai-request-limiter.js";
import {
  AgentChatError,
  type AgentChatGateway,
} from "../services/agent-chat/agent-chat-gateway.js";

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

const agentChatBodySchema = z.object({
  message: z.string().trim().min(1).max(1_000),
  context: z.enum(["study", "lab", "teacher"]).default("study"),
}).strip();

function formatSse(eventType: string, payload: unknown) {
  return `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
}

const allowedRoles = ["student", "teacher"];

/**
 * 全局浮窗 Agent 的真实问答流：POST 后 hijack 为 SSE，
 * 依次发出 agent.delta / agent.done（或 agent.failed）。
 * 未配置真实工作流时返回 503，由前端退回本地演示回复。
 */
export function registerAgentChatRoutes(
  app: FastifyInstance,
  dependencies: {
    gateway: AgentChatGateway | null;
    platformAccess: PlatformAccessService | null;
    allowLocalDevAuth: boolean;
    authentication?: LocalAuthenticationService | null;
    aiRequestLimiter: PerUserAiRequestLimiter;
  },
) {
  app.post<{ Body: unknown }>(
    "/api/v1/agent/chat",
    async (request, reply) => {
      const actor = await localActorId(request, dependencies);
      if (!actor.ok) return reply.code(actor.status).send(actor.body);
      const body = agentChatBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send(failure(
          request.id,
          "AGENT_CHAT_REQUEST_INVALID",
          "全局智能体请求不符合接口契约。",
          false,
          { issues: body.error.issues },
        ));
      }
      if (!dependencies.gateway) {
        return reply.code(503).send(failure(
          request.id,
          "AGENT_CHAT_NOT_CONFIGURED",
          "全局智能体暂不可用，请稍后重试。",
          true,
        ));
      }
      if (!dependencies.platformAccess) {
        return reply.code(503).send(failure(
          request.id,
          "IDENTITY_STORE_NOT_CONFIGURED",
          "用户与课程授权存储尚未配置。",
        ));
      }
      const platformActor = await dependencies.platformAccess.getActor(actor.userId);
      if (!platformActor) {
        return reply.code(401).send(failure(
          request.id,
          "ACTOR_NOT_FOUND",
          "用户不存在或已停用。",
        ));
      }
      if (!platformActor.roles.some((role) => allowedRoles.includes(role))) {
        return reply.code(403).send(failure(
          request.id,
          "AGENT_ACCESS_DENIED",
          "当前账户没有使用全局智能体的权限。",
        ));
      }
      const lease = dependencies.aiRequestLimiter.acquire(actor.userId);
      if (!lease.allowed) {
        return reply
          .header("Retry-After", String(lease.retryAfterSeconds))
          .code(429)
          .send(failure(
            request.id,
            "AI_REQUEST_LIMITED",
            "AI 学习请求较多，请稍后再试。",
            true,
          ));
      }
      const upstream = new AbortController();
      let clientGone = false;
      request.raw.on("close", () => {
        clientGone = true;
        upstream.abort();
      });

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const emit = (type: string, payload: unknown) => {
        if (!clientGone) reply.raw.write(formatSse(type, payload));
      };

      try {
        const text = await dependencies.gateway.streamReply(
          {
            requestId: `agentchat_${request.id}`,
            userId: actor.userId,
            context: body.data.context,
            message: body.data.message,
            signal: upstream.signal,
          },
          (chunk) => emit("agent.delta", { delta: chunk }),
        );
        emit("agent.done", { text });
      } catch (error) {
        if (error instanceof AgentChatError) {
          emit("agent.failed", {
            error: { code: error.code, message: error.message, retryable: error.retryable },
          });
        } else {
          emit("agent.failed", {
            error: {
              code: "AGENT_CHAT_INTERNAL_ERROR",
              message: "智能体服务处理失败，请稍后重试。",
              retryable: true,
            },
          });
        }
      } finally {
        lease.release();
        if (!clientGone) reply.raw.end();
      }
    },
  );
}
