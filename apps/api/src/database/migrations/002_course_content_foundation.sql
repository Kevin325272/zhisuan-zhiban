CREATE TABLE course_catalog_entries (
  course_id text PRIMARY KEY REFERENCES courses(course_id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  question_subject text NOT NULL UNIQUE,
  summary text NOT NULL,
  display_order smallint NOT NULL UNIQUE CHECK (display_order > 0),
  material_status text NOT NULL CHECK (material_status IN ('available', 'pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_content_sources (
  source_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  dataset_id text NOT NULL,
  source_kind text NOT NULL CHECK (
    source_kind IN ('knowledge_chunks', 'qa_examples', 'training_messages')
  ),
  title text NOT NULL,
  source_provider text NULL,
  author_name text NULL,
  edition text NULL,
  original_path text NOT NULL,
  storage_ref text NOT NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  record_count integer NOT NULL CHECK (record_count >= 0),
  license_status text NOT NULL CHECK (license_status = 'unverified'),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  provenance_status text NOT NULL CHECK (provenance_status = 'source_unknown_unverified'),
  ingestion_mode text NOT NULL CHECK (
    ingestion_mode IN ('postgresql_content', 'reference_only_not_model_training')
  ),
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, dataset_id, source_kind)
);

CREATE INDEX course_content_sources_course_idx
  ON course_content_sources(course_id, source_kind);

CREATE TABLE course_content_chunks (
  chunk_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES course_content_sources(source_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  source_item_id text NOT NULL,
  chapter text NOT NULL,
  page integer NOT NULL CHECK (page > 0),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content_text text NOT NULL CHECK (length(content_text) > 0),
  content_format text NOT NULL CHECK (content_format = 'plain_text'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_item_id)
);

CREATE INDEX course_content_chunks_navigation_idx
  ON course_content_chunks(course_id, chapter, ordinal);

CREATE TABLE course_qa_examples (
  qa_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES course_content_sources(source_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  source_item_id text NOT NULL,
  chapter text NULL,
  page integer NULL CHECK (page IS NULL OR page > 0),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  question_text text NOT NULL CHECK (length(question_text) > 0),
  answer_text text NOT NULL CHECK (length(answer_text) > 0),
  content_format text NOT NULL CHECK (content_format = 'plain_text'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_item_id)
);

CREATE INDEX course_qa_examples_navigation_idx
  ON course_qa_examples(course_id, chapter, ordinal);
