CREATE TABLE teacher_interventions (
  intervention_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  concept_id text NOT NULL REFERENCES course_core_concepts(concept_id) ON DELETE RESTRICT,
  actor_user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN ('assign_review', 'recommend_material', 'classroom_focus')
  ),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX teacher_interventions_course_created_idx
  ON teacher_interventions(course_id, created_at DESC);
