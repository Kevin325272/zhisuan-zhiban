import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import type { SqlQueryablePool } from "../src/database/client.js";
import { PostgresExamPaperLibrary } from "../src/services/exam-papers/postgres-exam-paper-library.js";

const row = {
  exam_paper_id: "exam_c3d34e3115ef7c7e6372f3bc",
  course_id: "course_408_001",
  import_batch_id: "exam_import_001",
  archive_sha256: "a".repeat(64),
  university: "上海科技大学",
  year: 2022,
  subject: "991数据结构与算法",
  paper_type: "exam",
  page_count: 6,
  file_size_bytes: "794412",
  content_mode: "text_layer",
  official_source_url: "https://sist.shanghaitech.edu.cn/paper.pdf",
  landing_page_url: "https://sist.shanghaitech.edu.cn/paper/index.htm",
  archive_entry: "自母命题试卷/上海科技大学/2022年/991数据结构与算法/试卷.pdf",
  pdf_sha256: "c".repeat(64),
  training_allowed: false,
  license_status: "unverified",
  usage_scope: "local_demo_only",
  review_status: "unreviewed",
  reviewed_by: null,
  reviewed_at: null,
  updated_at: "2026-07-31T00:00:00.000Z",
};

function poolFor(rows = [row]): SqlQueryablePool {
  return {
    async query<Row = Record<string, unknown>>(
      sql: string,
    ): Promise<import("../src/database/client.js").SqlQueryResult<Row>> {
      const response = (value: unknown[]) => ({
        rows: value as Row[],
        rowCount: value.length,
      });
      if (sql.includes("COUNT(*)")) {
        return response([{ total: "1", scan_count: "0", text_layer_count: "1", license_unverified_count: "1" }]);
      }
      if (sql.includes("SELECT DISTINCT university")) {
        return response([{ university: row.university }]);
      }
      if (sql.includes("SELECT DISTINCT year")) {
        return response([{ year: row.year }]);
      }
      if (sql.includes("SELECT DISTINCT subject")) {
        return response([{ subject: row.subject }]);
      }
      if (sql.includes("SELECT DISTINCT paper_type")) {
        return response([{ paper_type: row.paper_type }]);
      }
      if (sql.includes("WHERE exam_paper_id")) {
        return response(rows);
      }
      return response(rows);
    },
    async connect() {
      throw new Error("Not used by read-only service tests.");
    },
  };
}

describe("PostgresExamPaperLibrary", () => {
  it("returns student-safe filtered list and real facets", async () => {
    const library = new PostgresExamPaperLibrary(poolFor(), {
      async openPdf() {
        return {
          stream: Readable.from([Buffer.from("%PDF-")]),
          size: 5,
          fileName: "试卷.pdf",
        };
      },
    });

    const response = await library.list({
      courseId: "course_408_001",
      university: "上海科技大学",
      year: 2022,
      subject: "991数据结构与算法",
      paperType: "exam",
      limit: 20,
      offset: 0,
    });

    expect(response).toMatchObject({
      total: 1,
      facets: {
        universities: ["上海科技大学"],
        years: [2022],
        subjects: ["991数据结构与算法"],
        paper_types: ["exam"],
      },
    });
    expect(response.items[0]).toMatchObject({
      exam_paper_id: row.exam_paper_id,
      has_answer_key: false,
      automatic_grading: false,
    });
    expect(response.items[0]).not.toHaveProperty("archive_entry");
    expect(response.items[0]).not.toHaveProperty("pdf_sha256");
  });

  it("maps detail and streams only the requested internal archive entry", async () => {
    let requestedEntry: string | undefined;
    const library = new PostgresExamPaperLibrary(poolFor(), {
      async openPdf(entry) {
        requestedEntry = entry;
        return {
          stream: Readable.from([Buffer.from("%PDF-")]),
          size: 5,
          fileName: "试卷.pdf",
        };
      },
    });

    const detail = await library.get("exam_c3d34e3115ef7c7e6372f3bc", "course_408_001");
    expect(detail).toMatchObject({
      exam_paper_id: row.exam_paper_id,
      landing_page_url: row.landing_page_url,
      file_size_bytes: 794_412,
    });

    const opened = await library.openPdf(
      "exam_c3d34e3115ef7c7e6372f3bc",
      "course_408_001",
    );
    expect(opened?.size).toBe(5);
    expect(requestedEntry).toBe(row.archive_entry);
  });

  it("returns stored provenance only to the management projection", async () => {
    const library = new PostgresExamPaperLibrary(poolFor(), {
      async openPdf() {
        return {
          stream: Readable.from([Buffer.from("%PDF-")]),
          size: 5,
          fileName: "试卷.pdf",
        };
      },
    });
    const response = await library.listManagement({
      courseId: "course_408_001",
      limit: 20,
      offset: 0,
    });
    expect(response).toMatchObject({
      total: 1,
      scan_count: 0,
      text_layer_count: 1,
      license_unverified_count: 1,
      data_scope: "stored_records_only",
    });
    expect(response.items[0]).toMatchObject({
      pdf_sha256: row.pdf_sha256,
      archive_sha256: "a".repeat(64),
      training_allowed: false,
      usage_scope: "local_demo_only",
    });
  });
});
