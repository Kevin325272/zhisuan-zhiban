import { describe, expect, it } from "vitest";

import type {
  ProgrammingExperimentAttemptRecord,
} from "@xuetu/contracts";

import type {
  SqlClient,
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import { PostgresProgrammingExperimentRepository } from "../src/services/programming-experiments/postgres-programming-experiment.js";

function result<Row>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

function createPool(handler: (sql: string, parameters: readonly unknown[]) => SqlQueryResult) {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const client: SqlClient = {
    async query<Row = Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) {
      calls.push({ sql, parameters });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result() as SqlQueryResult<Row>;
      return handler(sql, parameters) as SqlQueryResult<Row>;
    },
    release() {},
  };
  const pool: SqlQueryablePool = {
    connect: async () => client,
    query: client.query.bind(client),
  };
  return { pool, calls };
}

const attempt: ProgrammingExperimentAttemptRecord = {
  attempt_id: "prog_attempt_001",
  experiment_id: "ds-bfs-visited-v1",
  course_id: "course_408_ds",
  concept_id: "ds_c06_03",
  task_id: "task_bfs_bug_001",
  language: "cpp",
  source: "vector<int> bfs() { return {}; }",
  result: {
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
    stdout: "运行完成",
    stderr: null,
    error_line: 15,
    trace_available: true,
    trace_variant: "visited-on-dequeue",
    test_cases: [],
  },
  diagnosis: {
    status: "needs_revision",
    title: "重复入队仍未解决",
    summary: "当前客观结果为 2/4 个用例通过。",
    evidence: ["菱形汇聚图未通过"],
    correction_goal: "检查 visited 标记时机。",
    next_action: "retry",
  },
  created_at: "2026-08-15T08:00:00.000Z",
};

const attemptRow = {
  attempt_id: attempt.attempt_id,
  experiment_id: attempt.experiment_id,
  course_id: attempt.course_id,
  concept_id: attempt.concept_id,
  task_id: attempt.task_id,
  language: attempt.language,
  source_code: attempt.source,
  result_payload: attempt.result,
  diagnosis_payload: attempt.diagnosis,
  created_at: new Date(attempt.created_at),
  total: "1",
};

describe("PostgresProgrammingExperimentRepository", () => {
  it("filters every history read by the authenticated user and experiment", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("COUNT(*)::int")) return result([{ total: 1 }]);
      if (sql.includes("FROM programming_experiment_attempts")) return result([attemptRow]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresProgrammingExperimentRepository(pool);

    expect(await repository.listAttempts("student_a", attempt.experiment_id, 20)).toEqual({
      items: [attempt],
      total: 1,
    });
    for (const call of calls) {
      expect(call.parameters[0]).toBe("student_a");
      expect(call.parameters[1]).toBe(attempt.experiment_id);
    }
  });

  it("finds an idempotent attempt only inside the same owner scope", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("idempotency_key")) return result([attemptRow]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresProgrammingExperimentRepository(pool);

    expect(await repository.findIdempotent("student_a", attempt.experiment_id, "same-request"))
      .toEqual(attempt);
    expect(calls[0]?.parameters).toEqual(["student_a", attempt.experiment_id, "same-request"]);
  });

  it("writes the sandbox attempt and its evidence in one transaction", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("INSERT INTO programming_experiment_attempts")) return result([], 1);
      if (sql.includes("INSERT INTO programming_experiment_evidence")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresProgrammingExperimentRepository(pool);

    await expect(repository.saveAttempt({
      userId: "student_a",
      idempotencyKey: "request-001",
      record: attempt,
    })).resolves.toEqual(attempt);

    expect(calls.map((call) => call.sql)).toEqual([
      "BEGIN",
      expect.stringContaining("INSERT INTO programming_experiment_attempts"),
      expect.stringContaining("INSERT INTO programming_experiment_evidence"),
      "COMMIT",
    ]);
    expect(calls[1]?.parameters).toContain("student_a");
    expect(calls[2]?.parameters).toContain("student_a");
    expect(JSON.stringify(calls)).not.toContain("student_b");
  });
});
