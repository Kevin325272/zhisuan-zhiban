CREATE TABLE practice_evaluation_idempotency (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint char(64) NOT NULL CHECK (char_length(request_fingerprint) = 64),
  attempt_id text NULL REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  response_payload jsonb NULL CHECK (
    response_payload IS NULL OR jsonb_typeof(response_payload) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);
