import { describe, expect, it } from "vitest";

import {
  classEnrollmentDecisionRequestSchema,
  studentClassEnrollmentRequestCreateSchema,
  studentClassEnrollmentStatusSchema,
  teacherClassCreateRequestSchema,
  teacherClassInvitationCreatedSchema,
  teacherClassManagementSchema,
} from "../src/index.js";

describe("class enrollment workflow contracts", () => {
  it("normalizes a student invitation request and rejects server-owned fields", () => {
    expect(studentClassEnrollmentRequestCreateSchema.parse({
      invite_code: "abcd-7k9m",
      student_number: "2315929354",
    })).toEqual({
      invite_code: "ABCD-7K9M",
      student_number: "2315929354",
    });

    expect(studentClassEnrollmentRequestCreateSchema.safeParse({
      invite_code: "ABCD-7K9M",
      student_number: "2315929354",
      status: "approved",
      class_id: "class_injected",
    }).success).toBe(false);
    expect(studentClassEnrollmentRequestCreateSchema.safeParse({
      invite_code: "SHORT",
      student_number: "2315929354",
    }).success).toBe(false);
  });

  it("accepts only bounded teacher class creation and decisions", () => {
    expect(teacherClassCreateRequestSchema.safeParse({
      class_name: "软件工程2301班",
      cohort_year: 2023,
      major: "软件工程",
    }).success).toBe(true);
    expect(teacherClassCreateRequestSchema.safeParse({
      class_name: "软件工程2301班",
      cohort_year: 2023,
      major: "软件工程",
      teacher_user_id: "user_other",
    }).success).toBe(false);
    expect(classEnrollmentDecisionRequestSchema.safeParse({ decision: "approved" }).success)
      .toBe(true);
    expect(classEnrollmentDecisionRequestSchema.safeParse({ decision: "reopened" }).success)
      .toBe(false);
  });

  it("keeps the raw invitation visible only in the generation response", () => {
    const invitation = teacherClassInvitationCreatedSchema.parse({
      class_id: "class_se_2301",
      invite_code: "ABCD-7K9M",
      code_hint: "****-7K9M",
      expires_at: "2026-09-25T08:00:00.000Z",
    });
    expect(invitation.invite_code).toBe("ABCD-7K9M");

    const overview = teacherClassManagementSchema.parse({
      course_id: "course_408_ds",
      classes: [{
        class_id: "class_se_2301",
        class_name: "软件工程2301班",
        cohort_year: 2023,
        major: "软件工程",
        member_count: 1,
        pending_request_count: 1,
        invitation: {
          status: "active",
          code_hint: "****-7K9M",
          expires_at: "2026-09-25T08:00:00.000Z",
        },
      }],
      pending_requests: [{
        request_id: "enrollment_request_1",
        class_id: "class_se_2301",
        class_name: "软件工程2301班",
        student_code: "P7F3A1C20",
        display_name: "许泽宇",
        student_number: "2315929354",
        status: "pending",
        submitted_at: "2026-08-26T08:00:00.000Z",
      }],
      members: [{
        class_id: "class_se_2301",
        class_name: "软件工程2301班",
        student_code: "P8D4B2E31",
        display_name: "韩若曦",
        student_number: "2315929381",
        joined_at: "2026-08-25T08:00:00.000Z",
      }],
    });

    expect(overview.classes[0]?.invitation).not.toHaveProperty("invite_code");
    expect(overview.pending_requests[0]?.status).toBe("pending");
  });

  it("represents a student's pending request without blocking learning setup", () => {
    const status = studentClassEnrollmentStatusSchema.parse({
      membership: null,
      request: {
        request_id: "enrollment_request_1",
        status: "pending",
        student_number: "2315929354",
        class_id: "class_se_2301",
        class_name: "软件工程2301班",
        course_id: "course_408_ds",
        course_title: "数据结构",
        submitted_at: "2026-08-26T08:00:00.000Z",
        reviewed_at: null,
      },
    });

    expect(status.membership).toBeNull();
    expect(status.request?.status).toBe("pending");
  });
});
