ALTER TABLE student_onboarding_states
  ADD COLUMN diagnostic_set_version text NOT NULL DEFAULT '408-v1'
  CHECK (length(diagnostic_set_version) BETWEEN 1 AND 50);

-- Existing rows belong to the original immutable set. New onboarding states
-- start on v2; the seed migrates unfinished v1 drafts after v2 exists.
ALTER TABLE student_onboarding_states
  ALTER COLUMN diagnostic_set_version SET DEFAULT '408-v2';

CREATE INDEX student_onboarding_diagnostic_set_idx
  ON student_onboarding_states(diagnostic_set_version, status);
