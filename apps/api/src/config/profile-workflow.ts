export interface ProfileWorkflowConfig {
  baseUrl: string;
  secret: string;
  timeoutMs: 20_000;
}

export class ProfileWorkflowConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileWorkflowConfigurationError";
  }
}

function normalizeBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProfileWorkflowConfigurationError("AI_PROFILE_WORKFLOW_BASE_URL 不是有效 URL。");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const secure = url.protocol === "https:";
  const localHttp = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!secure && !localHttp) {
    throw new ProfileWorkflowConfigurationError(
      "AI_PROFILE_WORKFLOW_BASE_URL 必须使用 HTTPS，或使用本机回环 HTTP 地址。",
    );
  }
  if (url.username || url.password) {
    throw new ProfileWorkflowConfigurationError(
      "AI_PROFILE_WORKFLOW_BASE_URL 不能包含认证信息。",
    );
  }
  return url.toString().replace(/\/$/u, "");
}

export function readProfileWorkflowConfig(
  environment: Record<string, string | undefined> = process.env,
): ProfileWorkflowConfig | null {
  const rawBaseUrl = environment.AI_PROFILE_WORKFLOW_BASE_URL?.trim() ?? "";
  const secret = environment.AI_PROFILE_WORKFLOW_SECRET?.trim() ?? "";
  if (!rawBaseUrl && !secret) return null;
  if (!rawBaseUrl || !secret) {
    throw new ProfileWorkflowConfigurationError(
      "AI_PROFILE_WORKFLOW_BASE_URL 与 AI_PROFILE_WORKFLOW_SECRET 必须同时配置。",
    );
  }
  return {
    baseUrl: normalizeBaseUrl(rawBaseUrl),
    secret,
    timeoutMs: 20_000,
  };
}
