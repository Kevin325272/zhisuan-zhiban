import { randomUUID } from "node:crypto";
import { practiceSelectionSchema } from "@xuetu/contracts";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlQueryablePool } from "../src/database/client.js";
import { loadMigrations, runMigrations } from "../src/database/migrate.js";
import { PostgresMockExam } from "../src/services/question-bank/postgres-mock-exam.js";
import { PostgresQuestionBank } from "../src/services/question-bank/postgres-question-bank.js";

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim() ?? "";
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const schemaName = `xuetu_mock_exam_it_${process.pid}_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;

const creatorId = "user_mock_exam_integration_creator";
const studentId = "user_mock_exam_integration_student";
const courseId = "course_mock_exam_integration";
const questionId = "question_mock_exam_snapshot_001";
const frozenExplanation = "冻结评分快照解析。";
const liveExplanation = "源题修改后的实时解析。";
const now = new Date("2026-09-02T02:00:00.000Z");

function assertSafeSchemaName(value: string) {
  if (!/^xuetu_mock_exam_it_[a-z0-9_]+$/u.test(value)) {
    throw new Error("Unsafe PostgreSQL integration-test schema name.");
  }
}

describeWithPostgres("PostgresMockExam frozen evaluation snapshots", () => {
  let adminPool: Pool | undefined;
  let testPool: Pool | undefined;
  let schemaCreated = false;

  beforeAll(async () => {
    assertSafeSchemaName(schemaName);
    adminPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: "xuetu-mock-exam-integration-admin",
    });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;

    testPool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      application_name: "xuetu-mock-exam-integration",
      options: `-c search_path=${schemaName} -c statement_timeout=15000`,
    });
    await runMigrations(testPool as unknown as SqlQueryablePool, loadMigrations());

    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users(user_id, display_name, account_status, auth_source)
         VALUES ($1, $2, 'active', 'local_development'),
                ($3, $4, 'active', 'local_development')`,
        [creatorId, "模考集成测试创建者", studentId, "模考集成测试学生"],
      );
      await client.query(
        `INSERT INTO courses(course_id, course_code, title, discipline, status, created_by)
         VALUES ($1, $2, $3, $4, 'active', $5)`,
        [courseId, "MOCK-EXAM-IT", "模考快照集成测试课程", "计算机", creatorId],
      );
      await client.query(
        `INSERT INTO course_memberships(course_id, user_id, membership_role, status)
         VALUES ($1, $2, 'student', 'active')`,
        [courseId, studentId],
      );
      await client.query(
        `INSERT INTO course_catalog_entries(
           course_id, slug, question_subject, summary, display_order, material_status
         ) VALUES ($1, $2, $3, $4, $5, 'available')`,
        [courseId, "mock-exam-integration", "数据结构", "模考快照集成测试目录", 1],
      );
      await client.query(
        `INSERT INTO question_import_batches(
           import_batch_id, dataset_id, archive_sha256, source_provider, source_url,
           license_status, usage_scope, status, question_count, completed_at
         ) VALUES ($1, $2, $3, $4, $5, 'unverified', 'local_demo_only', 'completed', 1, $6)`,
        [
          "batch_mock_exam_integration",
          "dataset_mock_exam_integration",
          "a".repeat(64),
          "xuetu_integration_test",
          "https://example.invalid/mock-exam-integration",
          now.toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO questions(
           question_id, course_id, import_batch_id, year, number, subject,
           question_type, multiple, question_text, options, tags, assets,
           answer_key, explanation_text, solution_text, source_url,
           license_status, usage_scope, review_status, reviewed_by, reviewed_at
         ) VALUES (
           $1, $2, $3, 2026, 1, '数据结构',
           'choice', false, $4, $5::jsonb, ARRAY['mock-exam-integration']::text[], '[]'::jsonb,
           '["A"]'::jsonb, $6, NULL, $7,
           'unverified', 'local_demo_only', 'approved', $8, $9
         )`,
        [
          questionId,
          courseId,
          "batch_mock_exam_integration",
          "冻结评分应使用哪一个答案？",
          JSON.stringify([
            { option_id: "A", text: "选项 A", assets: [] },
            { option_id: "B", text: "选项 B", assets: [] },
          ]),
          frozenExplanation,
          "https://example.invalid/mock-exam-integration/question-1",
          creatorId,
          now.toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO question_learning_metadata(
           question_id, source_type, allowed_modes, paper_year,
           protect_full_paper, importance, content_review_status
         ) VALUES (
           $1, 'self_authored_practice', ARRAY['targeted', 'mock_exam']::text[], 2026,
           false, 'core', 'teacher_verified'
         )`,
        [questionId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }, 60_000);

  afterAll(async () => {
    await testPool?.end();
    if (adminPool && schemaCreated) {
      assertSafeSchemaName(schemaName);
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    }
    await adminPool?.end();
  }, 30_000);

  it("grades and persists from the frozen snapshot after the live question changes", async () => {
    if (!testPool) {
      throw new Error("PostgreSQL integration-test pool is unavailable.");
    }
    const sqlPool = testPool as unknown as SqlQueryablePool;
    const questionBank = new PostgresQuestionBank(sqlPool, courseId, {
      now: () => now,
      createId: (prefix) => `${prefix}_mock_exam_integration`,
    });
    const mockExam = new PostgresMockExam(sqlPool, questionBank, {
      now: () => now,
      createId: (prefix) => `${prefix}_mock_exam_integration`,
    });

    const started = await mockExam.start(studentId, { year: 2026 });

    expect(started).toMatchObject({
      year: 2026,
      status: "active",
      duration_minutes: 15,
      resumed: false,
    });
    expect(started.questions).toHaveLength(1);
    expect(started.questions[0]?.question).toMatchObject({
      id: questionId,
      type: "choice",
      options: [
        { option_id: "A", text: "选项 A", assets: [] },
        { option_id: "B", text: "选项 B", assets: [] },
      ],
    });

    const snapshotResult = await testPool.query<{
      question_payload: unknown;
      evaluation_payload: unknown;
    }>(
      `SELECT question_payload, evaluation_payload
       FROM practice_exam_session_questions
       WHERE session_id = $1 AND question_id = $2`,
      [started.session_id, questionId],
    );
    expect(snapshotResult.rowCount).toBe(1);
    const snapshot = snapshotResult.rows[0];
    expect(snapshot).toBeDefined();
    const publicSnapshot = JSON.stringify(snapshot?.question_payload);
    expect(publicSnapshot).not.toContain('"answer_key"');
    expect(publicSnapshot).not.toContain('"correct_option_ids"');
    expect(publicSnapshot).not.toContain('"explanation"');
    expect(publicSnapshot).not.toContain('"reference_solution"');
    expect(snapshot?.evaluation_payload).toMatchObject({
      course_id: courseId,
      answer_key: ["A"],
      explanation: frozenExplanation,
      reference_solution: null,
      answer_assets: [],
    });

    await testPool.query(
      `UPDATE questions
       SET review_status = 'rejected',
           answer_key = '["B"]'::jsonb,
           explanation_text = $2,
           updated_at = $3
       WHERE question_id = $1`,
      [questionId, liveExplanation, now.toISOString()],
    );

    const resumed = await mockExam.start(studentId, { year: 2026 });
    expect(resumed).toMatchObject({
      session_id: started.session_id,
      status: "active",
      resumed: true,
    });
    expect(resumed.questions).toEqual(started.questions);

    const submission = await mockExam.submit(
      studentId,
      started.session_id,
      {
        answers: [{
          question_id: questionId,
          answer_type: "choice",
          selected_option_ids: ["B"],
        }],
      },
      "mock-exam-integration-submit-001",
    );

    expect(submission).toMatchObject({
      session_id: started.session_id,
      status: "submitted",
      question_count: 1,
      answered_count: 1,
      unanswered_count: 0,
      objective: {
        question_count: 1,
        answered_count: 1,
        correct_count: 0,
        score: 0,
        max_score: 2,
      },
      subjective: {
        question_count: 0,
        submitted_count: 0,
        pending_review_count: 0,
      },
      score_status: "partial_pending_subjective_review",
      evaluations: [{
        question_id: questionId,
        grading_mode: "deterministic_choice",
        status: "incorrect",
        is_correct: false,
        score: 0,
        correct_option_ids: ["A"],
        explanation: frozenExplanation,
        review_required: false,
      }],
    });

    const persistedResult = await testPool.query<{
      attempt_id: string;
      attempt_user_id: string;
      attempt_course_id: string;
      attempt_question_id: string;
      selected_option_ids: string[];
      attempt_status: string;
      grading_mode: string;
      evaluation_status: string;
      is_correct: boolean;
      score: string;
      correct_option_ids: string[];
      explanation_text: string;
      evidence_outcome: string;
      evidence_grading_mode: string;
      eligible_for_learning_state_update: boolean;
      mistake_status: string;
      wrong_count: number;
      next_review_at: Date;
      review_last_processed_attempt_id: string;
      review_algorithm_version: string;
      memory_due: Date;
      memory_last_attempt_id: string;
      memory_algorithm_version: string;
      linked_attempt_id: string;
      exam_status: string;
      exam_submitted_at: Date;
    }>(
      `SELECT attempt.attempt_id,
              attempt.user_id AS attempt_user_id,
              attempt.course_id AS attempt_course_id,
              attempt.question_id AS attempt_question_id,
              attempt.selected_option_ids,
              attempt.status AS attempt_status,
              evaluation.grading_mode,
              evaluation.status AS evaluation_status,
              evaluation.is_correct,
              evaluation.score,
              evaluation.correct_option_ids,
              evaluation.explanation_text,
              evidence.outcome AS evidence_outcome,
              evidence.grading_mode AS evidence_grading_mode,
              evidence.eligible_for_learning_state_update,
              mistake.status AS mistake_status,
              mistake.wrong_count,
              review.next_review_at,
              review.last_processed_attempt_id AS review_last_processed_attempt_id,
              review.algorithm_version AS review_algorithm_version,
              memory.due AS memory_due,
              memory.last_attempt_id AS memory_last_attempt_id,
              memory.algorithm_version AS memory_algorithm_version,
              exam_attempt.attempt_id AS linked_attempt_id,
              exam_session.status AS exam_status,
              exam_session.submitted_at AS exam_submitted_at
       FROM practice_exam_sessions exam_session
       JOIN practice_exam_session_attempts exam_attempt
         ON exam_attempt.session_id = exam_session.session_id
        AND exam_attempt.question_id = $2
       JOIN practice_attempts attempt
         ON attempt.attempt_id = exam_attempt.attempt_id
       JOIN evaluations evaluation
         ON evaluation.attempt_id = attempt.attempt_id
       JOIN learning_evidence evidence
         ON evidence.attempt_id = attempt.attempt_id
        AND evidence.evaluation_id = evaluation.evaluation_id
       JOIN practice_mistakes mistake
         ON mistake.user_id = attempt.user_id
        AND mistake.question_id = attempt.question_id
       JOIN practice_mistake_review_states review
         ON review.mistake_id = mistake.mistake_id
       JOIN student_question_memory_states memory
         ON memory.user_id = attempt.user_id
        AND memory.question_id = attempt.question_id
       WHERE exam_session.session_id = $1`,
      [started.session_id, questionId],
    );

    expect(persistedResult.rowCount).toBe(1);
    const persisted = persistedResult.rows[0];
    expect(persisted).toMatchObject({
      attempt_user_id: studentId,
      attempt_course_id: courseId,
      attempt_question_id: questionId,
      selected_option_ids: ["B"],
      attempt_status: "evaluated",
      grading_mode: "deterministic_choice",
      evaluation_status: "incorrect",
      is_correct: false,
      correct_option_ids: ["A"],
      explanation_text: frozenExplanation,
      evidence_outcome: "incorrect",
      evidence_grading_mode: "deterministic_choice",
      eligible_for_learning_state_update: true,
      mistake_status: "needs_review",
      wrong_count: 1,
      review_algorithm_version: "fsrs_v6_ts_fsrs_5_4_1",
      memory_algorithm_version: "fsrs_v6_ts_fsrs_5_4_1",
      exam_status: "submitted",
    });
    expect(Number(persisted?.score)).toBe(0);
    expect(persisted?.linked_attempt_id).toBe(persisted?.attempt_id);
    expect(persisted?.review_last_processed_attempt_id).toBe(persisted?.attempt_id);
    expect(persisted?.memory_last_attempt_id).toBe(persisted?.attempt_id);
    expect(persisted?.next_review_at.getTime()).toBe(persisted?.memory_due.getTime());
    expect(persisted?.exam_submitted_at.toISOString()).toBe(now.toISOString());
  }, 30_000);

  async function localPastExamFixture(suffix: string) {
    if (!testPool) throw new Error("Integration pool unavailable");
    const userId = `user_local_past_${suffix}`;
    await testPool.query("INSERT INTO users(user_id,display_name,account_status,auth_source) VALUES ($1,'本地题库回归测试','active','local_development')", [userId]);
    await testPool.query("UPDATE questions SET year=2025,review_status='approved',answer_key='[\"A\"]'::jsonb WHERE question_id=$1", [questionId]);
    await testPool.query("UPDATE question_learning_metadata SET source_type='past_exam',paper_year=2025,content_review_status='demo_validated',protect_full_paper=false,allowed_modes=ARRAY['targeted','past_exam','mock_exam']::text[] WHERE question_id=$1", [questionId]);
    return { userId, pool: testPool as unknown as SqlQueryablePool };
  }

  it("uses the explicit local-demo setting consistently for practice and owned mistake review", async () => {
    const { pool, userId } = await localPastExamFixture("practice");
    const selection = practiceSelectionSchema.parse({ mode: "targeted", subject: "数据结构" });
    const strict = new PostgresQuestionBank(pool, courseId);
    const local = new PostgresQuestionBank(pool, courseId, { allowLocalDemoPastExams: true });
    expect((await strict.select(userId, selection)).total).toBe(0);
    expect((await local.select(userId, selection)).items.map(item => item.question.id)).toEqual([questionId]);
    await local.evaluate(userId, { question_id: questionId, answer_type: "choice", selected_option_ids: ["B"] }, "local-practice-wrong");
    const review = practiceSelectionSchema.parse({ mode: "mistake_review" });
    expect((await local.select(userId, review)).total).toBe(1);
    expect((await local.select(creatorId, review)).total).toBe(0);
    await testPool!.query("UPDATE question_learning_metadata SET protect_full_paper=true WHERE question_id=$1", [questionId]);
    expect((await local.select(userId, selection)).total).toBe(0);
    await testPool!.query("UPDATE question_learning_metadata SET protect_full_paper=false,content_review_status='pending_teacher_review' WHERE question_id=$1", [questionId]);
    expect((await local.select(userId, selection)).total).toBe(0);
  });

  it("starts and grades a local-demo paper without making it available in the default mode", async () => {
    const { pool, userId } = await localPastExamFixture("mock");
    const localBank = new PostgresQuestionBank(pool, courseId, { allowLocalDemoPastExams: true });
    await expect(new PostgresMockExam(pool, localBank).start(userId, {})).rejects.toMatchObject({ code: "MOCK_EXAM_YEAR_UNAVAILABLE" });
    const mock = new PostgresMockExam(pool, localBank, { allowLocalDemoPastExams: true });
    const started = await mock.start(userId, {});
    expect(started).toMatchObject({ year: 2025, duration_minutes: 180, status: "active" });
    expect(started.questions).toHaveLength(1);
    expect(started.questions[0]?.learning_metadata.content_review_status).toBe("demo_validated");
    expect(JSON.stringify(started)).not.toMatch(/answer_key|correct_option_ids|reference_solution/);
    const result = await mock.submit(userId, started.session_id, { answers: [{ question_id: questionId, answer_type: "choice", selected_option_ids: ["A"] }] }, "local-mock-submit");
    expect(result.objective).toMatchObject({ correct_count: 1, score: 2 });
  });
});
