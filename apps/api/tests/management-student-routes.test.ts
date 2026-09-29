import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";
import type {
  ManagementService,
  ManagementViewer,
} from "../src/services/platform-management.js";

const teacher = {
  user_id: "user_teacher_001",
  display_name: "试点教师",
  account_status: "active" as const,
  auth_source: "local_development" as const,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

describe("teacher student learning visibility route", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("returns only authorized course students and stored learning evidence", async () => {
    let receivedViewer: { viewerUserId: string; viewerRole: "teacher" | "admin" } | undefined;
    let receivedTeacherViewer: { viewerUserId: string; viewerRole: "teacher" | "admin" } | undefined;
    const access: PlatformAccessService = {
      async getActor(userId) {
        return userId === teacher.user_id ? { user: teacher, roles: ["teacher"] } : null;
      },
      async isCourseAssigned() {
        return true;
      },
    };
    const management = {
      async listCourseStudents(_courseId: string, viewer: ManagementViewer) {
        receivedViewer = viewer;
        return {
          items: [{
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
          }],
          totalItems: 1,
          availableClasses: ["计算机科学与技术2302班"],
          includesSyntheticDemo: true,
          summary: {
            student_count: 1,
            attention_count: 1,
            average_progress_percent: 40,
            average_accuracy_percent: 60,
            weekly_study_minutes: 235,
            evidence_count: 5,
          },
        };
      },
      async listCourseTeachers(_courseId: string, viewer: ManagementViewer) {
        receivedTeacherViewer = viewer;
        return [{
          display_name: "陈明远",
          teacher_number: "T2008016",
          department: "计算机科学与技术系",
          professional_title: "副教授",
          assigned_classes: ["计算机科学与技术2302班"],
          data_provenance: "synthetic_demo",
        }];
      },
    } as unknown as ManagementService;
    app = buildApp({
      answerModel: null,
      platformAccess: access,
      management,
      allowLocalDevAuth: true,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_ds/students",
      headers: { "x-dev-user-id": teacher.user_id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toMatchObject({
      student_code: "P7F3A1C20",
      display_name: "许泽宇",
      student_number: "2315929354",
      evidence_count: 5,
    });
    expect(response.json().data.teachers[0]).toMatchObject({
      display_name: "陈明远",
      teacher_number: "T2008016",
    });
    expect(response.json().data.data_scope).toBe("includes_synthetic_demo");
    expect(receivedViewer).toEqual({
      viewerUserId: teacher.user_id,
      viewerRole: "teacher",
    });
    expect(receivedTeacherViewer).toEqual({
      viewerUserId: teacher.user_id,
      viewerRole: "teacher",
    });
    expect(response.body).not.toContain("password_hash");
    expect(response.body).not.toContain("answer_key");
  });

  it("forwards bounded roster pagination and filters to the management service", async () => {
    let receivedQuery: unknown;
    const access: PlatformAccessService = {
      async getActor(userId) {
        return userId === teacher.user_id ? { user: teacher, roles: ["teacher"] } : null;
      },
      async isCourseAssigned() {
        return true;
      },
    };
    const management = {
      async listCourseStudents(_courseId: string, _viewer: ManagementViewer, query: unknown) {
        receivedQuery = query;
        return {
          items: [],
          totalItems: 18,
          availableClasses: ["计算机科学与技术2302班"],
          includesSyntheticDemo: false,
          summary: {
            student_count: 18,
            attention_count: 6,
            average_progress_percent: 48,
            average_accuracy_percent: 63,
            weekly_study_minutes: 2_040,
            evidence_count: 132,
          },
        };
      },
      async listCourseTeachers() {
        return [];
      },
    } as unknown as ManagementService;
    app = buildApp({
      answerModel: null,
      platformAccess: access,
      management,
      allowLocalDevAuth: true,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_ds/students?page=2&page_size=15&class_name=%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%A7%91%E5%AD%A6%E4%B8%8E%E6%8A%80%E6%9C%AF2302%E7%8F%AD&learning_status=needs_attention",
      headers: { "x-dev-user-id": teacher.user_id },
    });

    expect(response.statusCode).toBe(200);
    expect(receivedQuery).toEqual({
      page: 2,
      page_size: 15,
      class_name: "计算机科学与技术2302班",
      learning_status: "needs_attention",
    });
    expect(response.json().data).toMatchObject({
      pagination: { page: 2, page_size: 15, total_items: 18, total_pages: 2 },
      filters: {
        class_name: "计算机科学与技术2302班",
        learning_status: "needs_attention",
      },
      summary: { student_count: 18, attention_count: 6 },
    });
  });
});
