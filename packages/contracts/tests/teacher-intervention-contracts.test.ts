import { describe, expect, it } from "vitest";

import {
  managedCourseEvidenceSchema,
  managedCourseEvidenceQuerySchema,
  teacherInterventionCreateRequestSchema,
  teacherInterventionSchema,
  teacherInterventionStatusUpdateRequestSchema,
} from "../src/index.js";

describe("teacher intervention evidence contracts", () => {
  it("accepts a bounded anonymous course evidence payload", () => {
    const parsed = managedCourseEvidenceSchema.parse({
      course_id: "course_408_co",
      generated_at: "2026-08-24T10:00:00.000Z",
      data_scope: "stored_records_only",
      active_student_count: 3,
      top_weak_concepts: [{
        concept_id: "co_c01_01",
        concept_title: "指令执行流程",
        attempt_count: 6,
        incorrect_count: 4,
        pending_review_count: 3,
        student_count: 2,
        last_activity_at: "2026-08-24T09:00:00.000Z",
      }],
      recent_interventions: [],
    });

    expect(parsed.top_weak_concepts[0]?.incorrect_count).toBe(4);
  });

  it("allows only the three bounded teacher actions", () => {
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "下次课先补充指令执行流程。",
    }).success).toBe(true);
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "invented_action",
      note: "不允许。",
    }).success).toBe(false);
  });

  it("rejects account and evidence fields crossing the write boundary", () => {
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "classroom_focus",
      note: "聚焦本节课。",
      course_id: "course_other",
      actor_user_id: "user_teacher_001",
      incorrect_count: 99,
    }).success).toBe(false);
  });

  it("accepts an explicit evidence window and validates its ordering", () => {
    expect(managedCourseEvidenceQuerySchema.parse({
      days: "7",
      start_at: "2026-08-18T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
    })).toMatchObject({
      days: 7,
      start_at: "2026-08-18T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
    });
    expect(managedCourseEvidenceQuerySchema.safeParse({
      start_at: "2026-08-25T00:00:00.000Z",
      end_at: "2026-08-18T00:00:00.000Z",
    }).success).toBe(false);
    expect(managedCourseEvidenceQuerySchema.safeParse({
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("requires a target for a class or student intervention", () => {
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "安排一次对照练习。",
      target_type: "class",
    }).success).toBe(false);
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "安排一次对照练习。",
      target_type: "student",
      target_student_code: "P7F3A1C20",
      due_at: "2026-08-30T10:00:00.000Z",
      material_ref: "pair:co_c01_01:v1",
    }).success).toBe(true);
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "班级任务不能同时携带学生目标。",
      target_type: "class",
      target_class_id: "class_001",
      target_user_id: "student_001",
    }).success).toBe(false);
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "学生任务不能同时携带班级目标。",
      target_type: "student",
      target_class_id: "class_001",
      target_user_id: "student_001",
    }).success).toBe(false);
  });

  it("accepts only a public student code for student targets", () => {
    const parsed = teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "给这名同学安排一次复测。",
      target_type: "student",
      target_student_code: "p7f3a1c20",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.target_student_code).toBe("P7F3A1C20");
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "缺少目标。",
      target_type: "student",
    }).success).toBe(false);
    expect(teacherInterventionCreateRequestSchema.safeParse({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "内部账号标识不能跨过公开写入边界。",
      target_type: "student",
      target_user_id: "student_001",
    }).success).toBe(false);
  });

  it("keeps internal user ids out of the intervention response contract", () => {
    expect(teacherInterventionSchema.safeParse({
      intervention_id: "intervention_001",
      course_id: "course_408_co",
      concept_id: "co_c01_01",
      concept_title: "指令执行流程",
      action: "assign_review",
      note: "给许同学安排一次复测。",
      target_type: "student",
      target_student_code: "P7F3A1C20",
      created_at: "2026-08-24T10:01:00.000Z",
    }).success).toBe(true);
    expect(teacherInterventionSchema.safeParse({
      intervention_id: "intervention_001",
      course_id: "course_408_co",
      concept_id: "co_c01_01",
      concept_title: "指令执行流程",
      action: "assign_review",
      note: "不应泄露内部 ID。",
      target_type: "student",
      target_student_code: "P7F3A1C20",
      target_user_id: "user_internal_001",
      created_at: "2026-08-24T10:01:00.000Z",
    }).success).toBe(false);
    expect(teacherInterventionSchema.safeParse({
      intervention_id: "intervention_class_001",
      course_id: "course_408_co",
      concept_id: "co_c01_01",
      concept_title: "指令执行流程",
      action: "classroom_focus",
      note: "给软件工程2301班安排一次补讲。",
      target_type: "class",
      target_class_id: "class_se_2301",
      target_class_name: "软件工程2301班",
      created_at: "2026-08-24T10:01:00.000Z",
    }).success).toBe(true);
  });

  it("allows only forward intervention status updates", () => {
    expect(teacherInterventionStatusUpdateRequestSchema.safeParse({ status: "sent" }).success).toBe(true);
    expect(teacherInterventionStatusUpdateRequestSchema.safeParse({ status: "planned" }).success).toBe(false);
    expect(teacherInterventionStatusUpdateRequestSchema.safeParse({ status: "completed" }).success).toBe(true);
  });
});
