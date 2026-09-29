import { describe, expect, it } from "vitest";

import { courseCurriculumMapSchema } from "../src/index.js";

describe("data structures curriculum student contract", () => {
  it("allows concise learning content and a source-course webp figure URL", () => {
    const parsed = courseCurriculumMapSchema.parse({
      course_id: "course_408_ds",
      course_slug: "data-structures",
      title: "课程知识地图",
      curation_method: "source_constrained_course_design",
      chapters: [{
        chapter_id: "ds_ch01",
        source_chapter: "第1章绪论",
        title: "绪论",
        ordinal: 1,
        modules: [{
          module_id: "ds_m01_01",
          title: "数据结构基础",
          ordinal: 1,
          concepts: [{
            concept_id: "ds_c01_01",
            title: "数据与数据元素",
            learning_objective: "理解数据在程序中的表示形式，并区分数据元素与数据项。",
            prerequisite_concept_ids: [],
            key_terms: ["数据", "数据元素"],
            learning_note: { kind: "reminder", text: "先明确对象，再选择组织方式。" },
            learning_content: {
              explanation: ["数据是信息在程序中的表示形式。"],
              case_prompt: "把学生名册拆成数据元素和数据项。",
              practice_tags: ["数据结构", "基本术语"],
            },
            sources: [{ chunk_id: "ds_k0002", print_page: 2, chunk_offset: 0 }],
            importance: "core",
            review_status: "verified",
            ordinal: 1,
            figure_guidance: {
              primary: {
                figure_label: "图1.3",
                caption: "逻辑结构与存储结构间的关系",
                storage_ref: "/api/v1/408/courses/data-structures/source-figures/ds_v2_fig_1_3",
                mime_type: "image/webp",
                pixel_width: 640,
                pixel_height: 320,
              },
              related: [],
            },
          }],
        }],
      }],
      concept_count: 1,
      traceability: { source_reference_count: 1, valid_source_reference_count: 1, rate: 1 },
      generated_at: "2026-08-02T00:00:00.000Z",
    });

    expect(parsed.chapters[0]!.modules[0]!.concepts[0]!.learning_content?.case_prompt)
      .toContain("学生名册");
  });
});
