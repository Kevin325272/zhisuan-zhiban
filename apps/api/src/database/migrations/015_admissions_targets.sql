CREATE TABLE admission_targets (
  target_id text PRIMARY KEY,
  school text NOT NULL CHECK (length(school) BETWEEN 1 AND 200),
  training_unit text NOT NULL CHECK (length(training_unit) BETWEEN 1 AND 200),
  program_code text NOT NULL CHECK (length(program_code) BETWEEN 1 AND 50),
  program_name text NOT NULL CHECK (length(program_name) BETWEEN 1 AND 200),
  study_mode text NOT NULL CHECK (length(study_mode) BETWEEN 1 AND 50),
  dataset_id text NOT NULL,
  license_status text NOT NULL CHECK (
    license_status IN ('unverified', 'verified', 'restricted')
  ),
  usage_scope text NOT NULL CHECK (
    usage_scope IN ('local_demo_only', 'authorized_product_use')
  ),
  training_allowed boolean NOT NULL DEFAULT false CHECK (training_allowed = false),
  review_status text NOT NULL CHECK (
    review_status IN ('pending_official_verification', 'verified')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school, training_unit, program_code, program_name, study_mode)
);

CREATE INDEX admission_targets_search_idx
  ON admission_targets(school, program_name, training_unit, program_code);

CREATE TABLE admission_retest_lines (
  line_id text PRIMARY KEY,
  target_id text NOT NULL REFERENCES admission_targets(target_id) ON DELETE RESTRICT,
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  retest_score integer NOT NULL CHECK (retest_score BETWEEN 0 AND 500),
  politics_score integer NULL CHECK (politics_score BETWEEN 0 AND 150),
  foreign_language_score integer NULL CHECK (foreign_language_score BETWEEN 0 AND 150),
  business_course_1_score integer NULL CHECK (business_course_1_score BETWEEN 0 AND 150),
  business_course_2_score integer NULL CHECK (business_course_2_score BETWEEN 0 AND 150),
  direction text NULL,
  initial_subjects text NULL,
  subject_source_url text NULL,
  retest_source_url text NOT NULL,
  source_domain text NOT NULL,
  source_type text NOT NULL,
  review_status text NOT NULL CHECK (
    review_status IN ('pending_official_verification', 'verified')
  ),
  original_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admission_retest_lines_target_year_idx
  ON admission_retest_lines(target_id, year DESC);

CREATE TABLE student_admission_targets (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  target_id text NOT NULL REFERENCES admission_targets(target_id) ON DELETE RESTRICT,
  saved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX student_admission_targets_user_idx
  ON student_admission_targets(user_id);

CREATE INDEX student_admission_targets_target_idx
  ON student_admission_targets(target_id);
