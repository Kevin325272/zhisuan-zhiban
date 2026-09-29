import { describe, expect, it } from "vitest";

import type { SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresCourseContent } from "../src/services/course-content/postgres-course-content.js";

describe("PostgreSQL course-reading progress", () => {
  it("reads a user-scoped position and derives its chapter offset", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const query: SqlQueryablePool["query"] = async <Row>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<SqlQueryResult<Row>> => {
      statements.push({ sql, ...(parameters ? { parameters } : {}) });
      return {
        rows: [{
          course_slug: "computer-organization",
          chapter: "1 计算机系统概论",
          chunk_id: "co_chunk_k0013",
          chunk_offset: "1",
          paragraph_index: 3,
          source_expanded: true,
          updated_at: "2026-07-28T09:00:00.000Z",
        } as Row],
        rowCount: 1,
      };
    };
    const pool: SqlQueryablePool = {
      query,
      connect: async () => { throw new Error("connect is not used by this service test"); },
    };
    const service = new PostgresCourseContent(pool);

    const result = await service.getReadingProgress(
      "user_student_001",
      "computer-organization",
    );

    expect(result.progress).toMatchObject({
      course_slug: "computer-organization",
      chunk_id: "co_chunk_k0013",
      chunk_offset: 1,
      paragraph_index: 3,
    });
    expect(statements[0]?.parameters).toEqual([
      "user_student_001",
      "computer-organization",
    ]);
  });

  it("upserts only when the chunk belongs to the requested course and chapter", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const query: SqlQueryablePool["query"] = async <Row>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<SqlQueryResult<Row>> => {
      statements.push({ sql, ...(parameters ? { parameters } : {}) });
      if (sql.includes("INSERT INTO course_reading_progress")) {
        return { rows: [], rowCount: 1 };
      }
      return {
        rows: [{
          course_slug: "computer-organization",
          chapter: "1 计算机系统概论",
          chunk_id: "co_chunk_k0013",
          chunk_offset: "1",
          paragraph_index: 4,
          source_expanded: true,
          updated_at: "2026-07-28T09:01:00.000Z",
        } as Row],
        rowCount: 1,
      };
    };
    const pool: SqlQueryablePool = {
      query,
      connect: async () => { throw new Error("connect is not used by this service test"); },
    };
    const service = new PostgresCourseContent(pool);

    const result = await service.saveReadingProgress(
      "user_student_001",
      "computer-organization",
      {
        chapter: "1 计算机系统概论",
        chunk_id: "co_chunk_k0013",
        paragraph_index: 4,
        source_expanded: true,
      },
    );

    expect(result.paragraph_index).toBe(4);
    expect(statements[0]?.sql).toContain("INSERT INTO course_reading_progress");
    expect(statements[0]?.sql).toContain("INSERT INTO course_reading_history");
    expect(statements[0]?.sql).toContain("ON CONFLICT (user_id, course_id, chunk_id)");
    expect(statements[0]?.sql).toContain("k.course_id = e.course_id");
    expect(statements[0]?.sql).toContain("k.chapter = $4");
    expect(statements[0]?.parameters).toEqual([
      "user_student_001",
      "computer-organization",
      "co_chunk_k0013",
      "1 计算机系统概论",
      4,
      true,
    ]);
  });
});
