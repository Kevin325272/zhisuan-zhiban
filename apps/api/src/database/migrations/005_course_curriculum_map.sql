ALTER TABLE course_content_sources
  DROP CONSTRAINT course_content_sources_source_kind_check;

ALTER TABLE course_content_sources
  ADD CONSTRAINT course_content_sources_source_kind_check
  CHECK (
    source_kind IN (
      'knowledge_chunks',
      'qa_examples',
      'training_messages',
      'curriculum_map'
    )
  );

CREATE TABLE course_learning_modules (
  module_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES course_content_sources(source_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  chapter_id text NOT NULL,
  source_chapter text NOT NULL CHECK (length(source_chapter) BETWEEN 2 AND 300),
  chapter_title text NOT NULL CHECK (length(chapter_title) BETWEEN 2 AND 120),
  chapter_ordinal smallint NOT NULL CHECK (chapter_ordinal > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, chapter_id, ordinal)
);

CREATE INDEX course_learning_modules_navigation_idx
  ON course_learning_modules(course_id, chapter_ordinal, ordinal);

CREATE TABLE course_core_concepts (
  concept_id text PRIMARY KEY,
  module_id text NOT NULL REFERENCES course_learning_modules(module_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  learning_objective text NOT NULL CHECK (length(learning_objective) BETWEEN 10 AND 600),
  learning_note_kind text NOT NULL CHECK (
    learning_note_kind IN ('misconception', 'reminder')
  ),
  learning_note_text text NOT NULL CHECK (length(learning_note_text) BETWEEN 1 AND 500),
  importance text NOT NULL CHECK (importance IN ('core', 'extended')),
  review_status text NOT NULL CHECK (review_status IN ('verified', 'needs_review')),
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, ordinal)
);

CREATE INDEX course_core_concepts_navigation_idx
  ON course_core_concepts(course_id, module_id, ordinal);

CREATE TABLE course_concept_sources (
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE CASCADE,
  chunk_id text NOT NULL REFERENCES course_content_chunks(chunk_id) ON DELETE RESTRICT,
  print_page integer NOT NULL CHECK (print_page > 0),
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  PRIMARY KEY (concept_id, chunk_id)
);

CREATE INDEX course_concept_sources_chunk_idx
  ON course_concept_sources(chunk_id, concept_id);

CREATE TABLE course_concept_terms (
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE CASCADE,
  term_text text NOT NULL CHECK (length(term_text) BETWEEN 1 AND 80),
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  PRIMARY KEY (concept_id, term_text)
);

CREATE TABLE course_concept_prerequisites (
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE CASCADE,
  prerequisite_concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE RESTRICT,
  PRIMARY KEY (concept_id, prerequisite_concept_id),
  CHECK (concept_id <> prerequisite_concept_id)
);
