ALTER TABLE course_figure_catalog_entries
  DROP CONSTRAINT course_figure_catalog_entries_extraction_status_check;

ALTER TABLE course_figure_catalog_entries
  ADD CONSTRAINT course_figure_catalog_entries_extraction_status_check
  CHECK (
    extraction_status IN (
      'displayable',
      'caption_not_located',
      'caption_unconfirmed',
      'crop_failed',
      'low_confidence',
      'rejected_low_confidence',
      'rejected_too_blank',
      'rejected_oversized',
      'rejected_too_small',
      'rejected_text_contamination',
      'rejected_multi_figure_crop',
      'duplicate_crop'
    )
  );
