import { describe, expect, it } from "vitest";

import { readAiRequestLimitConfig } from "../src/config/ai-request-limit.js";

describe("AI request limit configuration", () => {
  it("leaves the production defaults untouched when no overrides are set", () => {
    expect(readAiRequestLimitConfig({})).toBeUndefined();
  });

  it("parses explicit positive overrides for deterministic local runs", () => {
    expect(readAiRequestLimitConfig({
      AI_REQUEST_MAX_REQUESTS: "120",
      AI_REQUEST_WINDOW_MS: "60000",
      AI_REQUEST_MAX_CONCURRENT: "4",
      AI_REQUEST_MAX_TRACKED_USERS: "2000",
    })).toEqual({
      maxRequests: 120,
      windowMs: 60_000,
      maxConcurrent: 4,
      maxTrackedUsers: 2_000,
    });
  });

  it("rejects malformed or non-positive overrides", () => {
    expect(() => readAiRequestLimitConfig({ AI_REQUEST_MAX_REQUESTS: "0" })).toThrow(
      "AI_REQUEST_MAX_REQUESTS must be a positive integer.",
    );
    expect(() => readAiRequestLimitConfig({ AI_REQUEST_WINDOW_MS: "nope" })).toThrow(
      "AI_REQUEST_WINDOW_MS must be a positive integer.",
    );
  });
});
