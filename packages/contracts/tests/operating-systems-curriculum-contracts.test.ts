import { describe, expect, it } from "vitest";

import { courseCurriculumMapSchema } from "../src/index.js";

describe("operating systems curriculum contract", () => {
  it("accepts the same student-safe curriculum DTO shape as the accepted course sample", () => {
    const result = courseCurriculumMapSchema.parse({
      course_id: "course_408_os",
      course_slug: "operating-systems",
      title: "课程知识地图",
      curation_method: "source_constrained_course_design",
      chapters: [{
        chapter_id: "os_ch01",
        source_chapter: "第1章",
        title: "操作系统引论",
        ordinal: 1,
        modules: [{
          module_id: "os_m01_01",
          title: "系统角色",
          ordinal: 1,
          concepts: [{
            concept_id: "os_c01_01",
            title: "操作系统的作用",
            learning_objective: "理解操作系统如何向应用提供受保护的系统服务。",
            prerequisite_concept_ids: [],
            key_terms: ["系统调用", "资源管理"],
            learning_note: { kind: "reminder", text: "先区分用户程序与系统服务的边界。" },
            learning_content: {
              explanation: ["操作系统把硬件资源组织为可调用的服务。"],
              case_prompt: "把一个文件读取请求拆成应用、系统调用和设备处理三步。",
              practice_tags: ["系统调用"],
            },
            sources: [{ chunk_id: "os_k0002", print_page: 2, chunk_offset: 0 }],
            importance: "core",
            review_status: "verified",
            ordinal: 1,
            figure_guidance: {
              primary: {
                figure_label: "图1.5",
                caption: "单道程序的运行情况",
                storage_ref: "/api/v1/408/courses/operating-systems/source-figures/os_v4_fig_1_5",
                mime_type: "image/webp",
                pixel_width: 100,
                pixel_height: 80,
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

    expect(result.course_slug).toBe("operating-systems");
    expect(result.chapters[0]!.modules[0]!.concepts[0]!.figure_guidance.primary?.storage_ref)
      .toContain("operating-systems/source-figures");
  });
});
