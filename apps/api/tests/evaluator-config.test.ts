import { describe, expect, it } from "vitest";

import { readEvaluatorConfig } from "../src/config/evaluator.js";

describe("code evaluator configuration", () => {
  it("defaults to an explicit offline mock evaluator", () => {
    expect(readEvaluatorConfig({})).toMatchObject({
      mode: "mock",
      baseUrl: null,
      allowMockFallback: false,
      timeoutMs: 10_000,
      pollIntervalMs: 250,
      maxPollAttempts: 40,
      maxConcurrentRuns: 2,
      maxProcesses: 32,
    });
  });

  it("requires a base URL in Judge0 mode", () => {
    expect(() => readEvaluatorConfig({ EVALUATOR_MODE: "judge0" })).toThrow(
      "EVALUATOR_BASE_URL",
    );
  });

  it("accepts HTTPS Judge0 configuration and language overrides", () => {
    expect(
      readEvaluatorConfig({
        EVALUATOR_MODE: "judge0",
        EVALUATOR_BASE_URL: "https://judge.example/",
        EVALUATOR_AUTH_TOKEN: "private-token",
        EVALUATOR_AUTH_HEADER: "X-RapidAPI-Key",
        EVALUATOR_ALLOW_MOCK_FALLBACK: "true",
        EVALUATOR_LANGUAGE_ID_CPP: "105",
        EVALUATOR_LANGUAGE_ID_PYTHON: "100",
      }),
    ).toMatchObject({
      mode: "judge0",
      baseUrl: "https://judge.example",
      authToken: "private-token",
      authHeader: "X-RapidAPI-Key",
      allowMockFallback: true,
      languageIds: { cpp: 105, python: 100 },
    });
  });

  it("allows loopback HTTP but rejects remote cleartext and URL credentials", () => {
    expect(
      readEvaluatorConfig({
        EVALUATOR_MODE: "judge0",
        EVALUATOR_BASE_URL: "http://127.0.0.1:2358/",
      }).baseUrl,
    ).toBe("http://127.0.0.1:2358");

    expect(() =>
      readEvaluatorConfig({
        EVALUATOR_MODE: "judge0",
        EVALUATOR_BASE_URL: "http://judge.example",
      }),
    ).toThrow("HTTPS");

    expect(() =>
      readEvaluatorConfig({
        EVALUATOR_MODE: "judge0",
        EVALUATOR_BASE_URL: "https://user:pass@judge.example",
      }),
    ).toThrow("认证信息");
  });

  it("validates polling and resource bounds", () => {
    expect(() =>
      readEvaluatorConfig({
        EVALUATOR_MODE: "judge0",
        EVALUATOR_BASE_URL: "https://judge.example",
        EVALUATOR_POLL_INTERVAL_MS: "5",
      }),
    ).toThrow();

    expect(() =>
      readEvaluatorConfig({
        EVALUATOR_MODE: "judge0",
        EVALUATOR_BASE_URL: "https://judge.example",
        EVALUATOR_MEMORY_LIMIT_KB: "0",
      }),
    ).toThrow();

    expect(() =>
      readEvaluatorConfig({
        EVALUATOR_MAX_CONCURRENT_RUNS: "0",
      }),
    ).toThrow();
  });
});
