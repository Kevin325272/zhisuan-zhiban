import type { ProgrammingLanguage } from "@xuetu/contracts";
import { z } from "zod";

export type EvaluatorMode = "mock" | "judge0";

export interface EvaluatorConfig {
  mode: EvaluatorMode;
  baseUrl: string | null;
  authToken: string | null;
  authHeader: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxPollAttempts: number;
  maxConcurrentRuns: number;
  allowMockFallback: boolean;
  languageIds: Partial<Record<ProgrammingLanguage, number>>;
  cpuTimeLimitSeconds: number;
  wallTimeLimitSeconds: number;
  memoryLimitKb: number;
  maxProcesses: number;
  maxFileSizeKb: number;
}

const environmentSchema = z.object({
  EVALUATOR_MODE: z.enum(["mock", "judge0"]).default("mock"),
  EVALUATOR_BASE_URL: z.string().trim().optional(),
  EVALUATOR_AUTH_TOKEN: z.string().trim().optional(),
  EVALUATOR_AUTH_HEADER: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]+$/u)
    .default("X-Auth-Token"),
  EVALUATOR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  EVALUATOR_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(5_000).default(250),
  EVALUATOR_MAX_POLL_ATTEMPTS: z.coerce.number().int().min(1).max(500).default(40),
  EVALUATOR_MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(20).default(2),
  EVALUATOR_CPU_TIME_LIMIT_SECONDS: z.coerce.number().min(0.1).max(10).default(2),
  EVALUATOR_WALL_TIME_LIMIT_SECONDS: z.coerce.number().min(0.2).max(30).default(5),
  EVALUATOR_MEMORY_LIMIT_KB: z.coerce.number().int().min(16_384).max(1_048_576).default(131_072),
  EVALUATOR_MAX_PROCESSES: z.coerce.number().int().min(1).max(64).default(32),
  EVALUATOR_MAX_FILE_SIZE_KB: z.coerce.number().int().min(64).max(65_536).default(1_024),
  EVALUATOR_LANGUAGE_ID_C: optionalPositiveInteger(),
  EVALUATOR_LANGUAGE_ID_CPP: optionalPositiveInteger(),
  EVALUATOR_LANGUAGE_ID_JAVA: optionalPositiveInteger(),
  EVALUATOR_LANGUAGE_ID_PYTHON: optionalPositiveInteger(),
  EVALUATOR_LANGUAGE_ID_JAVASCRIPT: optionalPositiveInteger(),
  EVALUATOR_LANGUAGE_ID_TYPESCRIPT: optionalPositiveInteger(),
  EVALUATOR_LANGUAGE_ID_GO: optionalPositiveInteger(),
  EVALUATOR_LANGUAGE_ID_RUST: optionalPositiveInteger(),
});

function optionalPositiveInteger() {
  return z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : value),
    z.coerce.number().int().positive().optional(),
  );
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error("EVALUATOR_ALLOW_MOCK_FALLBACK 必须是 true 或 false。");
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const isSecure = url.protocol === "https:";
  const isLoopbackHttp = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!isSecure && !isLoopbackHttp) {
    throw new Error("EVALUATOR_BASE_URL 必须使用 HTTPS，或使用本机回环 HTTP 地址。");
  }
  if (url.username || url.password) {
    throw new Error("EVALUATOR_BASE_URL 不能包含认证信息。");
  }
  return url.toString().replace(/\/$/u, "");
}

export function readEvaluatorConfig(
  environment: Record<string, string | undefined> = process.env,
): EvaluatorConfig {
  const parsed = environmentSchema.parse(environment);
  const baseUrl = parsed.EVALUATOR_BASE_URL?.trim()
    ? normalizeBaseUrl(parsed.EVALUATOR_BASE_URL)
    : null;
  if (parsed.EVALUATOR_MODE === "judge0" && !baseUrl) {
    throw new Error("EVALUATOR_MODE=judge0 时必须配置 EVALUATOR_BASE_URL。");
  }

  const languageIds: Partial<Record<ProgrammingLanguage, number>> = {};
  const overrides = [
    ["c", parsed.EVALUATOR_LANGUAGE_ID_C],
    ["cpp", parsed.EVALUATOR_LANGUAGE_ID_CPP],
    ["java", parsed.EVALUATOR_LANGUAGE_ID_JAVA],
    ["python", parsed.EVALUATOR_LANGUAGE_ID_PYTHON],
    ["javascript", parsed.EVALUATOR_LANGUAGE_ID_JAVASCRIPT],
    ["typescript", parsed.EVALUATOR_LANGUAGE_ID_TYPESCRIPT],
    ["go", parsed.EVALUATOR_LANGUAGE_ID_GO],
    ["rust", parsed.EVALUATOR_LANGUAGE_ID_RUST],
  ] as const;
  for (const [language, id] of overrides) {
    if (id !== undefined) languageIds[language] = id;
  }

  return {
    mode: parsed.EVALUATOR_MODE,
    baseUrl,
    authToken: parsed.EVALUATOR_AUTH_TOKEN?.trim() || null,
    authHeader: parsed.EVALUATOR_AUTH_HEADER,
    timeoutMs: parsed.EVALUATOR_TIMEOUT_MS,
    pollIntervalMs: parsed.EVALUATOR_POLL_INTERVAL_MS,
    maxPollAttempts: parsed.EVALUATOR_MAX_POLL_ATTEMPTS,
    maxConcurrentRuns: parsed.EVALUATOR_MAX_CONCURRENT_RUNS,
    allowMockFallback: parseBoolean(
      environment.EVALUATOR_ALLOW_MOCK_FALLBACK,
      false,
    ),
    languageIds,
    cpuTimeLimitSeconds: parsed.EVALUATOR_CPU_TIME_LIMIT_SECONDS,
    wallTimeLimitSeconds: parsed.EVALUATOR_WALL_TIME_LIMIT_SECONDS,
    memoryLimitKb: parsed.EVALUATOR_MEMORY_LIMIT_KB,
    maxProcesses: parsed.EVALUATOR_MAX_PROCESSES,
    maxFileSizeKb: parsed.EVALUATOR_MAX_FILE_SIZE_KB,
  };
}
