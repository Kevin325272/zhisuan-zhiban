import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult } from "../src/database/client.js";
import { seedAdmissions } from "../src/database/seed-admissions.js";
import type { AdmissionsSource } from "../src/services/admissions/admissions-source.js";

function result<Row>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

const source = {
  manifest: {
    dataset_id: "computer-postgraduate-retest-lines-2024-2026",
    license_status: "unverified",
    usage_scope: "local_demo_only",
    training_allowed: false,
  },
  allRecordCount: 1,
  targets: [{
    target_id: "admission_target_001",
    school: "测试大学",
    training_unit: "计算机学院",
    program_code: "081200",
    program_name: "计算机科学与技术",
    study_mode: "全日制",
  }],
  lines: [{
    line_id: "retest_001",
    target_id: "admission_target_001",
    year: 2026,
    school: "测试大学",
    training_unit: "计算机学院",
    program_code: "081200",
    program_name: "计算机科学与技术",
    study_mode: "全日制",
    exam_category: "统考408",
    retest_score: 300,
    subject_scores: { politics: 40, foreign_language: 40, business_course_1: 60, business_course_2: 60 },
    direction: null,
    initial_subjects: "(408)计算机学科专业基础",
    subject_source_url: "https://example.edu/subjects",
    retest_source_url: "https://example.edu/retest",
    source_domain: "example.edu",
    source_type: "院校/科研机构官网",
    review_status: "pending_official_verification",
    original_note: "待官网复核",
  }],
} satisfies AdmissionsSource;

describe("admissions PostgreSQL seed", () => {
  it("bulk-upserts targets and lines in one repeatable transaction", async () => {
    const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, parameters });
        return result() as SqlQueryResult<Row>;
      },
      release() {},
    };
    const pool = { async connect() { return client; } };

    const first = await seedAdmissions(pool, source);
    const second = await seedAdmissions(pool, source);

    expect(first).toEqual({ targets: 1, lines: 1 });
    expect(second).toEqual(first);
    expect(statements.map(({ sql }) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("INSERT INTO admission_targets"),
      expect.stringContaining("INSERT INTO admission_retest_lines"),
      "COMMIT",
      "BEGIN",
      expect.stringContaining("INSERT INTO admission_targets"),
      expect.stringContaining("INSERT INTO admission_retest_lines"),
      "COMMIT",
    ]);
    expect(statements[1]?.sql).toContain("ON CONFLICT (target_id) DO UPDATE");
    expect(statements[2]?.sql).toContain("ON CONFLICT (line_id) DO UPDATE");
  });
});
