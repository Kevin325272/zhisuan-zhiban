import { describe, expect, it } from "vitest";

import {
  programmingExperimentAttemptRecordSchema,
  programmingExperimentAttemptSubmitSchema,
  programmingExperimentCatalogSchema,
  programmingExperimentDefinitionSchema,
  programmingExperimentHistorySchema,
} from "../src/index.js";

const sandboxResult = {
  run_id: "sandbox_run_001",
  task_id: "task_bfs_bug_001",
  status: "failed" as const,
  execution_mode: "sandbox" as const,
  evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
  degraded_reason: null,
  language: "cpp" as const,
  detected_variant: "visited-on-dequeue" as const,
  passed_count: 2,
  total_count: 4,
  duration_ms: 18,
  memory_kb: 3_456,
  stdout: "运行完成：2/4 个用例通过。",
  stderr: "visited 标记发生在出队后。",
  error_line: 15,
  trace_available: true,
  trace_variant: "visited-on-dequeue" as const,
  test_cases: [],
};

describe("programming experiment contracts", () => {
  it("accepts the source-constrained BFS experiment definition", () => {
    expect(programmingExperimentDefinitionSchema.parse({
      experiment_id: "ds-bfs-visited-v1",
      course_id: "course_408_ds",
      course_slug: "data-structures",
      concept_id: "ds_c06_03",
      task_id: "task_bfs_bug_001",
      title: "修复 BFS 重复入队问题",
      subtitle: "广度优先搜索 · visited 标记时机",
      learning_objective: "理解发现顶点时标记 visited 的必要性。",
      prompt: "修复代码，使每个顶点只入队一次。",
      requirements: ["保持广度优先访问顺序", "每个顶点最多入队一次"],
      success_criteria: ["4 个固定用例全部通过"],
      language: "cpp",
      starter_code: "vector<int> bfs() { return {}; }",
      data_boundary: "Judge0 隔离评测；确定性规则生成学习提示。",
    })).toMatchObject({
      experiment_id: "ds-bfs-visited-v1",
      concept_id: "ds_c06_03",
      language: "cpp",
    });
  });

  it("rejects unsupported languages and oversized source submissions", () => {
    expect(programmingExperimentAttemptSubmitSchema.safeParse({
      language: "python",
      source: "print('hello')",
      custom_input: null,
    }).success).toBe(false);
    expect(programmingExperimentAttemptSubmitSchema.safeParse({
      language: "cpp",
      source: "x".repeat(20_001),
      custom_input: null,
    }).success).toBe(false);
  });

  it("accepts an account-owned sandbox attempt without exposing a user id", () => {
    const attempt = programmingExperimentAttemptRecordSchema.parse({
      attempt_id: "prog_attempt_001",
      experiment_id: "ds-bfs-visited-v1",
      course_id: "course_408_ds",
      concept_id: "ds_c06_03",
      task_id: "task_bfs_bug_001",
      language: "cpp",
      source: "vector<int> bfs() { return {}; }",
      result: sandboxResult,
      diagnosis: {
        status: "needs_revision",
        title: "重复入队仍未解决",
        summary: "汇聚路径中同一顶点被多次加入队列。",
        evidence: ["菱形汇聚图：期望 1 2 3 4，实际 1 2 3 4 4"],
        correction_goal: "检查 visited 的标记时机后重新运行。",
        next_action: "retry",
      },
      created_at: "2026-08-15T08:00:00.000Z",
    });

    expect(attempt.result.execution_mode).toBe("sandbox");
    expect(attempt.diagnosis.next_action).toBe("retry");
    expect(attempt).not.toHaveProperty("user_id");
  });

  it("rejects mock results from formal persisted history", () => {
    const parsed = programmingExperimentAttemptRecordSchema.safeParse({
      attempt_id: "prog_attempt_001",
      experiment_id: "ds-bfs-visited-v1",
      course_id: "course_408_ds",
      concept_id: "ds_c06_03",
      task_id: "task_bfs_bug_001",
      language: "cpp",
      source: "vector<int> bfs() { return {}; }",
      result: { ...sandboxResult, execution_mode: "mock", evaluator_label: "演示评测" },
      diagnosis: {
        status: "needs_revision",
        title: "需要继续修改",
        summary: "当前结果未通过。",
        evidence: [],
        correction_goal: "重新运行。",
        next_action: "retry",
      },
      created_at: "2026-08-15T08:00:00.000Z",
    });
    expect(parsed.success).toBe(false);
  });

  it("bounds the account history response", () => {
    expect(programmingExperimentHistorySchema.parse({ items: [], total: 0 })).toEqual({
      items: [],
      total: 0,
    });
    expect(programmingExperimentHistorySchema.safeParse({
      items: Array.from({ length: 51 }, (_, index) => ({ attempt_id: `attempt_${index}` })),
      total: 51,
    }).success).toBe(false);
  });

  it("publishes a bounded student experiment catalog without account identity fields", () => {
    const catalog = programmingExperimentCatalogSchema.parse({
      items: [{
        definition: {
          experiment_id: "ds-bfs-visited-v1",
          course_id: "course_408_ds",
          course_slug: "data-structures",
          concept_id: "ds_c06_03",
          task_id: "task_bfs_bug_001",
          title: "修复 BFS 重复入队问题",
          subtitle: "广度优先搜索 · visited 标记时机",
          learning_objective: "理解发现顶点时标记 visited 的必要性。",
          prompt: "修复代码，使每个顶点只入队一次。",
          requirements: ["保持广度优先访问顺序"],
          success_criteria: ["4 个固定用例全部通过"],
          language: "cpp",
          starter_code: "vector<int> bfs() { return {}; }",
          data_boundary: "Judge0 隔离评测；确定性规则生成学习提示。",
        },
        latest_attempt: null,
        attempt_count: 0,
      }],
    });

    expect(catalog.items).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toContain("user_id");
  });
});
