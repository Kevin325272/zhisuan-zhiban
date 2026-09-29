import { describe, expect, it } from "vitest";

import type {
  SqlClient,
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import {
  PostgresStudentAdmissions,
  StudentAdmissionsError,
} from "../src/services/admissions/postgres-student-admissions.js";

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
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
        return result() as SqlQueryResult<Row>;
      }
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

const targetRow = {
  target_id: "admission_target_001",
  school: "中国科学技术大学",
  training_unit: "计算机科学与技术学院",
  program_code: "081200",
  program_name: "计算机科学与技术",
  study_mode: "全日制",
  available_years: [2026, 2025],
  retest_lines: [
    {
      line_id: "retest_001",
      year: 2026,
      retest_score: 315,
      subject_scores: {
        politics: 50,
        foreign_language: 50,
        business_course_1: 80,
        business_course_2: 80,
      },
      direction: null,
      source_url: "https://example.edu/2026/retest",
      source_kind: "official",
    },
  ],
};

describe("PostgresStudentAdmissions", () => {
  it("searches structured 408 targets with query, year and pagination", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("COUNT(*)::int AS total")) return result([{ total: 7 }]);
      if (sql.includes("SELECT DISTINCT year")) return result([{ year: 2026 }, { year: 2025 }, { year: 2024 }]);
      if (sql.includes("FROM admission_targets target")) return result([targetRow]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await new PostgresStudentAdmissions(pool).searchTargets({
      q: "科大",
      year: 2026,
      page: 2,
      page_size: 1,
    });

    expect(response).toMatchObject({
      total: 7,
      page: 2,
      page_size: 1,
      available_years: [2026, 2025, 2024],
      items: [{ target_id: targetRow.target_id, school: "中国科学技术大学" }],
      data_boundary: {
        scope: "retest_cutoff_information_only",
      },
    });
    expect(response.data_boundary.notice).toContain("院校官网当年公告");
    const searchCalls = calls.filter(({ sql }) => !sql.includes("SELECT DISTINCT year"));
    expect(searchCalls.every(({ parameters }) => parameters.includes("%科大%"))).toBe(true);
    expect(searchCalls.every(({ parameters }) => parameters.includes(2026))).toBe(true);
    expect(calls.find(({ sql }) => sql.includes("FROM admission_targets target"))?.parameters)
      .toEqual([
        "%科大%", "%科%大%", 2026,
        "科大", "%科大%", "科%", "%科%大%",
        1, 1,
      ]);
    expect(JSON.stringify(response)).not.toMatch(/license_status|review_status|dataset_id|user_id/iu);
  });

  it("matches a short Chinese abbreviation across the searchable target fields", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("COUNT(*)::int AS total")) return result([{ total: 1 }]);
      if (sql.includes("SELECT DISTINCT year")) return result([{ year: 2026 }]);
      if (sql.includes("FROM admission_targets target")) return result([targetRow]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await new PostgresStudentAdmissions(pool).searchTargets({
      q: "科大",
      page: 1,
      page_size: 6,
    });

    expect(response.items[0]?.school).toBe("中国科学技术大学");
    const countCall = calls.find(({ sql }) => sql.includes("COUNT(*)::int AS total"));
    expect(countCall?.sql).toContain("concat_ws");
    expect(countCall?.sql).toContain("target.school ILIKE $2");
    expect(countCall?.parameters).toEqual(["%科大%", "%科%大%"]);

    const targetCall = calls.find(({ sql }) => sql.includes("FROM admission_targets target"));
    expect(targetCall?.sql).toContain("CASE");
    expect(targetCall?.sql).toContain("target.program_code = $3");
    expect(targetCall?.sql).toContain("target.school ILIKE $4");
    expect(targetCall?.sql).toContain("target.school ILIKE $5");
    expect(targetCall?.sql).toContain("target.school ILIKE $5 AND target.school ILIKE $6");
    expect(targetCall?.parameters).toEqual([
      "%科大%", "%科%大%",
      "科大", "%科大%", "科%", "%科%大%",
      6, 0,
    ]);
  });

  it("supports a three-character school abbreviation without broad cross-field character matches", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("COUNT(*)::int AS total")) return result([{ total: 1 }]);
      if (sql.includes("SELECT DISTINCT year")) return result([{ year: 2026 }]);
      if (sql.includes("FROM admission_targets target")) return result([targetRow]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresStudentAdmissions(pool).searchTargets({
      q: "中科大",
      page: 1,
      page_size: 6,
    });

    const countCall = calls.find(({ sql }) => sql.includes("COUNT(*)::int AS total"));
    expect(countCall?.parameters).toEqual(["%中科大%", "%中%科%大%"]);
    expect(countCall?.sql).toContain("target.school ILIKE $2");

    const targetCall = calls.find(({ sql }) => sql.includes("FROM admission_targets target"));
    expect(targetCall?.sql).toContain("target.school ILIKE $5 AND target.school ILIKE $6");
    expect(targetCall?.parameters).toEqual([
      "%中科大%", "%中%科%大%",
      "中科大", "%中科大%", "中%", "%中%科%大%",
      6, 0,
    ]);
  });

  it("reads, replaces and clears only the authenticated student's target", async () => {
    let selectedTarget: string | null = null;
    let savedAt = new Date("2026-08-12T08:00:00.000Z");
    const { pool, calls } = createPool((sql, parameters) => {
      if (sql.includes("INSERT INTO student_admission_targets")) {
        selectedTarget = String(parameters[1]);
        savedAt = new Date("2026-08-12T09:00:00.000Z");
        return result([{ target_id: selectedTarget }], 1);
      }
      if (sql.includes("DELETE FROM student_admission_targets")) {
        selectedTarget = null;
        return result([], 1);
      }
      if (sql.includes("FROM student_admission_targets selection")) {
        return selectedTarget
          ? result([{ ...targetRow, target_id: selectedTarget, saved_at: savedAt }])
          : result();
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresStudentAdmissions(pool);

    expect(await service.getCurrentTarget("student_a")).toEqual({ target: null, saved_at: null });
    const selected = await service.selectTarget("student_a", targetRow.target_id);
    expect(selected.target?.target_id).toBe(targetRow.target_id);
    expect(selected.saved_at).toBe("2026-08-12T09:00:00.000Z");
    expect(await service.clearTarget("student_a")).toEqual({ target: null, saved_at: null });

    for (const call of calls.filter(({ sql }) => /student_admission_targets/u.test(sql))) {
      expect(call.parameters[0]).toBe("student_a");
    }
    expect(calls.some(({ parameters }) => parameters.includes("student_b"))).toBe(false);
  });

  it("rejects a target id that does not exist without changing ownership", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("INSERT INTO student_admission_targets")) return result([], 0);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(
      new PostgresStudentAdmissions(pool).selectTarget("student_a", "missing_target"),
    ).rejects.toBeInstanceOf(StudentAdmissionsError);
    await expect(
      new PostgresStudentAdmissions(pool).selectTarget("student_a", "missing_target"),
    ).rejects.toMatchObject({ code: "ADMISSIONS_TARGET_NOT_FOUND", statusCode: 404 });
  });
});
