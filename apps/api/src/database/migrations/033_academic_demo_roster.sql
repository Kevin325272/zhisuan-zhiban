CREATE TABLE academic_classes (
  class_id text PRIMARY KEY,
  cohort_year integer NOT NULL CHECK (cohort_year BETWEEN 2000 AND 2100),
  major text NOT NULL CHECK (length(major) BETWEEN 1 AND 100),
  class_name text NOT NULL UNIQUE CHECK (length(class_name) BETWEEN 1 AND 100),
  data_provenance text NOT NULL CHECK (
    data_provenance IN ('synthetic_demo', 'user_provided', 'institution_verified')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE student_academic_profiles (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  student_number text NOT NULL UNIQUE CHECK (student_number ~ '^[0-9]{10}$'),
  class_id text NOT NULL REFERENCES academic_classes(class_id) ON DELETE RESTRICT,
  data_provenance text NOT NULL CHECK (
    data_provenance IN ('synthetic_demo', 'user_provided', 'institution_verified')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teacher_academic_profiles (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  teacher_number text NOT NULL UNIQUE CHECK (length(teacher_number) BETWEEN 4 AND 32),
  department text NOT NULL CHECK (length(department) BETWEEN 1 AND 120),
  professional_title text NOT NULL CHECK (length(professional_title) BETWEEN 1 AND 50),
  data_provenance text NOT NULL CHECK (
    data_provenance IN ('synthetic_demo', 'user_provided', 'institution_verified')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teacher_course_class_assignments (
  teacher_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES academic_classes(class_id) ON DELETE CASCADE,
  data_provenance text NOT NULL CHECK (
    data_provenance IN ('synthetic_demo', 'user_provided', 'institution_verified')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_user_id, course_id, class_id)
);

CREATE TABLE student_course_progress_snapshots (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  progress_percent integer NOT NULL CHECK (progress_percent BETWEEN 0 AND 100),
  correct_count integer NOT NULL CHECK (correct_count >= 0),
  incorrect_count integer NOT NULL CHECK (incorrect_count >= 0),
  evidence_count integer NOT NULL CHECK (evidence_count >= 0),
  pending_review_count integer NOT NULL CHECK (pending_review_count >= 0),
  weekly_study_minutes integer NOT NULL CHECK (weekly_study_minutes BETWEEN 0 AND 10080),
  current_focus text NULL CHECK (current_focus IS NULL OR length(current_focus) BETWEEN 1 AND 200),
  weak_concept_id text NULL REFERENCES course_core_concepts(concept_id) ON DELETE SET NULL,
  learning_status text NOT NULL CHECK (
    learning_status IN ('on_track', 'needs_attention', 'inactive')
  ),
  last_active_at timestamptz NULL,
  data_provenance text NOT NULL CHECK (data_provenance = 'synthetic_demo'),
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

CREATE INDEX student_academic_profiles_class_idx
  ON student_academic_profiles(class_id, student_number);

CREATE INDEX student_course_progress_course_idx
  ON student_course_progress_snapshots(course_id, learning_status, progress_percent);

CREATE INDEX teacher_course_class_course_idx
  ON teacher_course_class_assignments(course_id, teacher_user_id);
