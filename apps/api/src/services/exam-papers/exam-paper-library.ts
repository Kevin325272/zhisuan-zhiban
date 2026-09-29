import type {
  ExamPaperDetail,
  ExamPaperListResponse,
  ExamPaperManagementResponse,
  ExamPaperSummary,
} from "@xuetu/contracts";

export interface OpenExamPaperPdf {
  stream: NodeJS.ReadableStream;
  size: number;
  fileName: string;
}

export interface ExamPaperArchiveReader {
  openPdf(archiveEntry: string): Promise<OpenExamPaperPdf>;
}

export interface ExamPaperListFilter {
  courseId: string;
  university?: string;
  year?: number;
  subject?: string;
  paperType?: "exam" | "sample";
  limit: number;
  offset: number;
}

export interface ExamPaperManagementFilter {
  courseId: string;
  reviewStatus?: "unreviewed" | "pending_review" | "approved" | "rejected";
  limit: number;
  offset: number;
}

export interface ExamPaperLibrary {
  list(filter: ExamPaperListFilter): Promise<ExamPaperListResponse>;
  get(examPaperId: string, courseId: string): Promise<ExamPaperDetail | null>;
  openPdf(examPaperId: string, courseId: string): Promise<OpenExamPaperPdf | null>;
  listManagement(
    filter: ExamPaperManagementFilter,
  ): Promise<ExamPaperManagementResponse>;
}

export class ExamPaperArchiveUnavailableError extends Error {
  constructor(message = "Exam-paper archive is unavailable.") {
    super(message);
    this.name = "ExamPaperArchiveUnavailableError";
  }
}

export type ExamPaperStudentRow = {
  exam_paper_id: string;
  course_id: string;
  import_batch_id: string;
  university: string;
  year: number;
  subject: string;
  paper_type: "exam" | "sample";
  page_count: number;
  file_size_bytes: number | string;
  content_mode: "text_layer" | "scan";
  official_source_url: string;
  landing_page_url: string;
  archive_entry: string;
  pdf_sha256: string;
  training_allowed: boolean;
  license_status: "unverified" | "verified" | "restricted";
  usage_scope: "local_demo_only";
  review_status: "unreviewed" | "pending_review" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  updated_at: Date | string;
};

export function toExamPaperSummary(row: ExamPaperStudentRow): ExamPaperSummary {
  return {
    exam_paper_id: row.exam_paper_id,
    university: row.university,
    year: row.year,
    subject: row.subject,
    paper_type: row.paper_type,
    page_count: row.page_count,
    content_mode: row.content_mode,
    official_source_url: row.official_source_url,
    has_answer_key: false,
    automatic_grading: false,
  };
}
