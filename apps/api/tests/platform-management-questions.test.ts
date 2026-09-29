import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryablePool } from "../src/database/client.js";
import { PostgresManagementService } from "../src/services/platform-management.js";

describe("PostgresManagementService question governance", () => {
  it("preserves a null exam year for self-authored questions", async () => {
    const pool = {
      async query<Row>() {
        return {
          rowCount: 1,
          rows: [{
            question_id: "practice-408-v1-01",
            course_id: "course_408_001",
            year: null,
            number: 1,
            subject: "数据结构",
            question_type: "choice",
            tags: ["循环队列"],
            source_url: "https://xuetu.local/practice/408-v1",
            license_status: "verified",
            usage_scope: "authorized_product_use",
            review_status: "pending_review",
            reviewed_by: null,
            reviewed_at: null,
            updated_at: new Date("2026-08-25T00:00:00.000Z"),
          } as Row],
        };
      },
    } as unknown as SqlQueryablePool;

    const questions = await new PostgresManagementService(pool).listQuestions(
      "course_408_001",
    );

    expect(questions).toHaveLength(1);
    expect(questions[0]?.year).toBeNull();
  });

  it("updates the teacher-verification gate in the same transaction as question approval", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const query = async <Row = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ) => {
      calls.push({ sql, parameters });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] as Row[] };
      if (sql.includes("UPDATE questions")) {
        return {
          rowCount: 1,
          rows: [{
            question_id: "screening-408-v3-01",
            course_id: "course_408_ds",
            year: null,
            number: 1,
            subject: "数据结构",
            question_type: "choice",
            tags: ["栈"],
            source_url: "https://xuetu.local/sources/onboarding-screening/408-v3",
            license_status: "verified",
            usage_scope: "authorized_product_use",
            review_status: "approved",
            reviewed_by: "teacher_001",
            reviewed_at: new Date("2026-08-26T01:00:00.000Z"),
            updated_at: new Date("2026-08-26T01:00:00.000Z"),
          } as Row],
        };
      }
      if (sql.includes("UPDATE question_learning_metadata")) return { rowCount: 1, rows: [] as Row[] };
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    const client: SqlClient = { query, release() {} };
    const pool: SqlQueryablePool = { query, connect: async () => client };

    const approved = await new PostgresManagementService(
      pool,
      () => new Date("2026-08-26T01:00:00.000Z"),
    ).reviewQuestion("screening-408-v3-01", "teacher_001", {
      review_status: "approved",
      review_note: "已核对题干、答案与知识点。",
    });

    expect(approved?.review_status).toBe("approved");
    expect(calls[0]?.sql).toBe("BEGIN");
    expect(calls.at(-1)?.sql).toBe("COMMIT");
    const metadataUpdate = calls.find((call) => call.sql.includes("UPDATE question_learning_metadata"));
    expect(metadataUpdate?.sql).toContain("content_review_status");
    expect(metadataUpdate?.parameters).toEqual(["screening-408-v3-01", "teacher_verified", expect.any(String)]);
  });
});
