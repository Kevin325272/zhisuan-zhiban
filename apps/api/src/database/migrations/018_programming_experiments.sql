CREATE TABLE programming_experiment_attempts (
  attempt_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  concept_id text NOT NULL CHECK (length(concept_id) BETWEEN 1 AND 120),
  experiment_id text NOT NULL CHECK (length(experiment_id) BETWEEN 1 AND 120),
  task_id text NOT NULL CHECK (length(task_id) BETWEEN 1 AND 120),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  language text NOT NULL CHECK (language = 'cpp'),
  source_code text NOT NULL CHECK (length(source_code) BETWEEN 1 AND 20000),
  result_status text NOT NULL CHECK (
    result_status IN (
      'passed', 'failed', 'compile_error', 'runtime_error',
      'time_limit_exceeded', 'memory_limit_exceeded', 'internal_error'
    )
  ),
  execution_mode text NOT NULL CHECK (execution_mode = 'sandbox'),
  evaluator_label text NOT NULL,
  passed_count integer NOT NULL CHECK (passed_count >= 0),
  total_count integer NOT NULL CHECK (total_count >= 0),
  result_payload jsonb NOT NULL CHECK (jsonb_typeof(result_payload) = 'object'),
  diagnosis_payload jsonb NOT NULL CHECK (jsonb_typeof(diagnosis_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, experiment_id, idempotency_key)
);

CREATE INDEX programming_experiment_attempts_owner_idx
  ON programming_experiment_attempts(user_id, experiment_id, created_at DESC);

CREATE INDEX programming_experiment_attempts_concept_idx
  ON programming_experiment_attempts(user_id, course_id, concept_id, created_at DESC);

CREATE TABLE programming_experiment_evidence (
  evidence_id text PRIMARY KEY,
  attempt_id text NOT NULL UNIQUE
    REFERENCES programming_experiment_attempts(attempt_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  concept_id text NOT NULL CHECK (length(concept_id) BETWEEN 1 AND 120),
  outcome text NOT NULL CHECK (outcome IN ('passed', 'needs_revision')),
  evidence_payload jsonb NOT NULL CHECK (jsonb_typeof(evidence_payload) = 'object'),
  eligible_for_learning_state_update boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX programming_experiment_evidence_owner_idx
  ON programming_experiment_evidence(user_id, course_id, concept_id, created_at DESC);
