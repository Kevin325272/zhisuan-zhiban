export type AiWorkflowConfig =
  | {
      provider: "openai_compatible";
      timeoutMs: 20_000;
    }
  | {
      provider: "xuetu" | "dify";
      baseUrl: string;
      secret: string;
      timeoutMs: 20_000;
    };

export class AiWorkflowConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiWorkflowConfigurationError";
  }
}

function normalizedBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiWorkflowConfigurationError("AI_WORKFLOW_BASE_URL 不是有效 URL。");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const secure = url.protocol === "https:";
  const localHttp = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!secure && !localHttp) {
    throw new AiWorkflowConfigurationError(
      "AI_WORKFLOW_BASE_URL 必须使用 HTTPS，或使用本机回环 HTTP 地址。",
    );
  }
  if (url.username || url.password) {
    throw new AiWorkflowConfigurationError(
      "AI_WORKFLOW_BASE_URL 不能包含认证信息。",
    );
  }
  return url.toString().replace(/\/$/u, "");
}

export function readAiWorkflowConfig(
  environment: Record<string, string | undefined> = process.env,
): AiWorkflowConfig | null {
  const provider = (environment.AI_WORKFLOW_PROVIDER?.trim().toLowerCase() || "xuetu");
  if (provider === "openai_compatible") {
    return { provider, timeoutMs: 20_000 };
  }
  if (provider !== "xuetu" && provider !== "dify") {
    throw new AiWorkflowConfigurationError(
      "AI_WORKFLOW_PROVIDER 只能是 xuetu、dify 或 openai_compatible。",
    );
  }
  const rawBaseUrl = environment.AI_WORKFLOW_BASE_URL?.trim() ?? "";
  const secret = environment.AI_WORKFLOW_SECRET?.trim() ?? "";
  if (!rawBaseUrl && !secret) return null;
  if (!rawBaseUrl || !secret) {
    throw new AiWorkflowConfigurationError(
      "AI_WORKFLOW_BASE_URL 与 AI_WORKFLOW_SECRET 必须同时配置。",
    );
  }
  return {
    provider,
    baseUrl: normalizedBaseUrl(rawBaseUrl),
    secret,
    timeoutMs: 20_000,
  };
}
