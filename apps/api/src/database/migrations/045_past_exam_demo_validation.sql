ALTER TABLE question_learning_metadata
  DROP CONSTRAINT IF EXISTS question_learning_metadata_content_review_status_check;

ALTER TABLE question_learning_metadata
  ADD CONSTRAINT question_learning_metadata_content_review_status_check
  CHECK (
    content_review_status IN (
      'pending_teacher_review',
      'demo_validated',
      'teacher_verified'
    )
  );
