CREATE TABLE pilot_studies (
  study_id text PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notice_version text NOT NULL CHECK (length(notice_version) BETWEEN 1 AND 80),
  notice_text text NOT NULL CHECK (length(notice_text) BETWEEN 1 AND 4000),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'closed')),
  created_by text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pilot_tasks (
  task_id text PRIMARY KEY,
  study_id text NOT NULL REFERENCES pilot_studies(study_id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  stage text NOT NULL CHECK (stage IN ('baseline', 'guided', 'transfer')),
  evidence_kind text NOT NULL CHECK (
    evidence_kind IN ('verified_choice_attempt', 'verified_course_reading')
  ),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  instructions text NOT NULL CHECK (length(instructions) BETWEEN 1 AND 1000),
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  concept_id text NULL REFERENCES course_core_concepts(concept_id) ON DELETE RESTRICT,
  question_id text NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  href text NOT NULL CHECK (href LIKE '/student/%' AND length(href) <= 1000),
  assistance_policy text NOT NULL CHECK (
    assistance_policy IN ('independent', 'platform_guidance')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, ordinal),
  CHECK (
    (evidence_kind = 'verified_choice_attempt' AND question_id IS NOT NULL)
    OR (evidence_kind = 'verified_course_reading' AND concept_id IS NOT NULL AND question_id IS NULL)
  )
);

CREATE TABLE pilot_participants (
  participant_id text PRIMARY KEY,
  study_id text NOT NULL REFERENCES pilot_studies(study_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  participant_code text NOT NULL CHECK (participant_code ~ '^[A-Z][A-Z0-9_-]{2,15}$'),
  role_label text NOT NULL CHECK (length(role_label) BETWEEN 4 AND 100),
  participant_kind text NOT NULL CHECK (
    participant_kind IN ('real_trial', 'synthetic_verification')
  ),
  consent_notice_version text NULL,
  consented_at timestamptz NULL,
  baseline_confidence smallint NULL CHECK (baseline_confidence BETWEEN 1 AND 5),
  completed_at timestamptz NULL,
  enrolled_by text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, participant_code),
  UNIQUE (study_id, user_id),
  CHECK (
    (consented_at IS NULL AND consent_notice_version IS NULL AND baseline_confidence IS NULL)
    OR (consented_at IS NOT NULL AND consent_notice_version IS NOT NULL AND baseline_confidence IS NOT NULL)
  )
);

CREATE INDEX pilot_participants_study_kind_idx
  ON pilot_participants(study_id, participant_kind, completed_at);

CREATE TABLE pilot_task_progress (
  progress_id text PRIMARY KEY,
  participant_id text NOT NULL REFERENCES pilot_participants(participant_id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES pilot_tasks(task_id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  attempt_id text NULL REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  evidence_snapshot jsonb NULL CHECK (
    evidence_snapshot IS NULL OR jsonb_typeof(evidence_snapshot) = 'object'
  ),
  UNIQUE (participant_id, task_id),
  CHECK (
    (completed_at IS NULL AND evidence_snapshot IS NULL)
    OR (completed_at IS NOT NULL AND evidence_snapshot IS NOT NULL AND completed_at >= started_at)
  )
);

CREATE INDEX pilot_task_progress_participant_idx
  ON pilot_task_progress(participant_id, completed_at, started_at);

CREATE TABLE pilot_feedback (
  participant_id text PRIMARY KEY REFERENCES pilot_participants(participant_id) ON DELETE CASCADE,
  ease_of_use smallint NOT NULL CHECK (ease_of_use BETWEEN 1 AND 5),
  guidance_helpfulness smallint NOT NULL CHECK (guidance_helpfulness BETWEEN 1 AND 5),
  confidence_after smallint NOT NULL CHECK (confidence_after BETWEEN 1 AND 5),
  continued_use_intent smallint NOT NULL CHECK (continued_use_intent BETWEEN 1 AND 5),
  open_feedback text NOT NULL CHECK (length(open_feedback) BETWEEN 1 AND 500),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

