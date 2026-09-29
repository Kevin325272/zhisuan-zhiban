-- case_review never acquired a server-owned completion-evidence event.
-- Refuse to tighten the type domain if any historical row unexpectedly uses it;
-- operators must audit such rows rather than silently deleting or rewriting them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM student_learning_plan_tasks WHERE task_type = 'case_review'
  ) OR EXISTS (
    SELECT 1 FROM student_learning_task_assignments WHERE task_type = 'case_review'
  ) THEN
    RAISE EXCEPTION 'Cannot remove unsupported case_review task type while historical rows exist';
  END IF;
END
$$;

ALTER TABLE student_learning_plan_tasks
  DROP CONSTRAINT IF EXISTS student_learning_plan_tasks_task_type_check;
ALTER TABLE student_learning_plan_tasks
  ADD CONSTRAINT student_learning_plan_tasks_task_type_check CHECK (
    task_type IN ('course_reading', 'choice_practice', 'mistake_review')
  );

ALTER TABLE student_learning_task_assignments
  DROP CONSTRAINT IF EXISTS student_learning_task_assignments_task_type_check;
ALTER TABLE student_learning_task_assignments
  ADD CONSTRAINT student_learning_task_assignments_task_type_check CHECK (
    task_type IN ('course_reading', 'choice_practice', 'mistake_review')
  );
