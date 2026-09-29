export type AgentChatConfig = {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
};

export class AgentChatConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentChatConfigurationError";
  }
}

function normalizedBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentChatConfigurationError("XUETU_AGENT_CHAT_BASE_URL 不是有效 URL。");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const secure = url.protocol === "https:";
  const localHttp = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!secure && !localHttp) {
    throw new AgentChatConfigurationError(
      "XUETU_AGENT_CHAT_BASE_URL 必须使用 HTTPS，或使用本机回环 HTTP 地址。",
    );
  }
  if (url.username || url.password) {
    throw new AgentChatConfigurationError(
      "XUETU_AGENT_CHAT_BASE_URL 不能包含认证信息。",
    );
  }
  return url.toString().replace(/\/$/u, "");
}

/**
 * 全局浮窗 Agent 的真实工作流接入配置（计算机考研智能体）。
 * 未配置时返回 null，路由以 503 响应、前端退回本地演示回复。
 */
export function readAgentChatConfig(
  environment: Record<string, string | undefined> = process.env,
): AgentChatConfig | null {
  const rawBaseUrl = environment.XUETU_AGENT_CHAT_BASE_URL?.trim() ?? "";
  const secret = environment.XUETU_AGENT_CHAT_SECRET?.trim() ?? "";
  if (!rawBaseUrl && !secret) return null;
  if (!rawBaseUrl || !secret) {
    throw new AgentChatConfigurationError(
      "XUETU_AGENT_CHAT_BASE_URL 与 XUETU_AGENT_CHAT_SECRET 必须同时配置。",
    );
  }
  return {
    baseUrl: normalizedBaseUrl(rawBaseUrl),
    secret,
    // 工作流型应用无流式 token 输出，等待完整结果的时间窗比普通问答更长。
    timeoutMs: 60_000,
  };
}
