import { describe, expect, it } from "vitest";

import type { SqlQueryablePool } from "../src/database/client.js";
import { PostgresManagementService } from "../src/services/platform-management.js";

const defaultRosterQuery = {
  page: 1,
  page_size: 15,
  class_name: "assigned",
  learning_status: "all" as const,
};

function pageRow(items: unknown[] = []) {
  return {
    items,
    total_items: String(items.length),
    available_classes: [],
    summary_student_count: String(items.length),
    summary_attention_count: "0",
    summary_average_progress_percent: "0",
    summary_average_accuracy_percent: "0",
    summary_weekly_study_minutes: "0",
    summary_evidence_count: "0",
    includes_synthetic_demo: false,
  };
}

describe("PostgresManagementService student visibility", () => {
  it("paginates and filters the authorized roster in PostgreSQL while returning full class totals", async () => {
    let sql = "";
    let parameters: readonly unknown[] | undefined;
    const studentRow = {
      student_code: "P7F3A1C20",
      display_name: "许泽宇",
      student_number: "2315929354",
      cohort_year: 2023,
      major: "计算机科学与技术",
      class_name: "计算机科学与技术2302班",
      onboarding_status: "in_progress",
      last_active_at: "2026-08-23T08:00:00.000Z",
      plan_completion_percent: 40,
      accuracy_percent: 60,
      correct_count: 3,
      incorrect_count: 2,
      evidence_count: 5,
      pending_review_mistake_count: 1,
      weekly_study_minutes: 235,
      current_focus: "队列与循环队列",
      learning_status: "needs_attention",
      data_provenance: "synthetic_demo",
    };
    const pool = {
      async query(query: string, values?: readonly unknown[]) {
        sql = query;
        parameters = values;
        return {
          rowCount: 1,
          rows: query.includes("jsonb_agg")
            ? [{
                items: [studentRow],
                total_items: "18",
                available_classes: ["计算机科学与技术2302班"],
                summary_student_count: "18",
                summary_attention_count: "6",
                summary_average_progress_percent: "48",
                summary_average_accuracy_percent: "63",
                summary_weekly_study_minutes: "2040",
                summary_evidence_count: "132",
                includes_synthetic_demo: true,
              }]
            : [studentRow],
        };
      },
    } as unknown as SqlQueryablePool;

    const page = await new PostgresManagementService(pool).listCourseStudents(
      "course_408_ds",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      {
        page: 2,
        page_size: 15,
        class_name: "计算机科学与技术2302班",
        learning_status: "needs_attention",
      },
    );

    expect(sql).toContain("LIMIT $7 OFFSET $8");
    expect(sql).toContain("class_scoped");
    expect(sql).toContain("filtered_roster");
    expect(parameters).toEqual([
      "course_408_ds",
      "course_408_001",
      "teacher",
      "user_teacher_001",
      "计算机科学与技术2302班",
      "needs_attention",
      15,
      15,
      expect.any(String),
    ]);
    expect(page).toMatchObject({
      totalItems: 18,
      availableClasses: ["计算机科学与技术2302班"],
      includesSyntheticDemo: true,
      summary: {
        student_count: 18,
        attention_count: 6,
        average_progress_percent: 48,
        average_accuracy_percent: 63,
        weekly_study_minutes: 2_040,
        evidence_count: 132,
      },
    });
    expect(page.items[0]?.student_number).toBe("2315929354");
  });

  it("scopes plan progress to the requested course and maps only anonymous fields", async () => {
    let sql = "";
    let parameters: readonly unknown[] | undefined;
    const pool = {
      async connect() {
        throw new Error("listCourseStudents must use the queryable pool directly");
      },
      async query(query: string, values?: readonly unknown[]) {
        sql = query;
        parameters = values;
        return {
          rowCount: 1,
          rows: [pageRow([{
            student_code: "P7F3A1C20",
            display_name: "许泽宇",
            student_number: "2315929354",
            cohort_year: "2023",
            major: "计算机科学与技术",
            class_name: "计算机科学与技术2302班",
            onboarding_status: "in_progress",
            last_active_at: "2026-08-23T08:00:00.000Z",
            plan_completion_percent: "50",
            accuracy_percent: "60",
            correct_count: "3",
            incorrect_count: "2",
            evidence_count: "5",
            pending_review_mistake_count: "1",
            weekly_study_minutes: "235",
            current_focus: "队列与循环队列",
            learning_status: "needs_attention",
            data_provenance: "synthetic_demo",
          }])],
        };
      },
    } as unknown as SqlQueryablePool;

    const service = new PostgresManagementService(pool);
    const student = (await service.listCourseStudents(
      "course_408_ds",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      defaultRosterQuery,
    )).items[0]!;

    expect(sql).toContain("t.course_id = $1");
    expect(sql).toContain("course_catalog_entries");
    expect(student).toEqual({
      student_code: "P7F3A1C20",
      display_name: "许泽宇",
      student_number: "2315929354",
      cohort_year: 2023,
      major: "计算机科学与技术",
      class_name: "计算机科学与技术2302班",
      onboarding_status: "in_progress",
      last_active_at: "2026-08-23T08:00:00.000Z",
      plan_completion_percent: 50,
      accuracy_percent: 60,
      correct_count: 3,
      incorrect_count: 2,
      evidence_count: 5,
      pending_review_mistake_count: 1,
      weekly_study_minutes: 235,
      current_focus: "队列与循环队列",
      learning_status: "needs_attention",
      data_provenance: "synthetic_demo",
      focus_source: "none",
      recent_attempt_count: 0,
    });
    expect(sql).toContain("student_academic_profiles");
    expect(sql).toContain("student_course_progress_snapshots");
    expect(sql).toContain("teacher_course_class_assignments");
    expect(sql).toContain("viewer_assignment.teacher_user_id = $4");
    expect(parameters).toEqual([
      "course_408_ds",
      "course_408_001",
      "teacher",
      "user_teacher_001",
      "assigned",
      "all",
      15,
      0,
      expect.any(String),
    ]);
    expect("password_hash" in student).toBe(false);
  });

  it("keeps the full course roster for an administrator viewer", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = {
      async query<Row>(sql: string, parameters: readonly unknown[] = []) {
        calls.push({ sql, parameters });
        return { rowCount: 1, rows: [pageRow() as Row] };
      },
    } as SqlQueryablePool;

    await new PostgresManagementService(pool).listCourseStudents(
      "course_408_ds",
      { viewerUserId: "user_admin_001", viewerRole: "admin" },
      defaultRosterQuery,
    );

    expect(calls[0]?.parameters).toEqual([
      "course_408_ds",
      "course_408_001",
      "admin",
      "user_admin_001",
      "assigned",
      "all",
      15,
      0,
      expect.any(String),
    ]);
  });

  it("scopes teacher profile rows to the signed-in teacher", async () => {
    let sql = "";
    let parameters: readonly unknown[] | undefined;
    const pool = {
      async query(query: string, values?: readonly unknown[]) {
        sql = query;
        parameters = values;
        return { rowCount: 0, rows: [] };
      },
    } as unknown as SqlQueryablePool;

    await new PostgresManagementService(pool).listCourseTeachers(
      "course_408_ds",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
    );

    expect(sql).toContain("$2 = 'admin' OR teacher.user_id = $3");
    expect(parameters).toEqual(["course_408_ds", "teacher", "user_teacher_001"]);
  });

  it("uses a course snapshot only until newer live learning evidence exists", async () => {
    let sql = "";
    const pool = {
      async query<Row>(query: string) {
        sql = query;
        return { rowCount: 1, rows: [pageRow() as Row] };
      },
    } as SqlQueryablePool;

    await new PostgresManagementService(pool).listCourseStudents(
      "course_408_ds",
      { viewerUserId: "user_admin_001", viewerRole: "admin" },
      defaultRosterQuery,
    );

    expect(sql).toContain("MAX(pa.submitted_at) AS last_attempt_at");
    expect(sql).toMatch(
      /current_snapshots AS[\s\S]*pr\.last_attempt_at IS NULL[\s\S]*pr\.last_attempt_at <= snapshot\.generated_at/u,
    );
    expect(sql).toMatch(
      /current_snapshots AS[\s\S]*evi\.last_evidence_at IS NULL[\s\S]*evi\.last_evidence_at <= snapshot\.generated_at/u,
    );
    expect(sql).toContain("LEFT JOIN current_snapshots snapshot");
  });
});
