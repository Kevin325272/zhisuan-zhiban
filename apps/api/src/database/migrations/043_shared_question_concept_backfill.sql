WITH unique_question_concept AS (
  SELECT link.question_id, MIN(link.concept_id) AS concept_id
  FROM course_concept_question_links link
  JOIN course_core_concepts concept ON concept.concept_id = link.concept_id
  JOIN questions question ON question.question_id = link.question_id
  JOIN course_catalog_entries catalog
    ON concept.course_id = catalog.course_id
   AND catalog.question_subject = question.subject
  WHERE link.status = 'active'
    AND concept.review_status = 'verified'
  GROUP BY link.question_id
  HAVING COUNT(DISTINCT link.concept_id) = 1
)
UPDATE practice_attempts attempt
SET concept_id = resolved.concept_id
FROM unique_question_concept resolved
WHERE attempt.question_id = resolved.question_id
  AND attempt.concept_id IS NULL;

UPDATE learning_evidence evidence
SET concept_id = attempt.concept_id
FROM practice_attempts attempt
WHERE evidence.attempt_id = attempt.attempt_id
  AND evidence.concept_id IS NULL
  AND attempt.concept_id IS NOT NULL;

UPDATE practice_mistakes mistake
SET concept_id = attempt.concept_id,
    updated_at = GREATEST(mistake.updated_at, attempt.submitted_at)
FROM practice_attempts attempt
WHERE mistake.last_incorrect_attempt_id = attempt.attempt_id
  AND mistake.concept_id IS NULL
  AND attempt.concept_id IS NOT NULL;
