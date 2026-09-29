import { describe, expect, it } from "vitest";

import type { SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresStudentSourceCourses } from "../src/services/course-source-layer/postgres-student-source-courses.js";

function result<Row>(rows: Row[]): SqlQueryResult<Row> {
  return { rows, rowCount: rows.length };
}

describe("Postgres student source-course service", () => {
  it("builds a small chapter index and exposes only high-confidence figures", async () => {
    const statements: string[] = [];
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row>(sql: string) {
        statements.push(sql);
        if (sql.includes("AS source_title")) {
          return result([{
            course_id: "course_408_ds",
            course_slug: "data-structures",
            course_code: "CS408-DS",
            title: "数据结构",
            summary: "结构理解、算法实现与复杂度分析。",
            question_subject: "数据结构",
            source_title: "数据结构（C语言版·第2版）",
            source_edition: "第2版",
            chapter_count: "1",
            source_entry_count: "42",
            displayable_figure_count: "1",
          }]) as SqlQueryResult<Row>;
        }
        if (sql.includes("AS page_start")) {
          return result([{
            chapter: "第1章 绪论",
            ordinal: "0",
            source_entry_count: "42",
            page_start: 1,
            page_end: 28,
          }]) as SqlQueryResult<Row>;
        }
        return result([{
          entry_id: "ds_k0001",
          chapter: "第1章 绪论",
          ordinal: 0,
          title: "数据结构的基本概念",
          print_page: 1,
          keywords: ["数据结构", "逻辑结构"],
          figure_asset_id: "ds_fig_1_1",
          figure_no: "图1-1",
          figure_title: "数据结构的研究内容",
          pixel_size: { width: 960, height: 540 },
        }]) as SqlQueryResult<Row>;
      },
    };

    const service = new PostgresStudentSourceCourses(pool);
    const outline = await service.getCourseOutline("data-structures");

    expect(outline?.chapters[0]?.entries[0]?.figure).toMatchObject({
      figure_label: "图1.1",
      caption: "数据结构的研究内容",
      mime_type: "image/webp",
    });
    expect(JSON.stringify(outline)).not.toMatch(/content_text|review_status|license_status|sha256|crop_rect/);
    const entrySql = statements.find((sql) => sql.includes("figure_asset_id"));
    expect(entrySql).toMatch(/confidence\s*=\s*'high'/);
    expect(entrySql).toMatch(/image_available\s*=\s*true/);
    expect(entrySql).toMatch(/needs_human_review/);
  });

  it("does not authorize a source image without a high-confidence relation", async () => {
    let capturedSql = "";
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row>(sql: string) {
        capturedSql = sql;
        return result([]) as SqlQueryResult<Row>;
      },
    };

    const service = new PostgresStudentSourceCourses(pool);
    await expect(service.getFigureAsset("operating-systems", "os_fig_review")).resolves.toBeNull();
    expect(capturedSql).toMatch(/confidence\s*=\s*'high'/);
    expect(capturedSql).toMatch(/image_available\s*=\s*true/);
    expect(capturedSql).toMatch(/review_status\s*<>\s*'needs_human_review'/);
  });
});
