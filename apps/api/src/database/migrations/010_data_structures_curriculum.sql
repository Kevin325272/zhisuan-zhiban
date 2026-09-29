ALTER TABLE course_core_concepts
  ADD COLUMN IF NOT EXISTS learning_explanation jsonb,
  ADD COLUMN IF NOT EXISTS case_prompt text,
  ADD COLUMN IF NOT EXISTS practice_tags jsonb;

ALTER TABLE course_core_concepts
  DROP CONSTRAINT IF EXISTS course_core_concepts_learning_explanation_check;

ALTER TABLE course_core_concepts
  ADD CONSTRAINT course_core_concepts_learning_explanation_check
  CHECK (
    learning_explanation IS NULL
    OR (
      jsonb_typeof(learning_explanation) = 'array'
      AND jsonb_array_length(learning_explanation) BETWEEN 1 AND 4
    )
  );

ALTER TABLE course_core_concepts
  DROP CONSTRAINT IF EXISTS course_core_concepts_practice_tags_check;

ALTER TABLE course_core_concepts
  ADD CONSTRAINT course_core_concepts_practice_tags_check
  CHECK (
    practice_tags IS NULL
    OR (
      jsonb_typeof(practice_tags) = 'array'
      AND jsonb_array_length(practice_tags) BETWEEN 0 AND 8
    )
  );

CREATE TABLE IF NOT EXISTS course_source_concept_figures (
  link_id text PRIMARY KEY,
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE CASCADE,
  figure_asset_id text NOT NULL REFERENCES course_source_figure_assets(figure_asset_id) ON DELETE RESTRICT,
  source_chunk_id text NOT NULL REFERENCES course_source_chunks(chunk_id) ON DELETE RESTRICT,
  display_role text NOT NULL CHECK (display_role IN ('primary', 'related')),
  match_confidence numeric(5,4) NOT NULL CHECK (match_confidence >= 0.92 AND match_confidence <= 1),
  display_enabled boolean NOT NULL DEFAULT true,
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, figure_asset_id)
);

CREATE INDEX IF NOT EXISTS course_source_concept_figures_concept_idx
  ON course_source_concept_figures(concept_id, display_enabled, ordinal);
