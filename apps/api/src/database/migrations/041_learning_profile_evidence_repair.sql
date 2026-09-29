WITH unique_question_concept AS (
  SELECT link.question_id, MIN(link.concept_id) AS concept_id
  FROM course_concept_question_links link
  JOIN course_core_concepts concept ON concept.concept_id = link.concept_id
  JOIN questions question ON question.question_id = link.question_id
  WHERE link.status = 'active'
    AND concept.review_status = 'verified'
    AND concept.course_id = question.course_id
  GROUP BY link.question_id
  HAVING COUNT(DISTINCT link.concept_id) = 1
)
UPDATE practice_attempts attempt
SET concept_id = resolved.concept_id
FROM unique_question_concept resolved
WHERE attempt.question_id = resolved.question_id
  AND attempt.concept_id IS NULL;

UPDATE learning_evidence evidence
SET concept_id = attempt.concept_id
FROM practice_attempts attempt
WHERE evidence.attempt_id = attempt.attempt_id
  AND evidence.concept_id IS NULL
  AND attempt.concept_id IS NOT NULL;

UPDATE practice_mistakes mistake
SET concept_id = attempt.concept_id,
    updated_at = GREATEST(mistake.updated_at, attempt.submitted_at)
FROM practice_attempts attempt
WHERE mistake.last_incorrect_attempt_id = attempt.attempt_id
  AND mistake.concept_id IS NULL
  AND attempt.concept_id IS NOT NULL;

UPDATE student_onboarding_states state
SET status = CASE
      WHEN state.target_exam_year IS NULL
        OR state.preparation_stage IS NULL
        OR state.daily_minutes IS NULL
      THEN 'not_started'
      ELSE 'in_progress'
    END,
    current_step = CASE
      WHEN state.target_exam_year IS NULL
        OR state.preparation_stage IS NULL
        OR state.daily_minutes IS NULL
      THEN 'goals'
      WHEN (
        SELECT COUNT(DISTINCT assessment.course_id)
        FROM student_onboarding_self_assessments assessment
        WHERE assessment.user_id = state.user_id
      ) < 4
      THEN 'self_assessment'
      WHEN (
        SELECT COUNT(*)
        FROM student_onboarding_diagnostic_answers answer
        WHERE answer.user_id = state.user_id
          AND answer.set_version = state.diagnostic_set_version
          AND answer.evaluated_at IS NOT NULL
      ) < 8
      THEN 'diagnostic'
      ELSE 'profile'
    END,
    completed_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE state.status = 'completed'
  AND (
    state.target_exam_year IS NULL
    OR state.preparation_stage IS NULL
    OR state.daily_minutes IS NULL
    OR (
      SELECT COUNT(DISTINCT assessment.course_id)
      FROM student_onboarding_self_assessments assessment
      WHERE assessment.user_id = state.user_id
    ) < 4
    OR NOT EXISTS (
      SELECT 1
      FROM student_initial_profile_versions profile
      WHERE profile.user_id = state.user_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM student_learning_plan_versions plan
      JOIN student_learning_plan_tasks task ON task.plan_id = plan.plan_id
      WHERE plan.user_id = state.user_id
        AND plan.status = 'active'
    )
  );
