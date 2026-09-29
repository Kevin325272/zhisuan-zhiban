-- Migration 049 is already deployed in some environments. Make the
-- source-of-truth boundary explicit: submitted event rows own replayable
-- probe results.
COMMENT ON COLUMN student_learning_probe_events.result_payload IS
  'Replayable submitted probe results; the event row is the source of truth for idempotent replay.';
