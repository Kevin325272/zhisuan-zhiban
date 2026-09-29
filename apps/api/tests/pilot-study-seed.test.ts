import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult } from "../src/database/client.js";
import { seedPilotStudy } from "../src/database/seed-pilot-study.js";

function result<Row>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

describe("pilot study seed", () => {
  it("validates real source records and inserts one fixed three-stage study without updates", async () => {
    const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    let studyRow: Record<string, unknown> | null = null;
    const taskRows = new Map<string, Record<string, unknown>>();
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, parameters });
        if (sql.includes("FROM course_core_concepts")) {
          return result([{ concept_id: "ds_c03_02" }] as Row[]);
        }
        if (sql.includes("FROM questions")) {
          return result([
            { question_id: "2010-02" },
            { question_id: "2021-02" },
          ] as Row[]);
        }
        if (sql.includes("FROM pilot_studies")) {
          return result((studyRow ? [studyRow] : []) as Row[]);
        }
        if (sql.includes("INSERT INTO pilot_studies")) {
          studyRow = {
            study_id: parameters[0],
            title: parameters[1],
            notice_version: parameters[2],
            notice_text: parameters[3],
            status: parameters[4],
          };
          return result([studyRow] as Row[]);
        }
        if (sql.includes("FROM pilot_tasks")) {
          return result([...taskRows.values()] as Row[]);
        }
        if (sql.includes("INSERT INTO pilot_tasks")) {
          const row = {
            task_id: parameters[0],
            study_id: parameters[1],
            ordinal: parameters[2],
            stage: parameters[3],
            evidence_kind: parameters[4],
            title: parameters[5],
            instructions: parameters[6],
            course_id: parameters[7],
            concept_id: parameters[8],
            question_id: parameters[9],
            href: parameters[10],
            assistance_policy: parameters[11],
          };
          taskRows.set(String(parameters[0]), row);
          return result<Row>();
        }
        return result<Row>();
      },
      release() {},
    };
    const pool = { async connect() { return client; } };

    const first = await seedPilotStudy(pool);
    const second = await seedPilotStudy(pool);

    expect(first).toEqual({ studies: 1, tasks: 3 });
    expect(second).toEqual(first);
    const sql = statements.map((entry) => entry.sql).join("\n");
    expect(sql).toContain("ON CONFLICT (study_id) DO NOTHING");
    expect(sql).toContain("ON CONFLICT (task_id) DO NOTHING");
    expect(sql).not.toContain("status = EXCLUDED.status");
    expect(statements.some((entry) => entry.parameters.includes("2010-02"))).toBe(true);
    expect(statements.some((entry) => entry.parameters.includes("2021-02"))).toBe(true);
    expect(statements.some((entry) => entry.parameters.includes("ds_c03_02"))).toBe(true);
  });

  it("fails closed when a fixed question is missing", async () => {
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        if (sql === "BEGIN" || sql === "ROLLBACK") return result<Row>();
        if (sql.includes("FROM course_core_concepts")) {
          return result([{ concept_id: "ds_c03_02" }] as Row[]);
        }
        if (sql.includes("FROM questions")) {
          return result([{ question_id: "2010-02" }] as Row[]);
        }
        return result<Row>();
      },
      release() {},
    };

    await expect(seedPilotStudy({ async connect() { return client; } }))
      .rejects.toThrow(/2021-02/u);
  });

  it("does not reactivate or rewrite an existing protocol", async () => {
    const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, parameters });
        if (sql === "BEGIN" || sql === "ROLLBACK") return result<Row>();
        if (sql.includes("FROM course_core_concepts")) {
          return result([{ concept_id: "ds_c03_02" }] as Row[]);
        }
        if (sql.includes("FROM questions")) {
          return result([
            { question_id: "2010-02" },
            { question_id: "2021-02" },
          ] as Row[]);
        }
        if (sql.includes("FROM pilot_studies")) {
          return result([{
            study_id: "pilot_408_queue_v1",
            title: "队列知识点三阶段试用",
            notice_version: "pilot_notice_v1",
            notice_text: "知情说明",
            status: "closed",
          }] as Row[]);
        }
        return result<Row>();
      },
      release() {},
    };

    await expect(seedPilotStudy({ async connect() { return client; } }))
      .rejects.toThrow(/closed|immutable|protocol/iu);
    expect(statements.some((entry) => /UPDATE pilot_(studies|tasks)/iu.test(entry.sql))).toBe(false);
  });
});
