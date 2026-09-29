ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_origin text NOT NULL DEFAULT 'legacy_demo',
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_origin_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_origin_check
  CHECK (account_origin IN ('legacy_demo', 'registered', 'seeded_admin'));

UPDATE users
SET username = lower(regexp_replace(user_id, '[^a-zA-Z0-9_-]', '_', 'g'))
WHERE username IS NULL;

ALTER TABLE users
  ADD CONSTRAINT users_username_format_check
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9_-]{3,31}$');

CREATE UNIQUE INDEX users_username_lower_idx
  ON users (lower(username))
  WHERE username IS NOT NULL;

CREATE TABLE account_sessions (
  session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX account_sessions_user_active_idx
  ON account_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX account_sessions_expiry_idx
  ON account_sessions(expires_at)
  WHERE revoked_at IS NULL;

