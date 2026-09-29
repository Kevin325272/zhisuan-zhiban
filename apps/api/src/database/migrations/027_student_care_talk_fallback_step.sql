ALTER TABLE student_care_interactions
  ADD COLUMN talk_fallback_step jsonb NULL CHECK (
    talk_fallback_step IS NULL OR jsonb_typeof(talk_fallback_step) = 'object'
  );

UPDATE student_care_interactions interaction
SET talk_fallback_step = jsonb_build_object(
  'task_id', 'care_fallback_' || interaction.interaction_id,
  'task_type', 'course_reading',
  'course_id', interaction.talk_course_id,
  'course_title', course.title,
  'title', '回到课程阅读',
  'detail', '先阅读约 10 分钟，完成情况仍以真实阅读记录为准。',
  'estimated_minutes', 10,
  'href', CASE interaction.talk_course_id
    WHEN 'course_408_ds' THEN '/student/courses/data-structures'
    WHEN 'course_408_co' THEN '/student/courses/computer-organization'
    WHEN 'course_408_os' THEN '/student/courses/operating-systems'
    WHEN 'course_408_cn' THEN '/student/courses/computer-networks'
    ELSE '/student/courses'
  END
)
FROM courses course
WHERE interaction.status = 'responded'
  AND interaction.response = 'talk'
  AND interaction.talk_course_id = course.course_id
  AND interaction.talk_fallback_step IS NULL;

ALTER TABLE student_care_interactions
  ADD CONSTRAINT student_care_talk_fallback_scope_check CHECK (
    (status = 'responded' AND response = 'talk' AND talk_fallback_step IS NOT NULL)
    OR ((status <> 'responded' OR response IS DISTINCT FROM 'talk') AND talk_fallback_step IS NULL)
  ) NOT VALID;

DO $student_care$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM student_care_interactions
    WHERE (response = 'talk' AND talk_fallback_step IS NULL)
       OR (response IS DISTINCT FROM 'talk' AND talk_fallback_step IS NOT NULL)
  ) THEN
    ALTER TABLE student_care_interactions
      VALIDATE CONSTRAINT student_care_talk_fallback_scope_check;
  END IF;
END
$student_care$;
