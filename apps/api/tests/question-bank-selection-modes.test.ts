import { describe, expect, it } from "vitest";

import { practiceSelectionSchema } from "@xuetu/contracts";

import type { SqlClient, SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresQuestionBank } from "../src/services/question-bank/postgres-question-bank.js";

function questionRow(id: string, number: number, overrides: Record<string, unknown> = {}) {
  return {
    question_id: id,
    year: 2020,
    number,
    subject: "数据结构",
    question_type: "choice",
    multiple: false,
    question_text: `第 ${number} 题`,
    options: [
      { option_id: "A", text: "选项 A", assets: [] },
      { option_id: "B", text: "选项 B", assets: [] },
    ],
    tags: ["栈"],
    assets: [],
    source_provider: "csgraduates.com",
    dataset_id: "408_json_data",
    source_url: `https://www.csgraduates.com/study_methods/408quiz/2020/#${number}`,
    license_status: "unverified",
    usage_scope: "local_demo_only",
    source_type: "past_exam",
    allowed_modes: ["targeted", "past_exam", "mock_exam"],
    paper_year: 2020,
    protect_full_paper: false,
    importance: "core",
    content_review_status: "pending_teacher_review",
    memory_due: null,
    memory_stability: null,
    memory_difficulty: null,
    memory_elapsed_days: null,
    memory_scheduled_days: null,
    memory_reps: null,
    memory_lapses: null,
    memory_learning_steps: null,
    memory_state: null,
    memory_last_review: null,
    memory_last_attempt_id: null,
    memory_algorithm_version: null,
    attempt_count: "0",
    concept_correct_count: "0",
    concept_incorrect_count: "0",
    wrong_count: "0",
    ...overrides,
  };
}

function completePaperRows(year = 2020) {
  return Array.from({ length: 47 }, (_, index) => {
    const number = index + 1;
    const subject = number <= 11
      ? "数据结构"
      : number <= 23
        ? "组成原理"
        : number <= 35
          ? "操作系统"
          : "计算机网络";
    return questionRow(`${year}-${String(number).padStart(2, "0")}`, number, {
      year,
      paper_year: year,
      subject,
      question_type: number <= 40 ? "choice" : "subjective",
      options: number <= 40
        ? [
            { option_id: "A", text: "选项 A", assets: [] },
            { option_id: "B", text: "选项 B", assets: [] },
          ]
        : [],
      total_count: "47",
    });
  });
}

function poolWithRows(rows: Record<string, unknown>[]) {
  const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
  const pool: SqlQueryablePool = {
    async query<Row = Record<string, unknown>>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<SqlQueryResult<Row>> {
      calls.push({ sql, ...(parameters ? { parameters } : {}) });
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async connect(): Promise<SqlClient> {
      throw new Error("not used");
    },
  };
  return { pool, calls };
}

describe("question-bank training modes", () => {
  it("ranks targeted practice for the authenticated student and excludes protected papers", async () => {
    const { pool, calls } = poolWithRows([
      questionRow("2020-02", 2),
      questionRow("2020-01", 1, {
        attempt_count: "1",
        concept_incorrect_count: "3",
        wrong_count: "3",
        memory_due: "2026-08-23T06:00:00.000Z",
        memory_stability: 2.5,
        memory_difficulty: 5.1,
        memory_elapsed_days: 1,
        memory_scheduled_days: 2,
        memory_reps: 2,
        memory_lapses: 0,
        memory_learning_steps: 0,
        memory_state: 2,
        memory_last_review: "2026-08-22T06:00:00.000Z",
        memory_last_attempt_id: "attempt_2020_01",
        memory_algorithm_version: "fsrs_v6_ts_fsrs_5_4_1",
      }),
    ]);
    const repository = new PostgresQuestionBank(pool, "course_408_001", {
      now: () => new Date("2026-08-24T06:00:00.000Z"),
    });

    const result = await repository.select("student_001", practiceSelectionSchema.parse({
      mode: "targeted",
      subject: "数据结构",
      type: "choice",
      limit: 20,
      offset: 0,
    }));

    expect(result.items.map((item) => item.question.id)).toEqual(["2020-01", "2020-02"]);
    expect(result.items[0]?.ranking).toMatchObject({
      algorithm_version: "fsrs_v6_weighted_v1",
      evidence_level: "grounded",
    });
    expect(result.items[1]?.ranking?.reason_lines).toContain("尚无稳定作答证据");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("JOIN question_learning_metadata");
    expect(calls[0]?.sql).toContain("q.review_status = 'approved'");
    expect(calls[0]?.sql).toContain("meta.content_review_status = 'teacher_verified'");
    expect(calls[0]?.sql).toContain("meta.protect_full_paper = false");
    expect(calls[0]?.parameters).toContain("student_001");
  });

  it("composes the local-demo exposure predicate without a duplicate AND", async () => {
    const { pool, calls } = poolWithRows([]);
    const repository = new PostgresQuestionBank(pool, "course_408_001", {
      allowLocalDemoPastExams: true,
    });

    await repository.select("student_001", practiceSelectionSchema.parse({
      mode: "targeted",
      subject: "数据结构",
      type: "choice",
      limit: 1,
      offset: 0,
    }));

    expect(calls[0]?.sql).not.toContain("AND AND");
    expect(calls[0]?.sql).toContain("meta.source_type = 'past_exam'");
    expect(calls[0]?.sql).toContain("jsonb_array_elements(q.options)");
  });

  it("limits mistake review to the authenticated student's unresolved mistakes", async () => {
    const { pool, calls } = poolWithRows([]);
    const repository = new PostgresQuestionBank(pool, "course_408_001");

    await repository.select("student_002", practiceSelectionSchema.parse({
      mode: "mistake_review",
      limit: 20,
      offset: 0,
    }));

    expect(calls[0]?.sql).toContain("mistake.user_id = $2");
    expect(calls[0]?.sql).toContain("mistake.status = 'needs_review'");
    expect(calls[0]?.parameters).toContain("student_002");
  });

  it("preserves original question order for historical-paper practice", async () => {
    const { pool } = poolWithRows(completePaperRows().reverse());
    const repository = new PostgresQuestionBank(pool, "course_408_001");

    const result = await repository.select("student_001", practiceSelectionSchema.parse({
      mode: "past_exam",
      year: 2020,
      limit: 47,
      offset: 0,
    }));

    expect(result.items.map((item) => item.question.number)).toEqual(
      Array.from({ length: 47 }, (_, index) => index + 1),
    );
    expect(result.items.every((item) => item.ranking === null)).toBe(true);
  });

  it("refuses to start an incomplete historical paper through a direct API request", async () => {
    const { pool } = poolWithRows(completePaperRows().slice(0, 46));
    const repository = new PostgresQuestionBank(pool, "course_408_001");

    const result = await repository.select("student_001", practiceSelectionSchema.parse({
      mode: "past_exam",
      year: 2020,
      limit: 1,
      offset: 0,
    }));

    expect(result).toMatchObject({ items: [], total: 0, limit: 1, offset: 0 });
  });
});
