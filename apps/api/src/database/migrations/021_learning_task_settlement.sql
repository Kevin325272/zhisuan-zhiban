-- Preserve the first server-derived challenge settlement so retries and refreshes
-- cannot reinterpret an already completed learning task from later evidence.
ALTER TABLE student_learning_task_assignments
  ADD COLUMN IF NOT EXISTS completion_settlement jsonb NULL
    CHECK (
      completion_settlement IS NULL
      OR jsonb_typeof(completion_settlement) = 'object'
    );
