import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getExamPaperPdf,
  getExamPapers,
  getManagedExamPapers,
} from "./exam-paper-client";

describe("exam paper web client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("encodes student filters and uses the server session without leaking internal storage fields", async () => {
    const response = {
      contract_version: "0.1",
      request_id: "req_001",
      data: {
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
        facets: {
          universities: [],
          years: [],
          subjects: [],
          paper_types: [],
        },
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );

    await getExamPapers({
      university: "上海科技大学",
      year: 2022,
      subject: "991数据结构与算法",
      paper_type: "exam",
      limit: 20,
      offset: 40,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/exam-papers?university=%E4%B8%8A%E6%B5%B7%E7%A7%91%E6%8A%80%E5%A4%A7%E5%AD%A6&year=2022&subject=991%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84%E4%B8%8E%E7%AE%97%E6%B3%95&paper_type=exam&limit=20&offset=40",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("uses the server session for administrator governance data", async () => {
    const response = {
      contract_version: "0.1",
      request_id: "req_002",
      data: {
        items: [],
        total: 0,
        scan_count: 0,
        text_layer_count: 0,
        license_unverified_count: 0,
        data_scope: "stored_records_only",
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );

    await getManagedExamPapers();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/manage/exam-papers",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("reads PDF bytes as a blob and raises a structured error for failures", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    await expect(getExamPaperPdf("exam_001")).resolves.toBeInstanceOf(Blob);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          contract_version: "0.1",
          request_id: "req_003",
          error: {
            code: "EXAM_PAPER_ARCHIVE_UNAVAILABLE",
            message: "本地试卷文件暂时不可读取，请稍后重试。",
            retryable: true,
            details: {},
          },
        }),
        { status: 503 },
      ),
    );
    await expect(getExamPaperPdf("exam_001")).rejects.toMatchObject({
      code: "EXAM_PAPER_ARCHIVE_UNAVAILABLE",
      retryable: true,
    });
  });
});
