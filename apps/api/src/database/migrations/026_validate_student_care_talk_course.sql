DO $student_care$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM student_care_interactions
    WHERE (response = 'talk' AND talk_course_id IS NULL)
       OR (response IS DISTINCT FROM 'talk' AND talk_course_id IS NOT NULL)
  ) THEN
    ALTER TABLE student_care_interactions
      VALIDATE CONSTRAINT student_care_talk_course_scope_check;
  END IF;
END
$student_care$;
