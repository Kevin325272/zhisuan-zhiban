import { sourceLayerCourseSummarySchema, type SourceLayerCourseSummary } from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";
import type { SourceLayerSummaryService } from "./source-layer.js";

interface SourceLayerSummaryRow {
  course_id: string;
  title: string;
  course_label: string;
  version: string;
  isbn: string;
  archive_file_name: string;
  archive_sha256: string;
  source_files: unknown;
  chunk_count: string | number;
  chapter_count: string | number;
  figure_count: string | number;
  image_available_count: string | number;
  needs_human_review_figure_count: string | number;
  chunk_review_count: string | number;
  student_content_status: string;
  license_status: "unverified";
  usage_scope: "local_demo_only";
}

function count(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function sourceFiles(value: unknown) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("Stored source_files must be a JSON string array.");
  }
  return value;
}

function mapSummary(row: SourceLayerSummaryRow): SourceLayerCourseSummary {
  return sourceLayerCourseSummarySchema.parse({
    course_id: row.course_id,
    title: row.title,
    course_label: row.course_label,
    version: row.version,
    isbn: row.isbn,
    source_archive_file: row.archive_file_name,
    source_archive_sha256: row.archive_sha256,
    source_files: sourceFiles(row.source_files),
    chunk_count: count(row.chunk_count),
    chapter_count: count(row.chapter_count),
    figure_count: count(row.figure_count),
    image_available_count: count(row.image_available_count),
    needs_human_review_figure_count: count(row.needs_human_review_figure_count),
    chunk_review_count: count(row.chunk_review_count),
    student_content_status: row.student_content_status,
    license_status: row.license_status,
    usage_scope: row.usage_scope,
  });
}

const summarySql = `
  SELECT d.course_id, d.title, d.course_label, d.version, d.isbn,
         d.archive_file_name, d.archive_sha256, d.source_files,
         COUNT(DISTINCT c.chunk_id)::text AS chunk_count,
         COUNT(DISTINCT c.chapter)::text AS chapter_count,
         COUNT(DISTINCT f.figure_asset_id)::text AS figure_count,
         COUNT(DISTINCT f.figure_asset_id) FILTER (WHERE f.image_available)::text
           AS image_available_count,
         COUNT(DISTINCT f.figure_asset_id) FILTER (WHERE f.review_status = 'needs_human_review')::text
           AS needs_human_review_figure_count,
         COUNT(DISTINCT c.chunk_id) FILTER (WHERE c.needs_review)::text AS chunk_review_count,
         d.student_content_status, d.license_status, d.usage_scope
    FROM course_source_datasets d
    LEFT JOIN course_source_chunks c ON c.dataset_id = d.dataset_id
    LEFT JOIN course_source_figure_assets f ON f.dataset_id = d.dataset_id
   WHERE d.course_id = $1
   GROUP BY d.dataset_id, d.course_id, d.title, d.course_label, d.version, d.isbn,
            d.archive_file_name, d.archive_sha256, d.source_files,
            d.student_content_status, d.license_status, d.usage_scope`;

export class Postgres408SourceLayer implements SourceLayerSummaryService {
  constructor(private readonly pool: SqlQueryablePool) {}

  async getCourseSummary(courseId: string): Promise<SourceLayerCourseSummary | null> {
    const result = await this.pool.query<SourceLayerSummaryRow>(summarySql, [courseId]);
    const row = result.rows[0];
    return row ? mapSummary(row) : null;
  }

  async listCourseSummaries(): Promise<SourceLayerCourseSummary[]> {
    const result = await this.pool.query<SourceLayerSummaryRow>(
      `${summarySql.replace("WHERE d.course_id = $1", "")}
       ORDER BY d.course_id`,
      [],
    );
    return result.rows.map(mapSummary);
  }
}

