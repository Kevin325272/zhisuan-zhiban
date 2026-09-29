import { describe, expect, it, vi } from "vitest";
import type { CodeRunRequest, CodeRunResult } from "@xuetu/contracts";

import type { CodeEvaluator } from "../src/services/evaluator/code-evaluator.js";
import { LimitedCodeEvaluator } from "../src/services/evaluator/limited-code-evaluator.js";

const request: CodeRunRequest = {
  language: "cpp",
  source: "// fixed",
  custom_input: null,
};

const result = {
  run_id: "limited_run",
  task_id: "task_bfs_bug_001",
  status: "passed",
} as CodeRunResult;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("LimitedCodeEvaluator", () => {
  it("rejects excess distinct runs and releases slots after completion", async () => {
    const first = deferred<CodeRunResult>();
    const second = deferred<CodeRunResult>();
    const evaluate = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(result);
    const delegate: CodeEvaluator = {
      evaluate,
      health: vi.fn(async () => ({ status: "sandbox" as const, label: "Judge0", detail: null })),
    };
    const evaluator = new LimitedCodeEvaluator(delegate, 2);

    const runningFirst = evaluator.evaluate("task_bfs_bug_001", request);
    const runningSecond = evaluator.evaluate("task_bfs_bug_001", {
      ...request,
      source: "// another source",
    });
    await expect(
      evaluator.evaluate("task_bfs_bug_001", { ...request, source: "// third source" }),
    ).rejects.toMatchObject({
      code: "EVALUATOR_BUSY",
      statusCode: 429,
      retryable: true,
    });

    first.resolve(result);
    second.resolve(result);
    await Promise.all([runningFirst, runningSecond]);
    await expect(
      evaluator.evaluate("task_bfs_bug_001", { ...request, source: "// retry source" }),
    ).resolves.toBe(result);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });
});
