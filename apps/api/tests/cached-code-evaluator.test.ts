import { describe, expect, it, vi } from "vitest";
import type { CodeRunResult } from "@xuetu/contracts";

import type { CodeEvaluator } from "../src/services/evaluator/code-evaluator.js";
import { CachedCodeEvaluator } from "../src/services/evaluator/cached-code-evaluator.js";

const result: CodeRunResult = {
  run_id: "sandbox_cached_001",
  task_id: "task_bfs_bug_001",
  status: "passed",
  execution_mode: "sandbox",
  evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
  degraded_reason: null,
  language: "cpp",
  detected_variant: "visited-on-enqueue",
  passed_count: 1,
  total_count: 1,
  duration_ms: 6,
  memory_kb: 1800,
  stdout: "运行完成：1/1 个用例通过。",
  stderr: null,
  error_line: null,
  trace_available: true,
  trace_variant: "visited-on-enqueue",
  test_cases: [],
};

describe("CachedCodeEvaluator", () => {
  it("reuses an identical recent run for submission", async () => {
    const evaluate = vi.fn(async () => result);
    const delegate: CodeEvaluator = {
      evaluate,
      health: vi.fn(async () => ({
        status: "sandbox" as const,
        label: result.evaluator_label,
        detail: null,
      })),
    };
    const evaluator = new CachedCodeEvaluator(delegate, { ttlMs: 30_000 });
    const request = {
      language: "cpp" as const,
      source: "// fixed source",
      custom_input: "start=7\n7 8\n7 9",
    };

    const first = await evaluator.evaluate("task_bfs_bug_001", request);
    const second = await evaluator.evaluate("task_bfs_bug_001", { ...request });

    expect(first).toBe(second);
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it("does not share results across source or custom-input changes", async () => {
    const evaluate = vi.fn(async () => ({ ...result, run_id: crypto.randomUUID() }));
    const delegate: CodeEvaluator = {
      evaluate,
      health: vi.fn(async () => ({ status: "sandbox" as const, label: "Judge0", detail: null })),
    };
    const evaluator = new CachedCodeEvaluator(delegate, { ttlMs: 30_000 });

    await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: "// source a",
      custom_input: null,
    });
    await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: "// source b",
      custom_input: null,
    });
    await evaluator.evaluate("task_bfs_bug_001", {
      language: "cpp",
      source: "// source b",
      custom_input: "start=3\n3 4",
    });

    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("removes failed evaluations so a retry can reach the sandbox", async () => {
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(result);
    const delegate: CodeEvaluator = {
      evaluate,
      health: vi.fn(async () => ({ status: "sandbox" as const, label: "Judge0", detail: null })),
    };
    const evaluator = new CachedCodeEvaluator(delegate, { ttlMs: 30_000 });
    const request = { language: "cpp" as const, source: "// fixed", custom_input: null };

    await expect(evaluator.evaluate("task_bfs_bug_001", request)).rejects.toThrow(
      "temporary outage",
    );
    await expect(evaluator.evaluate("task_bfs_bug_001", request)).resolves.toBe(result);

    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
