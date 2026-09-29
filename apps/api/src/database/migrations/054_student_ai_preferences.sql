CREATE TABLE student_ai_preferences (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  collaboration_enabled boolean NOT NULL DEFAULT true,
  visual_explanations_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
