import { describe, expect, it, vi } from "vitest";

import type { EvaluatorConfig } from "../src/config/evaluator.js";
import {
  Judge0Client,
  type Judge0ExecutionRequest,
} from "../src/services/evaluator/judge0-client.js";

const config: EvaluatorConfig = {
  mode: "judge0",
  baseUrl: "https://judge.example",
  authToken: "secret-token",
  authHeader: "X-Auth-Token",
  timeoutMs: 10_000,
  pollIntervalMs: 1,
  maxPollAttempts: 3,
  maxConcurrentRuns: 2,
  allowMockFallback: false,
  languageIds: {},
  cpuTimeLimitSeconds: 2,
  wallTimeLimitSeconds: 5,
  memoryLimitKb: 131_072,
  maxProcesses: 16,
  maxFileSizeKb: 1_024,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Judge0 client", () => {
  it("submits resource-limited code and polls until a terminal status", async () => {
    const responses = [
      jsonResponse({ token: "submission-token" }, 201),
      jsonResponse({
        token: "submission-token",
        status: { id: 2, description: "Processing" },
        stdout: null,
        stderr: null,
        compile_output: null,
        message: null,
        time: null,
        memory: null,
      }),
      jsonResponse({
        token: "submission-token",
        status: { id: 3, description: "Accepted" },
        stdout: "1 2 3 4\n",
        stderr: null,
        compile_output: null,
        message: null,
        time: "0.008",
        memory: 1832,
      }),
    ];
    const fetchMock = vi.fn<typeof fetch>(async () => responses.shift()!);
    const sleep = vi.fn(async () => undefined);
    const client = new Judge0Client(config, {
      fetch: fetchMock,
      sleep,
    });

    const request: Judge0ExecutionRequest & { compilerOptions: string } = {
      sourceCode: "int main() {}",
      languageId: 105,
      compilerOptions: "--target ES2015 --lib ES2015,DOM",
    };
    const result = await client.execute(request);

    expect(result.status).toEqual({ id: 3, description: "Accepted" });
    expect(result.stdout).toBe("1 2 3 4\n");
    expect(sleep).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://judge.example/submissions?base64_encoded=false&wait=false",
    );
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Auth-Token": "secret-token",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      language_id: 105,
      source_code: "int main() {}",
      cpu_time_limit: 2,
      wall_time_limit: 5,
      memory_limit: 131_072,
      max_processes_and_or_threads: 16,
      max_file_size: 1_024,
      enable_network: false,
      compiler_options: "--target ES2015 --lib ES2015,DOM",
    });
  });

  it("lists runtimes with server-side authentication", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse([{ id: 105, name: "C++ (GCC 14.1.0)" }]),
    );
    const client = new Judge0Client(config, {
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    await expect(client.listLanguages()).resolves.toEqual([
      { id: 105, name: "C++ (GCC 14.1.0)" },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://judge.example/languages");
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({
      "X-Auth-Token": "secret-token",
    });
  });

  it("stops polling and returns a safe retryable timeout error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: "private-submission-token" }, 201))
      .mockImplementation(async () =>
        jsonResponse({
          token: "private-submission-token",
          status: { id: 2, description: "Processing" },
          stdout: null,
          stderr: null,
          compile_output: null,
          message: null,
          time: null,
          memory: null,
        }),
      );
    const client = new Judge0Client(
      { ...config, maxPollAttempts: 2 },
      { fetch: fetchMock, sleep: async () => undefined },
    );

    const promise = client.execute({ sourceCode: "code", languageId: 105 });
    await expect(promise).rejects.toMatchObject({
      code: "EVALUATOR_POLL_TIMEOUT",
      retryable: true,
      category: "infrastructure",
    });
    await expect(promise).rejects.not.toThrow(
      "private-submission-token",
    );
  });

  it("does not leak the auth token through upstream HTTP errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "upstream detail" }, 503),
    );
    const client = new Judge0Client(config, {
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    const promise = client.listLanguages();
    await expect(promise).rejects.toMatchObject({
      code: "EVALUATOR_UPSTREAM_ERROR",
      retryable: true,
    });
    await expect(promise).rejects.not.toThrow("secret-token");
  });
});
