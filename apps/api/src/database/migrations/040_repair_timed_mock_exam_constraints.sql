ALTER TABLE practice_exam_sessions
  DROP CONSTRAINT IF EXISTS practice_exam_sessions_check2;

ALTER TABLE practice_exam_sessions
  DROP CONSTRAINT IF EXISTS practice_exam_sessions_objective_count_check;
ALTER TABLE practice_exam_sessions
  ADD CONSTRAINT practice_exam_sessions_objective_count_check
  CHECK (objective_count BETWEEN 0 AND question_count);
