CREATE TABLE course_source_datasets (
  dataset_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  book_id text NOT NULL,
  title text NOT NULL,
  course_label text NOT NULL,
  version text NOT NULL,
  isbn text NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = '2.1'),
  generated_at timestamptz NOT NULL,
  archive_file_name text NOT NULL,
  archive_sha256 char(64) NOT NULL CHECK (archive_sha256 ~ '^[a-f0-9]{64}$'),
  source_files jsonb NOT NULL CHECK (jsonb_typeof(source_files) = 'array'),
  license_status text NOT NULL CHECK (license_status = 'unverified'),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  provenance_status text NOT NULL,
  student_content_status text NOT NULL CHECK (
    student_content_status IN ('source_layer_only_curriculum_pending', 'curriculum_available')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, dataset_id)
);

CREATE INDEX course_source_datasets_course_idx
  ON course_source_datasets(course_id, updated_at DESC);

CREATE TABLE course_source_chunks (
  chunk_id text PRIMARY KEY,
  dataset_id text NOT NULL REFERENCES course_source_datasets(dataset_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  source_item_id text NOT NULL,
  chapter text NOT NULL,
  title text NOT NULL,
  printed_page integer NOT NULL CHECK (printed_page > 0),
  content_type text NOT NULL,
  content_text text NOT NULL CHECK (length(content_text) > 0),
  keywords jsonb NOT NULL CHECK (jsonb_typeof(keywords) = 'array'),
  quality_score numeric(5,4) NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
  needs_review boolean NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, source_item_id)
);

CREATE INDEX course_source_chunks_navigation_idx
  ON course_source_chunks(course_id, chapter, ordinal);

CREATE TABLE course_source_figure_assets (
  figure_asset_id text PRIMARY KEY,
  dataset_id text NOT NULL REFERENCES course_source_datasets(dataset_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  figure_no text NOT NULL,
  title text NOT NULL,
  chapter text NOT NULL,
  source_document text NOT NULL,
  version text NOT NULL,
  isbn text NOT NULL,
  printed_page integer NOT NULL CHECK (printed_page > 0),
  physical_page integer NOT NULL CHECK (physical_page > 0),
  crop_rect jsonb NOT NULL CHECK (jsonb_typeof(crop_rect) = 'object'),
  asset_sha256 char(64) NOT NULL CHECK (asset_sha256 ~ '^[a-f0-9]{64}$'),
  webp_sha256 char(64) NOT NULL CHECK (webp_sha256 ~ '^[a-f0-9]{64}$'),
  png_path text NOT NULL,
  webp_path text NOT NULL,
  source_file text NOT NULL,
  source_part text NOT NULL,
  combined_physical_page integer NOT NULL CHECK (combined_physical_page > 0),
  crop_coordinate_space text NOT NULL,
  source_page_size jsonb NOT NULL CHECK (jsonb_typeof(source_page_size) = 'object'),
  pixel_size jsonb NOT NULL CHECK (jsonb_typeof(pixel_size) = 'object'),
  ocr_caption text NOT NULL,
  ocr_confidence numeric(5,4) NOT NULL CHECK (ocr_confidence BETWEEN 0 AND 1),
  ocr_correction text NOT NULL,
  quality_checks jsonb NOT NULL CHECK (jsonb_typeof(quality_checks) = 'object'),
  ink_ratio numeric(5,4) NOT NULL CHECK (ink_ratio BETWEEN 0 AND 1),
  review_status text NOT NULL CHECK (
    review_status IN ('machine_verified', 'human_verified', 'needs_human_review')
  ),
  image_available boolean NOT NULL,
  license_status text NOT NULL CHECK (license_status = 'unverified'),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  raw_metadata jsonb NOT NULL CHECK (jsonb_typeof(raw_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, figure_no, printed_page)
);

CREATE INDEX course_source_figure_assets_review_idx
  ON course_source_figure_assets(course_id, review_status, image_available, printed_page);

CREATE TABLE course_source_figure_relations (
  source_chunk_id text NOT NULL REFERENCES course_source_chunks(chunk_id) ON DELETE CASCADE,
  figure_asset_id text NOT NULL REFERENCES course_source_figure_assets(figure_asset_id) ON DELETE CASCADE,
  dataset_id text NOT NULL REFERENCES course_source_datasets(dataset_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  anchor text NOT NULL,
  display_role text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  source_document text NOT NULL,
  printed_page integer NOT NULL CHECK (printed_page > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_chunk_id, figure_asset_id)
);

CREATE INDEX course_source_figure_relations_asset_idx
  ON course_source_figure_relations(figure_asset_id, confidence);

