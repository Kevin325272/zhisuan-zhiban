import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresStudentOnboarding } from "../src/services/onboarding/postgres-student-onboarding.js";

const now = new Date("2026-08-23T12:00:00.000Z");
const userId = "student_diagnostic_001";
const courses = [
  "course_408_ds",
  "course_408_co",
  "course_408_os",
  "course_408_cn",
] as const;

function result<Row = Record<string, unknown>>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "in_progress",
    current_step: "diagnostic",
    target_exam_year: 2027,
    preparation_stage: "foundation",
    daily_minutes: 60,
    target_school: null,
    target_score: null,
    completed_at: null,
    diagnostic_set_version: "408-v2",
    updated_at: now,
    ...overrides,
  };
}

function assessmentRows() {
  return courses.map((course_id) => ({ course_id, level: "average" }));
}

function questionRow(index: number, answer: string[] = ["A"]) {
  return {
    ordinal: index + 1,
    course_id: courses[Math.floor(index / 2)]!,
    course_title: `课程 ${index + 1}`,
    question_id: `question_${index + 1}`,
    year: 2025,
    number: index + 1,
    subject: "数据结构",
    question_type: "choice",
    multiple: false,
    question_text: `题目 ${index + 1}`,
    options: [
      { option_id: "A", text: "选项 A", assets: [] },
      { option_id: "B", text: "选项 B", assets: [] },
    ],
    tags: [],
    assets: [],
    source_provider: "test",
    dataset_id: "test",
    source_url: "https://example.com/question",
    license_status: "unverified",
    usage_scope: "local_demo_only",
    answer_key: answer,
    response_status: "answered",
    selected_option_ids: ["A"],
  };
}

const resourceRows = [
  ["course_408_ds", "数据结构", "数据结构", "data-structures", "ds_c03_01", "栈的抽象与存储"],
  ["course_408_co", "计算机组成原理", "组成原理", "computer-organization", "co_c06_03", "补码加减与溢出判断"],
  ["course_408_os", "操作系统", "操作系统", "operating-systems", "os_c05_03", "页面置换算法"],
  ["course_408_cn", "计算机网络", "计算机网络", "computer-networks", "cn_c06_01", "DNS 层次命名与解析"],
].map(([course_id, course_title, question_subject, course_slug, concept_id, concept_title]) => ({
  course_id,
  course_title,
  question_subject,
  course_slug,
  concept_id,
  concept_title,
  practice_question_count: 2,
}));

function createPool(handler: (sql: string, parameters: readonly unknown[]) => SqlQueryResult | Promise<SqlQueryResult>) {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async <Row = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ) => {
    calls.push({ sql, parameters });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result() as SqlQueryResult<Row>;
    return await handler(sql, parameters) as SqlQueryResult<Row>;
  };
  const client: SqlClient = { query, release() {} };
  const pool: SqlQueryablePool = { connect: async () => client, query };
  return { pool, calls };
}

describe("PostgresStudentOnboarding diagnostic flow", () => {
  it("returns self-authored screening questions with a null exam year", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ ...questionRow(index), year: null }));
    const { pool } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      if (sql.includes("FROM student_onboarding_states")) {
        return result([stateRow({ diagnostic_set_version: "408-v3" })]);
      }
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessmentRows());
      if (sql.includes("FROM onboarding_diagnostic_questions")) return result(rows);
      if (sql.includes("FROM student_onboarding_diagnostic_answers")) {
        return result([{ saved_count: 0, completed_at: null }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const diagnostic = await new PostgresStudentOnboarding(pool).getDiagnosticQuestions(userId);

    expect(diagnostic.items).toHaveLength(8);
    expect(diagnostic.items.every((item) => item.question.year === null)).toBe(true);
  });

  it("loads and grades only questions approved through both review layers", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => questionRow(index));
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow()]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessmentRows());
      if (sql.includes("FROM onboarding_diagnostic_questions")) return result(rows);
      if (sql.includes("FROM student_onboarding_diagnostic_answers")) {
        return result([{ saved_count: 0, completed_at: null }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresStudentOnboarding(pool).getDiagnosticQuestions(userId);

    const questionQuery = calls.find((call) => call.sql.includes("FROM onboarding_diagnostic_questions"))?.sql ?? "";
    expect(questionQuery).toContain("JOIN question_learning_metadata");
    expect(questionQuery).toContain("q.review_status = 'approved'");
    expect(questionQuery).toContain("content_review_status = 'teacher_verified'");
    expect(questionQuery).toContain("question_asset_links");
    expect(questionQuery).toContain("jsonb_array_elements(q.options)");
    expect(questionQuery).toContain("option_item->'assets'");
  });

  it("saves a server-owned unsure answer and moves the learner into the diagnostic step", async () => {
    let currentStep = "self_assessment";
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      if (sql.includes("FROM student_onboarding_states") && sql.includes("FOR UPDATE")) {
        return result([stateRow({ current_step: currentStep })]);
      }
      if (sql.includes("FROM onboarding_diagnostic_questions") && sql.includes("q.options")) {
        return result([questionRow(0)]);
      }
      if (sql.includes("INSERT INTO student_onboarding_diagnostic_answers")) return result([], 1);
      if (sql.includes("UPDATE student_onboarding_states")) {
        currentStep = "diagnostic";
        return result([], 1);
      }
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow({ current_step: currentStep })]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessmentRows());
      if (sql.includes("FROM student_initial_profile_versions")) return result();
      if (sql.includes("FROM student_learning_plan_versions")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const state = await new PostgresStudentOnboarding(pool, { now: () => now }).saveDiagnosticAnswer(userId, {
      question_id: "question_1",
      response_status: "unsure",
      selected_option_ids: [],
    });

    expect(state.current_step).toBe("diagnostic");
    const insert = calls.find((call) => call.sql.includes("INSERT INTO student_onboarding_diagnostic_answers"));
    expect(insert?.parameters).toContain("unsure");
    expect(insert?.parameters).toContain("[]");
    const questionQuery = calls.find((call) => call.sql.includes("FROM onboarding_diagnostic_questions"))?.sql ?? "";
    expect(questionQuery).toContain("available_asset.question_id = q.question_id");
    expect(questionQuery).toContain("q.usage_scope = 'authorized_product_use'");
    expect(questionQuery).toContain("JOIN question_learning_metadata");
    expect(questionQuery).toContain("q.review_status = 'approved'");
    expect(questionQuery).toContain("content_review_status = 'teacher_verified'");
  });

  it("evaluates all eight answers and creates the profile and plan in the same transaction", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => questionRow(index));
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      if (sql.includes("FROM student_onboarding_states") && sql.includes("FOR UPDATE")) {
        return result([stateRow({ diagnostic_set_version: "408-v3" })]);
      }
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessmentRows());
      if (sql.includes("FROM onboarding_diagnostic_questions") && sql.includes("answer_key")) return result(rows);
      if (sql.includes("FROM student_onboarding_diagnostic_answers") && sql.includes("concept.title")) {
        return result(rows.map((row) => ({
          course_id: row.course_id,
          question_id: row.question_id,
          response_status: row.response_status,
          is_correct: true,
          concept_id: resourceRows.find((resource) => resource.course_id === row.course_id)?.concept_id,
          concept_title: resourceRows.find((resource) => resource.course_id === row.course_id)?.concept_title,
          practice_question_count: 2,
        })));
      }
      if (sql.includes("FROM course_catalog_entries catalog")) return result(resourceRows);
      if (sql.includes("MAX(version)")) return result([{ next_version: 1 }]);
      if (sql.includes("UPDATE student_onboarding_diagnostic_answers")) return result([], 8);
      if (/^(UPDATE|INSERT)/u.test(sql.trim())) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const state = await new PostgresStudentOnboarding(pool, { now: () => now }).completeDiagnostic(userId);

    expect(state).toMatchObject({ status: "completed", current_step: "plan" });
    expect(state.profile).not.toBeNull();
    expect(state.plan?.tasks.length).toBeGreaterThanOrEqual(7);
    expect(calls.filter((call) => call.sql.includes("UPDATE student_onboarding_diagnostic_answers"))).toHaveLength(8);
    expect(calls.some((call) => call.sql.includes("current_step = 'profile'"))).toBe(false);
    expect(calls[0]?.sql).toBe("BEGIN");
    expect(calls.at(-1)?.sql).toBe("COMMIT");
    const screeningQuery = calls.find((call) => (
      call.sql.includes("FROM student_onboarding_diagnostic_answers")
      && call.sql.includes("concept.title")
    ))?.sql ?? "";
    expect(screeningQuery).toContain("JOIN questions q");
    expect(screeningQuery).toContain("JOIN question_learning_metadata learning");
    expect(screeningQuery).toContain("q.review_status = 'approved'");
    expect(screeningQuery).toContain("learning.content_review_status = 'teacher_verified'");
    expect(screeningQuery).toContain("LEFT JOIN questions practice_question");
    expect(screeningQuery).toContain("LEFT JOIN question_learning_metadata practice_learning");
    expect(screeningQuery).toContain("practice_question.review_status = 'approved'");
    expect(screeningQuery).toContain("practice_learning.content_review_status = 'teacher_verified'");
    expect(screeningQuery).toContain("'targeted' = ANY(practice_learning.allowed_modes)");
    expect(screeningQuery).toContain("practice_learning.protect_full_paper = false");
    expect(screeningQuery).toContain("question_asset_links available_asset");
    expect(screeningQuery).toContain("available_asset.question_id = practice_question.question_id");
    expect(screeningQuery).toContain("available_asset.asset_id = required_asset->>'asset_id'");
    expect(JSON.stringify(state)).not.toContain("answer_key");
  });
});
