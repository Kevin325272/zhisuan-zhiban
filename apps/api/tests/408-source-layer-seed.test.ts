import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult } from "../src/database/client.js";
import {
  seed408SourceLayer,
} from "../src/database/seed-408-source-layer.js";
import type { CourseSourceLayer } from "../src/services/course-source-layer/408-course-source.js";

const source: CourseSourceLayer = {
  datasetId: "408-three-course-source-v1",
  archiveSha256: "a".repeat(64),
  archiveFileName: "output.zip",
  courses: [{
    courseId: "course_408_ds",
    bookId: "book_course_408_ds",
    title: "数据结构",
    courseLabel: "数据结构",
    version: "第2版",
    isbn: "978-7-302-45989-7",
    sourceFiles: ["数据结构.pdf"],
    schemaVersion: "2.1",
    generatedAt: "2026-07-31T13:04:41.000Z",
    chunks: 1,
    chapters: ["第1章"],
    figures: 1,
    figuresWithFiles: 1,
    figuresNeedsHumanReview: 0,
    chunksNeedsReview: 0,
    qualityScoreMedian: 0.9,
    licenseStatus: "unverified",
    usageBoundary: "local_demo_only",
  }],
  chunks: [{
    chunkId: "ds_k0001",
    courseId: "course_408_ds",
    sourceItemId: "ds_k0001",
    chapter: "第1章",
    title: "基础",
    printedPage: 1,
    contentType: "textbook",
    text: "原文",
    keywords: ["基础"],
    qualityScore: 0.9,
    needsReview: false,
    ordinal: 0,
  }],
  figureAssets: [{
    figureAssetId: "ds_fig_1_1",
    courseId: "course_408_ds",
    figureNo: "图1-1",
    title: "示意图",
    chapter: "第1章",
    sourceDocument: "数据结构",
    version: "第2版",
    isbn: "978-7-302-45989-7",
    printedPage: 1,
    physicalPage: 2,
    cropRect: { x: 0, y: 0, width: 1, height: 1 },
    assetSha256: "b".repeat(64),
    pngSha256: "b".repeat(64),
    webpSha256: "c".repeat(64),
    pngPath: "图像资产/图.png",
    webpPath: "图像资产/图.webp",
    sourceFile: "数据结构.pdf",
    sourcePart: "全书",
    combinedPhysicalPage: 2,
    cropCoordinateSpace: "PDF points",
    sourcePageSize: { width: 1, height: 1 },
    pixelSize: { width: 1, height: 1 },
    ocrCaption: "示意图",
    ocrConfidence: 0.95,
    ocrCorrection: "none",
    qualityChecks: { crop_valid: true },
    inkRatio: 0.2,
    reviewStatus: "machine_verified",
    licenseStatus: "unverified",
    usageBoundary: "local_demo_only",
    imageAvailable: true,
    rawMetadata: {},
  }],
  relations: [{
    sourceChunkId: "ds_k0001",
    figureAssetId: "ds_fig_1_1",
    anchor: "after_paragraph_1",
    displayRole: "inline",
    confidence: "high",
    sourceDocument: "数据结构",
    printedPage: 1,
  }],
  counts: {
    courses: 1,
    chunks: 1,
    figures: 1,
    relations: 1,
    displayableFigures: 1,
    needsHumanReviewFigures: 0,
  },
};

describe("408 source-layer PostgreSQL seed", () => {
  it("writes only isolated source-layer tables in one transaction", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };

    const result = await seed408SourceLayer({ async connect() { return client; } }, source);

    expect(result).toEqual({ datasets: 1, chunks: 1, figures: 1, relations: 1 });
    expect(statements[0]?.sql).toBe("BEGIN");
    expect(statements.at(-1)?.sql).toBe("COMMIT");
    expect(statements.some((entry) => entry.sql.includes("course_source_datasets"))).toBe(true);
    expect(statements.some((entry) => entry.sql.includes("course_source_chunks"))).toBe(true);
    expect(statements.some((entry) => entry.sql.includes("course_source_figure_assets"))).toBe(true);
    expect(statements.some((entry) => entry.sql.includes("course_source_figure_relations"))).toBe(true);
    expect(statements.every((entry) => !entry.sql.includes("course_core_concepts"))).toBe(true);
    const derivedLinkCleanup = statements.findIndex((entry) => (
      entry.sql.includes("DELETE FROM course_source_concept_figures")
    ));
    const datasetReplacement = statements.findIndex((entry) => (
      entry.sql.includes("DELETE FROM course_source_datasets")
    ));
    expect(derivedLinkCleanup).toBeGreaterThan(0);
    expect(derivedLinkCleanup).toBeLessThan(datasetReplacement);
    expect(statements[derivedLinkCleanup]?.parameters).toEqual([
      "408-three-course-source-v1_course_408_ds",
    ]);
  });
});
