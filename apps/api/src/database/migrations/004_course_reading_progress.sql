CREATE TABLE course_reading_progress (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  chapter text NOT NULL CHECK (length(chapter) BETWEEN 1 AND 300),
  chunk_id text NOT NULL REFERENCES course_content_chunks(chunk_id) ON DELETE CASCADE,
  paragraph_index integer NOT NULL CHECK (paragraph_index BETWEEN 0 AND 10000),
  source_expanded boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id),
  CHECK (paragraph_index < 2 OR source_expanded = true)
);

CREATE INDEX course_reading_progress_recent_idx
  ON course_reading_progress(user_id, updated_at DESC);
