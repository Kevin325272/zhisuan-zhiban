import { describe, expect, it, vi } from "vitest";

import { getProgrammingLanguageDefinition } from "../src/domain/programming-languages.js";
import { CodeEvaluatorError } from "../src/services/evaluator/code-evaluator.js";
import { Judge0CodeEvaluator } from "../src/services/evaluator/judge0-evaluator.js";
import type {
  Judge0ExecutionRequest,
  Judge0SubmissionResult,
} from "../src/services/evaluator/judge0-client.js";
import { MockBfsCodeEvaluator } from "../src/services/evaluator/mock-bfs-evaluator.js";

const fixedCpp = getProgrammingLanguageDefinition("cpp").fixed_code;
const wrongCpp = getProgrammingLanguageDefinition("cpp").starter_code;

function terminal(
  statusId: number,
  description: string,
  overrides: Partial<Judge0SubmissionResult> = {},
): Judge0SubmissionResult {
  return {
    status: { id: statusId, description },
    stdout: null,
    stderr: null,
    compile_output: null,
    message: null,
    time: null,
    memory: null,
    ...overrides,
  };
}

function createEvaluator(
  results: Array<Judge0SubmissionResult | Error>,
  options: { allowMockFallback?: boolean } = {},
) {
  const execute = vi.fn<
    (request: Judge0ExecutionRequest) => Promise<Judge0SubmissionResult>
  >(async () => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("Missing fake Judge0 result.");
    return next;
  });
  const resolve = vi.fn(async () => ({ id: 105, name: "C++ (GCC 14.1.0)" }));
  return {
    evaluator: new Judge0CodeEvaluator({
      client: { execute },
      resolver: { resolve },
      allowMockFallback: options.allowMockFallback ?? false,
      fallback: new MockBfsCodeEvaluator(),
    }),
    execute,
    resolve,
  };
}

describe("Judge0 BFS evaluator", () => {
  it("runs every built-in case separately and aggregates real metrics", async () => {
    const { evaluator, execute } = createEvaluator([
      terminal(3, "Accepted", { stdout: "1 2 3 4 5\n", time: "0.003", memory: 1800 }),
      terminal(3, "Accepted", { stdout: "1 2 3 4\n", time: "0.004", memory: 1840 }),
      terminal(3, "Accepted", { stdout: "1 2 3 4 5\n", time: "0.002", memory: 1760 }),
      terminal(3, "Accepted", { stdout: "1 2 3 4 5\n", time: "0.005", memory: 1900 }),
    ]);

    const result = await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: fixedCpp,
      custom_input: null,
    });

    expect(result).toMatchObject({
      status: "passed",
      execution_mode: "sandbox",
      evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
      passed_count: 4,
      total_count: 4,
      duration_ms: 14,
      memory_kb: 1900,
      degraded_reason: null,
    });
    expect(result.test_cases.map((item) => item.duration_ms)).toEqual([3, 4, 2, 5]);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls[0]![0].sourceCode).toContain("int main()");
  });

  it("compares stdout itself and exposes the two duplicate-enqueue failures", async () => {
    const { evaluator } = createEvaluator([
      terminal(3, "Accepted", { stdout: "1 2 3 4 5\n", time: "0.001", memory: 1700 }),
      terminal(3, "Accepted", { stdout: "1 2 3 4 4\n", time: "0.001", memory: 1700 }),
      terminal(3, "Accepted", { stdout: "1 2 3 4 5\n", time: "0.001", memory: 1700 }),
      terminal(3, "Accepted", { stdout: "1 2 3 4 5 4 5\n", time: "0.001", memory: 1700 }),
    ]);

    const result = await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: wrongCpp,
      custom_input: null,
    });

    expect(result).toMatchObject({
      status: "failed",
      detected_variant: "visited-on-dequeue",
      passed_count: 2,
      total_count: 4,
    });
    expect(result.test_cases.filter((item) => item.status === "failed").map((item) => item.test_case_id))
      .toEqual(["case_diamond", "case_multi_merge"]);
  });

  it("short-circuits a compilation error without fabricating case metrics", async () => {
    const { evaluator, execute } = createEvaluator([
      terminal(6, "Compilation Error", {
        compile_output: "Main.cpp:19:3: error: expected ';'",
      }),
    ]);

    const result = await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: "vector<int> bfs( {",
      custom_input: null,
    });

    expect(result).toMatchObject({
      status: "compile_error",
      execution_mode: "sandbox",
      passed_count: 0,
      total_count: 0,
      duration_ms: null,
      memory_kb: null,
      error_line: 19,
      test_cases: [],
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps runtime and timeout failures as objective student-code results", async () => {
    const { evaluator } = createEvaluator([
      terminal(7, "Runtime Error (SIGSEGV)", { stderr: "Segmentation fault" }),
      terminal(5, "Time Limit Exceeded", { time: "5.001", memory: 2048 }),
      terminal(3, "Accepted", { stdout: "1 2 3 4 5\n", time: "0.002", memory: 1700 }),
      terminal(3, "Accepted", { stdout: "1 2 3 4 5\n", time: "0.002", memory: 1700 }),
    ]);

    const result = await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: fixedCpp,
      custom_input: null,
    });

    expect(result.execution_mode).toBe("sandbox");
    expect(result.status).toBe("runtime_error");
    expect(result.test_cases.map((item) => item.status)).toEqual([
      "runtime_error",
      "time_limit_exceeded",
      "passed",
      "passed",
    ]);
  });

  it("adds a fifth real submission for a custom graph", async () => {
    const { evaluator, execute } = createEvaluator(
      Array.from({ length: 5 }, () =>
        terminal(3, "Accepted", { stdout: "7 8 9\n", time: "0.001", memory: 1600 }),
      ),
    );

    const result = await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: fixedCpp,
      custom_input: "start=7\n7 8\n7 9\n8 9",
    });

    expect(result.total_count).toBe(5);
    expect(result.test_cases.at(-1)?.test_case_id).toBe("case_custom");
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("uses an explicitly labelled fallback only for infrastructure failures", async () => {
    const infrastructureError = new CodeEvaluatorError(
      "隔离沙箱暂时不可用。",
      "EVALUATOR_NETWORK_ERROR",
      503,
      true,
      "infrastructure",
    );
    const { evaluator } = createEvaluator([infrastructureError], {
      allowMockFallback: true,
    });

    const result = await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: wrongCpp,
      custom_input: null,
    });

    expect(result).toMatchObject({
      execution_mode: "mock_fallback",
      evaluator_label: "演示降级评测",
      degraded_reason: "隔离沙箱暂时不可用。",
      passed_count: 2,
    });
    await expect(evaluator.health()).resolves.toMatchObject({ status: "degraded_mock" });
  });

  it("does not hide infrastructure failure when fallback is disabled", async () => {
    const error = new CodeEvaluatorError(
      "隔离沙箱暂时不可用。",
      "EVALUATOR_NETWORK_ERROR",
      503,
      true,
      "infrastructure",
    );
    const { evaluator } = createEvaluator([error]);

    await expect(
      evaluator.evaluate("task_bfs_bug_001", {
        language: "cpp",
        source: fixedCpp,
        custom_input: null,
      }),
    ).rejects.toBe(error);
  });

  it("requests a modern standard library when evaluating TypeScript", async () => {
    const { evaluator, execute } = createEvaluator([
      terminal(6, "Compilation Error", { compile_output: "fixture" }),
    ]);

    await evaluator.evaluate("task_bfs_bug_001", {
      language: "typescript",
      source: "function bfs() { return new Map<number, number>(); }",
      custom_input: null,
    });

    expect(execute.mock.calls[0]![0]).toHaveProperty(
      "compilerOptions",
      "--target ES2015 --lib ES2015,DOM",
    );
  });
});
