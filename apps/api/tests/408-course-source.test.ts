import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  build408CourseSource,
  type CourseSourceArchiveEntry,
} from "../src/services/course-source-layer/408-course-source.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8ioAAAAASUVORK5CYII=",
  "base64",
);
const webp = Buffer.from("RIFF\x04\x00\x00\x00WEBP", "binary");

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function entry(path: string, value: Buffer | string): CourseSourceArchiveEntry {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return { path, uncompressedSize: bytes.length, read: async () => bytes };
}

const imagePath = (course: string) =>
  `图像资产/所有图片/${course}/第1章/图1-1_示意图.png`;
const webpPath = (course: string) =>
  `图像资产/所有图片/${course}/第1章/图1-1_示意图.webp`;

function courseJson(courseId: string, title: string, chunkId: string, assetId: string) {
  return JSON.stringify({
    schema_version: "2.1",
    generated_at: "2026-07-31T21:04:41+08:00",
    book: {
      book_id: `book_${courseId}`,
      title,
      course: title,
      course_id: courseId,
      version: "第1版",
      isbn: "978-7-000-00000-0",
      language: "zh-CN",
      source_files: [`${title}.pdf`],
      license_status: "unverified",
      usage_boundary: "local_demo_only",
    },
    data_contract: {
      primary_text: "chunks[*].text",
      retrieval_id: "chunks[*].chunk_id",
      image_marker: "{{figure:figure_asset_id}}",
      recommended_text_filter: "quality_score >= 0.65 and needs_review == false",
      recommended_image_filter: "review_status in ['machine_verified', 'human_verified']",
    },
    statistics: { chunks: 1, characters: 10, figures: 1, chunks_needing_review: 0 },
    chunks: [{
      chunk_id: chunkId,
      chapter: "第1章",
      title: "基础概念",
      printed_page: 1,
      content_type: "textbook",
      text: `课程原文。{{figure:${assetId}}}`,
      keywords: ["基础"],
      figures: [{
        figure_asset_id: assetId,
        figure_no: "图1-1",
        title: "示意图",
        image: imagePath(title),
        fallback_png: imagePath(title),
        review_status: "machine_verified",
      }],
      quality_score: 0.9,
      needs_review: false,
    }],
  });
}

function assetJson(courseId: string, title: string, assetId: string, reviewStatus = "machine_verified") {
  const available = reviewStatus === "machine_verified";
  const p = imagePath(title);
  const w = webpPath(title);
  return {
    figure_asset_id: assetId,
    figure_no: "图1-1",
    title: "示意图",
    course_id: courseId,
    chapter: "第1章",
    source_document: title,
    version: "第1版",
    isbn: "978-7-000-00000-0",
    printed_page: 1,
    physical_page: 2,
    crop_rect: { x: 0, y: 0, width: 1, height: 1 },
    sha256: sha256(png),
    review_status: reviewStatus,
    license_status: "unverified",
    usage_boundary: "local_demo_only",
    source_file: `${title}.pdf`,
    source_part: "全书",
    combined_physical_page: 2,
    crop_coordinate_space: "PDF points, top-left origin",
    source_page_size: { width: 1, height: 1 },
    png_path: p,
    webp_path: w,
    webp_sha256: sha256(webp),
    pixel_size: { width: 1, height: 1 },
    ocr_caption: "示意图",
    ocr_confidence: 0.95,
    ocr_correction: "none",
    quality_checks: { crop_valid: available },
    ink_ratio: 0.2,
  };
}

function relation(chunkId: string, assetId: string, title: string) {
  return {
    source_chunk_id: chunkId,
    figure_asset_id: assetId,
    anchor: "after_paragraph_1",
    display_role: "inline",
    confidence: "high",
    source_document: title,
    printed_page: 1,
  };
}

function packageEntries(options: { reviewMissing?: boolean; dangling?: boolean } = {}) {
  const books = [
    ["course_408_ds", "数据结构", "ds_k0001", "ds_fig_1_1"],
    ["course_408_os", "操作系统", "os_k0001", "os_fig_1_1"],
    ["course_408_cn", "计算机网络", "cn_k0001", "cn_fig_1_1"],
  ] as const;
  const entries: CourseSourceArchiveEntry[] = [];
  const assets: unknown[] = [];
  const relations: unknown[] = [];
  for (const [courseId, title, chunkId, assetId] of books) {
    entries.push(entry(`output/json/408课本清洗数据/${title}.json`, courseJson(courseId, title, chunkId, assetId)));
    const reviewStatus = options.reviewMissing && courseId === "course_408_os"
      ? "needs_human_review"
      : "machine_verified";
    assets.push(assetJson(courseId, title, assetId, reviewStatus));
    relations.push(relation(chunkId, assetId, title));
    if (reviewStatus === "machine_verified") {
      entries.push(entry(`output/pdf/408课本插图资产/${imagePath(title)}`, png));
      entries.push(entry(`output/pdf/408课本插图资产/${webpPath(title)}`, webp));
    }
  }
  if (options.dangling) {
    relations.push(relation("ds_k0001", "missing_asset", "数据结构"));
  }
  entries.push(entry(
    "output/pdf/408课本插图资产/插图信息/插图资产清单.json",
    JSON.stringify({ schema_version: "1.0", generated_at: "2026-07-31T21:04:41+08:00", visibility: "backend_only", assets }),
  ));
  entries.push(entry(
    "output/pdf/408课本插图资产/插图信息/正文插图关联.json",
    JSON.stringify({ schema_version: "1.0", generated_at: "2026-07-31T21:04:41+08:00", relations }),
  ));
  return entries;
}

describe("408 three-course source archive adapter", () => {
  it("normalizes the three courses and gates unavailable figures", async () => {
    const source = await build408CourseSource({
      archiveSha256: "a".repeat(64),
      archiveFileName: "output.zip",
      entries: packageEntries({ reviewMissing: true }),
    });

    expect(source.courses.map((course) => course.courseId)).toEqual([
      "course_408_ds",
      "course_408_os",
      "course_408_cn",
    ]);
    expect(source.counts).toMatchObject({ courses: 3, chunks: 3, figures: 3, relations: 3, displayableFigures: 2, needsHumanReviewFigures: 1 });
    expect(source.figureAssets.find((asset) => asset.figureAssetId === "os_fig_1_1")?.imageAvailable).toBe(false);
  });

  it("rejects unsafe archive paths before parsing data", async () => {
    await expect(build408CourseSource({
      archiveSha256: "a".repeat(64),
      archiveFileName: "output.zip",
      entries: [...packageEntries(), entry("output/../escape.txt", "bad")],
    })).rejects.toThrow(/unsafe/i);
  });

  it("rejects a dangling chunk-to-figure relation", async () => {
    await expect(build408CourseSource({
      archiveSha256: "a".repeat(64),
      archiveFileName: "output.zip",
      entries: packageEntries({ dangling: true }),
    })).rejects.toThrow(/unknown figure|relation/i);
  });

  it("rejects a machine-verified figure whose files are missing", async () => {
    const entries = packageEntries();
    const withoutImages = entries.filter((item) => !item.path.endsWith("图1-1_示意图.png") && !item.path.endsWith("图1-1_示意图.webp"));
    await expect(build408CourseSource({
      archiveSha256: "a".repeat(64),
      archiveFileName: "output.zip",
      entries: withoutImages,
    })).rejects.toThrow(/machine-verified|image/i);
  });
});
