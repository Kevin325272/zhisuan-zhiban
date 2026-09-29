import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult } from "../src/database/client.js";
import { seedCourseContent } from "../src/database/seed-course-content.js";
import {
  CourseContentSourceError,
  loadCourseContentSource,
} from "../src/services/course-content/course-content-source.js";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("computer-organization source import", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createSource() {
    const root = mkdtempSync(join(tmpdir(), "xuetu-course-source-"));
    directories.push(root);
    const raw = join(root, "raw");
    const assetRoot = join(root, "assets");
    const assets = join(assetRoot, "k0013");
    const curated = join(root, "curated");
    mkdirSync(raw);
    mkdirSync(assets, { recursive: true });
    mkdirSync(curated);
    const figurePng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8ioAAAAASUVORK5CYII=",
      "base64",
    );
    writeFileSync(join(assets, "figure-1-1.png"), figurePng);
    const figures = JSON.stringify([
      {
        asset_id: "co_figure_1_1",
        figure_label: "图1.1",
        caption: "计算机的解题过程",
        textbook_title: "计算机组成原理",
        author_name: "唐朔飞",
        edition: "第3版",
        publisher: "高等教育出版社",
        publication_year: 2020,
        isbn: "978-7-04-054518-0",
        print_page: 4,
        pdf_physical_page: 11,
        source_pdf_sha256: "a".repeat(64),
        original_path: "C:\\demo\\计算机组成原理第3版 唐朔飞.pdf",
        file: "k0013/figure-1-1.png",
        sha256: createHash("sha256").update(figurePng).digest("hex"),
        storage_ref: "/course-assets/computer-organization/k0013/figure-1-1.png",
        mime_type: "image/png",
        pixel_width: 1,
        pixel_height: 1,
        crop_box_pixels: { render_dpi: 200, x: 0, y: 0, width: 1, height: 1 },
        chapter: "1 计算机系统概论",
        tags: ["1 计算机系统概论", "计算机系统"],
        extraction_status: "displayable",
        extraction_method: "manual_pdf_crop",
        extraction_confidence: 1,
        verification_status: "human_verified",
        usage_scope: "local_demo_only",
        license_status: "unverified",
        reference: {
          reference_id: "co_reference_1_1",
          source_item_id: "1",
          reference_text: "图1.1",
          ordinal: 0,
        },
      },
    ]);
    const figureCatalog = JSON.stringify([
      {
        catalog_id: "co_catalog_1_1",
        figure_label: "图1.1",
        caption: "计算机的解题过程",
        chapter: "1 计算机系统概论",
        print_page: 4,
        pdf_physical_page: 11,
        source_pdf_sha256: "a".repeat(64),
        tags: ["1 计算机系统概论", "计算机系统"],
        extraction_status: "displayable",
        extraction_confidence: 1,
        crop_box_pixels: { render_dpi: 200, x: 0, y: 0, width: 1, height: 1 },
        verification_status: "human_verified",
        usage_scope: "local_demo_only",
        license_status: "unverified",
        asset_id: "co_figure_1_1",
        candidate_print_pages: [4],
      },
    ]);
    const conceptFigureLinks = JSON.stringify([
      {
        link_id: "co_link_co_c01_01_1_1",
        concept_id: "co_c01_01",
        asset_id: "co_figure_1_1",
        figure_label: "图1.1",
        display_role: "primary",
        match_method: "direct_reference",
        match_confidence: 1,
        source_chunk_ids: ["co_chunk_1"],
        evidence_text: "co_chunk_1 directly references 图1.1",
        display_enabled: true,
        ordinal: 0,
      },
    ]);
    const chapterNames = [
      "1 计算机系统概论",
      "2 计算机的发展及应用",
      "3 系统总线",
      "4 存储器",
      "5 输入输出系统",
      "6 计算机的运算方法",
      "7 指令系统",
      "8 CPU的结构和功能",
      "9 控制单元的功能",
      "10 控制单元的设计",
    ];
    const knowledgeRecords = chapterNames.flatMap((chapter, chapterIndex) =>
      Array.from({ length: 3 }, (_, conceptIndex) => {
        const sourceId = chapterIndex * 3 + conceptIndex + 1;
        return {
          id: sourceId,
          chapter,
          page: chapterIndex * 10 + conceptIndex + 4,
          text: sourceId === 1
            ? "<L/1 是公式文本，不是 HTML。图1.1"
            : `${chapter}的可追溯课程原文 ${conceptIndex + 1}。`,
        };
      }),
    );
    const curriculumMap = {
      schema_version: "1.0",
      course_id: "course_408_co",
      course_slug: "computer-organization",
      title: "课程知识地图",
      curation_method: "source_constrained_course_design",
      chapters: chapterNames.map((chapter, chapterIndex) => ({
        chapter_id: `co_ch${String(chapterIndex + 1).padStart(2, "0")}`,
        source_chapter: chapter,
        title: chapter.replace(/^\d+\s*/u, ""),
        ordinal: chapterIndex + 1,
        modules: [{
          module_id: `co_m${String(chapterIndex + 1).padStart(2, "0")}_01`,
          title: `${chapter.replace(/^\d+\s*/u, "")}基础`,
          ordinal: 1,
          concepts: Array.from({ length: 3 }, (_, conceptIndex) => {
            const sourceId = chapterIndex * 3 + conceptIndex + 1;
            return {
              concept_id:
                `co_c${String(chapterIndex + 1).padStart(2, "0")}_${String(conceptIndex + 1).padStart(2, "0")}`,
              title: `${chapter.replace(/^\d+\s*/u, "")}核心概念${conceptIndex + 1}`,
              learning_objective: `能够说明${chapter}中第${conceptIndex + 1}个核心概念的基本作用。`,
              prerequisite_concept_ids: [],
              key_terms: [`术语${conceptIndex + 1}`],
              learning_note: {
                kind: "reminder",
                text: "按课程原文理解，不把图号或 OCR 残片当作概念。",
              },
              sources: [{
                chunk_id: `co_chunk_${sourceId}`,
                print_page: chapterIndex * 10 + conceptIndex + 4,
              }],
              importance: "core",
              review_status: "verified",
              ordinal: conceptIndex + 1,
            };
          }),
        }],
      })),
    };
    const files = {
      knowledge: JSON.stringify(knowledgeRecords),
      qa: JSON.stringify([
        { id: 1, question: "什么是机器字长？", answer: "CPU 一次能处理的二进制位数。" },
      ]),
      training: JSON.stringify([
        { messages: [{ role: "user", content: "提问" }, { role: "assistant", content: "回答" }] },
      ]),
      figure_assets: figures,
      figure_catalog: figureCatalog,
      concept_figure_links: conceptFigureLinks,
      curriculum_map: JSON.stringify(curriculumMap),
    };
    for (const [name, value] of Object.entries(files).filter(
      ([name]) => name !== "figure_assets",
    )) {
      writeFileSync(join(raw, `${name}.json`), value, "utf8");
    }
    writeFileSync(join(assetRoot, "figure-assets.json"), files.figure_assets, "utf8");
    writeFileSync(join(assetRoot, "figure-catalog.json"), files.figure_catalog, "utf8");
    writeFileSync(
      join(assetRoot, "concept-figure-links.json"),
      files.concept_figure_links,
      "utf8",
    );
    writeFileSync(join(curated, "curriculum-map.json"), files.curriculum_map, "utf8");
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({
        dataset_id: "computer_organization_local_materials_v1",
        course_slug: "computer-organization",
        course_id: "course_408_co",
        original_directory: "C:\\Users\\Administrator\\Desktop\\挑战杯\\课程资料",
        license_status: "unverified",
        usage_scope: "local_demo_only",
        provenance_status: "source_unknown_unverified",
        files: {
          knowledge: { file: "knowledge.json", sha256: sha256(files.knowledge), record_count: 30 },
          qa: { file: "qa.json", sha256: sha256(files.qa), record_count: 1 },
          training: {
            file: "training.json",
            sha256: sha256(files.training),
            record_count: 1,
            usage: "reference_only_not_model_training",
          },
          figure_assets: {
            file: "figure-assets.json",
            sha256: sha256(files.figure_assets),
            record_count: 1,
          },
          figure_catalog: {
            file: "figure-catalog.json",
            sha256: sha256(files.figure_catalog),
            record_count: 1,
          },
          concept_figure_links: {
            file: "concept-figure-links.json",
            sha256: sha256(files.concept_figure_links),
            record_count: 1,
          },
          curriculum_map: {
            file: "curriculum-map.json",
            sha256: sha256(files.curriculum_map),
            record_count: 30,
          },
        },
      }),
      "utf8",
    );
    return root;
  }

  it("validates hashes and keeps mathematical angle brackets as plain text", () => {
    const source = loadCourseContentSource(createSource());

    expect(source.knowledge).toHaveLength(30);
    expect(source.knowledge[0]?.text).toContain("<L/1");
    expect(source.qa).toHaveLength(1);
    expect(source.figureAssets).toHaveLength(1);
    expect(source.figureAssets[0]?.reference.source_item_id).toBe("1");
    expect(source.figureCatalog).toHaveLength(1);
    expect(source.conceptFigureLinks[0]?.display_role).toBe("primary");
    expect(source.curriculumMap.chapters).toHaveLength(10);
    expect(source.trainingCount).toBe(1);
    expect(source.trainingUsage).toBe("reference_only_not_model_training");
  });

  it("validates the production curriculum map against exact raw chunks and pages", () => {
    const productionRoot = fileURLToPath(
      new URL("../../../data/course-materials/computer-organization/", import.meta.url),
    );
    const source = loadCourseContentSource(productionRoot);
    const concepts = source.curriculumMap.chapters.flatMap((chapter) =>
      chapter.modules.flatMap((module) => module.concepts),
    );
    const references = concepts.flatMap((concept) => concept.sources);

    expect(source.curriculumMap.chapters).toHaveLength(10);
    expect(concepts.length).toBeGreaterThanOrEqual(30);
    expect(concepts.length).toBeLessThanOrEqual(50);
    expect(references.length).toBeGreaterThanOrEqual(concepts.length);
    expect(source.curriculumMap.chapters.map((chapter) => chapter.source_chapter)).not.toContain(
      "前言、目录或参考资料",
    );
    expect(concepts.some((concept) => /^图\d+\.\d+$/u.test(concept.title))).toBe(false);
    expect(concepts.every((concept) => concept.sources.length > 0)).toBe(true);
  });

  it("rejects hash drift and malformed training pairs", () => {
    const root = createSource();
    writeFileSync(join(root, "raw", "qa.json"), "[]", "utf8");
    expect(() => loadCourseContentSource(root)).toThrow(CourseContentSourceError);

    const malformed = createSource();
    const training = JSON.stringify([{ messages: [{ role: "user", content: "缺少回答" }] }]);
    writeFileSync(join(malformed, "raw", "training.json"), training, "utf8");
    const manifestPath = join(malformed, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files.training.sha256 = sha256(training);
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    expect(() => loadCourseContentSource(malformed)).toThrow("training.json");
  });

  it("upserts traceable sources, chunks and examples in one transaction", async () => {
    const source = loadCourseContentSource(createSource());
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        return { rows: [], rowCount: 1 };
      },
      release() { statements.push({ sql: "RELEASE" }); },
    };

    const result = await seedCourseContent(
      { async connect() { return client; } },
      source,
      () => new Date("2026-07-28T00:00:00.000Z"),
    );

    expect(result).toEqual({
      sources: 4,
      knowledgeChunks: 30,
      qaExamples: 1,
      trainingRecords: 1,
      figureAssets: 1,
      figureReferences: 1,
      figureCatalogEntries: 1,
      conceptFigureLinks: 1,
      curriculumModules: 10,
      curriculumConcepts: 30,
      curriculumSourceReferences: 30,
    });
    expect(statements.map((entry) => entry.sql)).toEqual(expect.arrayContaining([
      "BEGIN",
      expect.stringContaining("INSERT INTO course_content_sources"),
      expect.stringContaining("INSERT INTO course_content_chunks"),
      expect.stringContaining("INSERT INTO course_qa_examples"),
      expect.stringContaining("DELETE FROM course_figure_assets"),
      expect.stringContaining("INSERT INTO course_figure_assets"),
      expect.stringContaining("INSERT INTO course_figure_references"),
      expect.stringContaining("INSERT INTO course_figure_catalog_entries"),
      expect.stringContaining("INSERT INTO course_concept_figures"),
      expect.stringContaining("INSERT INTO course_learning_modules"),
      expect.stringContaining("INSERT INTO course_core_concepts"),
      expect.stringContaining("INSERT INTO course_concept_sources"),
      expect.stringContaining("UPDATE course_catalog_entries"),
      "COMMIT",
      "RELEASE",
    ]));
    expect(JSON.stringify(statements)).toContain("reference_only_not_model_training");

    const sqlSequence = statements.map((entry) => entry.sql);
    const conceptFigureCleanupIndex = sqlSequence.findIndex((sql) =>
      sql.includes("DELETE FROM course_concept_figures"),
    );
    const catalogCleanupIndex = sqlSequence.findIndex((sql) =>
      sql.includes("DELETE FROM course_figure_catalog_entries"),
    );
    const assetCleanupIndex = sqlSequence.findIndex((sql) =>
      sql.includes("DELETE FROM course_figure_assets"),
    );

    expect(conceptFigureCleanupIndex).toBeGreaterThan(-1);
    expect(catalogCleanupIndex).toBeGreaterThan(-1);
    expect(assetCleanupIndex).toBeGreaterThan(-1);
    expect(conceptFigureCleanupIndex).toBeLessThan(assetCleanupIndex);
    expect(catalogCleanupIndex).toBeLessThan(assetCleanupIndex);
  });
});
