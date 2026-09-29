UPDATE student_learning_plan_versions
SET start_date = (generated_at AT TIME ZONE 'Asia/Shanghai')::date
WHERE start_date IS DISTINCT FROM (generated_at AT TIME ZONE 'Asia/Shanghai')::date;

UPDATE student_learning_plan_tasks AS task
SET task_date = (plan.generated_at AT TIME ZONE 'Asia/Shanghai')::date + (task.day_index - 1)
FROM student_learning_plan_versions AS plan
WHERE plan.plan_id = task.plan_id
  AND task.task_date IS DISTINCT FROM (
    (plan.generated_at AT TIME ZONE 'Asia/Shanghai')::date + (task.day_index - 1)
  );
