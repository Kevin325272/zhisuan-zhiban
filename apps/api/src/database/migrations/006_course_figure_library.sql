ALTER TABLE course_figure_assets
  ADD COLUMN chapter text,
  ADD COLUMN tags jsonb,
  ADD COLUMN extraction_method text,
  ADD COLUMN extraction_confidence numeric(4,3);

UPDATE course_figure_assets
SET chapter = '1 计算机系统概论',
    tags = '["1 计算机系统概论"]'::jsonb,
    extraction_method = 'manual_pdf_crop',
    extraction_confidence = 1.000
WHERE chapter IS NULL;

ALTER TABLE course_figure_assets
  ALTER COLUMN chapter SET NOT NULL,
  ALTER COLUMN tags SET NOT NULL,
  ALTER COLUMN extraction_method SET NOT NULL,
  ALTER COLUMN extraction_confidence SET NOT NULL,
  ADD CONSTRAINT course_figure_assets_chapter_check
    CHECK (length(chapter) BETWEEN 2 AND 300),
  ADD CONSTRAINT course_figure_assets_tags_check
    CHECK (jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) > 0),
  ADD CONSTRAINT course_figure_assets_extraction_method_check
    CHECK (extraction_method IN ('manual_pdf_crop', 'windows_ocr_caption_anchor')),
  ADD CONSTRAINT course_figure_assets_extraction_confidence_check
    CHECK (extraction_confidence BETWEEN 0.920 AND 1.000);

ALTER TABLE course_figure_assets
  DROP CONSTRAINT course_figure_assets_verification_status_check;

ALTER TABLE course_figure_assets
  ADD CONSTRAINT course_figure_assets_verification_status_check
  CHECK (verification_status IN ('human_verified', 'coordinate_verified'));

CREATE TABLE course_figure_catalog_entries (
  catalog_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  asset_id text NULL REFERENCES course_figure_assets(asset_id) ON DELETE SET NULL,
  figure_label text NOT NULL CHECK (figure_label ~ '^图[0-9]{1,2}\.[0-9]{1,3}$'),
  caption text NOT NULL CHECK (length(caption) BETWEEN 1 AND 300),
  chapter text NOT NULL CHECK (length(chapter) BETWEEN 2 AND 300),
  print_page integer NOT NULL CHECK (print_page > 0),
  pdf_physical_page integer NOT NULL CHECK (pdf_physical_page = print_page + 7),
  source_pdf_sha256 char(64) NOT NULL CHECK (source_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  tags jsonb NOT NULL CHECK (
    jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) > 0
  ),
  extraction_status text NOT NULL CHECK (
    extraction_status IN (
      'displayable',
      'caption_not_located',
      'caption_unconfirmed',
      'crop_failed',
      'low_confidence',
      'rejected_low_confidence',
      'rejected_too_blank',
      'rejected_oversized',
      'rejected_too_small',
      'rejected_text_contamination',
      'duplicate_crop'
    )
  ),
  extraction_confidence numeric(4,3) NOT NULL CHECK (
    extraction_confidence BETWEEN 0.000 AND 1.000
  ),
  crop_box_pixels jsonb NULL CHECK (
    crop_box_pixels IS NULL OR jsonb_typeof(crop_box_pixels) = 'object'
  ),
  verification_status text NOT NULL CHECK (
    verification_status IN ('human_verified', 'coordinate_verified', 'detected_only')
  ),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  license_status text NOT NULL CHECK (license_status = 'unverified'),
  candidate_print_pages jsonb NOT NULL CHECK (
    jsonb_typeof(candidate_print_pages) = 'array'
    AND jsonb_array_length(candidate_print_pages) > 0
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, figure_label, source_pdf_sha256),
  CHECK (
    extraction_status <> 'displayable'
    OR (asset_id IS NOT NULL AND crop_box_pixels IS NOT NULL)
  )
);

CREATE INDEX course_figure_catalog_chapter_status_idx
  ON course_figure_catalog_entries(course_id, chapter, extraction_status, figure_label);

CREATE TABLE course_concept_figures (
  link_id text PRIMARY KEY,
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE CASCADE,
  asset_id text NOT NULL,
  figure_label text NOT NULL,
  display_role text NOT NULL CHECK (display_role IN ('primary', 'related')),
  match_method text NOT NULL CHECK (
    match_method IN ('direct_reference', 'semantic_candidate')
  ),
  match_confidence numeric(4,3) NOT NULL CHECK (
    match_confidence BETWEEN 0.920 AND 1.000
  ),
  source_chunk_ids jsonb NOT NULL CHECK (
    jsonb_typeof(source_chunk_ids) = 'array'
    AND jsonb_array_length(source_chunk_ids) > 0
  ),
  evidence_text text NOT NULL CHECK (length(evidence_text) BETWEEN 1 AND 600),
  display_enabled boolean NOT NULL DEFAULT true,
  ordinal smallint NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (asset_id, figure_label)
    REFERENCES course_figure_assets(asset_id, figure_label)
    ON DELETE CASCADE,
  UNIQUE (concept_id, asset_id)
);

CREATE UNIQUE INDEX course_concept_figures_primary_idx
  ON course_concept_figures(concept_id)
  WHERE display_enabled = true AND display_role = 'primary';

CREATE INDEX course_concept_figures_navigation_idx
  ON course_concept_figures(concept_id, display_enabled, ordinal);
