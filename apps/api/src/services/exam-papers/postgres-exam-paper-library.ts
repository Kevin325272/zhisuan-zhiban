import { basename, posix } from "node:path";

import {
  examPaperDetailSchema,
  examPaperListResponseSchema,
  examPaperManagementResponseSchema,
  type ExamPaperDetail,
  type ExamPaperListResponse,
  type ExamPaperManagementResponse,
} from "@xuetu/contracts";
import { Open } from "unzipper";

import type { SqlQueryablePool } from "../../database/client.js";
import {
  ExamPaperArchiveUnavailableError,
  type ExamPaperArchiveReader,
  type ExamPaperListFilter,
  type ExamPaperManagementFilter,
  type ExamPaperLibrary,
  type ExamPaperStudentRow,
  toExamPaperSummary,
} from "./exam-paper-library.js";

interface ExamPaperManagementRow extends ExamPaperStudentRow {
  archive_sha256: string;
}

interface CountRow {
  total?: string | number;
  scan_count?: string | number;
  text_layer_count?: string | number;
  license_unverified_count?: string | number;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function integer(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function addFilter(
  clauses: string[],
  parameters: unknown[],
  column: string,
  value: unknown,
) {
  if (value === undefined) return;
  parameters.push(value);
  clauses.push(`${column} = $${parameters.length}`);
}

function detailFromRow(row: ExamPaperStudentRow): ExamPaperDetail {
  return examPaperDetailSchema.parse({
    ...toExamPaperSummary(row),
    landing_page_url: row.landing_page_url,
    file_size_bytes: integer(row.file_size_bytes),
  });
}

const studentColumns = `
  e.exam_paper_id, e.course_id, e.import_batch_id, e.university, e.year,
  e.subject, e.paper_type, e.page_count, e.file_size_bytes, e.content_mode,
  e.official_source_url, e.landing_page_url, e.archive_entry, e.pdf_sha256,
  e.training_allowed, e.license_status, e.usage_scope, e.review_status,
  e.reviewed_by, e.reviewed_at, e.updated_at
`;

export class ZipExamPaperArchive implements ExamPaperArchiveReader {
  constructor(private readonly archivePath: string) {}

  async openPdf(archiveEntry: string) {
    try {
      const directory = await Open.file(this.archivePath);
      const file = directory.files.find(
        (candidate) => candidate.type === "File" && candidate.path === archiveEntry,
      );
      if (!file) {
        throw new Error(`Archive entry not found: ${archiveEntry}`);
      }
      return {
        stream: file.stream(),
        size: file.uncompressedSize,
        fileName: basename(posix.basename(file.path)),
      };
    } catch (error) {
      throw new ExamPaperArchiveUnavailableError(
        error instanceof Error ? error.message : "Exam-paper archive is unavailable.",
      );
    }
  }
}

export class PostgresExamPaperLibrary implements ExamPaperLibrary {
  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly archive: ExamPaperArchiveReader,
  ) {}

  async list(filter: ExamPaperListFilter): Promise<ExamPaperListResponse> {
    const clauses = ["e.course_id = $1"];
    const parameters: unknown[] = [filter.courseId];
    addFilter(clauses, parameters, "e.university", filter.university);
    addFilter(clauses, parameters, "e.year", filter.year);
    addFilter(clauses, parameters, "e.subject", filter.subject);
    addFilter(clauses, parameters, "e.paper_type", filter.paperType);
    const where = clauses.join(" AND ");
    const countResult = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM exam_papers e WHERE ${where}`,
      parameters,
    );
    const rowsResult = await this.pool.query<ExamPaperStudentRow>(
      `SELECT ${studentColumns}
       FROM exam_papers e
       WHERE ${where}
       ORDER BY e.year DESC, e.university ASC, e.subject ASC, e.exam_paper_id ASC
       LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      [...parameters, filter.limit, filter.offset],
    );
    const [universities, years, subjects, paperTypes] = await Promise.all([
      this.pool.query<{ university: string }>(
        "SELECT DISTINCT university FROM exam_papers WHERE course_id = $1 ORDER BY university",
        [filter.courseId],
      ),
      this.pool.query<{ year: number | string }>(
        "SELECT DISTINCT year FROM exam_papers WHERE course_id = $1 ORDER BY year DESC",
        [filter.courseId],
      ),
      this.pool.query<{ subject: string }>(
        "SELECT DISTINCT subject FROM exam_papers WHERE course_id = $1 ORDER BY subject",
        [filter.courseId],
      ),
      this.pool.query<{ paper_type: "exam" | "sample" }>(
        "SELECT DISTINCT paper_type FROM exam_papers WHERE course_id = $1 ORDER BY paper_type",
        [filter.courseId],
      ),
    ]);

    return examPaperListResponseSchema.parse({
      items: rowsResult.rows.map(toExamPaperSummary),
      total: integer(countResult.rows[0]?.total ?? 0),
      limit: filter.limit,
      offset: filter.offset,
      facets: {
        universities: universities.rows.map((row) => row.university),
        years: years.rows.map((row) => integer(row.year)),
        subjects: subjects.rows.map((row) => row.subject),
        paper_types: paperTypes.rows.map((row) => row.paper_type),
      },
    });
  }

  async get(examPaperId: string, courseId: string): Promise<ExamPaperDetail | null> {
    const result = await this.pool.query<ExamPaperStudentRow>(
      `SELECT ${studentColumns}
       FROM exam_papers e
       WHERE e.exam_paper_id = $1 AND e.course_id = $2
       LIMIT 1`,
      [examPaperId, courseId],
    );
    const row = result.rows[0];
    return row ? detailFromRow(row) : null;
  }

  async openPdf(examPaperId: string, courseId: string) {
    const result = await this.pool.query<Pick<ExamPaperStudentRow, "archive_entry">>(
      `SELECT e.archive_entry
       FROM exam_papers e
       WHERE e.exam_paper_id = $1 AND e.course_id = $2
       LIMIT 1`,
      [examPaperId, courseId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return this.archive.openPdf(row.archive_entry);
  }

  async listManagement(
    filter: ExamPaperManagementFilter,
  ): Promise<ExamPaperManagementResponse> {
    const clauses = ["e.course_id = $1"];
    const parameters: unknown[] = [filter.courseId];
    addFilter(clauses, parameters, "e.review_status", filter.reviewStatus);
    const where = clauses.join(" AND ");
    const countResult = await this.pool.query<CountRow>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE e.content_mode = 'scan')::text AS scan_count,
         COUNT(*) FILTER (WHERE e.content_mode = 'text_layer')::text AS text_layer_count,
         COUNT(*) FILTER (WHERE e.license_status = 'unverified')::text AS license_unverified_count
       FROM exam_papers e
       WHERE ${where}`,
      parameters,
    );
    const rowsResult = await this.pool.query<ExamPaperManagementRow>(
      `SELECT ${studentColumns}, b.archive_sha256
       FROM exam_papers e
       JOIN exam_paper_import_batches b ON b.import_batch_id = e.import_batch_id
       WHERE ${where}
       ORDER BY e.year DESC, e.university ASC, e.subject ASC, e.exam_paper_id ASC
       LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      [...parameters, filter.limit, filter.offset],
    );
    const counts = countResult.rows[0] ?? {};

    return examPaperManagementResponseSchema.parse({
      items: rowsResult.rows.map((row) => ({
        ...detailFromRow(row),
        course_id: row.course_id,
        pdf_sha256: row.pdf_sha256,
        archive_sha256: row.archive_sha256,
        license_status: row.license_status,
        usage_scope: row.usage_scope,
        training_allowed: false,
        review_status: row.review_status,
        reviewed_by: row.reviewed_by,
        reviewed_at: iso(row.reviewed_at),
        updated_at: iso(row.updated_at),
      })),
      total: integer(counts.total ?? rowsResult.rows.length),
      scan_count: integer(
        counts.scan_count
          ?? rowsResult.rows.filter((row) => row.content_mode === "scan").length,
      ),
      text_layer_count: integer(
        counts.text_layer_count
          ?? rowsResult.rows.filter((row) => row.content_mode === "text_layer").length,
      ),
      license_unverified_count: integer(
        counts.license_unverified_count
          ?? rowsResult.rows.filter((row) => row.license_status === "unverified").length,
      ),
      data_scope: "stored_records_only",
    });
  }
}
