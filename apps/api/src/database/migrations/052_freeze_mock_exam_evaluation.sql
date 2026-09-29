-- A timed paper must remain gradable after its source question changes review
-- state or is withdrawn.  Keep grading material server-side and separate from
-- the public question payload returned to browsers.
ALTER TABLE practice_exam_session_questions
  ADD COLUMN IF NOT EXISTS evaluation_payload jsonb NULL;

UPDATE practice_exam_session_questions snapshot
SET evaluation_payload = jsonb_build_object(
  'course_id', question.course_id,
  'answer_key', question.answer_key,
  'explanation', question.explanation_text,
  'reference_solution', question.solution_text,
  'answer_assets', COALESCE(
    (
      SELECT jsonb_agg(asset)
      FROM jsonb_array_elements(question.assets) AS asset
      WHERE asset->>'role' IN ('explanation', 'solution')
    ),
    '[]'::jsonb
  )
)
FROM questions question
WHERE question.question_id = snapshot.question_id
  AND snapshot.evaluation_payload IS NULL;

ALTER TABLE practice_exam_session_questions
  ADD CONSTRAINT practice_exam_session_questions_evaluation_payload_check
  CHECK (
    evaluation_payload IS NULL
    OR jsonb_typeof(evaluation_payload) = 'object'
  );

