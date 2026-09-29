import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlQueryablePool } from "../src/database/client.js";
import { loadMigrations, runMigrations } from "../src/database/migrate.js";
import { ClassEnrollmentError } from "../src/services/class-enrollment/class-enrollment.js";
import { PostgresClassEnrollment } from "../src/services/class-enrollment/postgres-class-enrollment.js";
import {
  ManagementAccessDeniedError,
  ManagementInterventionTargetNotFoundError,
  ManagementResourceNotFoundError,
  PostgresManagementService,
} from "../src/services/platform-management.js";

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim() ?? "";
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const schemaName = `xuetu_teacher_class_it_${process.pid}_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;

const adminId = "user_teacher_class_it_admin";
const teacherAId = "user_teacher_class_it_teacher_a";
const teacherBId = "user_teacher_class_it_teacher_b";
const memberAId = "user_teacher_class_it_member_a";
const memberBId = "user_teacher_class_it_member_b";
const applicantAId = "user_teacher_class_it_applicant_a";
const applicantBId = "user_teacher_class_it_applicant_b";
const courseId = "course_teacher_class_it";
const classAId = "class_teacher_class_it_a";
const classBId = "class_teacher_class_it_b";
const missingClassId = "class_teacher_class_it_missing";
const invitationAId = "invitation_teacher_class_it_a";
const invitationBId = "invitation_teacher_class_it_b";
const requestAId = "request_teacher_class_it_a";
const requestBId = "request_teacher_class_it_b";
const missingRequestId = "request_teacher_class_it_missing";
const conceptId = "concept_teacher_class_it";
const questionId = "question_teacher_class_it";
const interventionAId = "intervention_teacher_class_it_seed_a";
const interventionBId = "intervention_teacher_class_it_seed_b";
const missingInterventionId = "intervention_teacher_class_it_missing";
const missingStudentCode = "P00000000";
const now = new Date("2026-09-02T02:00:00.000Z");
const evidenceAt = new Date("2026-09-01T12:00:00.000Z");

const teacherAViewer = {
  viewerUserId: teacherAId,
  viewerRole: "teacher",
} as const;
const teacherBViewer = {
  viewerUserId: teacherBId,
  viewerRole: "teacher",
} as const;
const adminViewer = {
  viewerUserId: adminId,
  viewerRole: "admin",
} as const;

interface CapturedOutcome {
  ok: boolean;
  error?: unknown;
}

function assertSafeSchemaName(value: string) {
  if (!/^xuetu_teacher_class_it_[a-z0-9_]+$/u.test(value)) {
    throw new Error("Unsafe PostgreSQL integration-test schema name.");
  }
}

function normalizedInvitationCode(value: string): string {
  return value.replace(/[\s-]/gu, "").toUpperCase();
}

function invitationHash(value: string): string {
  return createHash("sha256").update(normalizedInvitationCode(value)).digest("hex");
}

function studentCode(userId: string): string {
  return `P${createHash("md5").update(userId).digest("hex").slice(0, 8).toUpperCase()}`;
}

async function captureOutcome(operation: () => Promise<unknown>): Promise<CapturedOutcome> {
  try {
    await operation();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function rejectedError(outcome: CapturedOutcome): Error {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("Expected operation to reject.");
  expect(outcome.error).toBeInstanceOf(Error);
  if (!(outcome.error instanceof Error)) throw new Error("Expected an Error rejection.");
  return outcome.error;
}

function classEnrollmentErrorShape(error: Error) {
  const domainError = error as ClassEnrollmentError;
  return {
    name: error.name,
    code: domainError.code,
    statusCode: domainError.statusCode,
    message: error.message,
  };
}

function errorShape(error: Error) {
  return { name: error.name, message: error.message };
}

describeWithPostgres("PostgreSQL teacher and class authorization isolation", () => {
  let adminPool: Pool | undefined;
  let testPool: Pool | undefined;
  let schemaCreated = false;

  beforeAll(async () => {
    assertSafeSchemaName(schemaName);
    adminPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: "xuetu-teacher-class-isolation-admin",
    });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;

    testPool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      application_name: "xuetu-teacher-class-isolation",
      options: `-c search_path=${schemaName} -c statement_timeout=15000`,
    });
    await runMigrations(testPool as unknown as SqlQueryablePool, loadMigrations());

    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users(user_id, display_name, account_status, auth_source, created_at, updated_at)
         VALUES ($1, '隔离测试管理员', 'active', 'local_development', $8, $8),
                ($2, '隔离测试教师甲', 'active', 'local_development', $8, $8),
                ($3, '隔离测试教师乙', 'active', 'local_development', $8, $8),
                ($4, '隔离测试学生甲', 'active', 'local_development', $8, $8),
                ($5, '隔离测试学生乙', 'active', 'local_development', $8, $8),
                ($6, '隔离测试申请人甲', 'active', 'local_development', $8, $8),
                ($7, '隔离测试申请人乙', 'active', 'local_development', $8, $8)`,
        [
          adminId,
          teacherAId,
          teacherBId,
          memberAId,
          memberBId,
          applicantAId,
          applicantBId,
          evidenceAt.toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO roles(role_key, label, description)
         VALUES ('admin', '管理员', '隔离测试管理员角色'),
                ('teacher', '教师', '隔离测试教师角色'),
                ('student', '学生', '隔离测试学生角色')`,
      );
      await client.query(
        `INSERT INTO user_roles(user_id, role_key, granted_by, granted_at)
         VALUES ($1, 'admin', $1, $8),
                ($2, 'teacher', $1, $8),
                ($3, 'teacher', $1, $8),
                ($4, 'student', $1, $8),
                ($5, 'student', $1, $8),
                ($6, 'student', $1, $8),
                ($7, 'student', $1, $8)`,
        [
          adminId,
          teacherAId,
          teacherBId,
          memberAId,
          memberBId,
          applicantAId,
          applicantBId,
          evidenceAt.toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO courses(course_id, course_code, title, discipline, status, created_by, created_at, updated_at)
         VALUES ($1, 'CLASS-ISOLATION-IT', '教师班级隔离集成测试课程', '计算机', 'active', $2, $3, $3)`,
        [courseId, adminId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO course_memberships(course_id, user_id, membership_role, status, created_at)
         VALUES ($1, $2, 'teacher', 'active', $6),
                ($1, $3, 'teacher', 'active', $6),
                ($1, $4, 'student', 'active', $6),
                ($1, $5, 'student', 'active', $6)`,
        [
          courseId,
          teacherAId,
          teacherBId,
          memberAId,
          memberBId,
          evidenceAt.toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO course_catalog_entries(
           course_id, slug, question_subject, summary, display_order, material_status, created_at, updated_at
         ) VALUES ($1, 'teacher-class-isolation', '教师班级隔离', '教师班级隔离集成测试目录', 1, 'available', $2, $2)`,
        [courseId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO academic_classes(
           class_id, cohort_year, major, class_name, data_provenance, created_at, updated_at
         ) VALUES ($1, 2026, '计算机科学', '隔离测试一班', 'user_provided', $3, $3),
                  ($2, 2026, '计算机科学', '隔离测试二班', 'user_provided', $3, $3)`,
        [classAId, classBId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO teacher_academic_profiles(
           user_id, teacher_number, department, professional_title, data_provenance, created_at, updated_at
         ) VALUES ($1, 'T-ISO-A', '计算机学院', '讲师', 'user_provided', $3, $3),
                  ($2, 'T-ISO-B', '计算机学院', '讲师', 'user_provided', $3, $3)`,
        [teacherAId, teacherBId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO student_academic_profiles(
           user_id, student_number, class_id, data_provenance, created_at, updated_at
         ) VALUES ($1, '2026000001', $3, 'user_provided', $5, $5),
                  ($2, '2026000002', $4, 'user_provided', $5, $5)`,
        [memberAId, memberBId, classAId, classBId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO teacher_course_class_assignments(
           teacher_user_id, course_id, class_id, data_provenance, created_at
         ) VALUES ($1, $3, $4, 'user_provided', $6),
                  ($2, $3, $5, 'user_provided', $6)`,
        [teacherAId, teacherBId, courseId, classAId, classBId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO class_invitation_codes(
           invitation_id, class_id, course_id, created_by, code_hash, code_suffix,
           expires_at, revoked_at, created_at
         ) VALUES ($1, $3, $5, $6, $7, 'BBBB', $11, NULL, $10),
                  ($2, $4, $5, $8, $9, 'CCCC', $11, NULL, $10)`,
        [
          invitationAId,
          invitationBId,
          classAId,
          classBId,
          courseId,
          teacherAId,
          invitationHash("AAAA-BBBB"),
          teacherBId,
          invitationHash("BBBB-CCCC"),
          evidenceAt.toISOString(),
          "2026-09-10T02:00:00.000Z",
        ],
      );
      await client.query(
        `INSERT INTO class_enrollment_requests(
           request_id, user_id, invitation_id, class_id, course_id, student_number,
           status, reviewed_by, reviewed_at, created_at, updated_at
         ) VALUES ($1, $3, $5, $7, $9, '2026000003', 'pending', NULL, NULL, $10, $10),
                  ($2, $4, $6, $8, $9, '2026000004', 'pending', NULL, NULL, $10, $10)`,
        [
          requestAId,
          requestBId,
          applicantAId,
          applicantBId,
          invitationAId,
          invitationBId,
          classAId,
          classBId,
          courseId,
          evidenceAt.toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO course_content_sources(
           source_id, course_id, dataset_id, source_kind, title, source_provider,
           original_path, storage_ref, sha256, record_count, license_status, usage_scope,
           provenance_status, ingestion_mode, imported_at, updated_at
         ) VALUES (
           'source_teacher_class_it', $1, 'dataset_teacher_class_it', 'curriculum_map',
           '教师班级隔离课程图', 'xuetu_integration_test', 'fixtures/teacher-class-isolation.json',
           'integration://teacher-class-isolation', $2, 1, 'unverified', 'local_demo_only',
           'source_unknown_unverified', 'postgresql_content', $3, $3
         )`,
        [courseId, "b".repeat(64), evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO course_learning_modules(
           module_id, source_id, course_id, chapter_id, source_chapter, chapter_title,
           chapter_ordinal, title, ordinal, created_at, updated_at
         ) VALUES (
           'module_teacher_class_it', 'source_teacher_class_it', $1, 'chapter-isolation',
           '教师班级隔离章节', '教师班级隔离章节', 1, '授权隔离模块', 1, $2, $2
         )`,
        [courseId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO course_core_concepts(
           concept_id, module_id, course_id, title, learning_objective, learning_note_kind,
           learning_note_text, importance, review_status, ordinal, created_at, updated_at
         ) VALUES (
           $1, 'module_teacher_class_it', $2, '班级授权隔离',
           '能够验证同一课程中不同教师只能访问自己被分配的班级。',
           'reminder', '必须同时校验课程、班级和教师身份。', 'core', 'verified', 1, $3, $3
         )`,
        [conceptId, courseId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO question_import_batches(
           import_batch_id, dataset_id, archive_sha256, source_provider, source_url,
           license_status, usage_scope, status, question_count, completed_at
         ) VALUES (
           'batch_teacher_class_it', 'dataset_question_teacher_class_it', $1,
           'xuetu_integration_test', 'https://example.invalid/teacher-class-isolation',
           'unverified', 'local_demo_only', 'completed', 1, $2
         )`,
        ["c".repeat(64), evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO questions(
           question_id, course_id, import_batch_id, year, number, subject,
           question_type, multiple, question_text, options, tags, assets,
           answer_key, explanation_text, solution_text, source_url,
           license_status, usage_scope, review_status, reviewed_by, reviewed_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, 'batch_teacher_class_it', 2026, 1, '教师班级隔离',
           'choice', false, '授权必须使用哪一组关系？', $3::jsonb,
           ARRAY['班级授权隔离']::text[], '[]'::jsonb, '["A"]'::jsonb,
           '教师、课程与班级的精确关系。', NULL,
           'https://example.invalid/teacher-class-isolation/question-1',
           'unverified', 'local_demo_only', 'approved', $4, $5, $5, $5
         )`,
        [
          questionId,
          courseId,
          JSON.stringify([
            { option_id: "A", text: "教师、课程与班级三元组", assets: [] },
            { option_id: "B", text: "仅课程关系", assets: [] },
          ]),
          adminId,
          evidenceAt.toISOString(),
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
      await client.query(
        `INSERT INTO course_concept_question_links(
           concept_id, question_id, matched_tag, match_method, rule_version,
           status, created_at, updated_at
         ) VALUES (
           $1, $2, '班级授权隔离', 'exact_question_tag', 'v1_exact_unique_tag',
           'active', $3, $3
         )`,
        [conceptId, questionId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO practice_attempts(
           attempt_id, user_id, course_id, question_id, concept_id, answer_type,
           selected_option_ids, response_text, status, submitted_at
         ) VALUES (
           'attempt_teacher_class_it_a', $1, $3, $4, $5, 'choice', '["A"]'::jsonb,
           NULL, 'evaluated', $6
         ), (
           'attempt_teacher_class_it_b', $2, $3, $4, $5, 'choice', '["A"]'::jsonb,
           NULL, 'evaluated', $6
         )`,
        [memberAId, memberBId, courseId, questionId, conceptId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO evaluations(
           evaluation_id, attempt_id, grading_mode, status, is_correct, score,
           correct_option_ids, explanation_text, reference_solution, review_required, created_at
         ) VALUES (
           'evaluation_teacher_class_it_a', 'attempt_teacher_class_it_a',
           'deterministic_choice', 'correct', true, 2, '["A"]'::jsonb,
           '教师、课程与班级的精确关系。', NULL, false, $1
         ), (
           'evaluation_teacher_class_it_b', 'attempt_teacher_class_it_b',
           'deterministic_choice', 'correct', true, 2, '["A"]'::jsonb,
           '教师、课程与班级的精确关系。', NULL, false, $1
         )`,
        [evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO learning_evidence(
           evidence_id, evaluation_id, attempt_id, user_id, course_id, question_id,
           concept_id, outcome, grading_mode, evidence_payload,
           eligible_for_learning_state_update, created_at
         ) VALUES (
           'evidence_teacher_class_it_a', 'evaluation_teacher_class_it_a',
           'attempt_teacher_class_it_a', $1, $3, $4, $5, 'correct',
           'deterministic_choice', '{}'::jsonb, true, $6
         ), (
           'evidence_teacher_class_it_b', 'evaluation_teacher_class_it_b',
           'attempt_teacher_class_it_b', $2, $3, $4, $5, 'correct',
           'deterministic_choice', '{}'::jsonb, true, $6
         )`,
        [memberAId, memberBId, courseId, questionId, conceptId, evidenceAt.toISOString()],
      );
      await client.query(
        `INSERT INTO teacher_interventions(
           intervention_id, course_id, concept_id, actor_user_id, action, note,
           target_type, target_class_id, target_user_id, material_ref, due_at,
           status, delivered_at, completed_at, evidence_snapshot, created_at, updated_at
         ) VALUES (
           $1, $3, $4, $5, 'assign_review', '管理员为一班创建的隔离验证干预',
           'class', $6, NULL, NULL, NULL, 'planned', NULL, NULL, NULL, $8, $8
         ), (
           $2, $3, $4, $5, 'assign_review', '管理员为二班创建的隔离验证干预',
           'class', $7, NULL, NULL, NULL, 'planned', NULL, NULL, NULL, $8, $8
         )`,
        [
          interventionAId,
          interventionBId,
          courseId,
          conceptId,
          adminId,
          classAId,
          classBId,
          evidenceAt.toISOString(),
        ],
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

  it("scopes reads and makes cross-class denials indistinguishable without partial writes", async () => {
    if (!testPool) throw new Error("PostgreSQL integration-test pool is unavailable.");
    const sqlPool = testPool as unknown as SqlQueryablePool;
    let sequence = 0;
    const classEnrollment = new PostgresClassEnrollment(sqlPool, {
      now: () => now,
      createId: (prefix) => `${prefix}_teacher_class_it_${++sequence}`,
      createInvitationCode: () => "CCCC-DDDD",
    });
    const management = new PostgresManagementService(
      sqlPool,
      () => now,
      (prefix) => `${prefix}_teacher_class_it_${++sequence}`,
    );

    const [classViewA, classViewB, classViewAdmin] = await Promise.all([
      classEnrollment.listTeacherClasses(courseId, teacherAViewer),
      classEnrollment.listTeacherClasses(courseId, teacherBViewer),
      classEnrollment.listTeacherClasses(courseId, adminViewer),
    ]);
    expect(classViewA.classes.map((value) => value.class_id)).toEqual([classAId]);
    expect(classViewA.pending_requests.map((value) => value.request_id)).toEqual([requestAId]);
    expect(classViewA.members.map((value) => value.student_code)).toEqual([studentCode(memberAId)]);
    expect(classViewB.classes.map((value) => value.class_id)).toEqual([classBId]);
    expect(classViewB.pending_requests.map((value) => value.request_id)).toEqual([requestBId]);
    expect(classViewB.members.map((value) => value.student_code)).toEqual([studentCode(memberBId)]);
    expect(classViewAdmin.classes.map((value) => value.class_id).sort()).toEqual([classAId, classBId]);
    expect(classViewAdmin.pending_requests.map((value) => value.request_id).sort()).toEqual([
      requestAId,
      requestBId,
    ]);
    expect(classViewAdmin.members.map((value) => value.student_code).sort()).toEqual([
      studentCode(memberAId),
      studentCode(memberBId),
    ].sort());

    const rosterQuery = {
      page: 1,
      page_size: 50,
      class_name: "assigned",
      learning_status: "all",
    } as const;
    const [rosterA, rosterB, rosterAdmin] = await Promise.all([
      management.listCourseStudents(courseId, teacherAViewer, rosterQuery),
      management.listCourseStudents(courseId, teacherBViewer, rosterQuery),
      management.listCourseStudents(courseId, adminViewer, rosterQuery),
    ]);
    expect(rosterA.items.map((value) => value.student_code)).toEqual([studentCode(memberAId)]);
    expect(rosterA.totalItems).toBe(1);
    expect(rosterB.items.map((value) => value.student_code)).toEqual([studentCode(memberBId)]);
    expect(rosterB.totalItems).toBe(1);
    expect(rosterAdmin.items.map((value) => value.student_code).sort()).toEqual([
      studentCode(memberAId),
      studentCode(memberBId),
    ].sort());
    expect(rosterAdmin.totalItems).toBe(2);

    const [summaryA, summaryB, summaryAdmin] = await Promise.all([
      management.getLearningSummary(courseId, teacherAViewer),
      management.getLearningSummary(courseId, teacherBViewer),
      management.getLearningSummary(courseId, adminViewer),
    ]);
    expect(summaryA).toMatchObject({
      active_students: 1,
      attempt_count: 1,
      deterministic_correct_count: 1,
      deterministic_incorrect_count: 0,
      pending_review_count: 0,
      evidence_count: 1,
    });
    expect(summaryB).toMatchObject({
      active_students: 1,
      attempt_count: 1,
      deterministic_correct_count: 1,
      deterministic_incorrect_count: 0,
      pending_review_count: 0,
      evidence_count: 1,
    });
    expect(summaryAdmin).toMatchObject({
      active_students: 2,
      attempt_count: 2,
      deterministic_correct_count: 2,
      deterministic_incorrect_count: 0,
      pending_review_count: 0,
      evidence_count: 2,
    });

    const [evidenceA, evidenceB, evidenceAdmin] = await Promise.all([
      management.getCourseEvidence(courseId, teacherAViewer),
      management.getCourseEvidence(courseId, teacherBViewer),
      management.getCourseEvidence(courseId, adminViewer),
    ]);
    for (const evidence of [evidenceA, evidenceB]) {
      expect(evidence).toMatchObject({
        active_student_count: 1,
        evidence_status: "insufficient_sample",
        sample: {
          minimum_students: 5,
          active_student_count: 1,
          active_window_student_count: 1,
          valid_attempt_student_count: 1,
          sufficient: false,
        },
        source_breakdown: {
          local_demo: {
            student_count: 1,
            valid_attempt_count: 1,
            incorrect_count: 0,
            error_rate: 0,
          },
        },
      });
      expect(evidence.top_weak_concepts).toEqual([]);
    }
    expect(evidenceA.recent_interventions.map((value) => value.intervention_id)).toEqual([
      interventionAId,
    ]);
    expect(evidenceB.recent_interventions.map((value) => value.intervention_id)).toEqual([
      interventionBId,
    ]);
    expect(evidenceAdmin).toMatchObject({
      active_student_count: 2,
      evidence_status: "insufficient_sample",
      sample: {
        minimum_students: 5,
        active_student_count: 2,
        active_window_student_count: 2,
        valid_attempt_student_count: 2,
        sufficient: false,
      },
      source_breakdown: {
        local_demo: {
          student_count: 2,
          valid_attempt_count: 2,
          incorrect_count: 0,
          error_rate: 0,
        },
      },
    });
    expect(evidenceAdmin.top_weak_concepts).toEqual([]);
    expect(evidenceAdmin.recent_interventions.map((value) => value.intervention_id).sort()).toEqual([
      interventionAId,
      interventionBId,
    ]);

    const memberACode = studentCode(memberAId);
    const memberBCode = studentCode(memberBId);
    expect([memberACode, memberBCode]).not.toContain(missingStudentCode);

    const outcomes = {
      createInvitationB: await captureOutcome(() => classEnrollment.createInvitation(
        courseId,
        classBId,
        teacherAViewer,
      )),
      createInvitationMissing: await captureOutcome(() => classEnrollment.createInvitation(
        courseId,
        missingClassId,
        teacherAViewer,
      )),
      revokeInvitationB: await captureOutcome(() => classEnrollment.revokeInvitation(
        courseId,
        classBId,
        teacherAViewer,
      )),
      revokeInvitationMissing: await captureOutcome(() => classEnrollment.revokeInvitation(
        courseId,
        missingClassId,
        teacherAViewer,
      )),
      decideRequestB: await captureOutcome(() => classEnrollment.decideRequest(
        courseId,
        classBId,
        requestBId,
        teacherAViewer,
        { decision: "approved" },
      )),
      decideRequestMissing: await captureOutcome(() => classEnrollment.decideRequest(
        courseId,
        classBId,
        missingRequestId,
        teacherAViewer,
        { decision: "approved" },
      )),
      removeMemberB: await captureOutcome(() => classEnrollment.removeMember(
        courseId,
        classBId,
        memberBCode,
        teacherAViewer,
      )),
      removeMemberMissing: await captureOutcome(() => classEnrollment.removeMember(
        courseId,
        classBId,
        missingStudentCode,
        teacherAViewer,
      )),
      createClassInterventionB: await captureOutcome(() => management.recordTeacherIntervention(
        courseId,
        teacherAViewer,
        {
          concept_id: conceptId,
          action: "assign_review",
          note: "跨班级目标不应写入",
          target_type: "class",
          target_class_id: classBId,
        },
      )),
      createClassInterventionMissing: await captureOutcome(() => management.recordTeacherIntervention(
        courseId,
        teacherAViewer,
        {
          concept_id: conceptId,
          action: "assign_review",
          note: "不存在班级目标不应写入",
          target_type: "class",
          target_class_id: missingClassId,
        },
      )),
      createStudentInterventionB: await captureOutcome(() => management.recordTeacherIntervention(
        courseId,
        teacherAViewer,
        {
          concept_id: conceptId,
          action: "assign_review",
          note: "跨班级学生目标不应写入",
          target_type: "student",
          target_student_code: memberBCode,
        },
      )),
      createStudentInterventionMissing: await captureOutcome(() => management.recordTeacherIntervention(
        courseId,
        teacherAViewer,
        {
          concept_id: conceptId,
          action: "assign_review",
          note: "不存在学生目标不应写入",
          target_type: "student",
          target_student_code: missingStudentCode,
        },
      )),
      updateInterventionB: await captureOutcome(() => management.updateTeacherInterventionStatus(
        courseId,
        interventionBId,
        teacherAViewer,
        { status: "sent" },
      )),
      updateInterventionMissing: await captureOutcome(() => management.updateTeacherInterventionStatus(
        courseId,
        missingInterventionId,
        teacherAViewer,
        { status: "sent" },
      )),
    };

    const [invitationState, requestState, memberState, interventionState, interventionCount] =
      await Promise.all([
        testPool.query<{
          invitation_id: string;
          revoked_at: Date | null;
        }>(
          `SELECT invitation_id, revoked_at
             FROM class_invitation_codes
            WHERE course_id = $1 AND class_id = $2
            ORDER BY created_at, invitation_id`,
          [courseId, classBId],
        ),
        testPool.query<{
          status: string;
          reviewed_by: string | null;
          reviewed_at: Date | null;
        }>(
          `SELECT status, reviewed_by, reviewed_at
             FROM class_enrollment_requests
            WHERE request_id = $1`,
          [requestBId],
        ),
        testPool.query<{
          class_id: string;
          membership_role: string;
          membership_status: string;
        }>(
          `SELECT profile.class_id, membership.membership_role,
                  membership.status AS membership_status
             FROM student_academic_profiles profile
             JOIN course_memberships membership
               ON membership.user_id = profile.user_id
              AND membership.course_id = $2
            WHERE profile.user_id = $1`,
          [memberBId, courseId],
        ),
        testPool.query<{
          status: string;
          delivered_at: Date | null;
          completed_at: Date | null;
          evidence_snapshot: unknown;
        }>(
          `SELECT status, delivered_at, completed_at, evidence_snapshot
             FROM teacher_interventions
            WHERE intervention_id = $1`,
          [interventionBId],
        ),
        testPool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM teacher_interventions WHERE course_id = $1",
          [courseId],
        ),
      ]);

    expect(invitationState.rows).toEqual([{
      invitation_id: invitationBId,
      revoked_at: null,
    }]);
    expect(requestState.rows).toEqual([{
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
    }]);
    expect(memberState.rows).toEqual([{
      class_id: classBId,
      membership_role: "student",
      membership_status: "active",
    }]);
    expect(interventionState.rows).toEqual([{
      status: "planned",
      delivered_at: null,
      completed_at: null,
      evidence_snapshot: null,
    }]);
    expect(interventionCount.rows[0]?.count).toBe("2");

    const classScopePairs: ReadonlyArray<readonly [CapturedOutcome, CapturedOutcome]> = [
      [outcomes.createInvitationB, outcomes.createInvitationMissing],
      [outcomes.revokeInvitationB, outcomes.revokeInvitationMissing],
      [outcomes.decideRequestB, outcomes.decideRequestMissing],
      [outcomes.removeMemberB, outcomes.removeMemberMissing],
    ];
    for (const [existing, missing] of classScopePairs) {
      const existingError = rejectedError(existing);
      const missingError = rejectedError(missing);
      expect(existingError).toBeInstanceOf(ClassEnrollmentError);
      expect(missingError).toBeInstanceOf(ClassEnrollmentError);
      expect(classEnrollmentErrorShape(existingError)).toEqual({
        name: "ClassEnrollmentError",
        code: "CLASS_ACCESS_DENIED",
        statusCode: 403,
        message: "当前教师不能管理这个班级。",
      });
      expect(classEnrollmentErrorShape(missingError)).toEqual(classEnrollmentErrorShape(existingError));
    }

    const classInterventionExistingError = rejectedError(outcomes.createClassInterventionB);
    const classInterventionMissingError = rejectedError(outcomes.createClassInterventionMissing);
    expect(classInterventionExistingError).toBeInstanceOf(ManagementAccessDeniedError);
    expect(classInterventionMissingError).toBeInstanceOf(ManagementAccessDeniedError);
    expect(errorShape(classInterventionMissingError)).toEqual(errorShape(classInterventionExistingError));

    const studentInterventionExistingError = rejectedError(outcomes.createStudentInterventionB);
    const studentInterventionMissingError = rejectedError(outcomes.createStudentInterventionMissing);
    expect(studentInterventionExistingError).toBeInstanceOf(
      ManagementInterventionTargetNotFoundError,
    );
    expect(studentInterventionMissingError).toBeInstanceOf(
      ManagementInterventionTargetNotFoundError,
    );
    expect(errorShape(studentInterventionMissingError)).toEqual(
      errorShape(studentInterventionExistingError),
    );

    const statusExistingError = rejectedError(outcomes.updateInterventionB);
    const statusMissingError = rejectedError(outcomes.updateInterventionMissing);
    expect(statusExistingError).toBeInstanceOf(ManagementResourceNotFoundError);
    expect(statusMissingError).toBeInstanceOf(ManagementResourceNotFoundError);
    expect(errorShape(statusMissingError)).toEqual(errorShape(statusExistingError));

    const createdInvitation = await classEnrollment.createInvitation(
      courseId,
      classAId,
      teacherAViewer,
    );
    expect(createdInvitation).toMatchObject({
      class_id: classAId,
      invite_code: "CCCC-DDDD",
      code_hint: "****-DDDD",
    });
    await expect(classEnrollment.revokeInvitation(
      courseId,
      classAId,
      teacherAViewer,
    )).resolves.toEqual({ revoked: true });

    const approved = await classEnrollment.decideRequest(
      courseId,
      classAId,
      requestAId,
      teacherAViewer,
      { decision: "approved" },
    );
    expect(approved.status).toBe("approved");
    await expect(classEnrollment.removeMember(
      courseId,
      classAId,
      memberACode,
      teacherAViewer,
    )).resolves.toEqual({ removed: true });

    const createdIntervention = await management.recordTeacherIntervention(
      courseId,
      teacherAViewer,
      {
        concept_id: conceptId,
        action: "assign_review",
        note: "教师甲合法的一班复习干预",
        target_type: "class",
        target_class_id: classAId,
      },
    );
    expect(createdIntervention).toMatchObject({
      course_id: courseId,
      concept_id: conceptId,
      target_type: "class",
      target_class_id: classAId,
      status: "planned",
    });
    const sentIntervention = await management.updateTeacherInterventionStatus(
      courseId,
      createdIntervention.intervention_id,
      teacherAViewer,
      { status: "sent" },
    );
    expect(sentIntervention).toMatchObject({
      intervention_id: createdIntervention.intervention_id,
      status: "sent",
      delivered_at: now.toISOString(),
    });

    const positiveState = await testPool.query<{
      applicant_status: string;
      applicant_reviewer: string;
      applicant_class_id: string;
      applicant_membership_status: string;
      removed_profile_count: number;
      retained_membership_status: string;
      active_invitation_count: number;
    }>(
      `SELECT request.status AS applicant_status,
              request.reviewed_by AS applicant_reviewer,
              applicant_profile.class_id AS applicant_class_id,
              applicant_membership.status AS applicant_membership_status,
              (SELECT COUNT(*)::int FROM student_academic_profiles
                WHERE user_id = $5) AS removed_profile_count,
              retained_membership.status AS retained_membership_status,
              (SELECT COUNT(*)::int FROM class_invitation_codes
                WHERE course_id = $1 AND class_id = $2 AND revoked_at IS NULL)
                AS active_invitation_count
         FROM class_enrollment_requests request
         JOIN student_academic_profiles applicant_profile
           ON applicant_profile.user_id = request.user_id
         JOIN course_memberships applicant_membership
           ON applicant_membership.user_id = request.user_id
          AND applicant_membership.course_id = request.course_id
         JOIN course_memberships retained_membership
           ON retained_membership.user_id = $5
          AND retained_membership.course_id = request.course_id
        WHERE request.request_id = $3
          AND request.course_id = $1
          AND request.class_id = $2
          AND request.reviewed_by = $4`,
      [courseId, classAId, requestAId, teacherAId, memberAId],
    );
    expect(positiveState.rows[0]).toEqual({
      applicant_status: "approved",
      applicant_reviewer: teacherAId,
      applicant_class_id: classAId,
      applicant_membership_status: "active",
      removed_profile_count: 0,
      retained_membership_status: "active",
      active_invitation_count: 0,
    });
  }, 60_000);
});
