CREATE TABLE course_video_import_batches (
  import_batch_id text PRIMARY KEY,
  dataset_id text NOT NULL UNIQUE,
  archive_file text NOT NULL,
  archive_sha256 char(64) NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  source_provider text NOT NULL,
  original_path text NOT NULL,
  collected_at timestamptz NOT NULL,
  license_status text NOT NULL CHECK (license_status = 'unverified'),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  review_status text NOT NULL CHECK (review_status IN ('pending_review', 'approved', 'rejected')),
  content_mode text NOT NULL CHECK (content_mode = 'external_links_only'),
  notice text NOT NULL,
  raw_manifest jsonb NOT NULL CHECK (jsonb_typeof(raw_manifest) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_video_series (
  series_id text PRIMARY KEY,
  import_batch_id text NOT NULL REFERENCES course_video_import_batches(import_batch_id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  course_slug text NOT NULL,
  subject_label text NOT NULL,
  video_kind text NOT NULL CHECK (video_kind IN ('teaching', 'question_explanation')),
  platform text NOT NULL CHECK (platform = 'bilibili'),
  bv_id text NOT NULL UNIQUE CHECK (bv_id ~ '^BV[0-9A-Za-z]+$'),
  title text NOT NULL,
  uploader text NOT NULL,
  total_seconds integer NOT NULL CHECK (total_seconds >= 0),
  total_duration text NOT NULL,
  episode_count integer NOT NULL CHECK (episode_count > 0),
  canonical_url text NOT NULL CHECK (canonical_url LIKE 'https://www.bilibili.com/video/%'),
  description text NOT NULL,
  published_on text NOT NULL,
  source_collected_at text NOT NULL,
  license_status text NOT NULL CHECK (license_status = 'unverified'),
  usage_scope text NOT NULL CHECK (usage_scope = 'local_demo_only'),
  review_status text NOT NULL CHECK (review_status IN ('pending_review', 'approved', 'rejected')),
  raw_metadata jsonb NOT NULL CHECK (jsonb_typeof(raw_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX course_video_series_course_idx
  ON course_video_series(course_id, video_kind, title);

CREATE TABLE course_video_episodes (
  episode_id text PRIMARY KEY,
  series_id text NOT NULL REFERENCES course_video_series(series_id) ON DELETE RESTRICT,
  episode_number integer NOT NULL CHECK (episode_number > 0),
  title text NOT NULL,
  duration text NOT NULL,
  duration_seconds integer NOT NULL CHECK (duration_seconds >= 0),
  external_url text NOT NULL CHECK (external_url LIKE 'https://www.bilibili.com/video/%'),
  cid text NOT NULL,
  raw_metadata jsonb NOT NULL CHECK (jsonb_typeof(raw_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id, episode_number)
);

CREATE INDEX course_video_episodes_series_idx
  ON course_video_episodes(series_id, episode_number);

CREATE TABLE course_concept_video_links (
  link_id text PRIMARY KEY,
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  episode_id text NOT NULL REFERENCES course_video_episodes(episode_id) ON DELETE RESTRICT,
  display_role text NOT NULL CHECK (display_role IN ('primary', 'related')),
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  match_method text NOT NULL CHECK (match_method = 'metadata_title_review'),
  match_confidence numeric(5,4) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  review_status text NOT NULL CHECK (review_status IN ('approved', 'pending_review', 'rejected')),
  review_note text NOT NULL,
  display_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, episode_id)
);

CREATE INDEX course_concept_video_links_student_idx
  ON course_concept_video_links(concept_id, display_enabled, review_status, ordinal);
