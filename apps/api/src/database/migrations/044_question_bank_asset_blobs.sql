CREATE TABLE question_asset_blobs (
  content_sha256 char(64) PRIMARY KEY CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text NOT NULL CHECK (
    mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  ),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 5242880),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(content) = byte_length)
);

CREATE TABLE question_asset_links (
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  asset_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('question', 'option', 'explanation', 'solution')),
  option_id text NULL,
  content_sha256 char(64) NOT NULL
    REFERENCES question_asset_blobs(content_sha256) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, asset_id),
  CHECK (
    (role = 'option' AND option_id IS NOT NULL)
    OR (role <> 'option' AND option_id IS NULL)
  )
);

CREATE INDEX question_asset_links_question_role_idx
  ON question_asset_links(question_id, role, asset_id);
CREATE INDEX question_asset_links_content_idx
  ON question_asset_links(content_sha256, question_id);
