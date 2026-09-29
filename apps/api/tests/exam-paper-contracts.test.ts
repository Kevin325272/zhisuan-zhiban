import { describe, expect, it } from "vitest";

import {
  examPaperDetailSchema,
  examPaperFilterSchema,
  examPaperListResponseSchema,
  examPaperManagementRecordSchema,
  examPaperManagementResponseSchema,
  examPaperSummarySchema,
} from "@xuetu/contracts";

const studentSummary = {
  exam_paper_id: "exam_c3d34e3115ef7c7e6372f3bc",
  university: "上海科技大学",
  year: 2022,
  subject: "991数据结构与算法",
  paper_type: "exam",
  page_count: 6,
  content_mode: "text_layer",
  official_source_url:
    "https://sist.shanghaitech.edu.cn/_upload/article/files/sample/paper.pdf",
  has_answer_key: false,
  automatic_grading: false,
};

describe("exam-paper browser contracts", () => {
  it("applies bounded filter defaults", () => {
    expect(examPaperFilterSchema.parse({})).toEqual({
      limit: 20,
      offset: 0,
    });
    expect(() => examPaperFilterSchema.parse({ limit: 101 })).toThrow();
    expect(() => examPaperFilterSchema.parse({ year: 1899 })).toThrow();
  });

  it("accepts a student-safe summary and rejects internal archive fields", () => {
    expect(examPaperSummarySchema.parse(studentSummary)).toEqual(studentSummary);
    expect(() =>
      examPaperSummarySchema.parse({
        ...studentSummary,
        archive_entry: "自母命题试卷/上海科技大学/试卷.pdf",
      }),
    ).toThrow();
    expect(() =>
      examPaperSummarySchema.parse({
        ...studentSummary,
        pdf_sha256: "c3d34e3115ef7c7e6372f3bccdb32a99ea7fa2ff2db44d3edf7d20ecace23812",
      }),
    ).toThrow();
  });

  it("keeps official landing provenance in detail without exposing local storage", () => {
    const detail = examPaperDetailSchema.parse({
      ...studentSummary,
      landing_page_url: "https://sist.shanghaitech.edu.cn/2023/0913/page.htm",
      file_size_bytes: 794_412,
    });
    expect(detail.landing_page_url).toContain("shanghaitech.edu.cn");
    expect("storage_ref" in detail).toBe(false);
  });

  it("validates real facets and pagination", () => {
    const response = examPaperListResponseSchema.parse({
      items: [studentSummary],
      total: 67,
      limit: 20,
      offset: 0,
      facets: {
        universities: ["上海科技大学"],
        years: [2022],
        subjects: ["991数据结构与算法"],
        paper_types: ["exam"],
      },
    });
    expect(response.total).toBe(67);
  });
});

describe("exam-paper administrator contracts", () => {
  const managementRecord = {
    ...studentSummary,
    course_id: "course_408_001",
    landing_page_url: "https://sist.shanghaitech.edu.cn/2023/0913/page.htm",
    file_size_bytes: 794_412,
    pdf_sha256: "c3d34e3115ef7c7e6372f3bccdb32a99ea7fa2ff2db44d3edf7d20ecace23812",
    archive_sha256: "58bf66791d0587bc16917574c850429bf15722fd2a036ffe6779f8649939d984",
    license_status: "unverified",
    usage_scope: "local_demo_only",
    training_allowed: false,
    review_status: "unreviewed",
    reviewed_by: null,
    reviewed_at: null,
    updated_at: "2026-07-31T00:00:00.000Z",
  };

  it("requires provenance and the explicit no-training boundary", () => {
    expect(examPaperManagementRecordSchema.parse(managementRecord)).toEqual(
      managementRecord,
    );
    expect(() =>
      examPaperManagementRecordSchema.parse({
        ...managementRecord,
        training_allowed: true,
      }),
    ).toThrow();
  });

  it("validates stored-record-only governance counts", () => {
    const response = examPaperManagementResponseSchema.parse({
      items: [managementRecord],
      total: 67,
      scan_count: 35,
      text_layer_count: 32,
      license_unverified_count: 67,
      data_scope: "stored_records_only",
    });
    expect(response.scan_count + response.text_layer_count).toBe(response.total);
  });
});
