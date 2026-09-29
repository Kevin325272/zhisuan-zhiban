import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresMistakeRecommendation } from "../src/services/question-bank/postgres-mistake-recommendation.js";

type QueryCall = { sql: string; parameters: readonly unknown[] };
type QueryHandler = (
  sql: string,
  parameters: readonly unknown[],
) => SqlQueryResult | Promise<SqlQueryResult>;

function result<Row>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

function createPool(handler: QueryHandler) {
  const calls: QueryCall[] = [];
  const client: SqlClient = {
    async query<Row = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> {
      calls.push({ sql, parameters });
      return await handler(sql, parameters) as SqlQueryResult<Row>;
    },
    release() {},
  };
  const pool: SqlQueryablePool = {
    connect: async () => client,
    query: client.query.bind(client),
  };
  return { pool, calls };
}

const recommendationRow = {
  mistake_id: "mistake_001",
  course_id: "course_408_ds",
  course_title: "数据结构",
  question_id: "question_001",
  question_number: 12,
  subject: "数据结构",
  concept_id: "ds_c02_02",
  concept_title: "顺序表的存储表示",
  wrong_count: 3,
  next_review_at: "2026-08-15T08:00:00.000Z",
  last_incorrect_at: "2026-08-10T08:00:00.000Z",
  concept_correct_count: "0",
  concept_incorrect_count: "3",
  importance: "core",
  match_method: "exact_question_tag",
  question_type: "choice",
};

describe("PostgresMistakeRecommendation", () => {
  it("returns only the current student's answer-backed exact-link recommendations", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_mistakes mistake")) return result([recommendationRow]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresMistakeRecommendation(pool, () => new Date("2026-08-16T08:00:00.000Z"));

    const response = await service.listRecommendations("student_001", { limit: 5 });

    expect(response).toMatchObject({
      algorithm_version: "evidence_weighted_v1",
      items: [{
        mistake_id: "mistake_001",
        priority_score: expect.any(Number),
        due_status: "due",
        reason_lines: expect.arrayContaining(["已到复习时间", "核心知识点"]),
        practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=question_001",
      }],
    });
    expect(JSON.stringify(response)).not.toMatch(/correct_option|answer|password|session|user_id/iu);

    const query = calls[0];
    expect(query?.parameters[0]).toBe("student_001");
    expect(query?.sql).toContain("mistake.user_id = $1");
    expect(query?.sql).toContain("link.match_method = 'exact_question_tag'");
    expect(query?.sql).toContain("question.question_type = 'choice'");
    expect(query?.sql).toContain("review_state.next_review_at <= $2");
  });

  it("keeps the queue empty when no reliable due mistake exists", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM practice_mistakes mistake")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresMistakeRecommendation(pool, () => new Date("2026-08-16T08:00:00.000Z"));

    await expect(service.listRecommendations("student_001", {
      courseId: "course_408_ds",
      limit: 2,
    })).resolves.toMatchObject({ items: [] });
  });

  it("reopens only the student's mastered mistake with an immediately due state", async () => {
    const now = new Date("2026-08-16T08:00:00.000Z");
    const { pool, calls } = createPool((sql) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("FROM practice_mistakes") && sql.includes("FOR UPDATE")) {
        return result([{ mistake_id: "mistake_001", status: "mastered" }]);
      }
      if (sql.includes("UPDATE practice_mistakes")) return result();
      if (sql.includes("INSERT INTO practice_mistake_review_states")) {
        return result([{
          mistake_id: "mistake_001",
          status: "needs_review",
          next_review_at: now.toISOString(),
          consecutive_success_count: 0,
          last_processed_attempt_id: null,
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresMistakeRecommendation(pool, () => now);

    await expect(service.reopenMistake("student_001", "mistake_001")).resolves.toMatchObject({
      mistake_id: "mistake_001",
      status: "needs_review",
      next_review_at: now.toISOString(),
      consecutive_success_count: 0,
      next_review_interval_days: 0,
    });

    const ownershipLock = calls.find((call) => call.sql.includes("FOR UPDATE"));
    expect(ownershipLock?.parameters).toEqual(["student_001", "mistake_001"]);
    expect(calls.some((call) => call.sql.includes("INSERT INTO practice_mistake_review_states"))).toBe(true);
  });
});
