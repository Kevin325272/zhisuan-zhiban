CREATE TABLE course_reading_history (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  chunk_id text NOT NULL REFERENCES course_content_chunks(chunk_id) ON DELETE CASCADE,
  chapter text NOT NULL CHECK (length(chapter) BETWEEN 1 AND 300),
  max_paragraph_index integer NOT NULL CHECK (max_paragraph_index BETWEEN 0 AND 10000),
  first_read_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id, chunk_id)
);

CREATE INDEX course_reading_history_user_course_idx
  ON course_reading_history(user_id, course_id, last_read_at DESC);

INSERT INTO course_reading_history(
  user_id, course_id, chunk_id, chapter, max_paragraph_index, first_read_at, last_read_at
)
SELECT user_id, course_id, chunk_id, chapter, paragraph_index, updated_at, updated_at
FROM course_reading_progress
ON CONFLICT (user_id, course_id, chunk_id) DO UPDATE
SET chapter = EXCLUDED.chapter,
    max_paragraph_index = GREATEST(
      course_reading_history.max_paragraph_index,
      EXCLUDED.max_paragraph_index
    ),
    first_read_at = LEAST(course_reading_history.first_read_at, EXCLUDED.first_read_at),
    last_read_at = GREATEST(course_reading_history.last_read_at, EXCLUDED.last_read_at);
