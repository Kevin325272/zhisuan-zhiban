import { withTransaction, type SqlPool } from "./client.js";
import type {
  CourseSourceLayer,
  SourceCourseSummary,
} from "../services/course-source-layer/408-course-source.js";

function datasetRowId(packageDatasetId: string, courseId: string) {
  return `${packageDatasetId}_${courseId}`;
}

function summaryByCourse(source: CourseSourceLayer) {
  return new Map(source.courses.map((course) => [course.courseId, course]));
}

export async function seed408SourceLayer(
  pool: SqlPool,
  source: CourseSourceLayer,
  now: () => Date = () => new Date(),
): Promise<{ datasets: number; chunks: number; figures: number; relations: number }> {
  const timestamp = now().toISOString();
  const summaries = summaryByCourse(source);
  return withTransaction(pool, async (client) => {
    for (const summary of source.courses) {
      const datasetId = datasetRowId(source.datasetId, summary.courseId);
      await client.query(
        `DELETE FROM course_source_concept_figures
         WHERE source_chunk_id IN (
           SELECT chunk_id FROM course_source_chunks WHERE dataset_id = $1
         )
            OR figure_asset_id IN (
              SELECT figure_asset_id FROM course_source_figure_assets WHERE dataset_id = $1
            )`,
        [datasetId],
      );
      await client.query(
        "DELETE FROM course_source_datasets WHERE dataset_id = $1",
        [datasetId],
      );
      await client.query(
        `INSERT INTO course_source_datasets(
           dataset_id, course_id, book_id, title, course_label, version, isbn,
           schema_version, generated_at, archive_file_name, archive_sha256,
           source_files, license_status, usage_scope, provenance_status,
           student_content_status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
                   'unverified','local_demo_only',
                   'source_metadata_present_authorization_unverified',
                   'source_layer_only_curriculum_pending',$13,$13)`,
        [
          datasetId,
          summary.courseId,
          summary.bookId,
          summary.title,
          summary.courseLabel,
          summary.version,
          summary.isbn,
          summary.schemaVersion,
          summary.generatedAt,
          source.archiveFileName,
          source.archiveSha256,
          JSON.stringify(summary.sourceFiles),
          timestamp,
        ],
      );
    }

    for (const chunk of source.chunks) {
      const datasetId = datasetRowId(source.datasetId, chunk.courseId);
      await client.query(
        `INSERT INTO course_source_chunks(
           chunk_id, dataset_id, course_id, source_item_id, chapter, title,
           printed_page, content_type, content_text, keywords, quality_score,
           needs_review, ordinal, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$14)
         ON CONFLICT (chunk_id) DO UPDATE SET
           dataset_id = EXCLUDED.dataset_id,
           course_id = EXCLUDED.course_id,
           source_item_id = EXCLUDED.source_item_id,
           chapter = EXCLUDED.chapter,
           title = EXCLUDED.title,
           printed_page = EXCLUDED.printed_page,
           content_type = EXCLUDED.content_type,
           content_text = EXCLUDED.content_text,
           keywords = EXCLUDED.keywords,
           quality_score = EXCLUDED.quality_score,
           needs_review = EXCLUDED.needs_review,
           ordinal = EXCLUDED.ordinal,
           updated_at = EXCLUDED.updated_at`,
        [
          chunk.chunkId,
          datasetId,
          chunk.courseId,
          chunk.sourceItemId,
          chunk.chapter,
          chunk.title,
          chunk.printedPage,
          chunk.contentType,
          chunk.text,
          JSON.stringify(chunk.keywords),
          chunk.qualityScore,
          chunk.needsReview,
          chunk.ordinal,
          timestamp,
        ],
      );
    }

    for (const asset of source.figureAssets) {
      const datasetId = datasetRowId(source.datasetId, asset.courseId);
      await client.query(
        `INSERT INTO course_source_figure_assets(
           figure_asset_id, dataset_id, course_id, figure_no, title, chapter,
           source_document, version, isbn, printed_page, physical_page,
           crop_rect, asset_sha256, webp_sha256, png_path, webp_path,
           source_file, source_part, combined_physical_page,
           crop_coordinate_space, source_page_size, pixel_size, ocr_caption,
           ocr_confidence, ocr_correction, quality_checks, ink_ratio,
           review_status, image_available, license_status, usage_scope,
           raw_metadata, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,
           $17,$18,$19,$20,$21::jsonb,$22::jsonb,$23,$24,$25,$26::jsonb,$27,
           $28,$29,'unverified','local_demo_only',$30::jsonb,$31,$31
         )
         ON CONFLICT (figure_asset_id) DO UPDATE SET
           dataset_id = EXCLUDED.dataset_id,
           course_id = EXCLUDED.course_id,
           figure_no = EXCLUDED.figure_no,
           title = EXCLUDED.title,
           chapter = EXCLUDED.chapter,
           source_document = EXCLUDED.source_document,
           version = EXCLUDED.version,
           isbn = EXCLUDED.isbn,
           printed_page = EXCLUDED.printed_page,
           physical_page = EXCLUDED.physical_page,
           crop_rect = EXCLUDED.crop_rect,
           asset_sha256 = EXCLUDED.asset_sha256,
           webp_sha256 = EXCLUDED.webp_sha256,
           png_path = EXCLUDED.png_path,
           webp_path = EXCLUDED.webp_path,
           source_file = EXCLUDED.source_file,
           source_part = EXCLUDED.source_part,
           combined_physical_page = EXCLUDED.combined_physical_page,
           crop_coordinate_space = EXCLUDED.crop_coordinate_space,
           source_page_size = EXCLUDED.source_page_size,
           pixel_size = EXCLUDED.pixel_size,
           ocr_caption = EXCLUDED.ocr_caption,
           ocr_confidence = EXCLUDED.ocr_confidence,
           ocr_correction = EXCLUDED.ocr_correction,
           quality_checks = EXCLUDED.quality_checks,
           ink_ratio = EXCLUDED.ink_ratio,
           review_status = EXCLUDED.review_status,
           image_available = EXCLUDED.image_available,
           raw_metadata = EXCLUDED.raw_metadata,
           updated_at = EXCLUDED.updated_at`,
        [
          asset.figureAssetId,
          datasetId,
          asset.courseId,
          asset.figureNo,
          asset.title,
          asset.chapter,
          asset.sourceDocument,
          asset.version,
          asset.isbn,
          asset.printedPage,
          asset.physicalPage,
          JSON.stringify(asset.cropRect),
          asset.assetSha256,
          asset.webpSha256,
          asset.pngPath,
          asset.webpPath,
          asset.sourceFile,
          asset.sourcePart,
          asset.combinedPhysicalPage,
          asset.cropCoordinateSpace,
          JSON.stringify(asset.sourcePageSize),
          JSON.stringify(asset.pixelSize),
          asset.ocrCaption,
          asset.ocrConfidence,
          asset.ocrCorrection,
          JSON.stringify(asset.qualityChecks),
          asset.inkRatio,
          asset.reviewStatus,
          asset.imageAvailable,
          JSON.stringify(asset.rawMetadata),
          timestamp,
        ],
      );
    }

    for (const relation of source.relations) {
      const chunk = source.chunks.find((item) => item.chunkId === relation.sourceChunkId);
      if (!chunk) throw new Error(`Cannot seed relation without source chunk: ${relation.sourceChunkId}`);
      const datasetId = datasetRowId(source.datasetId, chunk.courseId);
      await client.query(
        `INSERT INTO course_source_figure_relations(
           source_chunk_id, figure_asset_id, dataset_id, course_id, anchor,
           display_role, confidence, source_document, printed_page,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         ON CONFLICT (source_chunk_id, figure_asset_id) DO UPDATE SET
           dataset_id = EXCLUDED.dataset_id,
           course_id = EXCLUDED.course_id,
           anchor = EXCLUDED.anchor,
           display_role = EXCLUDED.display_role,
           confidence = EXCLUDED.confidence,
           source_document = EXCLUDED.source_document,
           printed_page = EXCLUDED.printed_page,
           updated_at = EXCLUDED.updated_at`,
        [
          relation.sourceChunkId,
          relation.figureAssetId,
          datasetId,
          chunk.courseId,
          relation.anchor,
          relation.displayRole,
          relation.confidence,
          relation.sourceDocument,
          relation.printedPage,
          timestamp,
        ],
      );
    }

    // Keep the argument checked even when a caller passes a malformed summary list.
    for (const course of source.chunks.map((chunk) => chunk.courseId)) {
      if (!summaries.has(course)) throw new Error(`Missing source summary for ${course}.`);
    }
    return {
      datasets: source.courses.length,
      chunks: source.chunks.length,
      figures: source.figureAssets.length,
      relations: source.relations.length,
    };
  });
}

export function sourceDatasetId(packageDatasetId: string, courseId: string) {
  return datasetRowId(packageDatasetId, courseId);
}
