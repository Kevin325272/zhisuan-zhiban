import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult, SqlQueryablePool } from "../src/database/client.js";
import {
  ONBOARDING_DIAGNOSTIC_QUESTIONS,
  ONBOARDING_DIAGNOSTIC_SET_VERSION,
  SELF_AUTHORED_PRACTICE_QUESTIONS,
  seedOnboardingDiagnosticQuestions,
} from "../src/database/seed-onboarding-diagnostic.js";

interface SeedQuestionDefinition {
  questionId: string;
  subject: string;
  conceptId: string;
  courseId: string;
}

function validationRow(
  item: SeedQuestionDefinition,
  sourceType: "self_authored_screening" | "self_authored_practice",
  allowedModes: readonly ["diagnostic"] | readonly ["targeted", "mock_exam"],
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    question_id: item.questionId,
    year: null,
    subject: item.subject,
    question_type: "choice",
    answer_count: 1,
    asset_count: 0,
    has_figure_marker: false,
    concept_id: item.conceptId,
    question_course_id: sourceType === "self_authored_practice" ? "course_408_001" : item.courseId,
    course_id: item.courseId,
    active_link_count: 1,
    source_type: sourceType,
    allowed_modes: [...allowedModes],
    paper_year: sourceType === "self_authored_practice" ? 2026 : null,
    protect_full_paper: false,
    content_review_status: "pending_teacher_review",
    ...overrides,
  };
}

describe("student onboarding diagnostic seed", () => {
  it("seeds independent answer-backed screening and targeted-practice question sets", async () => {
    expect(ONBOARDING_DIAGNOSTIC_SET_VERSION).toBe("408-v3");
    expect(ONBOARDING_DIAGNOSTIC_QUESTIONS).toHaveLength(8);
    expect(ONBOARDING_DIAGNOSTIC_QUESTIONS.map((item) => item.questionId)).toEqual(
      Array.from({ length: 8 }, (_, index) => `screening-408-v3-${String(index + 1).padStart(2, "0")}`),
    );
    expect(ONBOARDING_DIAGNOSTIC_QUESTIONS.map((item) => item.conceptId)).toEqual([
      "ds_c03_01",
      "ds_c08_03",
      "co_c06_03",
      "co_c07_01",
      "os_c05_03",
      "os_c03_04",
      "cn_c06_01",
      "cn_c05_02",
    ]);
    expect(ONBOARDING_DIAGNOSTIC_QUESTIONS.every((item) => !/^20\d{2}-/u.test(item.questionId))).toBe(true);
    for (const courseId of ["course_408_ds", "course_408_co", "course_408_os", "course_408_cn"]) {
      expect(ONBOARDING_DIAGNOSTIC_QUESTIONS.filter((item) => item.courseId === courseId)).toHaveLength(2);
    }
    expect(SELF_AUTHORED_PRACTICE_QUESTIONS).toHaveLength(8);
    expect(SELF_AUTHORED_PRACTICE_QUESTIONS.map((item) => item.questionId)).toEqual(
      Array.from({ length: 8 }, (_, index) => `practice-408-v1-${String(index + 1).padStart(2, "0")}`),
    );
    expect(SELF_AUTHORED_PRACTICE_QUESTIONS.map((item) => item.conceptId)).toEqual([
      "ds_c03_02",
      "ds_c06_03",
      "co_c04_01",
      "co_c04_04",
      "os_c02_04",
      "os_c05_03",
      "cn_c04_02",
      "cn_c04_03",
    ]);
    for (const courseId of ["course_408_ds", "course_408_co", "course_408_os", "course_408_cn"]) {
      expect(SELF_AUTHORED_PRACTICE_QUESTIONS.filter((item) => item.courseId === courseId)).toHaveLength(2);
    }

    const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const validationRows = [
      ...ONBOARDING_DIAGNOSTIC_QUESTIONS.map((item) => (
        validationRow(item, "self_authored_screening", ["diagnostic"])
      )),
      ...SELF_AUTHORED_PRACTICE_QUESTIONS.map((item) => (
        validationRow(item, "self_authored_practice", ["targeted", "mock_exam"])
      )),
    ];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, parameters });
        if (sql.includes("RETURNING import_batch_id")) {
          return { rows: [{ import_batch_id: parameters[0] } as Row], rowCount: 1 };
        }
        if (sql.includes("FROM questions q")) {
          expect(sql).toContain("question_learning_metadata");
          expect(sql).toContain("COUNT(cql.question_id) OVER (PARTITION BY q.question_id)");
          return { rows: validationRows as Row[], rowCount: validationRows.length };
        }
        return { rows: [], rowCount: 1 };
      },
      release() { statements.push({ sql: "RELEASE", parameters: [] }); },
    };
    const pool: SqlQueryablePool = {
      async query() { throw new Error("screening seed validation must stay inside its transaction"); },
      async connect() { return client; },
    };

    await expect(seedOnboardingDiagnosticQuestions(pool)).resolves.toEqual({
      setVersion: "408-v3",
      questionCount: 8,
      practiceQuestionCount: 8,
    });
    expect(statements.some((call) => call.sql === "BEGIN")).toBe(true);
    expect(statements.some((call) => call.sql === "COMMIT")).toBe(true);
    const questionWrites = statements.filter((call) => call.sql.includes("INSERT INTO questions"));
    expect(questionWrites).toHaveLength(16);
    expect(questionWrites.filter((call) => String(call.parameters[0]).startsWith("screening-408-v3-"))
      .every((call) => call.parameters[3] === null)).toBe(true);
    expect(questionWrites.filter((call) => String(call.parameters[0]).startsWith("practice-408-v1-"))
      .every((call) => call.parameters[3] === null)).toBe(true);
    expect(questionWrites.every((call) => call.sql.includes("'pending_review'"))).toBe(true);
    expect(questionWrites.filter((call) => String(call.parameters[0]).startsWith("practice-408-v1-"))).toHaveLength(8);
    expect(questionWrites.filter((call) => String(call.parameters[0]).startsWith("practice-408-v1-"))
      .every((call) => call.parameters[1] === "course_408_001")).toBe(true);
    const metadataWrites = statements.filter((call) => call.sql.includes("INSERT INTO question_learning_metadata"));
    expect(metadataWrites).toHaveLength(16);
    expect(metadataWrites.filter((call) => call.sql.includes("'self_authored_screening'")).every((call) => (
      call.sql.includes("'self_authored_screening'")
      && call.sql.includes("ARRAY['diagnostic']::text[]")
      && call.sql.includes("'pending_teacher_review'")
    ))).toBe(true);
    expect(metadataWrites.filter((call) => call.sql.includes("'self_authored_practice'"))).toHaveLength(8);
    expect(metadataWrites.filter((call) => call.sql.includes("'self_authored_practice'")).every((call) => (
      call.sql.includes("ARRAY['targeted','mock_exam']::text[]")
      && call.sql.includes("2026")
      && call.sql.includes("'pending_teacher_review'")
    ))).toBe(true);
    expect(statements.filter((call) => call.sql.includes("INSERT INTO course_concept_question_links"))).toHaveLength(16);
    expect(statements.filter((call) => call.sql.includes("INSERT INTO onboarding_diagnostic_questions"))).toHaveLength(8);
    const batchWrites = statements.filter((call) => call.sql.includes("INSERT INTO question_import_batches"));
    expect(batchWrites).toHaveLength(2);
    expect(batchWrites.map((call) => call.parameters[0])).toEqual([
      "import_onboarding_408_v3",
      "import_practice_408_v1",
    ]);
    const lastQuestionWrite = statements.map((call) => call.sql).lastIndexOf(questionWrites.at(-1)!.sql);
    const validationRead = statements.findIndex((call) => call.sql.includes("FROM questions q"));
    expect(validationRead).toBeGreaterThan(lastQuestionWrite);
  });

  it("keeps v1/v2 immutable and moves only unfinished states to v3 with shared answers", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const validationRows = [
      ...ONBOARDING_DIAGNOSTIC_QUESTIONS.map((item) => (
        validationRow(item, "self_authored_screening", ["diagnostic"])
      )),
      ...SELF_AUTHORED_PRACTICE_QUESTIONS.map((item) => (
        validationRow(item, "self_authored_practice", ["targeted", "mock_exam"])
      )),
    ];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, parameters });
        if (sql.includes("RETURNING import_batch_id")) {
          return { rows: [{ import_batch_id: "import_onboarding_408_v3" } as Row], rowCount: 1 };
        }
        if (sql.includes("FROM questions q")) {
          return { rows: validationRows as Row[], rowCount: validationRows.length };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(
      ): Promise<SqlQueryResult<Row>> { throw new Error("not used"); },
      async connect() { return client; },
    };

    await seedOnboardingDiagnosticQuestions(pool);

    const questionWrites = calls.filter((call) => (
      call.sql.includes("INSERT INTO onboarding_diagnostic_questions")
    ));
    expect(questionWrites).toHaveLength(8);
    expect(questionWrites.every((call) => call.parameters[0] === "408-v3")).toBe(true);
    expect(calls.some((call) => (
      call.sql.includes("INSERT INTO student_onboarding_diagnostic_answers")
      && call.sql.includes("next_question.question_id = answer.question_id")
      && call.sql.includes("state.status <> 'completed'")
      && call.sql.includes("ANY($1::text[])")
      && JSON.stringify(call.parameters[0]) === JSON.stringify(["408-v1", "408-v2"])
      && call.parameters[1] === "408-v3"
    ))).toBe(true);
    expect(calls.some((call) => (
      call.sql.includes("UPDATE student_onboarding_states")
      && call.sql.includes("state.status <> 'completed'")
      && call.sql.includes("ANY($1::text[])")
      && JSON.stringify(call.parameters[0]) === JSON.stringify(["408-v1", "408-v2"])
      && call.parameters[1] === "408-v3"
    ))).toBe(true);
    expect(calls.some((call) => /DELETE\s+FROM\s+onboarding_diagnostic_questions/iu.test(call.sql))).toBe(false);
  });

  it("fails closed when a fixed question loses its answer or concept relation", async () => {
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        if (sql.includes("RETURNING import_batch_id")) {
          return { rows: [{ import_batch_id: "import_onboarding_408_v3" } as Row], rowCount: 1 };
        }
        if (sql.includes("FROM questions q")) {
          return {
            rows: [validationRow(
              ONBOARDING_DIAGNOSTIC_QUESTIONS[0]!,
              "self_authored_screening",
              ["diagnostic"],
              { answer_count: 0 },
            )] as Row[],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool = {
      async query() { throw new Error("not used"); },
      async connect() { return client; },
    } as SqlQueryablePool;

    await expect(seedOnboardingDiagnosticQuestions(pool)).rejects.toThrow(
      "fixed diagnostic question set is unavailable",
    );
  });

  it("fails closed when a fixed question depends on an unavailable figure", async () => {
    const validationRows = ONBOARDING_DIAGNOSTIC_QUESTIONS.map((item, index) => (
      validationRow(item, "self_authored_screening", ["diagnostic"], {
        asset_count: index === 0 ? 1 : 0,
        has_figure_marker: index === 0,
      })
    ));
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        if (sql.includes("RETURNING import_batch_id")) {
          return { rows: [{ import_batch_id: "import_onboarding_408_v3" } as Row], rowCount: 1 };
        }
        if (sql.includes("FROM questions q")) {
          return { rows: validationRows as Row[], rowCount: validationRows.length };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool = {
      async query() { throw new Error("not used"); },
      async connect() { return client; },
    } as SqlQueryablePool;

    await expect(seedOnboardingDiagnosticQuestions(pool)).rejects.toThrow(
      "fixed diagnostic question set is unavailable",
    );
  });
});
