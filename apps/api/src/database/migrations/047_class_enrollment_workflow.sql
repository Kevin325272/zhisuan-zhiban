CREATE TABLE class_invitation_codes (
  invitation_id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES academic_classes(class_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  code_hash char(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  code_suffix char(4) NOT NULL CHECK (code_suffix ~ '^[A-Z0-9]{4}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX class_invitation_codes_active_class_idx
  ON class_invitation_codes(class_id, course_id)
  WHERE revoked_at IS NULL;

CREATE INDEX class_invitation_codes_hash_lookup_idx
  ON class_invitation_codes(code_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE class_enrollment_requests (
  request_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  invitation_id text NOT NULL REFERENCES class_invitation_codes(invitation_id) ON DELETE RESTRICT,
  class_id text NOT NULL REFERENCES academic_classes(class_id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  student_number text NOT NULL CHECK (student_number ~ '^[0-9]{10}$'),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by text NULL REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status IN ('pending', 'cancelled') AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX class_enrollment_requests_pending_user_idx
  ON class_enrollment_requests(user_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX class_enrollment_requests_pending_number_idx
  ON class_enrollment_requests(student_number)
  WHERE status = 'pending';

CREATE INDEX class_enrollment_requests_teacher_queue_idx
  ON class_enrollment_requests(course_id, class_id, status, created_at);

CREATE INDEX class_enrollment_requests_student_history_idx
  ON class_enrollment_requests(user_id, created_at DESC);
