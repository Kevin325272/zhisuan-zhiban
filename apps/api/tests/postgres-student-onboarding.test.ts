import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresStudentOnboarding } from "../src/services/onboarding/postgres-student-onboarding.js";

const now = new Date("2026-08-12T08:00:00.000Z");
const userId = "user_new_student";

type QueryCall = { sql: string; parameters: readonly unknown[] };
type QueryHandler = (
  sql: string,
  parameters: readonly unknown[],
) => SqlQueryResult | Promise<SqlQueryResult>;

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length): SqlQueryResult {
  return { rows, rowCount };
}

function createPool(handler: QueryHandler) {
  const calls: QueryCall[] = [];
  const client: SqlClient = {
    async query<Row = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> {
      calls.push({ sql, parameters });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result() as SqlQueryResult<Row>;
      return await handler(sql, parameters) as SqlQueryResult<Row>;
    },
    release() {},
  };
  const pool: SqlQueryablePool = {
    connect: async () => client,
    query: client.query.bind(client),
  };
  return { pool, calls };
}

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "in_progress",
    current_step: "profile",
    target_exam_year: 2027,
    preparation_stage: "foundation",
    daily_minutes: 60,
    target_school: null,
    target_score: 120,
    completed_at: null,
    updated_at: now,
    ...overrides,
  };
}

const courses = [
  ["course_408_ds", "数据结构", "数据结构", "data-structures", "ds_c03_01", "栈的抽象与存储"],
  ["course_408_co", "计算机组成原理", "组成原理", "computer-organization", "co_c06_03", "补码加减与溢出判断"],
  ["course_408_os", "操作系统", "操作系统", "operating-systems", "os_c05_03", "页面置换算法"],
  ["course_408_cn", "计算机网络", "计算机网络", "computer-networks", "cn_c06_01", "DNS 层次命名与解析"],
] as const;

const assessments = courses.map((course) => ({
  course_id: course[0],
  level: "average" as const,
}));

const resources = courses.map((course) => ({
  course_id: course[0],
  course_title: course[1],
  question_subject: course[2],
  course_slug: course[3],
  concept_id: course[4],
  concept_title: course[5],
  practice_question_count: 2,
}));

function emptyStateHandler(sql: string) {
  if (sql.includes("FROM student_onboarding_states")) {
    return result([stateRow({
      status: "not_started",
      current_step: "goals",
      target_exam_year: null,
      preparation_stage: null,
      daily_minutes: null,
      target_score: null,
    })]);
  }
  if (sql.includes("FROM student_onboarding_self_assessments")) return result();
  if (sql.includes("FROM student_initial_profile_versions")) return result();
  if (sql.includes("FROM student_learning_plan_versions")) return result();
  throw new Error(`Unexpected SQL in state loader: ${sql}`);
}

describe("PostgresStudentOnboarding", () => {
  it.each([0, 7])("allows a self-report-only plan when only %i screening questions are available", async (availableCount) => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow({ current_step: "diagnostic", diagnostic_set_version: "408-v3" })]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments);
      if (sql.includes("FROM onboarding_diagnostic_questions")) return result(Array.from({ length: availableCount }, () => ({})));
      if (sql.includes("FROM student_onboarding_diagnostic_answers")) return result();
      if (sql.includes("FROM course_catalog_entries catalog")) return result(resources);
      if (sql.includes("MAX(version)")) return result([{ next_version: 1 }]);
      if (/^(UPDATE|INSERT)/u.test(sql.trim())) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const completed = await new PostgresStudentOnboarding(pool, { now: () => now }).completeSetup(userId);

    expect(completed.status).toBe("completed");
    expect(completed.plan?.tasks).toHaveLength(7);
    expect(completed.profile?.objective_evidence_count).toBe(0);
    expect(completed.profile?.screening).toBeUndefined();
    expect(completed.profile?.priority_courses.every((course) => course.evidence_level === "self_report_only")).toBe(true);
    expect(calls.some((call) => /(?:INSERT INTO|UPDATE) student_onboarding_diagnostic_answers/u.test(call.sql))).toBe(false);
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("still requires the screening when all eight questions are available", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow({ current_step: "diagnostic", diagnostic_set_version: "408-v3" })]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments);
      if (sql.includes("FROM onboarding_diagnostic_questions")) return result(Array.from({ length: 8 }, () => ({})));
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(new PostgresStudentOnboarding(pool).completeSetup(userId)).rejects.toMatchObject({ code: "ONBOARDING_DIAGNOSTIC_REQUIRED" });
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(calls.some((call) => call.sql.includes("INSERT INTO student_learning_plan_versions"))).toBe(false);
  });

  it("rebuilds an existing student's plan after revised self-assessments without forcing another screening", async () => {
    const revised = assessments.map((item) => ({ ...item, level: "weak" as const }));
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow({ current_step: "self_assessment", completed_at: now })]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(revised);
      if (sql.includes("FROM course_catalog_entries catalog")) return result(resources);
      if (sql.includes("MAX(version)")) return result([{ next_version: 2 }]);
      if (sql.includes("FROM student_initial_profile_versions") || sql.includes("FROM student_learning_plan_versions")) return result();
      if (/^(UPDATE|INSERT)/u.test(sql.trim())) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const updated = await new PostgresStudentOnboarding(pool, { now: () => now }).saveSelfAssessments(userId, { items: revised });
    expect(updated).toMatchObject({ status: "completed", current_step: "plan", plan: { version: 2 } });
    expect(updated.self_assessments).toEqual(revised);
    expect(calls.filter((call) => call.sql.includes("INSERT INTO student_onboarding_self_assessments"))).toHaveLength(4);
    expect(calls.some((call) => /DELETE|current_step = 'diagnostic'/u.test(call.sql))).toBe(false);
  });

  it("lazily creates a preference state without querying or exposing diagnostic records", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      return emptyStateHandler(sql);
    });

    const state = await new PostgresStudentOnboarding(pool, { now: () => now }).getState(userId);

    expect(state).toEqual({
      status: "not_started",
      current_step: "goals",
      goals: null,
      self_assessments: [],
      profile: null,
      plan: null,
      updated_at: now.toISOString(),
    });
    expect(calls.some((call) => /onboarding_diagnostic_(questions|answers)/u.test(call.sql))).toBe(false);
  });

  it("persists goals and exactly four self assessments as resumable setup steps", async () => {
    let loadedStep: "self_assessment" | "profile" = "self_assessment";
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM student_onboarding_states") && sql.includes("FOR UPDATE")) return result([stateRow({ current_step: loadedStep })]);
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow({ current_step: loadedStep })]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(loadedStep === "profile" ? assessments : []);
      if (sql.includes("FROM student_initial_profile_versions")) return result();
      if (sql.includes("FROM student_learning_plan_versions")) return result();
      if (/^(UPDATE|INSERT)/u.test(sql.trim())) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresStudentOnboarding(pool, { now: () => now });

    const afterGoals = await service.saveGoals(userId, {
      target_exam_year: 2027,
      preparation_stage: "foundation",
      daily_minutes: 60,
      target_school: null,
      target_score: 120,
    });
    loadedStep = "profile";
    const afterAssessments = await service.saveSelfAssessments(userId, { items: assessments });

    expect(afterGoals.current_step).toBe("self_assessment");
    expect(afterAssessments.current_step).toBe("profile");
    expect(afterAssessments.self_assessments).toHaveLength(4);
    expect(calls.filter((call) => call.sql.includes("INSERT INTO student_onboarding_self_assessments"))).toHaveLength(4);
  });

  it("serializes state reads when loading through a transaction client", async () => {
    let activeQueries = 0;
    let maxConcurrentQueries = 0;
    const calls: QueryCall[] = [];
    const query = async <Row = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> => {
      calls.push({ sql, parameters });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result() as SqlQueryResult<Row>;
      activeQueries += 1;
      maxConcurrentQueries = Math.max(maxConcurrentQueries, activeQueries);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeQueries -= 1;
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow()]) as SqlQueryResult<Row>;
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments) as SqlQueryResult<Row>;
      if (sql.includes("FROM student_initial_profile_versions")) return result() as SqlQueryResult<Row>;
      if (sql.includes("FROM student_learning_plan_versions")) return result() as SqlQueryResult<Row>;
      if (/^(UPDATE|INSERT)/u.test(sql.trim())) return result([], 1) as SqlQueryResult<Row>;
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    const client: SqlClient = { query, release() {} };
    const pool: SqlQueryablePool = {
      connect: async () => client,
      query,
    };

    await new PostgresStudentOnboarding(pool, { now: () => now }).saveGoals(userId, {
      target_exam_year: 2027,
      preparation_stage: "foundation",
      daily_minutes: 60,
      target_school: null,
      target_score: null,
    });

    expect(maxConcurrentQueries).toBe(1);
    expect(calls[0]?.sql).toBe("BEGIN");
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("lets a completed student revise the learning setup without deleting prior learning history", async () => {
    let goalsSaved = false;
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      if (sql.includes("UPDATE student_onboarding_states")) {
        goalsSaved = true;
        return result([], 1);
      }
      if (sql.includes("FROM student_onboarding_states")) {
        return result([stateRow({
          status: goalsSaved ? "in_progress" : "completed",
          current_step: goalsSaved ? "self_assessment" : "plan",
        })]);
      }
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments);
      if (sql.includes("FROM student_initial_profile_versions")) return result();
      if (sql.includes("FROM student_learning_plan_versions")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const updated = await new PostgresStudentOnboarding(pool, { now: () => now }).saveGoals(userId, {
      target_exam_year: 2027,
      preparation_stage: "strengthening",
      daily_minutes: 90,
      target_school: "中国科学技术大学",
      target_score: 120,
    });

    expect(updated).toMatchObject({ status: "in_progress", current_step: "self_assessment" });
    const update = calls.find((call) => call.sql.includes("UPDATE student_onboarding_states"))?.sql ?? "";
    expect(update).not.toContain("status <> 'completed'");
    expect(calls.some((call) => /\bDELETE\b/u.test(call.sql))).toBe(false);
  });

  it("creates a zero-objective-evidence direction and seven-day path in one transaction", async () => {
    let activeVersionQueries = 0;
    let maxConcurrentVersionQueries = 0;
    const { pool, calls } = createPool(async (sql) => {
      if (sql.includes("FROM student_onboarding_states") && sql.includes("FOR UPDATE")) return result([stateRow()]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments);
      if (sql.includes("FROM course_catalog_entries catalog")) return result(resources);
      if (sql.includes("MAX(version)")) {
        activeVersionQueries += 1;
        maxConcurrentVersionQueries = Math.max(maxConcurrentVersionQueries, activeVersionQueries);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeVersionQueries -= 1;
        return result([{ next_version: 1 }]);
      }
      if (/^(UPDATE|INSERT)/u.test(sql.trim())) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    let id = 0;
    const service = new PostgresStudentOnboarding(pool, {
      now: () => now,
      createId: (prefix) => `${prefix}_${++id}`,
    });

    const completed = await service.completeSetup(userId);

    expect(completed.status).toBe("completed");
    expect(completed.profile).toMatchObject({
      confidence: "low",
      evidence_status: "accumulating",
      objective_evidence_count: 0,
    });
    expect(completed.plan?.tasks).toHaveLength(7);
    expect(calls[0]?.sql).toBe("BEGIN");
    expect(calls.at(-1)?.sql).toBe("COMMIT");
    expect(maxConcurrentVersionQueries).toBe(1);
    expect(calls.some((call) => /onboarding_diagnostic_(questions|answers)/u.test(call.sql))).toBe(false);
    expect(JSON.stringify(completed)).not.toMatch(/diagnostic|诊断|答错/iu);
    const resourceQuery = calls.find((call) => call.sql.includes("FROM course_catalog_entries catalog"))?.sql ?? "";
    expect(resourceQuery).toContain("LEFT JOIN questions practice_question");
    expect(resourceQuery).toContain("LEFT JOIN question_learning_metadata practice_learning");
    expect(resourceQuery).toContain("practice_question.review_status = 'approved'");
    expect(resourceQuery).toContain("practice_learning.content_review_status = 'teacher_verified'");
    expect(resourceQuery).toContain("'targeted' = ANY(practice_learning.allowed_modes)");
    expect(resourceQuery).toContain("practice_learning.protect_full_paper = false");
  });

  it("rebuilds missing profile and plan artifacts for a legacy completed row", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM student_onboarding_states")) {
        return result([stateRow({ status: "completed", current_step: "plan" })]);
      }
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments);
      if (sql.includes("FROM student_initial_profile_versions")) return result();
      if (sql.includes("FROM student_learning_plan_versions") && !sql.includes("MAX(version)")) return result();
      if (sql.includes("FROM course_catalog_entries catalog")) return result(resources);
      if (sql.includes("MAX(version)")) return result([{ next_version: 1 }]);
      if (/^(UPDATE|INSERT)/u.test(sql.trim())) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const repaired = await new PostgresStudentOnboarding(pool, { now: () => now }).completeSetup(userId);

    expect(repaired).toMatchObject({
      status: "completed",
      current_step: "plan",
      profile: { confidence: "low" },
      plan: { version: 1 },
    });
    expect(calls.some((call) => call.sql.includes("INSERT INTO student_initial_profile_versions"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("INSERT INTO student_learning_plan_versions"))).toBe(true);
  });

  it("uses evaluated screening gaps for the first course and concept without creating an ability score", async () => {
    const screeningRows = [
      ["course_408_ds", "q_ds_1", "answered", true, "ds_c03_01", "栈的抽象与存储"],
      ["course_408_ds", "q_ds_2", "skipped", null, "ds_c08_03", "图的遍历"],
      ["course_408_co", "q_co_1", "answered", true, "co_c06_03", "补码加减与溢出判断"],
      ["course_408_co", "q_co_2", "unsure", null, "co_c07_01", "指令流水线"],
      ["course_408_os", "q_os_1", "answered", true, "os_c05_03", "页面置换算法"],
      ["course_408_os", "q_os_2", "answered", true, "os_c03_04", "进程同步"],
      ["course_408_cn", "q_cn_1", "answered", false, "cn_c06_01", "DNS 层次命名与解析"],
      ["course_408_cn", "q_cn_2", "skipped", null, "cn_c05_02", "运输层可靠传输"],
    ].map(([course_id, question_id, response_status, is_correct, concept_id, concept_title]) => ({
      course_id,
      question_id,
      response_status,
      is_correct,
      concept_id,
      concept_title,
      practice_question_count: 3,
    }));
    const { pool } = createPool(async (sql) => {
      if (sql.includes("FROM student_onboarding_states") && sql.includes("FOR UPDATE")) {
        return result([stateRow({ diagnostic_set_version: "408-v2" })]);
      }
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments);
      if (sql.includes("FROM student_onboarding_diagnostic_answers") && sql.includes("concept.title")) {
        return result(screeningRows);
      }
      if (sql.includes("FROM course_catalog_entries catalog")) return result(resources);
      if (sql.includes("MAX(version)")) return result([{ next_version: 1 }]);
      if (/^(UPDATE|INSERT)/u.test(sql.trim())) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const completed = await new PostgresStudentOnboarding(pool, { now: () => now }).completeSetup(userId);

    expect(completed.profile?.screening).toMatchObject({
      status: "completed",
      answered_count: 5,
      correct_count: 4,
      incorrect_count: 1,
      risk_concepts: [{ concept_id: "cn_c06_01" }],
    });
    expect(completed.profile?.objective_evidence_count).toBe(0);
    expect(completed.plan?.tasks[0]).toMatchObject({
      course_id: "course_408_cn",
      concept_id: "cn_c06_01",
    });
    expect(JSON.stringify(completed)).not.toContain("answer_key");
  });

  it("keeps an unfinished diagnostic step resumable without deleting history", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow({ current_step: "diagnostic" })]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments);
      if (sql.includes("FROM student_initial_profile_versions")) return result();
      if (sql.includes("FROM student_learning_plan_versions")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const state = await new PostgresStudentOnboarding(pool, { now: () => now }).getState(userId);

    expect(state.current_step).toBe("diagnostic");
    expect(calls.some((call) => call.sql.includes("DELETE"))).toBe(false);
  });

  it("sanitizes a legacy completed profile at read time without rewriting its historical payload", async () => {
    const legacyProfile = {
      profile_id: "legacy_profile_1",
      version: 1,
      confidence: "low",
      confidence_explanation: "旧版结果包含固定题组。",
      generated_at: now.toISOString(),
      objective_evidence_count: 8,
      subjective_evidence_count: 4,
      unanswered_count: 0,
      priority_courses: courses.map((course, index) => ({
        course_id: course[0],
        course_title: course[1],
        priority: index === 0 ? "focus" : index === 1 ? "strengthen" : "maintain",
        self_assessment: "average",
        answered_count: 2,
        correct_count: 1,
        incorrect_count: 1,
        uncertain_count: 0,
        evidence_refs: [`self:${course[0]}`, `legacy-question:${index}`],
        risk_concepts: [],
        rationale: "旧版题目结果。",
      })),
      strengths: [],
      risk_concepts: [],
      boundary_note: "旧版边界。",
    };
    const legacyPlan = {
      plan_id: "legacy_plan_1",
      version: 1,
      source: "deterministic_fallback",
      ai_status: "unavailable",
      ai_status_message: "旧路径由诊断证据生成。",
      start_date: "2026-08-12",
      daily_minutes: 60,
      today_task_id: "legacy_task_1",
      generated_at: now,
    };
    const legacyTasks = Array.from({ length: 7 }, (_, index) => ({
      task_id: `legacy_task_${index + 1}`,
      day_index: index + 1,
      task_date: `2026-08-${String(12 + index).padStart(2, "0")}`,
      task_order: 1,
      course_id: courses[index % courses.length]![0],
      course_title: courses[index % courses.length]![1],
      concept_id: courses[index % courses.length]![4],
      concept_title: courses[index % courses.length]![5],
      task_type: "course_reading",
      estimated_minutes: 30,
      title: `学习任务 ${index + 1}`,
      reason: "快速诊断出现答错记录。",
      completion_criteria: "完成课程阅读。",
      href: `/student/courses/${courses[index % courses.length]![3]}`,
      evidence_refs: [
        `self:${courses[index % courses.length]![0]}`,
        `screening:${courses[index % courses.length]![0]}:q_${index + 1}`,
        `diagnostic:q_${index + 1}`,
      ],
      status: "pending",
    }));
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      if (sql.includes("FROM student_onboarding_states")) return result([stateRow({ status: "completed", current_step: "plan" })]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments);
      if (sql.includes("FROM student_initial_profile_versions")) return result([{ profile_payload: legacyProfile }]);
      if (sql.includes("FROM student_learning_plan_versions")) return result([legacyPlan]);
      if (sql.includes("FROM student_learning_plan_tasks task")) return result(legacyTasks);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const state = await new PostgresStudentOnboarding(pool, { now: () => now }).getState(userId);

    expect(state.profile).toMatchObject({
      profile_id: "legacy_profile_1",
      evidence_status: "accumulating",
      objective_evidence_count: 0,
      subjective_evidence_count: 4,
    });
    expect(state.profile?.priority_courses.every((course) => (
      course.evidence_level === "self_report_only"
      && course.evidence_refs.every((reference) => reference.startsWith("self:"))
    ))).toBe(true);
    expect(state.plan?.tasks.every((task) => (
      task.evidence_refs.some((reference) => reference.startsWith("self:"))
      && task.evidence_refs.some((reference) => reference.startsWith("screening:"))
      && task.evidence_refs.every((reference) => (
        reference.startsWith("self:") || reference.startsWith("screening:")
      ))
    ))).toBe(true);
    expect(JSON.stringify({ profile: state.profile, plan: state.plan })).not.toMatch(
      /legacy-question|diagnostic|诊断|题目结果|正确率|答错/iu,
    );
    expect(calls.some((call) => /^(UPDATE|DELETE)/u.test(call.sql.trim()))).toBe(false);
  });

  it("refuses completion until goals and all four self assessments exist", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_onboarding_states")) return result();
      if (sql.includes("FROM student_onboarding_states") && sql.includes("FOR UPDATE")) return result([stateRow()]);
      if (sql.includes("FROM student_onboarding_self_assessments")) return result(assessments.slice(0, 3));
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresStudentOnboarding(pool).completeSetup(userId)).rejects.toMatchObject({
      code: "ONBOARDING_SELF_ASSESSMENTS_INCOMPLETE",
      statusCode: 409,
    });
  });
});
