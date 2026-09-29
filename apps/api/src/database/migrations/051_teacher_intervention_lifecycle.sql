-- Complete the teacher intervention lifecycle without rewriting historical actions.
ALTER TABLE teacher_interventions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'teacher_interventions_target_scope_chk'
       AND conrelid = 'teacher_interventions'::regclass
  ) THEN
    ALTER TABLE teacher_interventions
      ADD CONSTRAINT teacher_interventions_target_scope_chk CHECK (
        (target_type = 'concept' AND target_class_id IS NULL AND target_user_id IS NULL)
        OR (target_type = 'class' AND target_class_id IS NOT NULL AND target_user_id IS NULL)
        OR (target_type = 'student' AND target_class_id IS NULL AND target_user_id IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'teacher_interventions_lifecycle_chk'
       AND conrelid = 'teacher_interventions'::regclass
  ) THEN
    ALTER TABLE teacher_interventions
      ADD CONSTRAINT teacher_interventions_lifecycle_chk CHECK (
        (status = 'planned'
          AND delivered_at IS NULL
          AND completed_at IS NULL
          AND evidence_snapshot IS NULL)
        OR (status = 'sent'
          AND delivered_at IS NOT NULL
          AND completed_at IS NULL
          AND evidence_snapshot IS NULL)
        OR (status = 'completed'
          AND delivered_at IS NOT NULL
          AND completed_at IS NOT NULL
          AND evidence_snapshot IS NOT NULL)
        OR (status = 'cancelled'
          AND completed_at IS NULL
          AND evidence_snapshot IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'teacher_interventions_completion_order_chk'
       AND conrelid = 'teacher_interventions'::regclass
  ) THEN
    ALTER TABLE teacher_interventions
      ADD CONSTRAINT teacher_interventions_completion_order_chk
      CHECK (completed_at IS NULL OR delivered_at IS NULL OR completed_at >= delivered_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS teacher_interventions_target_class_idx
  ON teacher_interventions(course_id, target_class_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS teacher_interventions_target_user_idx
  ON teacher_interventions(course_id, target_user_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_teacher_intervention_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.evidence_snapshot IS NOT NULL
     AND NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot THEN
    RAISE EXCEPTION 'teacher intervention evidence_snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teacher_intervention_snapshot_immutable ON teacher_interventions;
CREATE TRIGGER teacher_intervention_snapshot_immutable
BEFORE UPDATE ON teacher_interventions
FOR EACH ROW
EXECUTE FUNCTION prevent_teacher_intervention_snapshot_mutation();
