import { describe, expect, it } from "vitest";

import {
  courseCatalogResponseSchema,
  courseChapterListSchema,
  courseCoreConceptSchema,
  courseConceptFigureGuidanceSchema,
  courseFigureAssetSchema,
  courseFigureReferenceSchema,
  courseKnowledgePageSchema,
  courseQaPageSchema,
  courseReadingProgressResponseSchema,
  courseReadingProgressSchema,
  courseReadingProgressUpdateSchema,
} from "../src/index.js";

const boundary = {
  usage_scope: "local_demo_only",
  license_status: "unverified",
  provenance_status: "source_unknown_unverified",
  notice: "原始资料未提供作者、版本或授权信息，仅限本地挑战杯演示。",
} as const;

describe("408 course-content contracts", () => {
  it("exposes a nonnegative reliable-practice count without leaking association internals", () => {
    const concept = courseCoreConceptSchema.parse({
      concept_id: "co_c01_03",
      title: "体系结构与计算机组成",
      learning_objective: "区分计算机体系结构与计算机组成，并理解两者之间的实现关系。",
      prerequisite_concept_ids: [],
      key_terms: ["体系结构", "计算机组成"],
      learning_note: { kind: "reminder", text: "不要把抽象属性与具体硬件实现混为一谈。" },
      sources: [{ chunk_id: "co_chunk_k0017", print_page: 8, chunk_offset: 0 }],
      importance: "core",
      review_status: "verified",
      ordinal: 1,
      practice_question_count: 0,
      figure_guidance: { primary: null, related: [] },
    });

    expect(concept.practice_question_count).toBe(0);
    expect(() => courseCoreConceptSchema.parse({
      ...concept,
      practice_question_count: -1,
    })).toThrow();
  });

  it("keeps the four-course catalog factual and explicit about missing materials", () => {
    const result = courseCatalogResponseSchema.parse({
      courses: [
        {
          course_id: "course_408_co",
          slug: "computer-organization",
          course_code: "CS408-CO",
          title: "计算机组成原理",
          summary: "理解计算机系统中的数据表示、存储、指令与控制。",
          question_subject: "组成原理",
          display_order: 2,
          question_count: 150,
          material_status: "available",
          knowledge_chunk_count: 504,
          core_concept_count: 46,
          qa_example_count: 123,
          chapter_count: 11,
          source_boundary: boundary,
        },
        {
          course_id: "course_408_os",
          slug: "operating-systems",
          course_code: "CS408-OS",
          title: "操作系统",
          summary: "理解进程、内存、文件与并发机制。",
          question_subject: "操作系统",
          display_order: 3,
          question_count: 190,
          material_status: "pending",
          knowledge_chunk_count: 0,
          core_concept_count: 0,
          qa_example_count: 0,
          chapter_count: 0,
          source_boundary: {
            usage_scope: "local_demo_only",
            license_status: "unverified",
            provenance_status: "not_ingested",
            notice: "课程讲解资料待接入；当前仅提供题库训练。",
          },
        },
      ],
      recommended_start: {
        course_slug: "computer-organization",
        chunk_id: "co_chunk_001",
        chapter: "1 计算机系统概论",
        page: 3,
        basis: "first_available_content",
      },
      generated_at: "2026-07-28T00:00:00.000Z",
    });

    expect(result.courses[0]?.question_count).toBe(150);
    expect(result.courses[1]?.material_status).toBe("pending");
    expect(result.recommended_start?.basis).toBe("first_available_content");
  });

  it("requires traceable chapter, page, plain-text and source fields", () => {
    const chapters = courseChapterListSchema.parse({
      course_slug: "computer-organization",
      items: [
        {
          chapter: "1 计算机系统概论",
          chunk_count: 42,
          page_start: 3,
          page_end: 34,
          first_chunk_id: "co_chunk_001",
        },
      ],
    });
    const knowledge = courseKnowledgePageSchema.parse({
      course_slug: "computer-organization",
      items: [
        {
          chunk_id: "co_chunk_001",
          source_item_id: "1",
          chapter: "1 计算机系统概论",
          page: 3,
          text: "计算机系统由硬件和软件共同组成。",
          content_format: "plain_text",
          source_boundary: boundary,
        },
      ],
      total: 1,
      limit: 1,
      offset: 0,
    });
    const qa = courseQaPageSchema.parse({
      course_slug: "computer-organization",
      items: [
        {
          qa_id: "co_qa_001",
          source_item_id: "1",
          chapter: null,
          page: null,
          question: "什么是机器字长？",
          answer: "机器字长是 CPU 一次能处理的二进制位数。",
          content_format: "plain_text",
          source_boundary: boundary,
        },
      ],
      total: 1,
      limit: 1,
      offset: 0,
    });

    expect(chapters.items[0]?.page_start).toBe(3);
    expect(knowledge.items[0]?.content_format).toBe("plain_text");
    expect(qa.items[0]?.page).toBeNull();
    expect(() =>
      courseKnowledgePageSchema.parse({
        ...knowledge,
        items: [{ ...knowledge.items[0], content_format: "html" }],
      }),
    ).toThrow();
  });

  it("keeps human-verified textbook figures traceable without upgrading their license", () => {
    const asset = courseFigureAssetSchema.parse({
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
      asset_sha256: "b".repeat(64),
      storage_ref: "/course-assets/computer-organization/k0013/figure-1-1.png",
      mime_type: "image/png",
      pixel_width: 760,
      pixel_height: 245,
      verification_status: "human_verified",
      usage_scope: "local_demo_only",
      license_status: "unverified",
    });
    const reference = courseFigureReferenceSchema.parse({
      reference_id: "co_reference_k0013_1_1",
      figure_label: "图1.1",
      reference_text: "其过程如图1.1所示。",
      ordinal: 0,
      asset,
    });

    expect(reference.asset.print_page).toBe(4);
    expect(reference.asset.pdf_physical_page).toBe(11);
    expect(reference.asset.license_status).toBe("unverified");
    expect(() =>
      courseFigureReferenceSchema.parse({
        ...reference,
        figure_label: "图1.2",
      }),
    ).toThrow("Figure reference label must match its asset");
  });

  it("keeps concept figure guidance student-safe and separates primary from related figures", () => {
    const guidance = courseConceptFigureGuidanceSchema.parse({
      primary: {
        figure_label: "图1.4",
        caption: "具有三级层次结构的计算机系统",
        storage_ref: "/course-assets/computer-organization/library/figure-1-4.png",
        mime_type: "image/png",
        pixel_width: 920,
        pixel_height: 410,
      },
      related: [{
        figure_label: "图1.5",
        caption: "具有四级层次结构的计算机系统",
        storage_ref: "/course-assets/computer-organization/library/figure-1-5.png",
        mime_type: "image/png",
        pixel_width: 900,
        pixel_height: 430,
      }],
    });

    expect(guidance.primary?.figure_label).toBe("图1.4");
    expect(guidance.related).toHaveLength(1);
    expect(() =>
      courseConceptFigureGuidanceSchema.parse({
        ...guidance,
        primary: {
          ...guidance.primary,
          source_pdf_sha256: "a".repeat(64),
          print_page: 5,
          license_status: "unverified",
        },
      }),
    ).toThrow();
  });

  it("tracks one student's exact course chunk and paragraph without accepting inconsistent expansion", () => {
    const progress = courseReadingProgressSchema.parse({
      course_slug: "computer-organization",
      chapter: "1 计算机系统概论",
      chunk_id: "co_chunk_k0013",
      chunk_offset: 1,
      paragraph_index: 3,
      source_expanded: true,
      updated_at: "2026-07-28T09:00:00.000Z",
    });
    const response = courseReadingProgressResponseSchema.parse({ progress });
    const update = courseReadingProgressUpdateSchema.parse({
      chapter: progress.chapter,
      chunk_id: progress.chunk_id,
      paragraph_index: progress.paragraph_index,
      source_expanded: progress.source_expanded,
    });

    expect(response.progress?.chunk_offset).toBe(1);
    expect(update.paragraph_index).toBe(3);
    expect(courseReadingProgressResponseSchema.parse({ progress: null }).progress).toBeNull();
    expect(() =>
      courseReadingProgressUpdateSchema.parse({
        ...update,
        paragraph_index: 3,
        source_expanded: false,
      }),
    ).toThrow();
  });
});
