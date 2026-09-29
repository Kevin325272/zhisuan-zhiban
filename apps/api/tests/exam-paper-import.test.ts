import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult } from "../src/database/client.js";
import { seedExamPapers } from "../src/database/seed-exam-papers.js";
import type { ExamPaperSource } from "../src/services/exam-papers/exam-paper-source.js";

const source: ExamPaperSource = {
  datasetId: "self-authored-computer-exams-2017-2026",
  sourceProvider: "official_university_websites",
  generatedAt: "2026-07-30T00:00:00.000Z",
  archiveSha256: "a".repeat(64),
  archiveFileName: "自命题试卷.zip",
  manifestEntry: "自母命题试卷/来源与下载记录.json",
  failureCount: 11,
  counts: {
    papers: 1,
    pages: 6,
    bytes: 794_412,
    scans: 0,
    textLayer: 1,
  },
  records: [
    {
      examPaperId: "exam_c3d34e3115ef7c7e6372f3bc",
      university: "上海科技大学",
      year: 2022,
      subject: "991数据结构与算法",
      paperType: "exam",
      pageCount: 6,
      fileSizeBytes: 794_412,
      contentMode: "text_layer",
      officialSourceUrl: "https://sist.shanghaitech.edu.cn/paper.pdf",
      landingPageUrl: "https://sist.shanghaitech.edu.cn/paper/index.htm",
      archiveEntry: "自母命题试卷/上海科技大学/2022年/991数据结构与算法/试卷.pdf",
      pdfSha256: "c".repeat(64),
      archiveSha256: "a".repeat(64),
      trainingAllowed: false,
      licenseStatus: "unverified",
      usageScope: "local_demo_only",
      reviewStatus: "unreviewed",
    },
  ],
};

describe("exam-paper PostgreSQL import", () => {
  it("seeds one provenance batch and document records in one transaction", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("RETURNING import_batch_id")) {
          return {
            rows: [{ import_batch_id: "exam_import_001" } as Row],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {
        statements.push({ sql: "RELEASE" });
      },
    };

    const result = await seedExamPapers(
      { async connect() { return client; } },
      source,
      {
        courseId: "course_408_001",
        createId: () => "exam_import_001",
        now: () => new Date("2026-07-31T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      importBatchId: "exam_import_001",
      paperCount: 1,
    });
    expect(statements.map((statement) => statement.sql)).toEqual(
      expect.arrayContaining([
        "BEGIN",
        expect.stringContaining("INSERT INTO exam_paper_import_batches"),
        expect.stringContaining("INSERT INTO exam_papers"),
        expect.stringContaining("UPDATE exam_paper_import_batches"),
        "COMMIT",
        "RELEASE",
      ]),
    );
    const serialized = JSON.stringify(statements);
    expect(serialized).toContain("local_demo_only");
    expect(serialized).toContain(source.records[0]!.archiveEntry);
    expect(serialized).not.toContain("answer_key");
    expect(serialized).not.toContain("learning_evidence");
  });

  it("rolls back the whole batch when a paper insert fails", async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        statements.push(sql);
        if (sql.includes("RETURNING import_batch_id")) {
          return {
            rows: [{ import_batch_id: "exam_import_001" } as Row],
            rowCount: 1,
          };
        }
        if (sql.includes("INSERT INTO exam_papers")) {
          throw new Error("paper insert failed");
        }
        return { rows: [], rowCount: 1 };
      },
      release() {
        statements.push("RELEASE");
      },
    };

    await expect(
      seedExamPapers(
        { async connect() { return client; } },
        source,
        { courseId: "course_408_001" },
      ),
    ).rejects.toThrow("paper insert failed");
    expect(statements).toEqual(
      expect.arrayContaining(["BEGIN", "ROLLBACK", "RELEASE"]),
    );
    expect(statements).not.toContain("COMMIT");
  });
});
