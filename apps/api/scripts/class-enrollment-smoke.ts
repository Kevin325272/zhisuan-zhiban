import { randomUUID } from "node:crypto";

import { readDatabaseConfig } from "../src/config/database.js";
import { loadLocalEnvironment } from "../src/config/local-env.js";
import { createPostgresPool } from "../src/database/client.js";
import { PostgresClassEnrollment } from "../src/services/class-enrollment/postgres-class-enrollment.js";

loadLocalEnvironment();

const pool = createPostgresPool(readDatabaseConfig());
const token = randomUUID().replaceAll("-", "").slice(0, 12);
const userId = `smoke_class_student_${token}`;
const username = `smoke_${token}`;
const studentNumber = `9${Date.now().toString().slice(-9)}`;
const classId = `class_smoke_${token}`;
const invitationId = `class_invitation_smoke_${token}`;
const requestId = `enrollment_request_smoke_${token}`;
const attemptId = `attempt_smoke_${token}`;
const evaluationId = `evaluation_smoke_${token}`;
const evidenceId = `evidence_smoke_${token}`;
const courseId = "course_408_ds";
const createdIds = new Map<string, string>([
  ["class", classId],
  ["class_invitation", invitationId],
  ["enrollment_request", requestId],
]);

try {
  const teacher = await pool.query<{ user_id: string }>(
    `SELECT membership.user_id
       FROM course_memberships membership
       JOIN user_roles role ON role.user_id = membership.user_id
      WHERE membership.course_id = $1
        AND membership.membership_role = 'teacher'
        AND membership.status = 'active'
        AND role.role_key = 'teacher'
      ORDER BY membership.created_at
      LIMIT 1`,
    [courseId],
  );
  const teacherUserId = teacher.rows[0]?.user_id;
  if (!teacherUserId) throw new Error("No authorized teacher is available for the smoke check.");

  await pool.query(
    `INSERT INTO users(
       user_id, username, display_name, account_status, auth_source,
       account_origin, must_change_password, created_at, updated_at
     ) VALUES ($1,$2,$3,'active','local_development','registered',false,now(),now())`,
    [userId, username, "班级闭环烟测学生"],
  );
  await pool.query(
    `INSERT INTO user_roles(user_id, role_key, granted_by, granted_at)
     VALUES ($1,'student',$2,now())`,
    [userId, teacherUserId],
  );

  const service = new PostgresClassEnrollment(pool, {
    createId: (prefix) => {
      const value = createdIds.get(prefix);
      if (!value) throw new Error(`Unexpected generated id prefix: ${prefix}`);
      return value;
    },
    createInvitationCode: () => "ZXCV-1234",
  });
  const viewer = { viewerUserId: teacherUserId, viewerRole: "teacher" as const };
  const createdClass = await service.createClass(courseId, viewer, {
    class_name: `班级闭环烟测${token}`,
    cohort_year: 2026,
    major: "计算机科学与技术",
  });
  const invitation = await service.createInvitation(courseId, createdClass.class_id, viewer);
  const submitted = await service.submitStudentRequest(userId, {
    invite_code: invitation.invite_code,
    student_number: studentNumber,
  });
  if (submitted.request?.status !== "pending") {
    throw new Error("Student enrollment request was not saved as pending.");
  }

  const pendingManagement = await service.listTeacherClasses(courseId, viewer);
  const pending = pendingManagement.pending_requests.find((item) => item.request_id === requestId);
  if (!pending) throw new Error("Teacher could not see the pending enrollment request.");
  await service.decideRequest(courseId, classId, requestId, viewer, { decision: "approved" });

  const question = await pool.query<{ question_id: string }>(
    `SELECT question_id FROM questions WHERE course_id = $1 ORDER BY question_id LIMIT 1`,
    [courseId],
  );
  const questionId = question.rows[0]?.question_id;
  if (!questionId) throw new Error("No course question is available for evidence preservation check.");
  await pool.query(
    `INSERT INTO practice_attempts(
       attempt_id, user_id, course_id, question_id, answer_type,
       selected_option_ids, response_text, status, submitted_at
     ) VALUES ($1,$2,$3,$4,'subjective',NULL,'smoke evidence','pending_review',now())`,
    [attemptId, userId, courseId, questionId],
  );
  await pool.query(
    `INSERT INTO evaluations(
       evaluation_id, attempt_id, grading_mode, status, is_correct, score,
       correct_option_ids, explanation_text, reference_solution,
       review_required, created_at
     ) VALUES ($1,$2,'ai_or_teacher_review_required','pending_review',NULL,NULL,'[]'::jsonb,NULL,NULL,true,now())`,
    [evaluationId, attemptId],
  );
  await pool.query(
    `INSERT INTO learning_evidence(
       evidence_id, evaluation_id, attempt_id, user_id, course_id, question_id,
       outcome, grading_mode, evidence_payload, eligible_for_learning_state_update, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'pending_review','ai_or_teacher_review_required','{}'::jsonb,false,now())`,
    [evidenceId, evaluationId, attemptId, userId, courseId, questionId],
  );

  const approvedManagement = await service.listTeacherClasses(courseId, viewer);
  const member = approvedManagement.members.find((item) => item.student_number === studentNumber);
  if (!member) throw new Error("Approved student did not appear in the teacher class roster.");
  await service.removeMember(courseId, classId, member.student_code, viewer);

  const verification = await pool.query<{
    profile_count: number | string;
    membership_count: number | string;
    evidence_count: number | string;
  }>(
    `SELECT
       (SELECT count(*) FROM student_academic_profiles WHERE user_id = $1)::int AS profile_count,
       (SELECT count(*) FROM course_memberships WHERE user_id = $1 AND course_id = $2 AND status = 'active')::int AS membership_count,
       (SELECT count(*) FROM learning_evidence WHERE evidence_id = $3)::int AS evidence_count`,
    [userId, courseId, evidenceId],
  );
  const result = verification.rows[0];
  if (!result
    || Number(result.profile_count) !== 0
    || Number(result.membership_count) !== 1
    || Number(result.evidence_count) !== 1) {
    throw new Error("Removing a class member changed more data than the class profile.");
  }

  console.log("Class enrollment smoke passed: request=approved, roster=visible, removal=profile_only, learning_evidence=preserved");
} finally {
  await pool.query("DELETE FROM learning_evidence WHERE evidence_id = $1", [evidenceId]);
  await pool.query("DELETE FROM evaluations WHERE evaluation_id = $1", [evaluationId]);
  await pool.query("DELETE FROM practice_attempts WHERE attempt_id = $1", [attemptId]);
  await pool.query("DELETE FROM student_academic_profiles WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM class_enrollment_requests WHERE user_id = $1 OR class_id = $2", [userId, classId]);
  await pool.query("DELETE FROM class_invitation_codes WHERE class_id = $1", [classId]);
  await pool.query("DELETE FROM course_memberships WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM teacher_course_class_assignments WHERE class_id = $1", [classId]);
  await pool.query("DELETE FROM academic_classes WHERE class_id = $1", [classId]);
  await pool.end();
}
