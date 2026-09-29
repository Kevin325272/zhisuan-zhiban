CREATE TABLE course_figure_assets (
  asset_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  figure_label text NOT NULL CHECK (figure_label ~ '^图[0-9]{1,2}\.[0-9]{1,3}$'),
  caption text NOT NULL CHECK (length(caption) > 0),
  textbook_title text NOT NULL,
  author_name text NOT NULL,
  edition text NOT NULL,
  publisher text NOT NULL,
  publication_year smallint NOT NULL CHECK (publication_year BETWEEN 1900 AND 2100),
  isbn text NOT NULL,
  print_page integer NOT NULL CHECK (print_page > 0),
  pdf_physical_page integer NOT NULL CHECK (pdf_physical_page > 0),
  source_pdf_sha256 char(64) NOT NULL CHECK (source_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  original_path text NOT NULL,
  asset_sha256 char(64) NOT NULL CHECK (asset_sha256 ~ '^[0-9a-f]{64}$'),
  storage_ref text NOT NULL CHECK (
    storage_ref ~ '^/course-assets/computer-organization/[a-z0-9/_-]+\.png$'
  ),
  mime_type text NOT NULL CHECK (mime_type = 'image/png'),
  pixel_width integer NOT NULL CHECK (pixel_width > 0),
  pixel_height integer NOT NULL CHECK (pixel_height > 0),
  crop_box_pixels jsonb NOT NULL CHECK (jsonb_typeof(crop_box_pixels) = 'object'),
  verification_status text NOT NULL CHECK (verification_status = 'human_verified'),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  license_status text NOT NULL CHECK (license_status = 'unverified'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, figure_label, source_pdf_sha256),
  UNIQUE (asset_id, figure_label)
);

CREATE INDEX course_figure_assets_course_page_idx
  ON course_figure_assets(course_id, print_page, figure_label);

CREATE TABLE course_figure_references (
  reference_id text PRIMARY KEY,
  chunk_id text NOT NULL REFERENCES course_content_chunks(chunk_id) ON DELETE CASCADE,
  asset_id text NOT NULL,
  figure_label text NOT NULL,
  reference_text text NOT NULL CHECK (length(reference_text) > 0),
  ordinal smallint NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (asset_id, figure_label)
    REFERENCES course_figure_assets(asset_id, figure_label)
    ON DELETE CASCADE,
  UNIQUE (chunk_id, asset_id)
);

CREATE INDEX course_figure_references_chunk_idx
  ON course_figure_references(chunk_id, ordinal);
