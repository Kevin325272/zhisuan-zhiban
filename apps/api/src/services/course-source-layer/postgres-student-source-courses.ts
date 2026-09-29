import {
  sourceCourseOutlineSchema,
  type SourceCourseChapter,
  type SourceCourseFigure,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";
import type {
  StudentSourceCourseService,
  StudentSourceFigureAsset,
} from "./student-source-courses.js";

const CURRICULUM_NOTICE = "课程结构已接入，讲解内容待课程化整理。";

interface CourseRow {
  course_id: string;
  course_slug: string;
  course_code: string;
  title: string;
  summary: string;
  question_subject: string;
  source_title: string;
  source_edition: string;
  chapter_count: string | number;
  source_entry_count: string | number;
  displayable_figure_count: string | number;
}

interface ChapterRow {
  chapter: string;
  ordinal: string | number;
  source_entry_count: string | number;
  page_start: string | number;
  page_end: string | number;
}

interface EntryRow {
  entry_id: string;
  chapter: string;
  ordinal: string | number;
  title: string;
  print_page: string | number;
  keywords: unknown;
  figure_asset_id: string | null;
  figure_no: string | null;
  figure_title: string | null;
  pixel_size: unknown;
}

interface FigureAssetRow {
  archive_sha256: string;
  archive_path: string;
  asset_sha256: string;
}

function count(value: string | number) {
  return Number(value);
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 8);
}

function studentFigureLabel(value: string) {
  const match = /^图(\d{1,2})-(\d{1,3})$/u.exec(value.trim());
  return match ? `图${match[1]}.${match[2]}` : null;
}

function pixelSize(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const width = Number((value as { width?: unknown }).width);
  const height = Number((value as { height?: unknown }).height);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    return null;
  }
  return { width, height };
}

function toStudentFigure(row: EntryRow, courseSlug: string): SourceCourseFigure | null {
  if (!row.figure_asset_id || !row.figure_no || !row.figure_title) return null;
  const label = studentFigureLabel(row.figure_no);
  const size = pixelSize(row.pixel_size);
  if (!label || !size) return null;
  return {
    figure_label: label,
    caption: row.figure_title,
    image_url: `/api/v1/408/courses/${courseSlug}/source-figures/${encodeURIComponent(row.figure_asset_id)}`,
    mime_type: "image/webp",
    pixel_width: size.width,
    pixel_height: size.height,
  };
}

export class PostgresStudentSourceCourses implements StudentSourceCourseService {
  constructor(private readonly pool: SqlQueryablePool) {}

  async getCourseOutline(courseSlug: string) {
    const courseResult = await this.pool.query<CourseRow>(
      `SELECT c.course_id, e.slug AS course_slug, c.course_code, c.title,
              e.summary, e.question_subject, d.title AS source_title,
              d.version AS source_edition,
              COUNT(DISTINCT sc.chapter)::text AS chapter_count,
              COUNT(DISTINCT sc.chunk_id)::text AS source_entry_count,
              COUNT(DISTINCT sf.figure_asset_id) FILTER (
                WHERE sr.confidence = 'high'
                  AND sf.image_available = true
                  AND sf.review_status <> 'needs_human_review'
              )::text AS displayable_figure_count
       FROM course_catalog_entries e
       JOIN courses c ON c.course_id = e.course_id AND c.status = 'active'
       JOIN course_source_datasets d ON d.course_id = c.course_id
       JOIN course_source_chunks sc ON sc.dataset_id = d.dataset_id
       LEFT JOIN course_source_figure_relations sr
         ON sr.source_chunk_id = sc.chunk_id AND sr.confidence = 'high'
       LEFT JOIN course_source_figure_assets sf
         ON sf.figure_asset_id = sr.figure_asset_id
        AND sf.course_id = c.course_id
        AND sf.image_available = true
        AND sf.review_status <> 'needs_human_review'
       WHERE e.slug = $1
         AND d.student_content_status = 'source_layer_only_curriculum_pending'
       GROUP BY c.course_id, e.slug, c.course_code, c.title, e.summary,
                e.question_subject, d.dataset_id, d.title, d.version`,
      [courseSlug],
    );
    const course = courseResult.rows[0];
    if (!course) return null;

    const [chapterResult, entryResult] = await Promise.all([
      this.pool.query<ChapterRow>(
        `SELECT sc.chapter, MIN(sc.ordinal)::text AS ordinal,
                COUNT(*)::text AS source_entry_count,
                MIN(sc.printed_page) AS page_start,
                MAX(sc.printed_page) AS page_end
         FROM course_catalog_entries e
         JOIN course_source_chunks sc ON sc.course_id = e.course_id
         WHERE e.slug = $1
         GROUP BY sc.chapter
         ORDER BY MIN(sc.ordinal)`,
        [courseSlug],
      ),
      this.pool.query<EntryRow>(
        `WITH candidates AS (
           SELECT sc.chunk_id AS entry_id, sc.chapter, sc.ordinal, sc.title,
                  sc.printed_page AS print_page, sc.keywords,
                  figure.figure_asset_id, figure.figure_no,
                  figure.figure_title, figure.pixel_size
           FROM course_catalog_entries e
           JOIN course_source_chunks sc ON sc.course_id = e.course_id
           LEFT JOIN LATERAL (
             SELECT sf.figure_asset_id, sf.figure_no,
                    sf.title AS figure_title, sf.pixel_size
             FROM course_source_figure_relations sr
             JOIN course_source_figure_assets sf
               ON sf.figure_asset_id = sr.figure_asset_id
              AND sf.course_id = sc.course_id
             WHERE sr.source_chunk_id = sc.chunk_id
               AND sr.confidence = 'high'
               AND sf.image_available = true
               AND sf.review_status <> 'needs_human_review'
             ORDER BY sf.printed_page, sf.figure_no
             LIMIT 1
           ) figure ON true
           WHERE e.slug = $1
             AND sc.needs_review = false
             AND sc.quality_score >= 0.65
         ), ranked AS (
           SELECT candidates.*,
                  ROW_NUMBER() OVER (
                    PARTITION BY chapter
                    ORDER BY (figure_asset_id IS NOT NULL) DESC, ordinal
                  ) AS entry_rank
           FROM candidates
         )
         SELECT entry_id, chapter, ordinal, title, print_page, keywords,
                figure_asset_id, figure_no, figure_title, pixel_size
         FROM ranked
         WHERE entry_rank <= 5
         ORDER BY MIN(ordinal) OVER (PARTITION BY chapter), ordinal`,
        [courseSlug],
      ),
    ]);

    const entriesByChapter = new Map<string, EntryRow[]>();
    for (const entry of entryResult.rows) {
      const entries = entriesByChapter.get(entry.chapter) ?? [];
      entries.push(entry);
      entriesByChapter.set(entry.chapter, entries);
    }
    const chapters: SourceCourseChapter[] = chapterResult.rows.map((chapter) => ({
      chapter: chapter.chapter,
      ordinal: count(chapter.ordinal),
      source_entry_count: count(chapter.source_entry_count),
      page_start: count(chapter.page_start),
      page_end: count(chapter.page_end),
      entries: (entriesByChapter.get(chapter.chapter) ?? []).map((entry) => ({
        entry_id: entry.entry_id,
        title: entry.title,
        print_page: count(entry.print_page),
        keywords: stringList(entry.keywords),
        figure: toStudentFigure(entry, courseSlug),
      })),
    }));

    return sourceCourseOutlineSchema.parse({
      course_id: course.course_id,
      course_slug: course.course_slug,
      course_code: course.course_code,
      title: course.title,
      summary: course.summary,
      question_subject: course.question_subject,
      source_title: course.source_title,
      source_edition: course.source_edition,
      curriculum_status: "source_structure_available_curriculum_pending",
      notice: CURRICULUM_NOTICE,
      chapter_count: count(course.chapter_count),
      source_entry_count: count(course.source_entry_count),
      displayable_figure_count: count(course.displayable_figure_count),
      chapters,
    });
  }

  async getFigureAsset(
    courseSlug: string,
    figureAssetId: string,
  ): Promise<StudentSourceFigureAsset | null> {
    const result = await this.pool.query<FigureAssetRow>(
      `SELECT d.archive_sha256, sf.webp_path AS archive_path,
              sf.webp_sha256 AS asset_sha256
       FROM course_catalog_entries e
       JOIN course_source_datasets d ON d.course_id = e.course_id
       JOIN course_source_figure_assets sf
         ON sf.dataset_id = d.dataset_id AND sf.course_id = e.course_id
       JOIN course_source_figure_relations sr
         ON sr.figure_asset_id = sf.figure_asset_id
        AND sr.course_id = e.course_id
       WHERE e.slug = $1
         AND sf.figure_asset_id = $2
         AND sr.confidence = 'high'
         AND sf.image_available = true
         AND sf.review_status <> 'needs_human_review'
       LIMIT 1`,
      [courseSlug, figureAssetId],
    );
    const row = result.rows[0];
    return row
      ? {
          archive_sha256: row.archive_sha256,
          archive_path: row.archive_path,
          asset_sha256: row.asset_sha256,
          mime_type: "image/webp",
        }
      : null;
  }
}
