CREATE INDEX IF NOT EXISTS practice_attempts_user_question_idx
  ON practice_attempts(user_id, question_id);
