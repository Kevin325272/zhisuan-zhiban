CREATE TABLE student_study_collections (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  collection_id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, collection_id), UNIQUE (user_id, name)
);
CREATE TABLE student_study_collection_questions (
  user_id text NOT NULL, collection_id text NOT NULL,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, collection_id, question_id),
  FOREIGN KEY (user_id, collection_id) REFERENCES student_study_collections ON DELETE CASCADE
);
CREATE TABLE student_memory_cards (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  card_id text NOT NULL,
  front text NOT NULL CHECK (length(front) BETWEEN 1 AND 2000),
  back text NOT NULL CHECK (length(back) BETWEEN 1 AND 8000),
  subject text NOT NULL CHECK (subject IN ('通用','数据结构','组成原理','操作系统','计算机网络')),
  source_note_id text NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  due_at timestamptz NOT NULL DEFAULT now(),
  memory_state jsonb NULL CHECK (memory_state IS NULL OR jsonb_typeof(memory_state) = 'object'),
  reviews integer NOT NULL DEFAULT 0 CHECK (reviews >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX student_memory_due_idx ON student_memory_cards(user_id, due_at, card_id);
CREATE TABLE student_memory_days (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day date NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE student_memory_day_cards (
  user_id text NOT NULL, day date NOT NULL, card_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0), completed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, day, card_id),
  FOREIGN KEY (user_id, day) REFERENCES student_memory_days ON DELETE CASCADE,
  FOREIGN KEY (user_id, card_id) REFERENCES student_memory_cards ON DELETE CASCADE
);
CREATE TABLE student_memory_reviews (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  request_id uuid NOT NULL, input jsonb NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, request_id)
);
