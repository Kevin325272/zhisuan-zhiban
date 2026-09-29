ALTER TABLE practice_exam_sessions
  DROP CONSTRAINT practice_exam_sessions_duration_minutes_check;
ALTER TABLE practice_exam_sessions
  ADD CONSTRAINT practice_exam_sessions_duration_minutes_check
  CHECK (duration_minutes BETWEEN 15 AND 240);

ALTER TABLE practice_exam_sessions
  DROP CONSTRAINT practice_exam_sessions_check;
ALTER TABLE practice_exam_sessions
  ADD CONSTRAINT practice_exam_sessions_expiry_matches_duration_check
  CHECK (expires_at = started_at + make_interval(mins => duration_minutes));

UPDATE question_learning_metadata
SET allowed_modes = ARRAY['targeted','mock_exam']::text[],
    paper_year = 2026,
    updated_at = now()
WHERE question_id LIKE 'practice-408-v1-%'
  AND source_type = 'self_authored_practice';
