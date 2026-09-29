import { describe, expect, it } from "vitest";

import type { SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresQuestionBank } from "../src/services/question-bank/postgres-question-bank.js";

function paperRows(year: number, questionCount = 47, attemptedCount = 0) {
  const subjects = [
    ...Array.from({ length: 11 }, () => "数据结构"),
    ...Array.from({ length: 12 }, () => "组成原理"),
    ...Array.from({ length: 12 }, () => "操作系统"),
    ...Array.from({ length: 12 }, () => "计算机网络"),
  ];
  return Array.from({ length: questionCount }, (_, index) => ({
    year,
    number: index + 1,
    subject: subjects[index] ?? "计算机网络",
    question_type: index < 40 ? "choice" : "subjective",
    attempted: index < attemptedCount,
  }));
}

describe("PostgreSQL past-exam library", () => {
  it("groups complete papers and derives distinct progress without loading answers", async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, ...(parameters ? { parameters } : {}) });
        return {
          rows: [
            ...paperRows(2026, 47, 9),
            ...paperRows(2025, 46, 46),
          ] as Row[],
          rowCount: 93,
        };
      },
    };

    const catalog = await new PostgresQuestionBank(pool, "course_408_001", {
      allowLocalDemoPastExams: true,
    }).listPastExamPapers("user_student_001");

    expect(catalog.items).toHaveLength(2);
    expect(catalog.items[0]).toMatchObject({
      year: 2026,
      question_count: 47,
      choice_count: 40,
      subjective_count: 7,
      attempted_count: 9,
      next_question_number: 10,
      is_complete: true,
    });
    expect(catalog.items[1]).toMatchObject({
      year: 2025,
      question_count: 46,
      attempted_count: 46,
      next_question_number: null,
      is_complete: false,
    });
    expect(calls[0]?.parameters).toEqual(["course_408_001", "user_student_001"]);
    expect(calls[0]?.sql).toMatch(/LIMIT\s+2000/iu);
    expect(calls[0]?.sql).toContain("local_demo_only");
    expect(calls[0]?.sql).toContain("demo_validated");
    expect(calls[0]?.sql).toContain("question_asset_links");
    expect(calls[0]?.sql).not.toMatch(/answer_key|explanation_text|solution_text/iu);
  });

  it("loads a binary asset only through a role-aware, attempt-owned query", async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const content = Buffer.from([137, 80, 78, 71]);
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, ...(parameters ? { parameters } : {}) });
        return {
          rows: [{
            role: "explanation",
            mime_type: "image/png",
            byte_length: content.length,
            content,
          } as Row],
          rowCount: 1,
        };
      },
    };
    const repository = new PostgresQuestionBank(pool, "course_408_001", {
      allowLocalDemoPastExams: true,
    });

    const asset = await repository.openAsset(
      "user_student_001",
      "2026-01",
      "asset_001",
      "attempt_001",
    );

    expect(asset).toMatchObject({
      role: "explanation",
      mimeType: "image/png",
      byteLength: content.length,
    });
    expect(asset?.content).toEqual(content);
    expect(calls[0]?.parameters).toEqual([
      "course_408_001",
      "user_student_001",
      "2026-01",
      "asset_001",
      "attempt_001",
    ]);
    expect(calls[0]?.sql).toContain("link.role IN ('question', 'option')");
    expect(calls[0]?.sql).toContain("attempt.user_id = $2");
    expect(calls[0]?.sql).toContain("attempt.question_id = q.question_id");
    expect(calls[0]?.sql).toContain("attempt.attempt_id = $5");
    expect(calls[0]?.sql).toContain("JOIN evaluations evaluation");
  });

  it("does not mark a 47-row paper complete when its original numbers are not 1 through 47", async () => {
    const malformedRows = paperRows(2024);
    malformedRows[46] = { ...malformedRows[46]!, number: 48 };
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row = Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
        return { rows: malformedRows as Row[], rowCount: malformedRows.length };
      },
    };

    const catalog = await new PostgresQuestionBank(pool, "course_408_001", {
      allowLocalDemoPastExams: true,
    }).listPastExamPapers("user_student_001");

    expect(catalog.items[0]).toMatchObject({
      year: 2024,
      question_count: 47,
      is_complete: false,
    });
  });
});
