CREATE TABLE exam_paper_import_batches (
  import_batch_id text PRIMARY KEY,
  dataset_id text NOT NULL,
  archive_file_name text NOT NULL,
  archive_sha256 char(64) NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_entry text NOT NULL,
  source_provider text NOT NULL,
  source_generated_at timestamptz NOT NULL,
  license_status text NOT NULL CHECK (
    license_status IN ('unverified', 'verified', 'restricted')
  ),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  training_allowed boolean NOT NULL DEFAULT false CHECK (training_allowed = false),
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  paper_count integer NOT NULL DEFAULT 0 CHECK (paper_count >= 0),
  source_failure_count integer NOT NULL DEFAULT 0 CHECK (source_failure_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  UNIQUE (dataset_id, archive_sha256)
);

CREATE TABLE exam_papers (
  exam_paper_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  import_batch_id text NOT NULL
    REFERENCES exam_paper_import_batches(import_batch_id) ON DELETE RESTRICT,
  university text NOT NULL CHECK (length(university) BETWEEN 1 AND 200),
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  paper_type text NOT NULL CHECK (paper_type IN ('exam', 'sample')),
  page_count integer NOT NULL CHECK (page_count > 0),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  content_mode text NOT NULL CHECK (content_mode IN ('text_layer', 'scan')),
  official_source_url text NOT NULL,
  landing_page_url text NOT NULL,
  archive_entry text NOT NULL,
  pdf_sha256 char(64) NOT NULL UNIQUE CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  training_allowed boolean NOT NULL DEFAULT false CHECK (training_allowed = false),
  license_status text NOT NULL CHECK (
    license_status IN ('unverified', 'verified', 'restricted')
  ),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  review_status text NOT NULL CHECK (
    review_status IN ('unreviewed', 'pending_review', 'approved', 'rejected')
  ),
  reviewed_by text NULL REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  review_note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, archive_entry)
);

CREATE INDEX exam_papers_filter_idx
  ON exam_papers(university, year DESC, subject, paper_type);

CREATE INDEX exam_papers_course_review_idx
  ON exam_papers(course_id, review_status, updated_at DESC);
