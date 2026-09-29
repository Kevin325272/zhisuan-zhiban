import { describe, expect, it } from "vitest";

import {
  AgentChatConfigurationError,
  readAgentChatConfig,
} from "../src/config/agent-chat.js";

describe("readAgentChatConfig", () => {
  it("returns null when neither endpoint nor secret is configured", () => {
    expect(readAgentChatConfig({})).toBeNull();
    expect(readAgentChatConfig({
      XUETU_AGENT_CHAT_BASE_URL: "  ",
      XUETU_AGENT_CHAT_SECRET: "",
    })).toBeNull();
  });

  it("requires both endpoint and secret together", () => {
    expect(() => readAgentChatConfig({
      XUETU_AGENT_CHAT_BASE_URL: "https://api.dify.ai/v1/workflows/run",
    })).toThrow(AgentChatConfigurationError);
    expect(() => readAgentChatConfig({
      XUETU_AGENT_CHAT_SECRET: "app-secret",
    })).toThrow(AgentChatConfigurationError);
  });

  it("accepts a full HTTPS workflow endpoint and strips the trailing slash", () => {
    const config = readAgentChatConfig({
      XUETU_AGENT_CHAT_BASE_URL: "https://api.dify.ai/v1/workflows/run/",
      XUETU_AGENT_CHAT_SECRET: "app-secret",
    });
    expect(config).toEqual({
      baseUrl: "https://api.dify.ai/v1/workflows/run",
      secret: "app-secret",
      timeoutMs: 60_000,
    });
  });

  it("accepts loopback HTTP but rejects other HTTP endpoints", () => {
    expect(readAgentChatConfig({
      XUETU_AGENT_CHAT_BASE_URL: "http://127.0.0.1:8080/v1/workflows/run",
      XUETU_AGENT_CHAT_SECRET: "app-secret",
    })).not.toBeNull();
    expect(() => readAgentChatConfig({
      XUETU_AGENT_CHAT_BASE_URL: "http://upstream.example.test/v1/workflows/run",
      XUETU_AGENT_CHAT_SECRET: "app-secret",
    })).toThrow(AgentChatConfigurationError);
  });

  it("rejects malformed URLs and endpoints with embedded credentials", () => {
    expect(() => readAgentChatConfig({
      XUETU_AGENT_CHAT_BASE_URL: "not-a-url",
      XUETU_AGENT_CHAT_SECRET: "app-secret",
    })).toThrow(AgentChatConfigurationError);
    expect(() => readAgentChatConfig({
      XUETU_AGENT_CHAT_BASE_URL: "https://user:pass@api.dify.ai/v1/workflows/run",
      XUETU_AGENT_CHAT_SECRET: "app-secret",
    })).toThrow(AgentChatConfigurationError);
  });
});
