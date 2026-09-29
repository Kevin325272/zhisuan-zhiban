import { z } from "zod";

export interface LlmRequestOptions {
  apiFormat?: "responses" | "chat_completions";
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "max";
  maxOutputTokens?: number;
}

export interface LlmConfig extends LlmRequestOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

const environmentSchema = z.object({
  LLM_BASE_URL: z.string().trim().min(1).default("http://127.0.0.1:8317/v1"),
  LLM_API_KEY: z.string().trim().min(1),
  LLM_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  LLM_API_FORMAT: z.enum(["responses", "chat_completions"]).optional(),
  LLM_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high", "max"]).optional(),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(32_768).optional(),
});

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const isSecure = url.protocol === "https:";
  const isLoopbackHttp = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!isSecure && !isLoopbackHttp) {
    throw new Error("LLM_BASE_URL 必须使用 HTTPS，或使用本机回环 HTTP 地址。");
  }
  if (url.username || url.password) {
    throw new Error("LLM_BASE_URL 不能包含认证信息。");
  }
  return url.toString().replace(/\/$/u, "");
}

export function readLlmConfig(
  environment: Record<string, string | undefined> = process.env,
): LlmConfig | null {
  if (!environment.LLM_API_KEY?.trim()) return null;
  const parsed = environmentSchema.parse(environment);
  return {
    baseUrl: normalizeBaseUrl(parsed.LLM_BASE_URL),
    apiKey: parsed.LLM_API_KEY,
    model: parsed.LLM_MODEL,
    timeoutMs: parsed.LLM_TIMEOUT_MS,
    ...(parsed.LLM_API_FORMAT ? { apiFormat: parsed.LLM_API_FORMAT } : {}),
    ...(parsed.LLM_REASONING_EFFORT ? { reasoningEffort: parsed.LLM_REASONING_EFFORT } : {}),
    ...(parsed.LLM_MAX_OUTPUT_TOKENS ? { maxOutputTokens: parsed.LLM_MAX_OUTPUT_TOKENS } : {}),
  };
}
