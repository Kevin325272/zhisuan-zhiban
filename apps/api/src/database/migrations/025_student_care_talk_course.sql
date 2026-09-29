ALTER TABLE student_care_interactions
  ADD COLUMN talk_course_id text NULL REFERENCES courses(course_id);

ALTER TABLE student_care_interactions
  ADD CONSTRAINT student_care_talk_course_scope_check CHECK (
    (status = 'responded' AND response = 'talk' AND talk_course_id IS NOT NULL)
    OR ((status <> 'responded' OR response IS DISTINCT FROM 'talk') AND talk_course_id IS NULL)
  ) NOT VALID;

CREATE INDEX student_care_talk_consent_idx
  ON student_care_interactions(user_id, talk_course_id, responded_at DESC)
  WHERE status = 'responded' AND response = 'talk';
