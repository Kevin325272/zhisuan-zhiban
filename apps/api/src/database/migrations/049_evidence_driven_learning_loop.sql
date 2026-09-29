-- Evidence-driven contrast probes. Raw attempts/evaluations remain the
-- authoritative learning facts; these tables only add governed relationships
-- and derived, auditable concept-level evidence.

CREATE TABLE learning_question_pairs (
  pair_id text PRIMARY KEY,
  pair_group_id text NOT NULL CHECK (length(pair_group_id) BETWEEN 1 AND 120),
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE RESTRICT,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  contrast_question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  hypothesis_code text NOT NULL CHECK (hypothesis_code IN (
    'rule_confusion', 'boundary_condition', 'concept_definition', 'transfer'
  )),
  surface_difference text NOT NULL CHECK (length(surface_difference) BETWEEN 8 AND 500),
  question_role text NOT NULL CHECK (question_role IN ('anchor', 'contrast', 'transfer')),
  content_review_status text NOT NULL CHECK (
    content_review_status IN ('pending_teacher_review', 'teacher_verified', 'disabled')
  ),
  source_provenance text NOT NULL CHECK (length(source_provenance) BETWEEN 1 AND 300),
  algorithm_version text NOT NULL DEFAULT 'evidence_probe_v1'
    CHECK (algorithm_version = 'evidence_probe_v1'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  reviewed_by text NULL REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (question_id <> contrast_question_id),
  CHECK (
    (content_review_status = 'teacher_verified' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR content_review_status <> 'teacher_verified'
  )
);

CREATE UNIQUE INDEX learning_question_pairs_unique_questions_idx
  ON learning_question_pairs(pair_group_id, question_id, contrast_question_id, algorithm_version);
CREATE INDEX learning_question_pairs_lookup_idx
  ON learning_question_pairs(course_id, concept_id, status, content_review_status, question_role);

CREATE TABLE student_learning_probe_sessions (
  probe_session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  pair_id text NOT NULL REFERENCES learning_question_pairs(pair_id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE RESTRICT,
  source_attempt_id text NOT NULL REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  anchor_question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  contrast_question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('offered', 'started', 'skipped', 'completed', 'expired')),
  data_origin text NOT NULL DEFAULT 'real_trial'
    CHECK (data_origin IN ('real_trial', 'synthetic_verification', 'local_demo')),
  idempotency_key text NULL CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  skipped_at timestamptz NULL,
  result_event_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (anchor_question_id <> contrast_question_id),
  CHECK (
    (status = 'offered' AND started_at IS NULL AND completed_at IS NULL AND skipped_at IS NULL)
    OR (status = 'started' AND started_at IS NOT NULL AND completed_at IS NULL AND skipped_at IS NULL)
    OR (status = 'skipped' AND skipped_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND skipped_at IS NULL)
    OR status = 'expired'
  ),
  UNIQUE (user_id, source_attempt_id, pair_id),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX student_learning_probe_sessions_user_status_idx
  ON student_learning_probe_sessions(user_id, status, updated_at DESC);

CREATE TABLE student_learning_probe_events (
  event_id text PRIMARY KEY,
  probe_session_id text NOT NULL REFERENCES student_learning_probe_sessions(probe_session_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('offered', 'started', 'skipped', 'submitted')),
  attempt_id text NULL REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  evaluation_id text NULL REFERENCES evaluations(evaluation_id) ON DELETE RESTRICT,
  outcome text NULL CHECK (outcome IS NULL OR outcome IN ('correct', 'incorrect', 'pending_review')),
  evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence_payload) = 'object'),
  result_payload jsonb NULL CHECK (result_payload IS NULL OR jsonb_typeof(result_payload) = 'object'),
  idempotency_key text NULL CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX student_learning_probe_events_session_idx
  ON student_learning_probe_events(probe_session_id, created_at);

CREATE TABLE student_concept_evidence_events (
  evidence_event_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE RESTRICT,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  attempt_id text NULL REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  evaluation_id text NULL REFERENCES evaluations(evaluation_id) ON DELETE RESTRICT,
  probe_session_id text NULL REFERENCES student_learning_probe_sessions(probe_session_id) ON DELETE RESTRICT,
  question_role text NOT NULL CHECK (question_role IN ('anchor', 'contrast', 'transfer', 'ordinary')),
  outcome text NOT NULL CHECK (outcome IN ('correct', 'incorrect', 'pending_review', 'skipped')),
  independent boolean NOT NULL DEFAULT false,
  eligible_for_learning_state_update boolean NOT NULL,
  data_origin text NOT NULL DEFAULT 'real_trial'
    CHECK (data_origin IN ('real_trial', 'synthetic_verification', 'local_demo')),
  evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence_payload) = 'object'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CHECK (outcome <> 'pending_review' OR eligible_for_learning_state_update = false),
  CHECK (outcome <> 'skipped' OR eligible_for_learning_state_update = false)
);

CREATE INDEX student_concept_evidence_events_lookup_idx
  ON student_concept_evidence_events(user_id, concept_id, created_at DESC);

CREATE TABLE student_concept_evidence (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('signal', 'developing', 'provisionally_stable', 'transfer_validated')),
  independent_correct_count integer NOT NULL DEFAULT 0 CHECK (independent_correct_count >= 0),
  distinct_correct_question_count integer NOT NULL DEFAULT 0 CHECK (distinct_correct_question_count >= 0),
  reliable_incorrect_count integer NOT NULL DEFAULT 0 CHECK (reliable_incorrect_count >= 0),
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  first_correct_at timestamptz NULL,
  last_correct_at timestamptz NULL,
  last_evidence_at timestamptz NULL,
  data_origin text NOT NULL DEFAULT 'real_trial'
    CHECK (data_origin IN ('real_trial', 'synthetic_verification', 'local_demo')),
  algorithm_version text NOT NULL DEFAULT 'concept_evidence_v1'
    CHECK (algorithm_version = 'concept_evidence_v1'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, concept_id),
  UNIQUE (user_id, course_id, concept_id)
);

CREATE INDEX student_concept_evidence_course_status_idx
  ON student_concept_evidence(course_id, status, updated_at DESC);

-- Extend the existing teacher action record without invalidating old rows.
ALTER TABLE teacher_interventions
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'concept'
    CHECK (target_type IN ('concept', 'class', 'student')),
  ADD COLUMN IF NOT EXISTS target_class_id text NULL REFERENCES academic_classes(class_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_user_id text NULL REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS material_ref text NULL CHECK (material_ref IS NULL OR length(material_ref) <= 500),
  ADD COLUMN IF NOT EXISTS due_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'sent', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS evidence_snapshot jsonb NULL
    CHECK (evidence_snapshot IS NULL OR jsonb_typeof(evidence_snapshot) = 'object');

CREATE INDEX IF NOT EXISTS teacher_interventions_action_status_idx
  ON teacher_interventions(course_id, concept_id, status, created_at DESC);
