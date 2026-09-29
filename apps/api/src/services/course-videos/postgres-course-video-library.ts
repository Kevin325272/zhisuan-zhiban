import {
  courseConceptVideoListSchema,
  courseVideoEpisodePageSchema,
  courseVideoSeriesPageSchema,
  type CourseVideoSeriesItem,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";
import {
  CourseVideoConceptNotFoundError,
  CourseVideoCourseNotFoundError,
  CourseVideoSeriesNotFoundError,
  type CourseVideoEpisodeQuery,
  type CourseVideoLibrary,
  type CourseVideoSeriesQuery,
} from "./course-video-library.js";

const EXTERNAL_NOTICE = "外部视频资源，打开后将在哔哩哔哩播放。";
const EXTERNAL_LIBRARY_NOTICE = "外部视频来源索引，元数据未逐集人工复核，打开后将在哔哩哔哩播放。";

interface CourseConceptRow {
  course_id: string;
  concept_id: string | null;
}

interface StudentVideoRow {
  episode_id: string;
  series_title: string;
  episode_title: string;
  episode_number: number;
  duration: string;
  duration_seconds: number;
  uploader: string;
  external_url: string;
  display_role: "primary" | "related";
  ordinal: number;
}

interface CourseVideoContextRow {
  course_id: string;
  course_title: string;
}

interface CourseVideoCountRow {
  total_series: number | string;
  total_episodes: number | string;
}

interface CourseVideoSeriesRow {
  series_id: string;
  series_title: string;
  uploader: string;
  video_kind: "teaching" | "question_explanation";
  total_duration: string;
  total_seconds: number;
  episode_count: number;
  canonical_url: string;
}

interface CourseVideoEpisodeRow {
  episode_id: string;
  episode_title: string;
  episode_number: number;
  duration: string;
  duration_seconds: number;
  external_url: string;
}

function toSeriesItem(row: CourseVideoSeriesRow): CourseVideoSeriesItem {
  return {
    series_id: row.series_id,
    series_title: row.series_title,
    uploader: row.uploader,
    video_kind: row.video_kind,
    total_duration: row.total_duration,
    total_seconds: Number(row.total_seconds),
    episode_count: Number(row.episode_count),
    canonical_url: row.canonical_url,
    platform: "bilibili",
  };
}

export class PostgresCourseVideoLibrary implements CourseVideoLibrary {
  constructor(private readonly pool: SqlQueryablePool) {}

  async listConceptVideos(courseSlug: string, conceptId: string) {
    const courseResult = await this.pool.query<CourseConceptRow>(
      `SELECT catalog.course_id, concept.concept_id
       FROM course_catalog_entries catalog
       LEFT JOIN course_core_concepts concept
         ON concept.course_id = catalog.course_id
        AND concept.concept_id = $2
       WHERE catalog.slug = $1`,
      [courseSlug, conceptId],
    );
    const context = courseResult.rows[0];
    if (!context) throw new CourseVideoCourseNotFoundError(courseSlug);
    if (!context.concept_id) throw new CourseVideoConceptNotFoundError(conceptId);

    const result = await this.pool.query<StudentVideoRow>(
      `SELECT episode.episode_id,
              series.title AS series_title,
              episode.title AS episode_title,
              episode.episode_number,
              episode.duration,
              episode.duration_seconds,
              series.uploader,
              episode.external_url,
              link.display_role,
              link.ordinal
       FROM course_concept_video_links link
       JOIN course_video_episodes episode ON episode.episode_id = link.episode_id
       JOIN course_video_series series ON series.series_id = episode.series_id
       WHERE link.concept_id = $1
         AND link.course_id = $2
         AND link.display_enabled = true
         AND link.review_status = 'approved'
       ORDER BY link.ordinal, link.link_id
       LIMIT 2`,
      [conceptId, context.course_id],
    );

    return courseConceptVideoListSchema.parse({
      course_slug: courseSlug,
      concept_id: conceptId,
      external_only: true,
      notice: EXTERNAL_NOTICE,
      items: result.rows.map((row) => ({
        episode_id: row.episode_id,
        series_title: row.series_title,
        episode_title: row.episode_title,
        episode_number: Number(row.episode_number),
        duration: row.duration,
        duration_seconds: Number(row.duration_seconds),
        uploader: row.uploader,
        external_url: row.external_url,
        display_role: row.display_role,
        ordinal: Number(row.ordinal),
        platform: "bilibili",
      })),
    });
  }

  async listCourseVideoSeries(courseSlug: string, query: CourseVideoSeriesQuery) {
    const contextResult = await this.pool.query<CourseVideoContextRow>(
      `SELECT catalog.course_id, course.title AS course_title
       FROM course_catalog_entries catalog
       JOIN courses course ON course.course_id = catalog.course_id
       WHERE catalog.slug = $1`,
      [courseSlug],
    );
    const context = contextResult.rows[0];
    if (!context) throw new CourseVideoCourseNotFoundError(courseSlug);

    const kind = query.kind === "all" ? null : query.kind;
    const countResult = await this.pool.query<CourseVideoCountRow>(
      `SELECT COUNT(*)::int AS total_series,
              (
                SELECT COUNT(episode.episode_id)::int
                FROM course_video_episodes episode
                JOIN course_video_series course_series
                  ON course_series.series_id = episode.series_id
                WHERE course_series.course_id = $1
              ) AS total_episodes
       FROM course_video_series series
       WHERE series.course_id = $1
         AND ($2::text IS NULL OR series.video_kind = $2)
         AND (
           $3::text = ''
           OR series.title ILIKE '%' || $3 || '%'
           OR series.uploader ILIKE '%' || $3 || '%'
           OR EXISTS (
             SELECT 1
             FROM course_video_episodes episode
             WHERE episode.series_id = series.series_id
               AND episode.title ILIKE '%' || $3 || '%'
           )
         )`,
      [context.course_id, kind, query.q],
    );
    const counts = countResult.rows[0] ?? { total_series: 0, total_episodes: 0 };
    const totalSeries = Number(counts.total_series);
    const totalEpisodes = Number(counts.total_episodes);
    const offset = (query.page - 1) * query.pageSize;

    const seriesResult = await this.pool.query<CourseVideoSeriesRow>(
      `SELECT series.series_id,
              series.title AS series_title,
              series.uploader,
              series.video_kind,
              series.total_duration,
              series.total_seconds,
              series.episode_count,
              series.canonical_url
       FROM course_video_series series
       WHERE series.course_id = $1
         AND ($2::text IS NULL OR series.video_kind = $2)
         AND (
           $3::text = ''
           OR series.title ILIKE '%' || $3 || '%'
           OR series.uploader ILIKE '%' || $3 || '%'
           OR EXISTS (
             SELECT 1
             FROM course_video_episodes episode
             WHERE episode.series_id = series.series_id
               AND episode.title ILIKE '%' || $3 || '%'
           )
         )
       ORDER BY series.video_kind, series.title, series.series_id
       LIMIT $4 OFFSET $5`,
      [context.course_id, kind, query.q, query.pageSize, offset],
    );

    return courseVideoSeriesPageSchema.parse({
      course_slug: courseSlug,
      course_title: context.course_title,
      external_only: true,
      notice: EXTERNAL_LIBRARY_NOTICE,
      query: query.q,
      kind: query.kind,
      total_series: totalSeries,
      total_episodes: totalEpisodes,
      page: query.page,
      page_size: query.pageSize,
      total_pages: totalSeries === 0 ? 0 : Math.ceil(totalSeries / query.pageSize),
      items: seriesResult.rows.map(toSeriesItem),
    });
  }

  async listSeriesEpisodes(
    courseSlug: string,
    seriesId: string,
    query: CourseVideoEpisodeQuery,
  ) {
    const contextResult = await this.pool.query<CourseVideoContextRow>(
      `SELECT catalog.course_id, course.title AS course_title
       FROM course_catalog_entries catalog
       JOIN courses course ON course.course_id = catalog.course_id
       WHERE catalog.slug = $1`,
      [courseSlug],
    );
    const context = contextResult.rows[0];
    if (!context) throw new CourseVideoCourseNotFoundError(courseSlug);

    const seriesResult = await this.pool.query<CourseVideoSeriesRow>(
      `SELECT series.series_id,
              series.title AS series_title,
              series.uploader,
              series.video_kind,
              series.total_duration,
              series.total_seconds,
              series.episode_count,
              series.canonical_url
       FROM course_video_series series
       WHERE series.course_id = $1
         AND series.series_id = $2`,
      [context.course_id, seriesId],
    );
    const series = seriesResult.rows[0];
    if (!series) throw new CourseVideoSeriesNotFoundError(seriesId);

    const totalEpisodes = Number(series.episode_count);
    const offset = (query.page - 1) * query.pageSize;
    const episodeResult = await this.pool.query<CourseVideoEpisodeRow>(
      `SELECT episode.episode_id,
              episode.title AS episode_title,
              episode.episode_number,
              episode.duration,
              episode.duration_seconds,
              episode.external_url
       FROM course_video_episodes episode
       WHERE episode.series_id = $1
       ORDER BY episode.episode_number, episode.episode_id
       LIMIT $2 OFFSET $3`,
      [seriesId, query.pageSize, offset],
    );

    return courseVideoEpisodePageSchema.parse({
      course_slug: courseSlug,
      series: toSeriesItem(series),
      external_only: true,
      notice: EXTERNAL_LIBRARY_NOTICE,
      page: query.page,
      page_size: query.pageSize,
      total_pages: totalEpisodes === 0 ? 0 : Math.ceil(totalEpisodes / query.pageSize),
      total_episodes: totalEpisodes,
      items: episodeResult.rows.map((episode) => ({
        episode_id: episode.episode_id,
        episode_title: episode.episode_title,
        episode_number: Number(episode.episode_number),
        duration: episode.duration,
        duration_seconds: Number(episode.duration_seconds),
        external_url: episode.external_url,
        platform: "bilibili" as const,
      })),
    });
  }
}
