import { describe, expect, it } from "vitest";

import type { SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresCourseContent } from "../src/services/course-content/postgres-course-content.js";

describe("PostgreSQL course concept figures", () => {
  it("attaches only student-safe display fields to the matching concept", async () => {
    const statements: string[] = [];
    const query: SqlQueryablePool["query"] = async <Row>(
      sql: string,
    ): Promise<SqlQueryResult<Row>> => {
      statements.push(sql);
      if (sql.includes("SELECT 1 FROM course_catalog_entries")) {
        return { rows: [{} as Row], rowCount: 1 };
      }
      if (sql.includes("SELECT m.module_id")) {
        return {
          rows: [{
            module_id: "co_m01_01",
            chapter_id: "co_ch01",
            source_chapter: "1 计算机系统概论",
            chapter_title: "计算机系统概论",
            chapter_ordinal: 1,
            module_title: "系统与机器层次",
            module_ordinal: 1,
          } as Row],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT c.concept_id, c.module_id")) {
        return {
          rows: [{
            concept_id: "co_c01_02",
            module_id: "co_m01_01",
            title: "程序翻译与机器层次",
            learning_objective: "说明程序翻译过程以及不同机器层次之间的关系。",
            learning_note_kind: "reminder",
            learning_note_text: "先区分源程序、目标程序和机器语言。",
            practice_question_count: "2",
            importance: "core",
            review_status: "verified",
            ordinal: 1,
          } as Row],
          rowCount: 1,
        };
      }
      if (sql.includes("course_concept_sources")) {
        return {
          rows: [{
            concept_id: "co_c01_02",
            chunk_id: "co_chunk_k0013",
            print_page: 4,
            ordinal: 1,
            chunk_offset: "1",
          } as Row],
          rowCount: 1,
        };
      }
      if (sql.includes("course_concept_terms")) {
        return {
          rows: [{
            concept_id: "co_c01_02",
            term_text: "机器语言",
            ordinal: 1,
          } as Row],
          rowCount: 1,
        };
      }
      if (sql.includes("course_concept_prerequisites")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("course_concept_figures")) {
        return {
          rows: [{
            concept_id: "co_c01_02",
            display_role: "primary",
            ordinal: 0,
            figure_label: "图1.1",
            caption: "计算机的解题过程",
            storage_ref: "/course-assets/computer-organization/k0013/figure-1-1.png",
            mime_type: "image/png",
            pixel_width: 760,
            pixel_height: 245,
            source_pdf_sha256: "a".repeat(64),
            license_status: "unverified",
          } as Row],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    const pool: SqlQueryablePool = {
      query,
      connect: async () => {
        throw new Error("connect is not used by this service test");
      },
    };
    const service = new PostgresCourseContent(
      pool,
      () => new Date("2026-07-28T00:00:00.000Z"),
    );

    const result = await service.getCurriculumMap("computer-organization");
    const guidance = result.chapters[0]?.modules[0]?.concepts[0]?.figure_guidance;

    expect(guidance?.primary).toEqual({
      figure_label: "图1.1",
      caption: "计算机的解题过程",
      storage_ref: "/course-assets/computer-organization/k0013/figure-1-1.png",
      mime_type: "image/png",
      pixel_width: 760,
      pixel_height: 245,
    });
    expect(guidance?.related).toEqual([]);
    expect(result.chapters[0]?.modules[0]?.concepts[0]?.practice_question_count).toBe(2);
    expect(JSON.stringify(guidance)).not.toContain("source_pdf_sha256");
    expect(JSON.stringify(guidance)).not.toContain("license_status");
    expect(statements.some((sql) => sql.includes("course_concept_figures"))).toBe(true);
    expect(statements.some((sql) => sql.includes("course_concept_question_links"))).toBe(true);
  });
});
