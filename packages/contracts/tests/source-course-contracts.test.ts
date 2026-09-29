import { describe, expect, it } from "vitest";

import { sourceCourseOutlineSchema } from "../src/index.js";

const outline = {
  course_id: "course_408_ds",
  course_slug: "data-structures",
  course_code: "CS408-DS",
  title: "数据结构",
  summary: "结构理解、算法实现与复杂度分析。",
  question_subject: "数据结构",
  source_title: "数据结构（C语言版·第2版）",
  source_edition: "第2版",
  curriculum_status: "source_structure_available_curriculum_pending",
  notice: "课程结构已接入，讲解内容待课程化整理。",
  chapter_count: 8,
  source_entry_count: 406,
  displayable_figure_count: 219,
  chapters: [
    {
      chapter: "第1章 绪论",
      ordinal: 0,
      source_entry_count: 42,
      page_start: 1,
      page_end: 28,
      entries: [
        {
          entry_id: "ds_k0001",
          title: "数据结构的基本概念",
          print_page: 1,
          keywords: ["数据结构", "逻辑结构"],
          figure: {
            figure_label: "图1.1",
            caption: "数据结构的研究内容",
            image_url: "/api/v1/408/courses/data-structures/source-figures/ds_fig_1_1",
            mime_type: "image/webp",
            pixel_width: 960,
            pixel_height: 540,
          },
        },
      ],
    },
  ],
} as const;

describe("student source-course contracts", () => {
  it("accepts a traceable course structure without exposing raw OCR text", () => {
    const parsed = sourceCourseOutlineSchema.parse(outline);

    expect(parsed.chapters[0]?.entries[0]?.figure?.figure_label).toBe("图1.1");
    expect(JSON.stringify(parsed)).not.toContain("content_text");
  });

  it.each([
    ["content_text", "OCR 原文"],
    ["raw_metadata", { crop: true }],
    ["review_status", "machine_verified"],
    ["license_status", "unverified"],
    ["asset_sha256", "a".repeat(64)],
    ["crop_rect", { x: 0, y: 0, width: 10, height: 10 }],
  ])("rejects internal field %s from the student figure DTO", (field, value) => {
    expect(() => sourceCourseOutlineSchema.parse({
      ...outline,
      chapters: [{
        ...outline.chapters[0],
        entries: [{
          ...outline.chapters[0].entries[0],
          figure: {
            ...outline.chapters[0].entries[0].figure,
            [field]: value,
          },
        }],
      }],
    })).toThrow();
  });
});
