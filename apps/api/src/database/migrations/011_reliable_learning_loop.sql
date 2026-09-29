ALTER TABLE practice_attempts
  ADD COLUMN IF NOT EXISTS concept_id text NULL
    REFERENCES course_core_concepts(concept_id) ON DELETE SET NULL;

ALTER TABLE learning_evidence
  ADD COLUMN IF NOT EXISTS concept_id text NULL
    REFERENCES course_core_concepts(concept_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS practice_attempts_user_concept_idx
  ON practice_attempts(user_id, concept_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS learning_evidence_user_concept_idx
  ON learning_evidence(user_id, concept_id, created_at DESC);

CREATE TABLE course_concept_question_links (
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  matched_tag text NOT NULL CHECK (length(matched_tag) BETWEEN 1 AND 100),
  match_method text NOT NULL CHECK (match_method = 'exact_question_tag'),
  rule_version text NOT NULL CHECK (rule_version = 'v1_exact_unique_tag'),
  status text NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (concept_id, question_id)
);

CREATE INDEX course_concept_question_links_question_idx
  ON course_concept_question_links(question_id, status);

CREATE INDEX course_concept_question_links_concept_idx
  ON course_concept_question_links(concept_id, status, question_id);

CREATE TABLE practice_mistakes (
  mistake_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  concept_id text NULL REFERENCES course_core_concepts(concept_id) ON DELETE SET NULL,
  first_incorrect_attempt_id text NOT NULL REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  last_incorrect_attempt_id text NOT NULL REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  last_incorrect_evaluation_id text NOT NULL REFERENCES evaluations(evaluation_id) ON DELETE RESTRICT,
  wrong_count integer NOT NULL CHECK (wrong_count > 0),
  status text NOT NULL CHECK (status IN ('needs_review', 'mastered')) DEFAULT 'needs_review',
  first_incorrect_at timestamptz NOT NULL,
  last_incorrect_at timestamptz NOT NULL,
  mastered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);

CREATE INDEX practice_mistakes_user_filter_idx
  ON practice_mistakes(user_id, course_id, concept_id, status, updated_at DESC);

CREATE OR REPLACE FUNCTION xuetu_record_choice_mistake()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_course_id text;
BEGIN
  IF NEW.outcome <> 'incorrect' OR NEW.grading_mode <> 'deterministic_choice' THEN
    RETURN NEW;
  END IF;

  SELECT catalog.course_id
    INTO resolved_course_id
  FROM questions q
  JOIN course_catalog_entries catalog
    ON catalog.question_subject = q.subject
  WHERE q.question_id = NEW.question_id
  LIMIT 1;

  IF resolved_course_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO practice_mistakes (
    mistake_id, user_id, course_id, question_id, concept_id,
    first_incorrect_attempt_id, last_incorrect_attempt_id,
    last_incorrect_evaluation_id, wrong_count, status,
    first_incorrect_at, last_incorrect_at, mastered_at, created_at, updated_at
  ) VALUES (
    'mistake_' || md5(NEW.user_id || ':' || NEW.question_id),
    NEW.user_id, resolved_course_id, NEW.question_id, NEW.concept_id,
    NEW.attempt_id, NEW.attempt_id, NEW.evaluation_id, 1, 'needs_review',
    NEW.created_at, NEW.created_at, NULL, NEW.created_at, NEW.created_at
  )
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    concept_id = COALESCE(EXCLUDED.concept_id, practice_mistakes.concept_id),
    last_incorrect_attempt_id = EXCLUDED.last_incorrect_attempt_id,
    last_incorrect_evaluation_id = EXCLUDED.last_incorrect_evaluation_id,
    wrong_count = practice_mistakes.wrong_count + 1,
    status = 'needs_review',
    last_incorrect_at = EXCLUDED.last_incorrect_at,
    mastered_at = NULL,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS learning_evidence_choice_mistake_trigger ON learning_evidence;
CREATE TRIGGER learning_evidence_choice_mistake_trigger
AFTER INSERT ON learning_evidence
FOR EACH ROW
EXECUTE FUNCTION xuetu_record_choice_mistake();
