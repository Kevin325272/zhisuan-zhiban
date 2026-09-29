import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildExamPaperSource,
  type ExamPaperArchiveEntry,
} from "../src/services/exam-papers/exam-paper-source.js";

const pdf = Buffer.from("%PDF-1.4\nverified local test fixture\n", "utf8");
const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
const archiveSha256 =
  "58bf66791d0587bc16917574c850429bf15722fd2a036ffe6779f8649939d984";

function entry(path: string, content = pdf): ExamPaperArchiveEntry {
  return {
    path,
    uncompressedSize: content.byteLength,
    async read() {
      return content;
    },
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    university: "上海科技大学",
    year: 2022,
    subject: "991数据结构与算法",
    paper_type: "试题",
    path: "上海科技大学/2022年/991数据结构与算法/试卷.pdf",
    url: "https://sist.shanghaitech.edu.cn/paper.pdf",
    landing_url: "https://sist.shanghaitech.edu.cn/paper/index.htm",
    source_member: null,
    status: "已存在",
    training_allowed: false,
    pages: 6,
    bytes: pdf.byteLength,
    sha256: pdfSha256,
    han_chars_sample: 1_314,
    language_check: "中文文本通过",
    ...overrides,
  };
}

function manifest(records = [record()]) {
  return {
    generated_at: "2026-07-30T00:00:00+08:00",
    scope: "公开高校自命题试卷",
    directory_rule: "学校/年份/科目/文件",
    notice: "公开下载不等于允许模型训练；所有记录 training_allowed=false，仅用于个人学习和检索。",
    counts: {
      pdfs: records.length,
      pages: records.reduce((sum, item) => sum + Number(item.pages), 0),
      bytes: records.reduce((sum, item) => sum + Number(item.bytes), 0),
      by_school: {},
      by_year: {},
      by_subject: {},
    },
    source_pages: [],
    records,
    failures: [],
  };
}

describe("self-authored exam archive source", () => {
  it("maps an exact PDF entry and derives a stable student-safe record", async () => {
    const source = await buildExamPaperSource({
      archiveSha256,
      manifest: manifest(),
      manifestEntryPath: "自母命题试卷/来源与下载记录.json",
      entries: [
        entry("自母命题试卷/来源与下载记录.json", Buffer.from("{}")),
        entry("自母命题试卷/上海科技大学/2022年/991数据结构与算法/试卷.pdf"),
      ],
    });

    expect(source.records).toEqual([
      expect.objectContaining({
        examPaperId: `exam_${pdfSha256.slice(0, 24)}`,
        archiveEntry:
          "自母命题试卷/上海科技大学/2022年/991数据结构与算法/试卷.pdf",
        paperType: "exam",
        contentMode: "text_layer",
        trainingAllowed: false,
        licenseStatus: "unverified",
        usageScope: "local_demo_only",
      }),
    ]);
  });

  it("normalizes a verified scan and a sample-paper label", async () => {
    const scanRecord = record({
      paper_type: "样题",
      language_check: "官网扫描件/低文本量，已通过页面渲染",
    });
    const source = await buildExamPaperSource({
      archiveSha256,
      manifest: manifest([scanRecord]),
      manifestEntryPath: "自母命题试卷/来源与下载记录.json",
      entries: [
        entry("自母命题试卷/上海科技大学/2022年/991数据结构与算法/试卷.pdf"),
      ],
    });
    expect(source.records[0]).toMatchObject({
      paperType: "sample",
      contentMode: "scan",
    });
  });

  it("rejects unsafe record paths before matching entries", async () => {
    await expect(
      buildExamPaperSource({
        archiveSha256,
        manifest: manifest([record({ path: "../outside.pdf" })]),
        manifestEntryPath: "自母命题试卷/来源与下载记录.json",
        entries: [entry("outside.pdf")],
      }),
    ).rejects.toThrow("unsafe");
  });

  it("rejects duplicate archive entry names", async () => {
    const path = "自母命题试卷/上海科技大学/2022年/991数据结构与算法/试卷.pdf";
    await expect(
      buildExamPaperSource({
        archiveSha256,
        manifest: manifest(),
        manifestEntryPath: "自母命题试卷/来源与下载记录.json",
        entries: [entry(path), entry(path)],
      }),
    ).rejects.toThrow("duplicate");
  });

  it("rejects any record that permits model training", async () => {
    await expect(
      buildExamPaperSource({
        archiveSha256,
        manifest: manifest([record({ training_allowed: true })]),
        manifestEntryPath: "自母命题试卷/来源与下载记录.json",
        entries: [
          entry("自母命题试卷/上海科技大学/2022年/991数据结构与算法/试卷.pdf"),
        ],
      }),
    ).rejects.toThrow("training_allowed");
  });

  it("rejects a PDF whose verified hash does not match the source record", async () => {
    await expect(
      buildExamPaperSource({
        archiveSha256,
        manifest: manifest([
          record({
            sha256: "0".repeat(64),
          }),
        ]),
        manifestEntryPath: "自母命题试卷/来源与下载记录.json",
        entries: [
          entry("自母命题试卷/上海科技大学/2022年/991数据结构与算法/试卷.pdf"),
        ],
      }),
    ).rejects.toThrow("SHA256");
  });
});
