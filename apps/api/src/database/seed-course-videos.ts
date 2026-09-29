import { withTransaction, type SqlPool } from "./client.js";
import type { CourseVideoSource } from "../services/course-videos/video-source.js";

interface ConceptCourseRow {
  concept_id: string;
  course_id: string;
}

export async function seedCourseVideos(
  pool: SqlPool,
  source: CourseVideoSource,
  now: () => Date = () => new Date(),
): Promise<{ batches: number; series: number; episodes: number; conceptLinks: number }> {
  const timestamp = now().toISOString();
  return withTransaction(pool, async (client) => {
    if (source.curatedLinks.length > 0) {
      const conceptIds = [...new Set(source.curatedLinks.map((link) => link.conceptId))];
      const result = await client.query<ConceptCourseRow>(
        `SELECT concept_id, course_id
         FROM course_core_concepts
         WHERE concept_id = ANY($1::text[])`,
        [conceptIds],
      );
      const courseByConcept = new Map(result.rows.map((row) => [row.concept_id, row.course_id]));
      for (const link of source.curatedLinks) {
        const courseId = courseByConcept.get(link.conceptId);
        if (!courseId) throw new Error(`Cannot seed video for unknown course concept: ${link.conceptId}.`);
        if (courseId !== link.courseId) {
          throw new Error(`Course video concept mapping crosses its course boundary: ${link.conceptId}.`);
        }
      }
    }

    const batch = source.importBatch;
    await client.query(
      `INSERT INTO course_video_import_batches(
         import_batch_id, dataset_id, archive_file, archive_sha256,
         source_provider, original_path, collected_at, license_status,
         usage_scope, review_status, content_mode, notice, raw_manifest,
         imported_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$14)
       ON CONFLICT (import_batch_id) DO UPDATE SET
         dataset_id = EXCLUDED.dataset_id,
         archive_file = EXCLUDED.archive_file,
         archive_sha256 = EXCLUDED.archive_sha256,
         source_provider = EXCLUDED.source_provider,
         original_path = EXCLUDED.original_path,
         collected_at = EXCLUDED.collected_at,
         license_status = EXCLUDED.license_status,
         usage_scope = EXCLUDED.usage_scope,
         review_status = EXCLUDED.review_status,
         content_mode = EXCLUDED.content_mode,
         notice = EXCLUDED.notice,
         raw_manifest = EXCLUDED.raw_manifest,
         updated_at = EXCLUDED.updated_at`,
      [
        batch.importBatchId,
        batch.datasetId,
        batch.archiveFileName,
        batch.archiveSha256,
        batch.sourceProvider,
        batch.originalPath,
        batch.collectedAt,
        batch.licenseStatus,
        batch.usageScope,
        batch.reviewStatus,
        batch.contentMode,
        batch.notice,
        JSON.stringify(batch.rawManifest),
        timestamp,
      ],
    );

    for (const series of source.series) {
      await client.query(
        `INSERT INTO course_video_series(
           series_id, import_batch_id, course_id, course_slug, subject_label,
           video_kind, platform, bv_id, title, uploader, total_seconds,
           total_duration, episode_count, canonical_url, description,
           published_on, source_collected_at, license_status, usage_scope,
           review_status, raw_metadata, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
           $18,$19,$20,$21::jsonb,$22,$22
         )
         ON CONFLICT (series_id) DO UPDATE SET
           import_batch_id = EXCLUDED.import_batch_id,
           course_id = EXCLUDED.course_id,
           course_slug = EXCLUDED.course_slug,
           subject_label = EXCLUDED.subject_label,
           video_kind = EXCLUDED.video_kind,
           platform = EXCLUDED.platform,
           bv_id = EXCLUDED.bv_id,
           title = EXCLUDED.title,
           uploader = EXCLUDED.uploader,
           total_seconds = EXCLUDED.total_seconds,
           total_duration = EXCLUDED.total_duration,
           episode_count = EXCLUDED.episode_count,
           canonical_url = EXCLUDED.canonical_url,
           description = EXCLUDED.description,
           published_on = EXCLUDED.published_on,
           source_collected_at = EXCLUDED.source_collected_at,
           license_status = EXCLUDED.license_status,
           usage_scope = EXCLUDED.usage_scope,
           review_status = EXCLUDED.review_status,
           raw_metadata = EXCLUDED.raw_metadata,
           updated_at = EXCLUDED.updated_at`,
        [
          series.seriesId,
          series.importBatchId,
          series.courseId,
          series.courseSlug,
          series.subjectLabel,
          series.kind,
          series.platform,
          series.bvId,
          series.title,
          series.uploader,
          series.totalSeconds,
          series.totalDuration,
          series.episodeCount,
          series.canonicalUrl,
          series.description,
          series.publishedOn,
          series.sourceCollectedAt,
          series.licenseStatus,
          series.usageScope,
          series.reviewStatus,
          JSON.stringify(series.rawMetadata),
          timestamp,
        ],
      );
    }

    for (const episode of source.episodes) {
      await client.query(
        `INSERT INTO course_video_episodes(
           episode_id, series_id, episode_number, title, duration,
           duration_seconds, external_url, cid, raw_metadata, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10)
         ON CONFLICT (episode_id) DO UPDATE SET
           series_id = EXCLUDED.series_id,
           episode_number = EXCLUDED.episode_number,
           title = EXCLUDED.title,
           duration = EXCLUDED.duration,
           duration_seconds = EXCLUDED.duration_seconds,
           external_url = EXCLUDED.external_url,
           cid = EXCLUDED.cid,
           raw_metadata = EXCLUDED.raw_metadata,
           updated_at = EXCLUDED.updated_at`,
        [
          episode.episodeId,
          episode.seriesId,
          episode.episodeNumber,
          episode.title,
          episode.duration,
          episode.durationSeconds,
          episode.externalUrl,
          episode.cid,
          JSON.stringify(episode.rawMetadata),
          timestamp,
        ],
      );
    }

    for (const link of source.curatedLinks) {
      await client.query(
        `INSERT INTO course_concept_video_links(
           link_id, concept_id, course_id, episode_id, display_role, ordinal,
           match_method, match_confidence, review_status, review_note,
           display_enabled, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
         ON CONFLICT (link_id) DO UPDATE SET
           concept_id = EXCLUDED.concept_id,
           course_id = EXCLUDED.course_id,
           episode_id = EXCLUDED.episode_id,
           display_role = EXCLUDED.display_role,
           ordinal = EXCLUDED.ordinal,
           match_method = EXCLUDED.match_method,
           match_confidence = EXCLUDED.match_confidence,
           review_status = EXCLUDED.review_status,
           review_note = EXCLUDED.review_note,
           display_enabled = EXCLUDED.display_enabled,
           updated_at = EXCLUDED.updated_at`,
        [
          link.linkId,
          link.conceptId,
          link.courseId,
          link.episodeId,
          link.displayRole,
          link.ordinal,
          link.matchMethod,
          link.matchConfidence,
          link.reviewStatus,
          link.reviewNote,
          link.reviewStatus === "approved",
          timestamp,
        ],
      );
    }

    return {
      batches: 1,
      series: source.series.length,
      episodes: source.episodes.length,
      conceptLinks: source.curatedLinks.length,
    };
  });
}
