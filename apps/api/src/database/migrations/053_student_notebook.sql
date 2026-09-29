CREATE TABLE student_notebook_entries (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  entry_id text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  content text NOT NULL DEFAULT '' CHECK (length(content) <= 20000),
  subject text NOT NULL CHECK (subject IN ('通用','数据结构','组成原理','操作系统','计算机网络')),
  question_id text NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  question_snapshot jsonb NULL,
  bookmarked boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entry_id),
  UNIQUE (user_id, question_id),
  CHECK (NOT bookmarked OR question_id IS NOT NULL),
  CHECK ((question_id IS NULL AND question_snapshot IS NULL) OR
    (question_id IS NOT NULL AND jsonb_typeof(question_snapshot) = 'object'))
);
CREATE INDEX student_notebook_updated_idx ON student_notebook_entries(user_id, updated_at DESC);
