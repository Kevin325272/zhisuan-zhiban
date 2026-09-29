import { describe, expect, it } from "vitest";

import type { CodeRunResult } from "@xuetu/contracts";

import {
  DATA_STRUCTURES_BFS_EXPERIMENT_ID,
  diagnoseProgrammingExperiment,
  getProgrammingExperimentDefinition,
} from "../src/services/programming-experiments/programming-experiment.js";

const baseResult: CodeRunResult = {
  run_id: "sandbox_run_001",
  task_id: "task_bfs_bug_001",
  status: "failed",
  execution_mode: "sandbox",
  evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
  degraded_reason: null,
  language: "cpp",
  detected_variant: "visited-on-dequeue",
  passed_count: 2,
  total_count: 4,
  duration_ms: 18,
  memory_kb: 3_456,
  stdout: "运行完成：2/4 个用例通过。",
  stderr: "visited 标记发生在出队后。",
  error_line: 15,
  trace_available: true,
  trace_variant: "visited-on-dequeue",
  test_cases: [
    {
      test_case_id: "case_diamond",
      label: "菱形汇聚图",
      status: "failed",
      judge_status: "failed",
      input: "start=1\n1 2\n1 3\n2 4\n3 4",
      expected_output: "1 2 3 4",
      actual_output: "1 2 3 4 4",
      summary: "期望 1 2 3 4，实际得到 1 2 3 4 4。",
      duration_ms: 4,
      memory_kb: 3_456,
      stdout: "1 2 3 4 4\n",
      stderr: null,
    },
  ],
};

describe("data-structures programming experiment", () => {
  it("publishes one source-constrained BFS experiment without a solved template", () => {
    const definition = getProgrammingExperimentDefinition(DATA_STRUCTURES_BFS_EXPERIMENT_ID);
    expect(definition).toMatchObject({
      experiment_id: "ds-bfs-visited-v1",
      course_id: "course_408_ds",
      concept_id: "ds_c06_03",
      language: "cpp",
    });
    expect(definition?.starter_code).toContain("pending.push(start)");
    expect(definition?.starter_code).not.toContain("visited[start] = true");
    expect(getProgrammingExperimentDefinition("unknown")).toBeNull();
  });

  it("grounds a failed diagnosis in the actual failed case and source line", () => {
    expect(diagnoseProgrammingExperiment(baseResult)).toEqual({
      status: "needs_revision",
      title: "重复入队仍未解决",
      summary: "汇聚路径中同一顶点被重复加入队列；当前客观结果为 2/4 个用例通过。",
      evidence: [
        "菱形汇聚图：期望 1 2 3 4，实际得到 1 2 3 4 4。",
        "评测定位到源码第 15 行附近。",
      ],
      correction_goal: "检查发现相邻顶点、标记 visited 与加入队列三者的先后顺序，再重新运行。",
      next_action: "retry",
    });
  });

  it("does not claim mastery for compile or infrastructure failures", () => {
    expect(diagnoseProgrammingExperiment({
      ...baseResult,
      status: "compile_error",
      detected_variant: null,
      passed_count: 0,
      total_count: 0,
      stderr: "第 12 行：缺少右分隔符。",
      error_line: 12,
      trace_available: false,
      trace_variant: null,
      test_cases: [],
    })).toMatchObject({
      status: "compile_error",
      title: "先修复编译错误",
      next_action: "retry",
    });

    expect(diagnoseProgrammingExperiment({
      ...baseResult,
      status: "time_limit_exceeded",
      detected_variant: null,
      passed_count: 0,
      stderr: "程序运行超过时间限制。",
      error_line: null,
      trace_available: false,
      trace_variant: null,
      test_cases: [],
    })).toMatchObject({
      status: "execution_error",
      next_action: "retry",
    });
  });

  it("marks all sandbox cases passing as a completed experiment", () => {
    expect(diagnoseProgrammingExperiment({
      ...baseResult,
      status: "passed",
      detected_variant: "visited-on-enqueue",
      passed_count: 4,
      total_count: 4,
      stderr: null,
      error_line: null,
      test_cases: baseResult.test_cases.map((testCase) => ({
        ...testCase,
        status: "passed" as const,
        judge_status: "passed" as const,
        actual_output: testCase.expected_output,
        summary: "访问顺序正确，未发现重复入队。",
      })),
    })).toEqual({
      status: "passed",
      title: "实验通过",
      summary: "4/4 个固定用例全部通过，当前实现满足本实验的客观通过标准。",
      evidence: ["菱形汇聚图：访问顺序正确，未发现重复入队。"],
      correction_goal: "返回关联知识点总结 visited 标记时机，再继续课程训练。",
      next_action: "review_concept",
    });
  });
});
