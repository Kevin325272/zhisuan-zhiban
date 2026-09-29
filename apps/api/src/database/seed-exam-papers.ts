import { randomUUID } from "node:crypto";

import { withTransaction, type SqlPool } from "./client.js";
import type { ExamPaperSource } from "../services/exam-papers/exam-paper-source.js";

interface SeedExamPaperOptions {
  courseId: string;
  createId?: (prefix: string) => string;
  now?: () => Date;
}

export async function seedExamPapers(
  pool: SqlPool,
  source: ExamPaperSource,
  options: SeedExamPaperOptions,
): Promise<{ importBatchId: string; paperCount: number }> {
  if (source.records.length !== source.counts.papers) {
    throw new Error("Exam-paper source record count is inconsistent.");
  }
  const createId = options.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const now = (options.now ?? (() => new Date()))().toISOString();

  return withTransaction(pool, async (client) => {
    const candidateBatchId = createId("exam_import");
    const batchResult = await client.query<{ import_batch_id: string }>(
      `INSERT INTO exam_paper_import_batches(
         import_batch_id, dataset_id, archive_file_name, archive_sha256,
         manifest_entry, source_provider, source_generated_at,
         license_status, usage_scope, training_allowed, status,
         paper_count, source_failure_count, started_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'unverified','local_demo_only',false,
                 'started',0,$8,$9,NULL)
       ON CONFLICT (dataset_id, archive_sha256) DO UPDATE
       SET archive_file_name = EXCLUDED.archive_file_name,
           manifest_entry = EXCLUDED.manifest_entry,
           source_provider = EXCLUDED.source_provider,
           source_generated_at = EXCLUDED.source_generated_at,
           status = 'started',
           paper_count = 0,
           source_failure_count = EXCLUDED.source_failure_count,
           started_at = EXCLUDED.started_at,
           completed_at = NULL
       RETURNING import_batch_id`,
      [
        candidateBatchId,
        source.datasetId,
        source.archiveFileName,
        source.archiveSha256,
        source.manifestEntry,
        source.sourceProvider,
        source.generatedAt,
        source.failureCount,
        now,
      ],
    );
    const importBatchId = batchResult.rows[0]?.import_batch_id;
    if (!importBatchId) {
      throw new Error("Exam-paper import batch returned no identifier.");
    }

    for (const record of source.records) {
      if (record.archiveSha256 !== source.archiveSha256) {
        throw new Error(`Exam-paper archive provenance mismatch: ${record.examPaperId}`);
      }
      await client.query(
        `INSERT INTO exam_papers(
           exam_paper_id, course_id, import_batch_id, university, year, subject,
           paper_type, page_count, file_size_bytes, content_mode,
           official_source_url, landing_page_url, archive_entry, pdf_sha256,
           training_allowed, license_status, usage_scope, review_status,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,$15,$16,$17,$18,$18)
         ON CONFLICT (exam_paper_id) DO UPDATE SET
           course_id = EXCLUDED.course_id,
           import_batch_id = EXCLUDED.import_batch_id,
           university = EXCLUDED.university,
           year = EXCLUDED.year,
           subject = EXCLUDED.subject,
           paper_type = EXCLUDED.paper_type,
           page_count = EXCLUDED.page_count,
           file_size_bytes = EXCLUDED.file_size_bytes,
           content_mode = EXCLUDED.content_mode,
           official_source_url = EXCLUDED.official_source_url,
           landing_page_url = EXCLUDED.landing_page_url,
           archive_entry = EXCLUDED.archive_entry,
           pdf_sha256 = EXCLUDED.pdf_sha256,
           license_status = EXCLUDED.license_status,
           usage_scope = EXCLUDED.usage_scope,
           updated_at = EXCLUDED.updated_at`,
        [
          record.examPaperId,
          options.courseId,
          importBatchId,
          record.university,
          record.year,
          record.subject,
          record.paperType,
          record.pageCount,
          record.fileSizeBytes,
          record.contentMode,
          record.officialSourceUrl,
          record.landingPageUrl,
          record.archiveEntry,
          record.pdfSha256,
          record.licenseStatus,
          record.usageScope,
          record.reviewStatus,
          now,
        ],
      );
    }

    await client.query(
      `UPDATE exam_paper_import_batches
       SET status = 'completed', paper_count = $2, completed_at = $3
       WHERE import_batch_id = $1`,
      [importBatchId, source.records.length, now],
    );

    return {
      importBatchId,
      paperCount: source.records.length,
    };
  });
}
