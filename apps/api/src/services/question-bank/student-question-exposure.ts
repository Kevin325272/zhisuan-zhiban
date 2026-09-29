/**
 * Builds the student-exposure predicate for a chosen question/metadata alias.
 * Keeping the alias parameter here lets governance queries validate a
 * contrast question with exactly the same visibility rules as normal practice
 * selection, without copying a subtly different policy into another service.
 */
export function studentQuestionExposureSqlForAliases(
  questionAlias = "q",
  metadataAlias = "meta",
) {
  return `(
  (
    ${questionAlias}.usage_scope = 'authorized_product_use'
    AND ${questionAlias}.license_status = 'verified'
  )
  OR ${metadataAlias}.source_type IN ('self_authored_screening', 'self_authored_practice')
)
AND NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(${questionAlias}.assets) AS required_asset
  WHERE required_asset->>'role' IN ('question', 'option')
    AND NOT EXISTS (
      SELECT 1
      FROM question_asset_links available_asset
      WHERE available_asset.question_id = ${questionAlias}.question_id
        AND available_asset.asset_id = required_asset->>'asset_id'
    )
)
AND NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(${questionAlias}.options) AS option_item
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(option_item->'assets', '[]'::jsonb)
  ) AS required_asset
  WHERE required_asset->>'role' = 'option'
    AND NOT EXISTS (
      SELECT 1
      FROM question_asset_links available_asset
      WHERE available_asset.question_id = ${questionAlias}.question_id
        AND available_asset.asset_id = required_asset->>'asset_id'
    )
)`;
}

export const studentQuestionExposureSql = studentQuestionExposureSqlForAliases();

/** Local-demo review is an explicit runtime opt-in; stored review status stays unchanged. */
export function studentQuestionContentReviewSql(allowLocalDemoPastExams = false) {
  return allowLocalDemoPastExams
    ? `(
        meta.content_review_status = 'teacher_verified'
        OR (
          meta.content_review_status = 'demo_validated'
          AND q.usage_scope = 'local_demo_only'
          AND meta.source_type = 'past_exam'
        )
      )`
    : "meta.content_review_status = 'teacher_verified'";
}

const questionAssetCompletenessSql = studentQuestionExposureSqlForAliases("q", "meta");

export const studentQuestionExposureWithLocalPastExamsSql = `(
  (
    q.usage_scope = 'authorized_product_use'
    AND q.license_status = 'verified'
  )
  OR meta.source_type IN ('self_authored_screening', 'self_authored_practice')
  OR (
    q.usage_scope = 'local_demo_only'
    AND meta.source_type = 'past_exam'
  )
) 
${questionAssetCompletenessSql.slice(questionAssetCompletenessSql.indexOf("AND NOT EXISTS"))}`;

export const studentVisibleTargetedQuestionSql = `
  q.review_status = 'approved'
  AND meta.content_review_status = 'teacher_verified'
  AND 'targeted' = ANY(meta.allowed_modes)
  AND meta.source_type <> 'self_authored_screening'
  AND meta.protect_full_paper = false
  AND ${studentQuestionExposureSql}
`;
