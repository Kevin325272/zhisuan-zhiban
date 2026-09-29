-- Server-owned lifecycle for the one learning task a student has started.
-- The browser may name a task, but it never supplies evidence or completion facts.
CREATE TABLE student_learning_task_assignments (
  assignment_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  task_id text NOT NULL CHECK (length(task_id) BETWEEN 1 AND 200),
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  concept_id text NULL REFERENCES course_core_concepts(concept_id) ON DELETE SET NULL,
  mistake_id text NULL REFERENCES practice_mistakes(mistake_id) ON DELETE SET NULL,
  task_type text NOT NULL CHECK (
    task_type IN ('course_reading', 'case_review', 'choice_practice', 'mistake_review')
  ),
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'superseded')) DEFAULT 'pending',
  activated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  completion_evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(completion_evidence_refs) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, task_id),
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status IN ('pending', 'superseded') AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX student_learning_task_one_pending_idx
  ON student_learning_task_assignments(user_id)
  WHERE status = 'pending';

CREATE INDEX student_learning_task_assignments_user_idx
  ON student_learning_task_assignments(user_id, status, updated_at DESC);

CREATE INDEX student_learning_task_assignments_evidence_idx
  ON student_learning_task_assignments(user_id, activated_at DESC);
