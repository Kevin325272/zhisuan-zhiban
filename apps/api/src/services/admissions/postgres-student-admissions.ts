import {
  admissionsCurrentTargetSchema,
  admissionsTargetSearchResponseSchema,
  type AdmissionsCurrentTarget,
  type AdmissionsTargetSearchQuery,
  type AdmissionsTargetSearchResponse,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";

export class StudentAdmissionsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 400 | 404 | 503,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "StudentAdmissionsError";
  }
}

export interface StudentAdmissionsService {
  searchTargets(query: AdmissionsTargetSearchQuery): Promise<AdmissionsTargetSearchResponse>;
  getCurrentTarget(userId: string): Promise<AdmissionsCurrentTarget>;
  selectTarget(userId: string, targetId: string): Promise<AdmissionsCurrentTarget>;
  clearTarget(userId: string): Promise<AdmissionsCurrentTarget>;
}

interface CountRow { total: number | string }
interface YearRow { year: number | string }

interface TargetRow {
  target_id: string;
  school: string;
  training_unit: string;
  program_code: string;
  program_name: string;
  study_mode: string;
  available_years: unknown;
  retest_lines: unknown;
  saved_at?: Date | string;
}

const DATA_BOUNDARY = {
  scope: "retest_cutoff_information_only" as const,
  notice: "复试线信息来自本地公开资料整理，选择前请以院校官网当年公告为准。",
};

function jsonValue(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function targetFromRow(row: TargetRow) {
  return {
    target_id: row.target_id,
    school: row.school,
    training_unit: row.training_unit,
    program_code: row.program_code,
    program_name: row.program_name,
    study_mode: row.study_mode,
    available_years: jsonValue(row.available_years),
    retest_lines: jsonValue(row.retest_lines),
  };
}

function schoolAbbreviationPattern(value: string) {
  return /^[\p{Script=Han}]{2,4}$/u.test(value)
    ? `%${[...value].join("%")}%`
    : null;
}

const TARGET_SELECT = `SELECT target.target_id, target.school, target.training_unit,
       target.program_code, target.program_name, target.study_mode,
       COALESCE(array_agg(DISTINCT line.year ORDER BY line.year DESC)
         FILTER (WHERE line.line_id IS NOT NULL), '{}') AS available_years,
       COALESCE(jsonb_agg(jsonb_build_object(
         'line_id', line.line_id,
         'year', line.year,
         'retest_score', line.retest_score,
         'subject_scores', jsonb_build_object(
           'politics', line.politics_score,
           'foreign_language', line.foreign_language_score,
           'business_course_1', line.business_course_1_score,
           'business_course_2', line.business_course_2_score
         ),
         'direction', line.direction,
         'source_url', line.retest_source_url,
         'source_kind', CASE
           WHEN line.source_type LIKE '%官网%' THEN 'official'
           ELSE 'third_party_public'
         END
       ) ORDER BY line.year DESC, line.line_id)
         FILTER (WHERE line.line_id IS NOT NULL), '[]'::jsonb) AS retest_lines`;

function filterSql(query: AdmissionsTargetSearchQuery) {
  const clauses: string[] = [];
  const parameters: unknown[] = [];
  if (query.q) {
    const searchableTarget = `concat_ws(' ', target.school, target.training_unit,
      target.program_code, target.program_name)`;
    const normalizedQuery = query.q.trim();
    parameters.push(`%${normalizedQuery}%`);
    const fullMatchParameter = parameters.length;
    const abbreviationPattern = schoolAbbreviationPattern(normalizedQuery);
    let abbreviationClause = "";
    if (abbreviationPattern) {
      parameters.push(abbreviationPattern);
      abbreviationClause = ` OR target.school ILIKE $${parameters.length}`;
    }
    clauses.push(`(${searchableTarget} ILIKE $${fullMatchParameter}${abbreviationClause})`);
  }
  if (query.year !== undefined) {
    parameters.push(query.year);
    clauses.push(`EXISTS (
      SELECT 1 FROM admission_retest_lines filtered_line
      WHERE filtered_line.target_id = target.target_id
        AND filtered_line.year = $${parameters.length}
    )`);
  }
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    parameters,
  };
}

function relevanceSql(query: AdmissionsTargetSearchQuery, parameters: unknown[]) {
  if (!query.q) return "";
  const normalizedQuery = query.q.trim();
  const abbreviationPattern = schoolAbbreviationPattern(normalizedQuery);
  parameters.push(normalizedQuery);
  const exactParameter = parameters.length;
  parameters.push(`%${normalizedQuery}%`);
  const fullParameter = parameters.length;
  let schoolAbbreviationClause = "";
  if (abbreviationPattern) {
    parameters.push(`${[...normalizedQuery][0]}%`);
    const matchingFirstCharacterParameter = parameters.length;
    parameters.push(abbreviationPattern);
    const abbreviationParameter = parameters.length;
    schoolAbbreviationClause = `WHEN target.school ILIKE $${matchingFirstCharacterParameter} AND target.school ILIKE $${abbreviationParameter} THEN 2
         WHEN target.school ILIKE $${abbreviationParameter} THEN 3`;
  }
  return `CASE
         WHEN target.program_code = $${exactParameter} THEN 0
         WHEN target.school ILIKE $${fullParameter} THEN 1
         ${schoolAbbreviationClause}
         WHEN target.program_name ILIKE $${fullParameter} THEN 4
         WHEN target.training_unit ILIKE $${fullParameter} THEN 5
         ELSE 6
       END,`;
}

export class PostgresStudentAdmissions implements StudentAdmissionsService {
  constructor(private readonly pool: SqlQueryablePool) {}

  async searchTargets(query: AdmissionsTargetSearchQuery): Promise<AdmissionsTargetSearchResponse> {
    const filter = filterSql(query);
    const [countResult, yearsResult] = await Promise.all([
      this.pool.query<CountRow>(
        `SELECT COUNT(*)::int AS total FROM admission_targets AS target ${filter.where}`,
        filter.parameters,
      ),
      this.pool.query<YearRow>(
        "SELECT DISTINCT year FROM admission_retest_lines ORDER BY year DESC",
      ),
    ]);
    const offset = (query.page - 1) * query.page_size;
    const parameters = [...filter.parameters];
    const relevance = relevanceSql(query, parameters);
    parameters.push(query.page_size, offset);
    const result = await this.pool.query<TargetRow>(
      `${TARGET_SELECT}
       FROM admission_targets target
       LEFT JOIN admission_retest_lines line ON line.target_id = target.target_id
       ${filter.where}
       GROUP BY target.target_id
       ORDER BY ${relevance} target.school, target.training_unit,
         target.program_code, target.program_name, target.study_mode
       LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`,
      parameters,
    );
    return admissionsTargetSearchResponseSchema.parse({
      items: result.rows.map(targetFromRow),
      total: Number(countResult.rows[0]?.total ?? 0),
      page: query.page,
      page_size: query.page_size,
      available_years: yearsResult.rows.map((row) => Number(row.year)),
      data_boundary: DATA_BOUNDARY,
    });
  }

  async getCurrentTarget(userId: string): Promise<AdmissionsCurrentTarget> {
    const result = await this.pool.query<TargetRow>(
      `${TARGET_SELECT}, selection.saved_at
       FROM student_admission_targets selection
       JOIN admission_targets target ON target.target_id = selection.target_id
       LEFT JOIN admission_retest_lines line ON line.target_id = target.target_id
       WHERE selection.user_id = $1
       GROUP BY target.target_id, selection.saved_at`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return { target: null, saved_at: null };
    return admissionsCurrentTargetSchema.parse({
      target: targetFromRow(row),
      saved_at: row.saved_at instanceof Date
        ? row.saved_at.toISOString()
        : new Date(row.saved_at ?? "").toISOString(),
    });
  }

  async selectTarget(userId: string, targetId: string): Promise<AdmissionsCurrentTarget> {
    const inserted = await this.pool.query<{ target_id: string }>(
      `INSERT INTO student_admission_targets(user_id, target_id, saved_at, updated_at)
       SELECT $1, target_id, now(), now()
       FROM admission_targets
       WHERE target_id = $2
       ON CONFLICT (user_id) DO UPDATE SET
         target_id = EXCLUDED.target_id,
         saved_at = now(),
         updated_at = now()
       RETURNING target_id`,
      [userId, targetId],
    );
    if ((inserted.rowCount ?? inserted.rows.length) === 0) {
      throw new StudentAdmissionsError(
        "ADMISSIONS_TARGET_NOT_FOUND",
        "没有找到该院校专业目标，请重新选择。",
        404,
      );
    }
    return this.getCurrentTarget(userId);
  }

  async clearTarget(userId: string): Promise<AdmissionsCurrentTarget> {
    await this.pool.query(
      "DELETE FROM student_admission_targets WHERE user_id = $1",
      [userId],
    );
    return { target: null, saved_at: null };
  }
}
