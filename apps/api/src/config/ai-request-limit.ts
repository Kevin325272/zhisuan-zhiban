import type { AiRequestLimitOptions } from "../services/ai-request-limiter.js";

const ENV_FIELDS = [
  ["AI_REQUEST_MAX_REQUESTS", "maxRequests"],
  ["AI_REQUEST_WINDOW_MS", "windowMs"],
  ["AI_REQUEST_MAX_CONCURRENT", "maxConcurrent"],
  ["AI_REQUEST_MAX_TRACKED_USERS", "maxTrackedUsers"],
] as const;

function positiveInteger(value: string, envName: string) {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${envName} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`);
  }
  return parsed;
}

export function readAiRequestLimitConfig(
  environment: Record<string, string | undefined> = process.env,
): Partial<AiRequestLimitOptions> | undefined {
  const entries = ENV_FIELDS.flatMap(([envName, optionName]) => {
    const raw = environment[envName]?.trim();
    if (!raw) return [];
    return [[optionName, positiveInteger(raw, envName)] as const];
  });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Partial<AiRequestLimitOptions>;
}
