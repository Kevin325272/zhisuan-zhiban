CREATE TABLE student_onboarding_states (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed')),
  current_step text NOT NULL CHECK (
    current_step IN ('goals', 'self_assessment', 'diagnostic', 'profile', 'plan')
  ),
  target_exam_year integer NULL CHECK (target_exam_year BETWEEN 2026 AND 2100),
  preparation_stage text NULL CHECK (
    preparation_stage IN ('preparing', 'foundation', 'strengthening', 'sprint')
  ),
  daily_minutes integer NULL CHECK (
    daily_minutes BETWEEN 30 AND 360 AND daily_minutes % 15 = 0
  ),
  target_school text NULL CHECK (target_school IS NULL OR length(target_school) BETWEEN 1 AND 120),
  target_score integer NULL CHECK (target_score BETWEEN 0 AND 150),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status IN ('not_started', 'completed')
    OR (target_exam_year IS NOT NULL AND preparation_stage IS NOT NULL AND daily_minutes IS NOT NULL)
  )
);

CREATE INDEX student_onboarding_status_idx
  ON student_onboarding_states(status, updated_at DESC);

CREATE TABLE student_onboarding_self_assessments (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  level text NOT NULL CHECK (level IN ('not_started', 'weak', 'average', 'good', 'reinforcing')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id),
  CHECK (course_id IN ('course_408_ds', 'course_408_co', 'course_408_os', 'course_408_cn'))
);

CREATE TABLE onboarding_diagnostic_questions (
  set_version text NOT NULL CHECK (length(set_version) BETWEEN 1 AND 50),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 8),
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 100),
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_version, ordinal),
  UNIQUE (set_version, question_id),
  CHECK (course_id IN ('course_408_ds', 'course_408_co', 'course_408_os', 'course_408_cn'))
);

CREATE INDEX onboarding_diagnostic_active_idx
  ON onboarding_diagnostic_questions(set_version, active, ordinal);

CREATE TABLE student_onboarding_diagnostic_answers (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  set_version text NOT NULL,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  response_status text NOT NULL CHECK (response_status IN ('answered', 'unsure', 'skipped')),
  selected_option_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_option_ids) = 'array'),
  is_correct boolean NULL,
  evaluated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, set_version, question_id),
  FOREIGN KEY (set_version, question_id)
    REFERENCES onboarding_diagnostic_questions(set_version, question_id) ON DELETE RESTRICT,
  CHECK (
    (response_status = 'answered' AND jsonb_array_length(selected_option_ids) > 0)
    OR (response_status IN ('unsure', 'skipped') AND jsonb_array_length(selected_option_ids) = 0)
  ),
  CHECK (
    (evaluated_at IS NULL AND is_correct IS NULL)
    OR (evaluated_at IS NOT NULL AND (
      (response_status = 'answered' AND is_correct IS NOT NULL)
      OR (response_status IN ('unsure', 'skipped') AND is_correct IS NULL)
    ))
  )
);

CREATE INDEX student_onboarding_answers_user_idx
  ON student_onboarding_diagnostic_answers(user_id, set_version, updated_at DESC);

CREATE TABLE student_initial_profile_versions (
  profile_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  confidence text NOT NULL CHECK (confidence = 'low'),
  profile_payload jsonb NOT NULL CHECK (jsonb_typeof(profile_payload) = 'object'),
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);

CREATE INDEX student_initial_profile_user_idx
  ON student_initial_profile_versions(user_id, version DESC);

CREATE TABLE student_learning_plan_versions (
  plan_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  source text NOT NULL CHECK (source = 'deterministic_fallback'),
  ai_status text NOT NULL CHECK (ai_status = 'unavailable'),
  ai_status_message text NOT NULL,
  start_date date NOT NULL,
  daily_minutes integer NOT NULL CHECK (
    daily_minutes BETWEEN 30 AND 360 AND daily_minutes % 15 = 0
  ),
  today_task_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'superseded')) DEFAULT 'active',
  generated_at timestamptz NOT NULL,
  superseded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);

CREATE UNIQUE INDEX student_learning_plan_active_idx
  ON student_learning_plan_versions(user_id)
  WHERE status = 'active';

CREATE TABLE student_learning_plan_tasks (
  task_id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES student_learning_plan_versions(plan_id) ON DELETE CASCADE,
  day_index integer NOT NULL CHECK (day_index BETWEEN 1 AND 7),
  task_date date NOT NULL,
  task_order integer NOT NULL CHECK (task_order BETWEEN 1 AND 10),
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  concept_id text NULL REFERENCES course_core_concepts(concept_id) ON DELETE SET NULL,
  task_type text NOT NULL CHECK (
    task_type IN ('course_reading', 'case_review', 'choice_practice', 'mistake_review')
  ),
  estimated_minutes integer NOT NULL CHECK (estimated_minutes BETWEEN 5 AND 360),
  title text NOT NULL,
  reason text NOT NULL,
  completion_criteria text NOT NULL,
  href text NOT NULL CHECK (href LIKE '/student/%'),
  evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
  status text NOT NULL CHECK (status IN ('pending', 'completed')) DEFAULT 'pending',
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, day_index, task_order)
);

CREATE INDEX student_learning_plan_tasks_status_idx
  ON student_learning_plan_tasks(plan_id, status, day_index, task_order);

-- Accounts that already existed when this feature was introduced keep their
-- current student home. New registrations have no row and are initialized as
-- not_started by the onboarding service on first access.
INSERT INTO student_onboarding_states(
  user_id, status, current_step, started_at, completed_at, created_at, updated_at
)
SELECT DISTINCT u.user_id, 'completed', 'plan', now(), now(), now(), now()
FROM users u
JOIN user_roles ur ON ur.user_id = u.user_id AND ur.role_key = 'student'
ON CONFLICT (user_id) DO NOTHING;
