import { describe, expect, it } from "vitest";

import * as contracts from "../src/index.js";

describe("teacher student learning visibility contracts", () => {
  it("accepts an authorized academic roster row without credential fields", () => {
    const schema = (contracts as Record<string, unknown>).managedCourseStudentSchema as {
      safeParse: (value: unknown) => { success: boolean };
    } | undefined;
    expect(schema).toBeDefined();
    expect(schema?.safeParse({
      student_code: "P7F3A1C20",
      display_name: "周子航",
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
    }).success).toBe(true);
    expect(schema?.safeParse({
      student_code: "P7F3A1C20",
      display_name: "周子航",
      student_number: "2315929354",
      cohort_year: 2023,
      major: "计算机科学与技术",
      class_name: "计算机科学与技术2302班",
      onboarding_status: "in_progress",
      last_active_at: null,
      plan_completion_percent: 0,
      accuracy_percent: 0,
      correct_count: 0,
      incorrect_count: 0,
      evidence_count: 0,
      pending_review_mistake_count: 0,
      weekly_study_minutes: 0,
      current_focus: null,
      learning_status: "inactive",
      data_provenance: "synthetic_demo",
      password_hash: "must-not-cross-boundary",
    }).success).toBe(false);
  });

  it("accepts bounded server-side roster filters and pagination metadata", () => {
    const querySchema = (contracts as Record<string, unknown>).managedCourseStudentListQuerySchema as {
      safeParse: (value: unknown) => { success: boolean; data?: unknown };
    } | undefined;
    const listSchema = (contracts as Record<string, unknown>).managedCourseStudentListSchema as {
      safeParse: (value: unknown) => { success: boolean };
    } | undefined;

    expect(querySchema).toBeDefined();
    expect(querySchema?.safeParse({
      page: "2",
      page_size: "15",
      class_name: "计算机科学与技术2302班",
      learning_status: "needs_attention",
    })).toMatchObject({
      success: true,
      data: {
        page: 2,
        page_size: 15,
        class_name: "计算机科学与技术2302班",
        learning_status: "needs_attention",
      },
    });
    expect(querySchema?.safeParse({ page: 1, page_size: 500 }).success).toBe(false);

    expect(listSchema).toBeDefined();
    expect(listSchema?.safeParse({
      course_id: "course_408_ds",
      items: [],
      teachers: [],
      generated_at: "2026-08-25T04:20:00.000Z",
      data_scope: "stored_records_only",
      pagination: {
        page: 2,
        page_size: 15,
        total_items: 18,
        total_pages: 2,
      },
      filters: {
        class_name: "计算机科学与技术2302班",
        learning_status: "needs_attention",
        available_classes: ["计算机科学与技术2302班"],
      },
      summary: {
        student_count: 18,
        attention_count: 6,
        average_progress_percent: 48,
        average_accuracy_percent: 63,
        weekly_study_minutes: 2_040,
        evidence_count: 132,
      },
    }).success).toBe(true);
  });
});
