import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { SqlQueryablePool } from "../src/database/client.js";
import { PostgresManagementService } from "../src/services/platform-management.js";

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim();
const clock = new Date("2026-09-10T04:00:00.000Z");
const query = { page: 1, page_size: 15, class_name: "all", learning_status: "all" as const };

(databaseUrl ? describe : describe.skip)("teacher roster learning activity in PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  let client: PoolClient;
  let service: PostgresManagementService;
  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    // Session-local empty tables exercise the real SQL without changing platform records.
    for (const table of ["users", "course_memberships", "student_academic_profiles", "academic_classes",
      "teacher_course_class_assignments", "student_onboarding_states", "student_learning_plan_versions",
      "student_learning_plan_tasks", "practice_attempts", "evaluations", "questions", "course_catalog_entries",
      "learning_evidence", "student_course_progress_snapshots", "practice_mistakes", "course_reading_progress",
      "course_reading_history", "course_core_concepts", "course_concept_sources", "course_concept_question_links",
      "programming_experiment_attempts", "student_concept_evidence_events"]) {
      await client.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
    }
    await client.query(`
      INSERT INTO users(user_id, display_name, account_status, last_login_at)
        VALUES ('roster-test', '测试学生', 'active', '2026-09-10T03:55:00Z');
      INSERT INTO course_memberships(user_id, course_id, membership_role, status)
        VALUES ('roster-test', 'course_408_ds', 'student', 'active');
      INSERT INTO student_academic_profiles(user_id, student_number, data_provenance)
        VALUES ('roster-test', '2415929999', 'registered_account');
      INSERT INTO course_catalog_entries(course_id, question_subject)
        VALUES ('course_408_ds','data_structures');
      INSERT INTO course_core_concepts(concept_id,course_id,title)
        VALUES ('ds-read','course_408_ds','树与二叉树'), ('ds-practice','course_408_ds','线性表'),
               ('ds-experiment','course_408_ds','实验过程'), ('cn-read','course_408_cn','网络分层');
      INSERT INTO course_concept_sources(concept_id, chunk_id, ordinal)
        VALUES ('ds-read','ds-chunk',1), ('cn-read','cn-chunk',1);
    `);
    service = new PostgresManagementService(client as unknown as SqlQueryablePool, () => clock);
  });
  afterEach(async () => { try { await client.query("ROLLBACK"); } finally { client.release(); } });
  afterAll(async () => { await pool.end(); });
  async function student() {
    return (await service.listCourseStudents("course_408_ds", { viewerUserId: "admin", viewerRole: "admin" }, query)).items[0]!;
  }
  async function snapshot() {
    await client.query(`INSERT INTO student_course_progress_snapshots
      (user_id,course_id,progress_percent,correct_count,incorrect_count,evidence_count,pending_review_count,
       weekly_study_minutes,current_focus,learning_status,last_active_at,data_provenance,generated_at)
      VALUES ('roster-test','course_408_ds',60,12,8,20,4,300,'旧体验知识点','needs_attention',
        '2026-08-24T12:00:00Z','synthetic_demo','2026-09-10T03:59:00Z')`);
  }
  it("keeps a dated demo as a demo and never treats its old weekly hours as current", async () => {
    await snapshot();
    expect(await student()).toMatchObject({
      focus_source: "demo_snapshot", current_focus: "旧体验知识点",
      last_active_at: "2026-08-24T12:00:00.000Z", recent_attempt_count: 0,
      weekly_study_minutes: 0, learning_status: "inactive",
    });
  });
  it("uses course reading and actual answer dates ahead of a freshly imported demo", async () => {
    await snapshot();
    await client.query(`
      INSERT INTO course_reading_progress(user_id,course_id,chunk_id,chapter,updated_at)
        VALUES ('roster-test','course_408_ds','ds-chunk','第五章','2026-09-09T12:23:00Z'),
               ('roster-test','course_408_cn','cn-chunk','第一章','2026-09-10T03:50:00Z');
      INSERT INTO questions(question_id, subject) VALUES ('q-ds','data_structures');
      INSERT INTO practice_attempts(attempt_id,user_id,course_id,concept_id,question_id,submitted_at)
        VALUES ('a1','roster-test','course_408_ds','ds-practice','q-ds','2026-09-09T11:17:00Z'),
               ('a2','roster-test','course_408_001','ds-practice','q-ds','2026-09-04T00:00:00Z'),
               ('a3','roster-test','course_408_ds','ds-practice','q-ds','2026-09-03T15:59:00Z');
      INSERT INTO evaluations(attempt_id,status) VALUES ('a1','correct'),('a2','incorrect'),('a3','correct');
    `);
    expect(await student()).toMatchObject({ current_focus: "树与二叉树", focus_source: "reading",
      last_active_at: "2026-09-09T12:23:00.000Z", recent_attempt_count: 2,
      correct_count: 2, incorrect_count: 1, learning_status: "on_track" });
  });
  it("does not call logging in or completing onboarding course learning", async () => {
    await client.query(`INSERT INTO student_onboarding_states(user_id,status,updated_at)
      VALUES ('roster-test','completed','2026-09-10T03:58:00Z')`);
    expect(await student()).toMatchObject({ last_active_at: null, current_focus: null,
      focus_source: "none", recent_attempt_count: 0, learning_status: "inactive" });
  });
  it("uses a saved experiment as the latest course activity, without inflating question counts", async () => {
    await snapshot();
    await client.query(`INSERT INTO programming_experiment_attempts
      (user_id,course_id,concept_id,created_at,result_status)
      VALUES ('roster-test','course_408_ds','ds-experiment','2026-09-09T10:43:00Z','passed')`);
    expect(await student()).toMatchObject({ current_focus: "实验过程", focus_source: "experiment",
      last_active_at: "2026-09-09T10:43:00.000Z", recent_attempt_count: 0 });
  });
  it("counts probe answers once and ignores future or other-course events", async () => {
    await client.query(`
      INSERT INTO student_concept_evidence_events
        (evidence_event_id,user_id,course_id,concept_id,attempt_id,outcome,data_origin,created_at)
      VALUES ('probe1','roster-test','course_408_ds','ds-practice',NULL,'correct','real_trial','2026-09-08T11:26:00Z'),
             ('future','roster-test','course_408_ds','ds-practice',NULL,'correct','real_trial','2026-09-11T11:26:00Z'),
             ('other','roster-test','course_408_cn','cn-read',NULL,'correct','real_trial','2026-09-09T11:26:00Z'),
             ('test','roster-test','course_408_ds','ds-practice',NULL,'correct','synthetic_verification','2026-09-10T01:26:00Z');
    `);
    expect(await student()).toMatchObject({ current_focus: "线性表", focus_source: "probe",
      last_active_at: "2026-09-08T11:26:00.000Z", recent_attempt_count: 1 });
  });
  it("shows the chapter when a reading position cannot identify one unique concept", async () => {
    await client.query(`
      INSERT INTO course_concept_sources(concept_id, chunk_id, ordinal) VALUES ('ds-practice','ds-chunk',2);
      INSERT INTO course_reading_progress(user_id,course_id,chunk_id,chapter,updated_at)
        VALUES ('roster-test','course_408_ds','ds-chunk','第五章','2026-09-09T12:23:00Z');
    `);
    expect(await student()).toMatchObject({ current_focus: "第五章", focus_source: "reading" });
  });
  it("resolves a practice topic only from a unique course question link", async () => {
    await client.query(`
      INSERT INTO questions(question_id,subject) VALUES ('linked-question','data_structures');
      INSERT INTO practice_attempts(attempt_id,user_id,course_id,question_id,submitted_at)
        VALUES ('linked-answer','roster-test','course_408_001','linked-question','2026-09-09T11:17:00Z');
      INSERT INTO course_concept_question_links(question_id,concept_id,status)
        VALUES ('linked-question','ds-practice','active');
    `);
    expect(await student()).toMatchObject({ current_focus: "线性表", focus_source: "practice", recent_attempt_count: 1 });
    await client.query(`INSERT INTO course_concept_question_links(question_id,concept_id,status)
      VALUES ('linked-question','ds-read','active')`);
    expect(await student()).toMatchObject({ current_focus: "课程练习", focus_source: "practice", recent_attempt_count: 1 });
  });
});
