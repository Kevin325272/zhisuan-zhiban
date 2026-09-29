CREATE TABLE student_external_questions (
  external_question_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN (
    'recognition_failed',
    'needs_better_image',
    'unsupported',
    'recognized',
    'confirmed',
    'deleted'
  )),
  content_revision integer NOT NULL DEFAULT 0 CHECK (content_revision >= 0),
  image_storage_ref text NOT NULL CHECK (
    image_storage_ref ~ '^[a-f0-9-]+\.webp$'
    AND length(image_storage_ref) BETWEEN 6 AND 80
  ),
  image_sha256 char(64) NOT NULL CHECK (image_sha256 ~ '^[a-f0-9]{64}$'),
  image_mime_type text NOT NULL CHECK (image_mime_type = 'image/webp'),
  pixel_width integer NOT NULL CHECK (pixel_width BETWEEN 1 AND 2048),
  pixel_height integer NOT NULL CHECK (pixel_height BETWEEN 1 AND 2048),
  image_byte_size integer NOT NULL CHECK (image_byte_size BETWEEN 1 AND 5242880),
  recognition_payload jsonb NULL CHECK (
    recognition_payload IS NULL OR (
      jsonb_typeof(recognition_payload) = 'object'
      AND octet_length(recognition_payload::text) <= 65536
    )
  ),
  confirmed_payload jsonb NULL CHECK (
    confirmed_payload IS NULL OR (
      jsonb_typeof(confirmed_payload) = 'object'
      AND octet_length(confirmed_payload::text) <= 65536
    )
  ),
  concept_candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(concept_candidates) = 'array'
    AND jsonb_array_length(concept_candidates) <= 8
    AND octet_length(concept_candidates::text) <= 32768
  ),
  model_trace jsonb NULL CHECK (
    model_trace IS NULL OR (
      jsonb_typeof(model_trace) = 'object'
      AND octet_length(model_trace::text) <= 4096
    )
  ),
  saved_at timestamptz NULL,
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz NULL,
  cleanup_claimed_at timestamptz NULL,
  image_removed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'confirmed' AND content_revision > 0 AND confirmed_payload IS NOT NULL)
    OR (status <> 'confirmed')
  ),
  CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status <> 'deleted' AND deleted_at IS NULL)
  ),
  CHECK (saved_at IS NULL OR status IN ('confirmed', 'deleted')),
  CHECK (image_removed_at IS NULL OR cleanup_claimed_at IS NOT NULL)
);

CREATE INDEX student_external_questions_user_list_idx
  ON student_external_questions(user_id, updated_at DESC, external_question_id)
  WHERE deleted_at IS NULL;

CREATE INDEX student_external_questions_user_quota_idx
  ON student_external_questions(user_id, saved_at, expires_at)
  WHERE deleted_at IS NULL;

CREATE INDEX student_external_questions_cleanup_idx
  ON student_external_questions(expires_at, deleted_at, external_question_id)
  WHERE image_removed_at IS NULL;

CREATE TABLE student_external_question_explanations (
  explanation_id text PRIMARY KEY,
  external_question_id text NOT NULL REFERENCES student_external_questions(external_question_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content_revision integer NOT NULL CHECK (content_revision > 0),
  depth text NOT NULL CHECK (depth IN ('direction', 'steps', 'complete')),
  concept_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(concept_ids) = 'array'
    AND jsonb_array_length(concept_ids) <= 8
    AND octet_length(concept_ids::text) <= 4096
  ),
  response_payload jsonb NOT NULL CHECK (
    jsonb_typeof(response_payload) = 'object'
    AND octet_length(response_payload::text) <= 65536
  ),
  model_trace jsonb NULL CHECK (
    model_trace IS NULL OR (
      jsonb_typeof(model_trace) = 'object'
      AND octet_length(model_trace::text) <= 4096
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_question_id, content_revision, depth)
);

CREATE INDEX student_external_question_explanations_current_idx
  ON student_external_question_explanations(
    user_id,
    external_question_id,
    content_revision,
    created_at DESC
  );

CREATE TABLE student_external_question_idempotency (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN (
    'upload', 'recognition', 'confirmation', 'explanation', 'save', 'delete'
  )),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  external_question_id text NOT NULL REFERENCES student_external_questions(external_question_id) ON DELETE CASCADE,
  response_payload jsonb NOT NULL CHECK (
    jsonb_typeof(response_payload) = 'object'
    AND octet_length(response_payload::text) <= 65536
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation, idempotency_key)
);

CREATE INDEX student_external_question_idempotency_resource_idx
  ON student_external_question_idempotency(external_question_id, created_at DESC);
