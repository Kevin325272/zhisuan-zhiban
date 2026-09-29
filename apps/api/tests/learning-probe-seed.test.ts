import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult, SqlQueryablePool } from "../src/database/client.js";
import {
  LEARNING_PROBE_DEMO_PAIR_GROUP_ID,
  LEARNING_PROBE_DEMO_QUESTIONS,
  seedLearningProbeDemo,
} from "../src/database/seed-learning-probe.js";

describe("learning probe demo seed", () => {
  it("defines two distinct same-concept questions with an explicit local-demo provenance", () => {
    expect(LEARNING_PROBE_DEMO_QUESTIONS).toHaveLength(2);
    expect(new Set(LEARNING_PROBE_DEMO_QUESTIONS.map((item) => item.questionId)).size).toBe(2);
    expect(new Set(LEARNING_PROBE_DEMO_QUESTIONS.map((item) => item.conceptId))).toEqual(new Set(["co_c04_01"]));
    expect(new Set(LEARNING_PROBE_DEMO_QUESTIONS.map((item) => item.questionText))).toHaveLength(2);
    expect(LEARNING_PROBE_DEMO_QUESTIONS.every((item) => item.options.every((option) => Array.isArray(option.assets)))).toBe(true);
    expect(LEARNING_PROBE_DEMO_PAIR_GROUP_ID).toContain("local_demo");
    expect(LEARNING_PROBE_DEMO_QUESTIONS.every((item) => item.sourceProvenance.includes("本地演示审核"))).toBe(true);
  });

  it("writes both directions of a governed pair without allowing a later seed to downgrade review", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, parameters });
        if (sql.includes("FROM courses")) {
          return { rows: [{ course_id: "course_408_co" } as Row], rowCount: 1 };
        }
        if (sql.includes("FROM course_core_concepts")) {
          return { rows: [{ concept_id: "co_c04_01" } as Row], rowCount: 1 };
        }
        if (sql.includes("FROM users")) {
          return { rows: [{ user_id: "user_admin_001" } as Row], rowCount: 1 };
        }
        if (sql.includes("RETURNING import_batch_id")) {
          return { rows: [{ import_batch_id: "import_learning_probe_co_v1" } as Row], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      async connect() { return client; },
      async query() { throw new Error("all seed reads must stay inside the transaction"); },
    };

    await expect(seedLearningProbeDemo(pool)).resolves.toEqual({
      questions: 2,
      links: 2,
      pairs: 3,
    });
    expect(calls.some(({ sql }) => sql === "BEGIN")).toBe(true);
    expect(calls.some(({ sql }) => sql === "COMMIT")).toBe(true);
    expect(calls.filter(({ sql }) => sql.includes("INSERT INTO questions"))).toHaveLength(2);
    expect(calls.filter(({ sql }) => sql.includes("INSERT INTO question_learning_metadata"))).toHaveLength(2);
    expect(calls.filter(({ sql }) => sql.includes("INSERT INTO course_concept_question_links"))).toHaveLength(2);
    expect(calls.filter(({ sql }) => sql.includes("INSERT INTO learning_question_pairs"))).toHaveLength(3);
    expect(calls.filter(({ sql }) => sql.includes("INSERT INTO questions"))
      .every(({ sql }) => sql.includes("review_status = CASE"))).toBe(true);
    expect(calls.filter(({ sql }) => sql.includes("INSERT INTO learning_question_pairs"))
      .every(({ sql }) => sql.includes("content_review_status = CASE"))).toBe(true);
    expect(calls
      .filter(({ sql }) => sql.includes("INSERT INTO learning_question_pairs"))
      .some(({ parameters }) => parameters.includes("practice-408-v1-03")))
      .toBe(true);
    expect(calls.filter(({ sql }) => sql.includes("INSERT INTO learning_question_pairs"))).toHaveLength(3);
  });
});
