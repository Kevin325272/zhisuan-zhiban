import type {
  ExamPaperDetail,
  ExamPaperFilter,
  ExamPaperListResponse,
  ExamPaperManagementResponse,
} from "@xuetu/contracts";

interface ApiEnvelope<T> {
  contract_version: string;
  request_id: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
}

export class ExamPaperClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ExamPaperClientError";
  }
}

async function readEnvelope<T>(response: Response): Promise<T> {
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ExamPaperClientError(
      response.ok ? "服务返回了无法解析的数据。" : `服务暂时不可用（HTTP ${response.status}）。`,
      "UNEXPECTED_RESPONSE",
      response.status >= 500 || response.status === 429,
    );
  }
  if (!response.ok || envelope.error || envelope.data === undefined) {
    const error = envelope.error ?? {
      code: "UNEXPECTED_RESPONSE",
      message: "服务返回了无法识别的结果。",
      retryable: false,
      details: {},
    };
    throw new ExamPaperClientError(
      error.message,
      error.code,
      error.retryable,
      error.details,
    );
  }
  return envelope.data;
}

function jsonHeaders() {
  return {
    Accept: "application/json",
  };
}

function queryString(
  filters: Partial<Omit<ExamPaperFilter, "limit" | "offset">> & {
    limit?: number;
    offset?: number;
    review_status?: "unreviewed" | "pending_review" | "approved" | "rejected";
  },
) {
  const params = new URLSearchParams();
  if (filters.university) params.set("university", filters.university);
  if (filters.year !== undefined) params.set("year", String(filters.year));
  if (filters.subject) params.set("subject", filters.subject);
  if (filters.paper_type) params.set("paper_type", filters.paper_type);
  if (filters.review_status) params.set("review_status", filters.review_status);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  const value = params.toString();
  return value ? `?${value}` : "";
}

export async function getExamPapers(
  filters: Partial<ExamPaperFilter> = {},
): Promise<ExamPaperListResponse> {
  const response = await fetch(
    `/api/v1/exam-papers${queryString(filters)}`,
    { credentials: "same-origin", headers: jsonHeaders() },
  );
  return readEnvelope<ExamPaperListResponse>(response);
}

export async function getExamPaperDetail(
  examPaperId: string,
): Promise<ExamPaperDetail> {
  const response = await fetch(`/api/v1/exam-papers/${encodeURIComponent(examPaperId)}`, {
    credentials: "same-origin",
    headers: jsonHeaders(),
  });
  return readEnvelope<ExamPaperDetail>(response);
}

export async function getExamPaperPdf(examPaperId: string): Promise<Blob> {
  const response = await fetch(
    `/api/v1/exam-papers/${encodeURIComponent(examPaperId)}/file`,
    {
      credentials: "same-origin",
      headers: {
        Accept: "application/pdf",
      },
    },
  );
  if (response.ok) return response.blob();
  return readEnvelope<Blob>(response);
}

export async function getManagedExamPapers(filters: {
  review_status?: "unreviewed" | "pending_review" | "approved" | "rejected";
  limit?: number;
  offset?: number;
} = {}): Promise<ExamPaperManagementResponse> {
  const response = await fetch(
    `/api/v1/manage/exam-papers${queryString(filters)}`,
    { credentials: "same-origin", headers: jsonHeaders() },
  );
  return readEnvelope<ExamPaperManagementResponse>(response);
}
