import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import {
  AgentChatError,
  type AgentChatGateway,
  type AgentChatGatewayOptions,
} from "../src/services/agent-chat/agent-chat-gateway.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

function parseSseEvents(body: string) {
  return body
    .replaceAll("\r\n", "\n")
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const type = lines.find((line) => line.startsWith("event: "))?.slice(7);
      const rawData = lines.find((line) => line.startsWith("data: "))?.slice(6);
      return { type, ...(rawData ? JSON.parse(rawData) as Record<string, unknown> : {}) };
    });
}

describe("agent chat routes", () => {
  let app: FastifyInstance;
  let actorExists: boolean;
  let actorRoles: string[];
  let gatewayOptions: AgentChatGatewayOptions[];
  let gatewayBehavior: (
    options: AgentChatGatewayOptions,
    onDelta: (chunk: string) => void,
  ) => Promise<string>;

  beforeEach(async () => {
    actorExists = true;
    actorRoles = ["student"];
    gatewayOptions = [];
    gatewayBehavior = async (_options, onDelta) => {
      onDelta("第一段回复。");
      onDelta("第二段回复。");
      return "第一段回复。第二段回复。";
    };
    const platformAccess: PlatformAccessService = {
      async getActor(userId) {
        if (!actorExists) return null;
        return {
          user: {
            user_id: userId,
            display_name: "本地演示学生",
            account_status: "active",
            auth_source: "local_development",
            created_at: "2026-07-28T00:00:00.000Z",
            updated_at: "2026-07-28T00:00:00.000Z",
          },
          roles: actorRoles as never[],
        };
      },
      async isCourseAssigned() {
        return true;
      },
    };
    const gateway: AgentChatGateway = {
      streamReply(options, onDelta) {
        gatewayOptions.push(options);
        return gatewayBehavior(options, onDelta);
      },
    };
    app = buildApp({
      answerModel: null,
      platformAccess,
      agentChatGateway: gateway,
      allowLocalDevAuth: true,
    });
  });

  afterEach(async () => app.close());

  async function invoke(payload: unknown, withIdentity = true) {
    return app.inject({
      method: "POST",
      url: "/api/v1/agent/chat",
      ...(withIdentity
        ? { headers: { "x-dev-user-id": "user_student_001" } }
        : {}),
      payload: payload as never,
    });
  }

  it("requires a local identity before answering", async () => {
    const anonymous = await invoke({ message: "你好", context: "study" }, false);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("AUTHENTICATION_REQUIRED");

    actorExists = false;
    const missing = await invoke({ message: "你好", context: "study" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("ACTOR_NOT_FOUND");
  });

  it("rejects accounts without a student or teacher role", async () => {
    actorRoles = ["admin"];
    const response = await invoke({ message: "你好", context: "study" });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AGENT_ACCESS_DENIED");
    expect(gatewayOptions).toHaveLength(0);
  });

  it("validates the request body", async () => {
    const empty = await invoke({ message: "   ", context: "study" });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("AGENT_CHAT_REQUEST_INVALID");

    const badContext = await invoke({ message: "你好", context: "unknown" });
    expect(badContext.statusCode).toBe(400);
  });

  it("responds 503 when no gateway is configured", async () => {
    await app.close();
    app = buildApp({ answerModel: null, platformAccess: null, allowLocalDevAuth: true });

    const response = await invoke({ message: "你好", context: "study" });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("AGENT_CHAT_NOT_CONFIGURED");
  });

  it("streams gateway deltas and the final text as SSE", async () => {
    const response = await invoke({ message: "TCP 三次握手为什么是三次？", context: "study" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    const events = parseSseEvents(response.body);
    expect(events).toEqual([
      { type: "agent.delta", delta: "第一段回复。" },
      { type: "agent.delta", delta: "第二段回复。" },
      { type: "agent.done", text: "第一段回复。第二段回复。" },
    ]);
    expect(gatewayOptions).toHaveLength(1);
    expect(gatewayOptions[0]).toMatchObject({
      userId: "user_student_001",
      context: "study",
      message: "TCP 三次握手为什么是三次？",
    });
  });

  it("defaults the context to study and reports gateway failures as agent.failed", async () => {
    gatewayBehavior = async () => {
      throw new AgentChatError("UPSTREAM_REJECTED", "工作流拒绝了请求。", false);
    };
    const response = await invoke({ message: "你好" });

    expect(response.statusCode).toBe(200);
    const events = parseSseEvents(response.body);
    expect(events).toEqual([{
      type: "agent.failed",
      error: { code: "UPSTREAM_REJECTED", message: "工作流拒绝了请求。", retryable: false },
    }]);
    expect(gatewayOptions[0]?.context).toBe("study");
  });

  it("masks unexpected gateway errors as a retryable internal failure", async () => {
    gatewayBehavior = async () => {
      throw new Error("unexpected");
    };
    const response = await invoke({ message: "你好", context: "lab" });

    const events = parseSseEvents(response.body);
    expect(events).toEqual([{
      type: "agent.failed",
      error: {
        code: "AGENT_CHAT_INTERNAL_ERROR",
        message: "智能体服务处理失败，请稍后重试。",
        retryable: true,
      },
    }]);
  });
});
