import type { SqlPool } from "./client.js";
import { withTransaction } from "./client.js";
import {
  PRE_DEFENSE_CLASSES,
  PRE_DEFENSE_COURSES,
  PRE_DEFENSE_STUDENTS,
  PRE_DEFENSE_TEACHERS,
  buildPreDefenseCourseProgress,
} from "./pre-defense-demo-roster.js";

export async function seedPreDefenseDemoRoster(
  pool: SqlPool,
  now: () => Date = () => new Date(),
) {
  const timestamp = now().toISOString();
  const progress = buildPreDefenseCourseProgress();

  return withTransaction(pool, async (client) => {
    for (const item of PRE_DEFENSE_CLASSES) {
      await client.query(
        `INSERT INTO academic_classes(
           class_id, cohort_year, major, class_name, data_provenance, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'synthetic_demo',$5,$5)
         ON CONFLICT (class_id) DO UPDATE
         SET cohort_year = EXCLUDED.cohort_year,
             major = EXCLUDED.major,
             class_name = EXCLUDED.class_name,
             data_provenance = EXCLUDED.data_provenance,
             updated_at = EXCLUDED.updated_at`,
        [item.classId, item.cohortYear, item.major, item.className, timestamp],
      );
    }

    for (const student of PRE_DEFENSE_STUDENTS) {
      await client.query(
        `INSERT INTO users(
           user_id, username, display_name, account_status, auth_source,
           account_origin, must_change_password, created_at, updated_at
         ) VALUES ($1,$2,$3,'active','local_development','legacy_demo',true,$4,$4)
         ON CONFLICT (user_id) DO UPDATE
         SET username = COALESCE(users.username, EXCLUDED.username),
             display_name = EXCLUDED.display_name,
             account_status = 'active',
             updated_at = EXCLUDED.updated_at`,
        [student.userId, student.userId === "user_student_001" ? "user_student_001" : student.studentNumber, student.displayName, timestamp],
      );
      await client.query(
        `INSERT INTO user_roles(user_id, role_key, granted_by, granted_at)
         VALUES ($1,'student','user_admin_001',$2)
         ON CONFLICT (user_id, role_key) DO NOTHING`,
        [student.userId, timestamp],
      );
      await client.query(
        `INSERT INTO student_academic_profiles(
           user_id, student_number, class_id, data_provenance, created_at, updated_at
         ) VALUES ($1,$2,$3,'synthetic_demo',$4,$4)
         ON CONFLICT (user_id) DO UPDATE
         SET student_number = EXCLUDED.student_number,
             class_id = EXCLUDED.class_id,
             data_provenance = EXCLUDED.data_provenance,
             updated_at = EXCLUDED.updated_at`,
        [student.userId, student.studentNumber, student.classId, timestamp],
      );
      await client.query(
        `INSERT INTO student_onboarding_states(
           user_id, status, current_step, target_school, created_at, updated_at
         ) VALUES ($1,'not_started','goals',$2,$3,$3)
         ON CONFLICT (user_id) DO UPDATE
         SET target_school = COALESCE(student_onboarding_states.target_school, EXCLUDED.target_school),
             updated_at = EXCLUDED.updated_at`,
        [student.userId, student.targetSchool, timestamp],
      );
      for (const course of PRE_DEFENSE_COURSES) {
        await client.query(
          `INSERT INTO course_memberships(
             course_id, user_id, membership_role, status, created_at
           ) VALUES ($1,$2,'student','active',$3)
           ON CONFLICT (course_id, user_id) DO UPDATE
           SET membership_role = 'student', status = 'active'`,
          [course.courseId, student.userId, timestamp],
        );
      }
    }

    for (const teacher of PRE_DEFENSE_TEACHERS) {
      await client.query(
        `INSERT INTO users(
           user_id, username, display_name, account_status, auth_source,
           account_origin, must_change_password, created_at, updated_at
         ) VALUES ($1,$2,$3,'active','local_development','legacy_demo',true,$4,$4)
         ON CONFLICT (user_id) DO UPDATE
         SET username = COALESCE(users.username, EXCLUDED.username),
             display_name = EXCLUDED.display_name,
             account_status = 'active',
             updated_at = EXCLUDED.updated_at`,
        [teacher.userId, teacher.username, teacher.displayName, timestamp],
      );
      await client.query(
        `INSERT INTO user_roles(user_id, role_key, granted_by, granted_at)
         VALUES ($1,'teacher','user_admin_001',$2)
         ON CONFLICT (user_id, role_key) DO NOTHING`,
        [teacher.userId, timestamp],
      );
      await client.query(
        `INSERT INTO teacher_academic_profiles(
           user_id, teacher_number, department, professional_title,
           data_provenance, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'synthetic_demo',$5,$5)
         ON CONFLICT (user_id) DO UPDATE
         SET teacher_number = EXCLUDED.teacher_number,
             department = EXCLUDED.department,
             professional_title = EXCLUDED.professional_title,
             data_provenance = EXCLUDED.data_provenance,
             updated_at = EXCLUDED.updated_at`,
        [teacher.userId, teacher.teacherNumber, teacher.department, teacher.professionalTitle, timestamp],
      );
      for (const courseId of teacher.courseIds) {
        await client.query(
          `INSERT INTO course_memberships(
             course_id, user_id, membership_role, status, created_at
           ) VALUES ($1,$2,'teacher','active',$3)
           ON CONFLICT (course_id, user_id) DO UPDATE
           SET membership_role = 'teacher', status = 'active'`,
          [courseId, teacher.userId, timestamp],
        );
        for (const classId of teacher.classIds) {
          await client.query(
            `INSERT INTO teacher_course_class_assignments(
               teacher_user_id, course_id, class_id, data_provenance, created_at
             ) VALUES ($1,$2,$3,'synthetic_demo',$4)
             ON CONFLICT (teacher_user_id, course_id, class_id) DO UPDATE
             SET data_provenance = EXCLUDED.data_provenance`,
            [teacher.userId, courseId, classId, timestamp],
          );
        }
      }
    }

    for (const item of progress) {
      await client.query(
        `INSERT INTO student_course_progress_snapshots(
           user_id, course_id, progress_percent, correct_count, incorrect_count,
           evidence_count, pending_review_count, weekly_study_minutes,
           current_focus, weak_concept_id, learning_status, last_active_at,
           data_provenance, generated_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'synthetic_demo',$13,$13,$13)
         ON CONFLICT (user_id, course_id) DO UPDATE
         SET progress_percent = EXCLUDED.progress_percent,
             correct_count = EXCLUDED.correct_count,
             incorrect_count = EXCLUDED.incorrect_count,
             evidence_count = EXCLUDED.evidence_count,
             pending_review_count = EXCLUDED.pending_review_count,
             weekly_study_minutes = EXCLUDED.weekly_study_minutes,
             current_focus = EXCLUDED.current_focus,
             weak_concept_id = EXCLUDED.weak_concept_id,
             learning_status = EXCLUDED.learning_status,
             last_active_at = EXCLUDED.last_active_at,
             data_provenance = EXCLUDED.data_provenance,
             generated_at = EXCLUDED.generated_at,
             updated_at = EXCLUDED.updated_at`,
        [
          item.userId,
          item.courseId,
          item.progressPercent,
          item.correctCount,
          item.incorrectCount,
          item.evidenceCount,
          item.pendingReviewCount,
          item.weeklyStudyMinutes,
          item.currentFocus,
          item.weakConceptId,
          item.learningStatus,
          item.lastActiveAt,
          timestamp,
        ],
      );
    }

    return {
      classes: PRE_DEFENSE_CLASSES.length,
      students: PRE_DEFENSE_STUDENTS.length,
      teachers: PRE_DEFENSE_TEACHERS.length,
      memberships: PRE_DEFENSE_STUDENTS.length * PRE_DEFENSE_COURSES.length
        + PRE_DEFENSE_TEACHERS.reduce((total, teacher) => total + teacher.courseIds.length, 0),
      progressSnapshots: progress.length,
      assignments: PRE_DEFENSE_TEACHERS.reduce(
        (total, teacher) => total + teacher.courseIds.length * teacher.classIds.length,
        0,
      ),
    };
  });
}
