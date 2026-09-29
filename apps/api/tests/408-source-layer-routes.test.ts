import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService, PlatformActor } from "../src/services/platform-access.js";
import type { ManagementService } from "../src/services/platform-management.js";
import type {
  SourceLayerCourseSummary,
  SourceLayerSummaryService,
} from "../src/services/course-source-layer/source-layer.js";

const studentUser = {
  user_id: "user_student_001",
  display_name: "本地学生",
  account_status: "active" as const,
  auth_source: "local_development" as const,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

const teacherUser = {
  user_id: "user_teacher_001",
  display_name: "本地教师",
  account_status: "active" as const,
  auth_source: "local_development" as const,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

const summary: SourceLayerCourseSummary = {
  course_id: "course_408_ds",
  title: "数据结构（C语言版·第2版）",
  course_label: "数据结构",
  version: "第2版",
  isbn: "978-7-302-45989-7",
  source_archive_file: "output.zip",
  source_archive_sha256: "a".repeat(64),
  source_files: ["数据结构.pdf"],
  chunk_count: 406,
  chapter_count: 8,
  figure_count: 234,
  image_available_count: 219,
  needs_human_review_figure_count: 15,
  chunk_review_count: 18,
  student_content_status: "source_layer_only_curriculum_pending",
  license_status: "unverified",
  usage_scope: "local_demo_only",
};

describe("408 source-layer management route", () => {
  let app: FastifyInstance;
  let roles: Array<"student" | "teacher" | "admin"> = ["teacher"];
  let assigned = true;

  afterEach(async () => {
    await app?.close();
  });

  function createApp() {
    const actorMap: Record<string, PlatformActor> = {
      [teacherUser.user_id]: { user: teacherUser, roles },
      [studentUser.user_id]: { user: studentUser, roles: ["student"] },
    };
    const access: PlatformAccessService = {
      async getActor(userId) { return actorMap[userId] ?? null; },
      async isCourseAssigned() { return assigned; },
    };
    const management = {} as ManagementService;
    const sourceLayer: SourceLayerSummaryService = {
      async getCourseSummary(courseId) {
        return courseId === summary.course_id ? summary : null;
      },
      async listCourseSummaries() { return [summary]; },
    };
    app = buildApp({
      answerModel: null,
      platformAccess: access,
      management,
      sourceLayer,
      allowLocalDevAuth: true,
    });
  }

  it("returns source governance summary without raw textbook fields", async () => {
    createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_ds/source-layer",
      headers: { "x-dev-user-id": teacherUser.user_id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(summary);
    expect(response.body).not.toContain("content_text");
    expect(response.body).not.toContain("raw_metadata");
  });

  it("keeps the existing teacher assignment and admin override boundary", async () => {
    createApp();
    assigned = false;
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_ds/source-layer",
      headers: { "x-dev-user-id": teacherUser.user_id },
    });
    expect(denied.statusCode).toBe(403);

    roles = ["admin"];
    app = buildApp({
      answerModel: null,
      platformAccess: {
        async getActor(userId) {
          return userId === teacherUser.user_id
            ? { user: teacherUser, roles: ["admin"] }
            : null;
        },
        async isCourseAssigned() { return false; },
      },
      management: {} as ManagementService,
      sourceLayer: {
        async getCourseSummary() { return summary; },
        async listCourseSummaries() { return [summary]; },
      },
      allowLocalDevAuth: true,
    });
    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_ds/source-layer",
      headers: { "x-dev-user-id": teacherUser.user_id },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("does not let students access governance metadata", async () => {
    createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_ds/source-layer",
      headers: { "x-dev-user-id": studentUser.user_id },
    });
    expect(response.statusCode).toBe(403);
  });
});
