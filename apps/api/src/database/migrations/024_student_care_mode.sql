CREATE TABLE student_care_preferences (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE student_care_interactions (
  interaction_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  signal_code text NOT NULL CHECK (
    signal_code IN ('return_after_gap', 'accuracy_shift', 'rhythm_drop')
  ),
  rule_version text NOT NULL CHECK (rule_version = 'student_care_v1'),
  status text NOT NULL CHECK (status IN ('presented', 'responded', 'expired')),
  evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence_summary) = 'object'),
  reason_summary text NOT NULL CHECK (length(reason_summary) BETWEEN 1 AND 500),
  response text NULL CHECK (
    response IS NULL
    OR response IN ('continue', 'lighten', 'talk', 'dismiss', 'disable')
  ),
  presented_at timestamptz NOT NULL,
  responded_at timestamptz NULL,
  expires_at timestamptz NOT NULL,
  cooldown_until timestamptz NULL,
  light_session_expires_at timestamptz NULL,
  light_step jsonb NULL CHECK (
    light_step IS NULL OR jsonb_typeof(light_step) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > presented_at),
  CHECK (
    (status = 'presented'
      AND response IS NULL
      AND responded_at IS NULL
      AND cooldown_until IS NULL
      AND light_session_expires_at IS NULL
      AND light_step IS NULL)
    OR (status = 'expired'
      AND response IS NULL
      AND responded_at IS NULL
      AND cooldown_until IS NULL
      AND light_session_expires_at IS NULL
      AND light_step IS NULL)
    OR (status = 'responded'
      AND response IS NOT NULL
      AND responded_at IS NOT NULL)
  ),
  CHECK (
    status <> 'responded'
    OR response = 'disable'
    OR cooldown_until IS NOT NULL
  ),
  CHECK (
    (response = 'lighten'
      AND light_session_expires_at IS NOT NULL
      AND light_step IS NOT NULL)
    OR (response IS DISTINCT FROM 'lighten'
      AND light_session_expires_at IS NULL
      AND light_step IS NULL)
  )
);

CREATE UNIQUE INDEX student_care_one_presented_idx
  ON student_care_interactions(user_id)
  WHERE status = 'presented';

CREATE INDEX student_care_user_recent_idx
  ON student_care_interactions(user_id, presented_at DESC);

CREATE INDEX student_care_user_cooldown_idx
  ON student_care_interactions(user_id, cooldown_until DESC)
  WHERE cooldown_until IS NOT NULL;

CREATE INDEX student_care_active_light_idx
  ON student_care_interactions(user_id, light_session_expires_at DESC)
  WHERE status = 'responded' AND response = 'lighten';
