CREATE TABLE practice_mistake_review_states (
  mistake_id text PRIMARY KEY REFERENCES practice_mistakes(mistake_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  next_review_at timestamptz NULL,
  consecutive_success_count integer NOT NULL DEFAULT 0
    CHECK (consecutive_success_count >= 0),
  last_processed_attempt_id text NULL
    REFERENCES practice_attempts(attempt_id) ON DELETE RESTRICT,
  last_reviewed_at timestamptz NULL,
  algorithm_version text NOT NULL DEFAULT 'evidence_weighted_v1'
    CHECK (algorithm_version = 'evidence_weighted_v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX practice_mistake_review_states_user_due_idx
  ON practice_mistake_review_states(user_id, next_review_at)
  WHERE next_review_at IS NOT NULL;

INSERT INTO practice_mistake_review_states (
  mistake_id,
  user_id,
  next_review_at,
  consecutive_success_count,
  algorithm_version
)
SELECT
  mistake_id,
  user_id,
  last_incorrect_at + interval '1 day',
  0,
  'evidence_weighted_v1'
FROM practice_mistakes
WHERE status = 'needs_review'
ON CONFLICT (mistake_id) DO NOTHING;

CREATE OR REPLACE FUNCTION xuetu_advance_mistake_review_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  mistake_row practice_mistakes%ROWTYPE;
  review_state_row practice_mistake_review_states%ROWTYPE;
  next_success_count integer;
BEGIN
  IF NEW.eligible_for_learning_state_update IS NOT TRUE
     OR NEW.grading_mode <> 'deterministic_choice'
     OR NEW.outcome NOT IN ('correct', 'incorrect') THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO mistake_row
  FROM practice_mistakes
  WHERE user_id = NEW.user_id
    AND question_id = NEW.question_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.outcome = 'incorrect' THEN
    INSERT INTO practice_mistake_review_states (
      mistake_id,
      user_id,
      next_review_at,
      consecutive_success_count,
      last_processed_attempt_id,
      last_reviewed_at,
      algorithm_version,
      created_at,
      updated_at
    ) VALUES (
      mistake_row.mistake_id,
      mistake_row.user_id,
      NEW.created_at + interval '1 day',
      0,
      NEW.attempt_id,
      NULL,
      'evidence_weighted_v1',
      NEW.created_at,
      NEW.created_at
    )
    ON CONFLICT (mistake_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      next_review_at = EXCLUDED.next_review_at,
      consecutive_success_count = 0,
      last_processed_attempt_id = EXCLUDED.last_processed_attempt_id,
      last_reviewed_at = NULL,
      algorithm_version = EXCLUDED.algorithm_version,
      updated_at = EXCLUDED.updated_at
    WHERE practice_mistake_review_states.last_processed_attempt_id
      IS DISTINCT FROM EXCLUDED.last_processed_attempt_id;
    RETURN NEW;
  END IF;

  IF NEW.outcome = 'correct' THEN
    IF mistake_row.status <> 'needs_review'
       OR NEW.created_at <= mistake_row.last_incorrect_at THEN
      RETURN NEW;
    END IF;

  SELECT *
    INTO review_state_row
  FROM practice_mistake_review_states
  WHERE mistake_id = mistake_row.mistake_id
  FOR UPDATE;

  IF FOUND AND review_state_row.last_processed_attempt_id = NEW.attempt_id THEN
    RETURN NEW;
  END IF;

  next_success_count := COALESCE(review_state_row.consecutive_success_count, 0) + 1;

  IF next_success_count >= 3 THEN
    UPDATE practice_mistakes
    SET status = 'mastered',
        mastered_at = NEW.created_at,
        updated_at = NEW.created_at
    WHERE mistake_id = mistake_row.mistake_id
      AND user_id = NEW.user_id;

    INSERT INTO practice_mistake_review_states (
      mistake_id,
      user_id,
      next_review_at,
      consecutive_success_count,
      last_processed_attempt_id,
      last_reviewed_at,
      algorithm_version,
      created_at,
      updated_at
    ) VALUES (
      mistake_row.mistake_id,
      mistake_row.user_id,
      NULL,
      3,
      NEW.attempt_id,
      NEW.created_at,
      'evidence_weighted_v1',
      NEW.created_at,
      NEW.created_at
    )
    ON CONFLICT (mistake_id) DO UPDATE SET
      next_review_at = NULL,
      consecutive_success_count = 3,
      last_processed_attempt_id = EXCLUDED.last_processed_attempt_id,
      last_reviewed_at = EXCLUDED.last_reviewed_at,
      algorithm_version = EXCLUDED.algorithm_version,
      updated_at = EXCLUDED.updated_at;
    RETURN NEW;
  END IF;

  INSERT INTO practice_mistake_review_states (
    mistake_id,
    user_id,
    next_review_at,
    consecutive_success_count,
    last_processed_attempt_id,
    last_reviewed_at,
    algorithm_version,
    created_at,
    updated_at
  ) VALUES (
    mistake_row.mistake_id,
    mistake_row.user_id,
    NEW.created_at + CASE WHEN next_success_count = 1 THEN interval '3 days' ELSE interval '7 days' END,
    next_success_count,
    NEW.attempt_id,
    NEW.created_at,
    'evidence_weighted_v1',
    NEW.created_at,
    NEW.created_at
  )
  ON CONFLICT (mistake_id) DO UPDATE SET
    next_review_at = EXCLUDED.next_review_at,
    consecutive_success_count = EXCLUDED.consecutive_success_count,
    last_processed_attempt_id = EXCLUDED.last_processed_attempt_id,
    last_reviewed_at = EXCLUDED.last_reviewed_at,
    algorithm_version = EXCLUDED.algorithm_version,
    updated_at = EXCLUDED.updated_at;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_mistake_review_state_trigger ON learning_evidence;
CREATE TRIGGER zz_mistake_review_state_trigger
AFTER INSERT ON learning_evidence
FOR EACH ROW
EXECUTE FUNCTION xuetu_advance_mistake_review_state();
