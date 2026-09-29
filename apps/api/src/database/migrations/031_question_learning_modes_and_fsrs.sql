ALTER TABLE questions ALTER COLUMN year DROP NOT NULL;

ALTER TABLE student_onboarding_states
  ALTER COLUMN diagnostic_set_version SET DEFAULT '408-v3';

CREATE TABLE question_learning_metadata (
  question_id text PRIMARY KEY REFERENCES questions(question_id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (
    source_type IN ('past_exam', 'mock_exam', 'self_authored_screening', 'self_authored_practice')
  ),
  allowed_modes text[] NOT NULL CHECK (
    cardinality(allowed_modes) BETWEEN 1 AND 5
    AND allowed_modes <@ ARRAY['diagnostic', 'targeted', 'past_exam', 'mock_exam', 'mistake_review']::text[]
  ),
  paper_year integer NULL CHECK (paper_year IS NULL OR paper_year BETWEEN 1900 AND 2100),
  protect_full_paper boolean NOT NULL DEFAULT false,
  importance text NOT NULL CHECK (importance IN ('core', 'extended')),
  content_review_status text NOT NULL CHECK (
    content_review_status IN ('pending_teacher_review', 'teacher_verified')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (protect_full_paper = false OR paper_year IS NOT NULL),
  CHECK (
    source_type <> 'self_authored_screening'
    OR (
      paper_year IS NULL
      AND protect_full_paper = false
      AND allowed_modes = ARRAY['diagnostic']::text[]
    )
  )
);

CREATE INDEX question_learning_metadata_mode_idx
  ON question_learning_metadata USING gin(allowed_modes);
CREATE INDEX question_learning_metadata_paper_idx
  ON question_learning_metadata(paper_year, source_type, protect_full_paper);

WITH latest_paper AS (
  SELECT MAX(year) AS latest_year
  FROM questions
  WHERE year IS NOT NULL
)
INSERT INTO question_learning_metadata(
  question_id,
  source_type,
  allowed_modes,
  paper_year,
  protect_full_paper,
  importance,
  content_review_status,
  created_at,
  updated_at
)
SELECT
  q.question_id,
  'past_exam',
  ARRAY['targeted', 'past_exam', 'mock_exam']::text[],
  q.year,
  COALESCE(q.year >= latest_paper.latest_year - 2, false),
  'core',
  CASE WHEN q.review_status = 'approved' THEN 'teacher_verified'
       ELSE 'pending_teacher_review' END,
  q.created_at,
  q.updated_at
FROM questions q
CROSS JOIN latest_paper
WHERE q.year IS NOT NULL
ON CONFLICT (question_id) DO NOTHING;

CREATE TABLE student_question_memory_states (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  due timestamptz NOT NULL,
  stability double precision NOT NULL CHECK (stability >= 0),
  difficulty double precision NOT NULL CHECK (difficulty >= 0),
  elapsed_days integer NOT NULL CHECK (elapsed_days >= 0),
  scheduled_days integer NOT NULL CHECK (scheduled_days >= 0),
  reps integer NOT NULL CHECK (reps >= 0),
  lapses integer NOT NULL CHECK (lapses >= 0),
  learning_steps integer NOT NULL CHECK (learning_steps >= 0),
  state smallint NOT NULL CHECK (state BETWEEN 0 AND 3),
  last_review timestamptz NULL,
  last_attempt_id text NULL REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  algorithm_version text NOT NULL DEFAULT 'fsrs_v6_ts_fsrs_5_4_1'
    CHECK (algorithm_version = 'fsrs_v6_ts_fsrs_5_4_1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id),
  UNIQUE (user_id, last_attempt_id)
);

CREATE INDEX student_question_memory_states_due_idx
  ON student_question_memory_states(user_id, due, question_id);

ALTER TABLE practice_mistake_review_states
  DROP CONSTRAINT IF EXISTS practice_mistake_review_states_algorithm_version_check;
ALTER TABLE practice_mistake_review_states
  ADD CONSTRAINT practice_mistake_review_states_algorithm_version_check
  CHECK (algorithm_version IN ('evidence_weighted_v1', 'fsrs_v6_ts_fsrs_5_4_1'));

CREATE TABLE practice_exam_sessions (
  session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  paper_year integer NOT NULL CHECK (paper_year BETWEEN 1900 AND 2100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted')),
  duration_minutes integer NOT NULL DEFAULT 180 CHECK (duration_minutes = 180),
  question_count integer NOT NULL CHECK (question_count BETWEEN 1 AND 100),
  objective_count integer NOT NULL CHECK (objective_count BETWEEN 0 AND question_count),
  subjective_count integer NOT NULL CHECK (
    subjective_count BETWEEN 0 AND question_count
    AND objective_count + subjective_count = question_count
  ),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz NULL,
  submission_key_hash char(64) NULL,
  result_payload jsonb NULL CHECK (
    result_payload IS NULL OR jsonb_typeof(result_payload) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at = started_at + interval '180 minutes'),
  CHECK (
    (status = 'active' AND submitted_at IS NULL AND submission_key_hash IS NULL AND result_payload IS NULL)
    OR (
      status = 'submitted'
      AND submitted_at IS NOT NULL
      AND submission_key_hash IS NOT NULL
      AND result_payload IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX practice_exam_sessions_active_idx
  ON practice_exam_sessions(user_id, paper_year)
  WHERE status = 'active';
CREATE INDEX practice_exam_sessions_user_history_idx
  ON practice_exam_sessions(user_id, submitted_at DESC, paper_year DESC);

CREATE TABLE practice_exam_session_questions (
  session_id text NOT NULL REFERENCES practice_exam_sessions(session_id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  question_type text NOT NULL CHECK (question_type IN ('choice', 'subjective')),
  question_payload jsonb NOT NULL CHECK (jsonb_typeof(question_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, question_id),
  UNIQUE (session_id, ordinal)
);

CREATE INDEX practice_exam_session_questions_order_idx
  ON practice_exam_session_questions(session_id, ordinal);

CREATE TABLE practice_exam_session_attempts (
  session_id text NOT NULL REFERENCES practice_exam_sessions(session_id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  attempt_id text NOT NULL UNIQUE REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, question_id)
);

CREATE INDEX practice_exam_session_attempts_session_idx
  ON practice_exam_session_attempts(session_id, question_id);
