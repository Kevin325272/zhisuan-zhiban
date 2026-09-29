import { randomUUID } from "node:crypto";

import { withTransaction, type SqlPool } from "./client.js";
import type { QuestionBankImportSource } from "../services/question-bank/question-bank-source.js";

interface SeedOptions {
  courseId: string;
  allowLocalDemoPastExams?: boolean;
  createId?: (prefix: string) => string;
  now?: () => Date;
}

export async function seedQuestionBank(
  pool: SqlPool,
  source: QuestionBankImportSource,
  options: SeedOptions,
): Promise<{ importBatchId: string; questionCount: number }> {
  const createId = options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const years = source.questions.map((record) => record.question.year);
  if (years.some((year) => year === null)) {
    throw new Error("Historical question imports require a real paper year.");
  }
  const latestYear = Math.max(...years as number[]);
  const activateLocalDemo = options.allowLocalDemoPastExams === true
    && source.usageScope === "local_demo_only";
  const initialReviewStatus = activateLocalDemo ? "approved" : "unreviewed";
  const initialReviewNote = activateLocalDemo
    ? "结构与资源完整性已通过固定清单校验；仅限本地演示。"
    : null;
  const initialContentReviewStatus = activateLocalDemo
    ? "demo_validated"
    : "pending_teacher_review";

  return withTransaction(pool, async (client) => {
    const batchId = createId("import");
    const batchResult = await client.query<{ import_batch_id: string }>(
      `INSERT INTO question_import_batches(
         import_batch_id, dataset_id, archive_sha256, source_provider, source_url,
         license_status, usage_scope, status, question_count, started_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'started',0,$8,NULL)
       ON CONFLICT (dataset_id, archive_sha256) DO UPDATE
       SET status = 'started', question_count = 0, started_at = EXCLUDED.started_at,
           completed_at = NULL
       RETURNING import_batch_id`,
      [
        batchId,
        source.datasetId,
        source.archiveSha256,
        source.provider,
        source.sourceUrl,
        source.licenseStatus,
        source.usageScope,
        now,
      ],
    );
    const importBatchId = batchResult.rows[0]?.import_batch_id;
    if (!importBatchId) throw new Error("Question import batch returned no identifier.");

    for (const blob of source.assetBlobs) {
      await client.query(
        `INSERT INTO question_asset_blobs(
           content_sha256, mime_type, byte_length, content, created_at
         ) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (content_sha256) DO NOTHING`,
        [blob.contentSha256, blob.mimeType, blob.byteLength, blob.content, now],
      );
    }

    for (const record of source.questions) {
      await client.query(
        `INSERT INTO questions(
           question_id, course_id, import_batch_id, year, number, subject,
           question_type, multiple, question_text, options, tags, assets,
           answer_key, explanation_text, solution_text, source_url,
           license_status, usage_scope, review_status, review_note, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::text[],$12::jsonb,
                   $13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$21)
         ON CONFLICT (question_id) DO UPDATE SET
           course_id = EXCLUDED.course_id,
           import_batch_id = EXCLUDED.import_batch_id,
           year = EXCLUDED.year,
           number = EXCLUDED.number,
           subject = EXCLUDED.subject,
           question_type = EXCLUDED.question_type,
           multiple = EXCLUDED.multiple,
           question_text = EXCLUDED.question_text,
           options = EXCLUDED.options,
           tags = EXCLUDED.tags,
           assets = EXCLUDED.assets,
           answer_key = EXCLUDED.answer_key,
           explanation_text = EXCLUDED.explanation_text,
           solution_text = EXCLUDED.solution_text,
           source_url = EXCLUDED.source_url,
           license_status = EXCLUDED.license_status,
           usage_scope = EXCLUDED.usage_scope,
           review_status = CASE
             WHEN questions.review_status = 'unreviewed'
               AND EXCLUDED.review_status = 'approved'
               THEN 'approved'
             ELSE questions.review_status
           END,
           review_note = CASE
             WHEN questions.review_status = 'unreviewed'
               AND EXCLUDED.review_status = 'approved'
               THEN EXCLUDED.review_note
             ELSE questions.review_note
           END,
           updated_at = EXCLUDED.updated_at`,
        [
          record.question.id,
          options.courseId,
          importBatchId,
          record.question.year,
          record.question.number,
          record.question.subject,
          record.question.type,
          record.question.multiple,
          record.question.question,
          JSON.stringify(record.question.options),
          record.question.tags,
          JSON.stringify(record.allAssets),
          JSON.stringify(record.correctOptionIds),
          record.explanation,
          record.referenceSolution,
          record.question.source.source_url,
          record.question.source.license_status,
          record.question.source.usage_scope,
          initialReviewStatus,
          initialReviewNote,
          now,
        ],
      );
      await client.query(
        "DELETE FROM question_asset_links WHERE question_id = $1",
        [record.question.id],
      );
      for (const link of record.assetLinks) {
        await client.query(
          `INSERT INTO question_asset_links(
             question_id, asset_id, role, option_id, content_sha256, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            record.question.id,
            link.assetId,
            link.role,
            link.optionId,
            link.contentSha256,
            now,
          ],
        );
      }
      const paperYear = record.question.year;
      if (paperYear === null) {
        throw new Error("Historical question imports require a real paper year.");
      }
      await client.query(
        `INSERT INTO question_learning_metadata(
           question_id, source_type, allowed_modes, paper_year,
           protect_full_paper, importance, content_review_status,
           created_at, updated_at
         ) VALUES (
           $1, 'past_exam', ARRAY['targeted', 'past_exam', 'mock_exam']::text[], $2,
           $3, 'core', $4, $5, $5
         )
         ON CONFLICT (question_id) DO UPDATE SET
           source_type = EXCLUDED.source_type,
           allowed_modes = EXCLUDED.allowed_modes,
           paper_year = EXCLUDED.paper_year,
           protect_full_paper = EXCLUDED.protect_full_paper,
           importance = EXCLUDED.importance,
           content_review_status = CASE
             WHEN question_learning_metadata.content_review_status = 'pending_teacher_review'
               AND EXCLUDED.content_review_status = 'demo_validated'
               THEN 'demo_validated'
             ELSE question_learning_metadata.content_review_status
           END,
           updated_at = EXCLUDED.updated_at`,
        [
          record.question.id,
          paperYear,
          paperYear >= latestYear - 2,
          initialContentReviewStatus,
          now,
        ],
      );
    }

    await client.query(
      `DELETE FROM question_asset_blobs blob
       WHERE NOT EXISTS (
         SELECT 1
         FROM question_asset_links link
         WHERE link.content_sha256 = blob.content_sha256
       )`,
    );

    await client.query(
      `UPDATE question_import_batches
       SET status = 'completed', question_count = $2, completed_at = $3
       WHERE import_batch_id = $1`,
      [importBatchId, source.questions.length, now],
    );
    return { importBatchId, questionCount: source.questions.length };
  });
}
