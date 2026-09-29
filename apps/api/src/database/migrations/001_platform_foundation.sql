CREATE TABLE users (
  user_id text PRIMARY KEY,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  account_status text NOT NULL CHECK (account_status IN ('active', 'disabled')),
  auth_source text NOT NULL CHECK (auth_source IN ('local_development', 'external_identity')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  role_key text PRIMARY KEY CHECK (role_key IN ('student', 'teacher', 'admin')),
  label text NOT NULL,
  description text NOT NULL
);

CREATE TABLE permissions (
  permission_key text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_key text NOT NULL REFERENCES roles(role_key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE user_roles (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_key text NOT NULL REFERENCES roles(role_key) ON DELETE RESTRICT,
  granted_by text NULL REFERENCES users(user_id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_key)
);

CREATE TABLE courses (
  course_id text PRIMARY KEY,
  course_code text NOT NULL UNIQUE,
  title text NOT NULL,
  discipline text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  created_by text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_memberships (
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  membership_role text NOT NULL CHECK (membership_role IN ('student', 'teacher')),
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);

CREATE INDEX course_memberships_user_idx
  ON course_memberships(user_id, status);

CREATE TABLE materials (
  material_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  title text NOT NULL,
  material_type text NOT NULL CHECK (
    material_type IN ('course_handout', 'textbook', 'exercise_set', 'reference', 'other')
  ),
  source_url text NULL,
  storage_ref text NULL,
  review_status text NOT NULL CHECK (
    review_status IN ('unreviewed', 'pending_review', 'approved', 'rejected')
  ),
  license_status text NOT NULL CHECK (
    license_status IN ('unverified', 'verified', 'restricted')
  ),
  created_by text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_url IS NOT NULL OR storage_ref IS NOT NULL)
);

CREATE INDEX materials_course_review_idx
  ON materials(course_id, review_status);

CREATE TABLE question_import_batches (
  import_batch_id text PRIMARY KEY,
  dataset_id text NOT NULL,
  archive_sha256 char(64) NOT NULL,
  source_provider text NOT NULL,
  source_url text NULL,
  license_status text NOT NULL CHECK (
    license_status IN ('unverified', 'verified', 'restricted')
  ),
  usage_scope text NOT NULL CHECK (
    usage_scope IN ('local_demo_only', 'authorized_product_use')
  ),
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  question_count integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  UNIQUE (dataset_id, archive_sha256)
);

CREATE TABLE questions (
  question_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  import_batch_id text NOT NULL REFERENCES question_import_batches(import_batch_id) ON DELETE RESTRICT,
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  number integer NOT NULL CHECK (number > 0),
  subject text NOT NULL,
  question_type text NOT NULL CHECK (question_type IN ('choice', 'subjective')),
  multiple boolean NOT NULL DEFAULT false,
  question_text text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  tags text[] NOT NULL DEFAULT '{}',
  assets jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assets) = 'array'),
  answer_key jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(answer_key) = 'array'),
  explanation_text text NULL,
  solution_text text NULL,
  source_url text NOT NULL,
  license_status text NOT NULL CHECK (
    license_status IN ('unverified', 'verified', 'restricted')
  ),
  usage_scope text NOT NULL CHECK (
    usage_scope IN ('local_demo_only', 'authorized_product_use')
  ),
  review_status text NOT NULL CHECK (
    review_status IN ('unreviewed', 'pending_review', 'approved', 'rejected')
  ),
  reviewed_by text NULL REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  review_note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, year, number),
  CHECK (
    (question_type = 'choice' AND jsonb_array_length(options) >= 2 AND jsonb_array_length(answer_key) >= 1)
    OR (question_type = 'subjective' AND jsonb_array_length(options) = 0)
  )
);

CREATE INDEX questions_filter_idx
  ON questions(course_id, subject, year, question_type, review_status);
CREATE INDEX questions_tags_idx ON questions USING gin(tags);

CREATE TABLE practice_attempts (
  attempt_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  answer_type text NOT NULL CHECK (answer_type IN ('choice', 'subjective')),
  selected_option_ids jsonb NULL CHECK (
    selected_option_ids IS NULL OR jsonb_typeof(selected_option_ids) = 'array'
  ),
  response_text text NULL,
  status text NOT NULL CHECK (status IN ('submitted', 'evaluated', 'pending_review')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (answer_type = 'choice' AND selected_option_ids IS NOT NULL AND response_text IS NULL)
    OR (answer_type = 'subjective' AND selected_option_ids IS NULL AND response_text IS NOT NULL)
  )
);

CREATE INDEX practice_attempts_user_course_idx
  ON practice_attempts(user_id, course_id, submitted_at DESC);

CREATE TABLE evaluations (
  evaluation_id text PRIMARY KEY,
  attempt_id text NOT NULL UNIQUE REFERENCES practice_attempts(attempt_id) ON DELETE CASCADE,
  grading_mode text NOT NULL CHECK (
    grading_mode IN ('deterministic_choice', 'ai_or_teacher_review_required')
  ),
  status text NOT NULL CHECK (status IN ('correct', 'incorrect', 'pending_review')),
  is_correct boolean NULL,
  score numeric(5,2) NULL CHECK (score BETWEEN 0 AND 100),
  correct_option_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(correct_option_ids) = 'array'
  ),
  explanation_text text NULL,
  reference_solution text NULL,
  review_required boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (grading_mode = 'deterministic_choice' AND status IN ('correct', 'incorrect')
      AND is_correct IS NOT NULL AND score IS NOT NULL AND review_required = false)
    OR (grading_mode = 'ai_or_teacher_review_required' AND status = 'pending_review'
      AND is_correct IS NULL AND score IS NULL AND review_required = true)
  )
);

CREATE TABLE learning_evidence (
  evidence_id text PRIMARY KEY,
  evaluation_id text NOT NULL REFERENCES evaluations(evaluation_id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES practice_attempts(attempt_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('correct', 'incorrect', 'pending_review')),
  grading_mode text NOT NULL CHECK (
    grading_mode IN ('deterministic_choice', 'ai_or_teacher_review_required')
  ),
  evidence_payload jsonb NOT NULL CHECK (jsonb_typeof(evidence_payload) = 'object'),
  eligible_for_learning_state_update boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome <> 'pending_review' OR eligible_for_learning_state_update = false)
);

CREATE INDEX learning_evidence_user_course_idx
  ON learning_evidence(user_id, course_id, created_at DESC);
