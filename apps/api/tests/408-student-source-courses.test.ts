import { Readable } from "node:stream";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService, PlatformActor } from "../src/services/platform-access.js";
import type { SourceCourseOutline } from "@xuetu/contracts";

const studentId = "user_student_001";
const adminId = "user_admin_001";

const actors: Record<string, PlatformActor> = {
  [studentId]: {
    user: {
      user_id: studentId,
      display_name: "本地学生",
      account_status: "active",
      auth_source: "local_development",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    roles: ["student"],
  },
  [adminId]: {
    user: {
      user_id: adminId,
      display_name: "本地管理员",
      account_status: "active",
      auth_source: "local_development",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    roles: ["admin"],
  },
};

const outline: SourceCourseOutline = {
  course_id: "course_408_ds",
  course_slug: "data-structures",
  course_code: "CS408-DS",
  title: "数据结构",
  summary: "结构理解、算法实现与复杂度分析。",
  question_subject: "数据结构",
  source_title: "数据结构（C语言版·第2版）",
  source_edition: "第2版",
  curriculum_status: "source_structure_available_curriculum_pending",
  notice: "课程结构已接入，讲解内容待课程化整理。",
  chapter_count: 1,
  source_entry_count: 1,
  displayable_figure_count: 1,
  chapters: [{
    chapter: "第1章 绪论",
    ordinal: 0,
    source_entry_count: 1,
    page_start: 1,
    page_end: 12,
    entries: [{
      entry_id: "ds_k0001",
      title: "数据结构的基本概念",
      print_page: 1,
      keywords: ["数据结构"],
      figure: {
        figure_label: "图1.1",
        caption: "数据结构的研究内容",
        image_url: "/api/v1/408/courses/data-structures/source-figures/ds_fig_1_1",
        mime_type: "image/webp",
        pixel_width: 960,
        pixel_height: 540,
      },
    }],
  }],
};

describe("408 student source-course routes", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  function createApp(assignedCourseIds: readonly string[] = ["course_408_ds"]) {
    const platformAccess: PlatformAccessService = {
      async getActor(userId) { return actors[userId] ?? null; },
      async isCourseAssigned(_userId, courseId, membershipRole) {
        return membershipRole === "student" && assignedCourseIds.includes(courseId);
      },
    };
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess,
      studentSourceCourses: {
        async getCourseOutline(courseSlug: string) {
          return courseSlug === "data-structures" ? outline : null;
        },
        async getFigureAsset(courseSlug: string, figureAssetId: string) {
          if (courseSlug !== "data-structures" || figureAssetId !== "ds_fig_1_1") return null;
          return {
            archive_sha256: "a".repeat(64),
            archive_path: "图像资产/数据结构/图1-1.webp",
            asset_sha256: "b".repeat(64),
            mime_type: "image/webp" as const,
          };
        },
      },
      sourceFigureArchive: {
        async open() {
          const bytes = Buffer.from("RIFF\x04\x00\x00\x00WEBP", "binary");
          return { stream: Readable.from(bytes), content_length: bytes.length };
        },
      },
    });
  }

  it("returns a student-safe outline without raw OCR or governance fields", async () => {
    createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/source-outline",
      headers: { "x-dev-user-id": studentId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(outline);
    for (const forbidden of [
      "content_text", "raw_metadata", "review_status", "license_status",
      "asset_sha256", "crop_rect", "printed_page", "physical_page",
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it("requires the student role for the outline", async () => {
    createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/source-outline",
      headers: { "x-dev-user-id": adminId },
    });
    expect(response.statusCode).toBe(403);
  });

  it("denies source outlines and figures outside the student's memberships", async () => {
    createApp(["course_408_co"]);

    const outlineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/source-outline",
      headers: { "x-dev-user-id": studentId },
    });
    expect(outlineResponse.statusCode).toBe(403);
    expect(outlineResponse.json().error.code).toBe("COURSE_ACCESS_DENIED");

    const figureResponse = await app.inject({
      method: "GET",
      url: `/api/v1/408/courses/data-structures/source-figures/ds_fig_1_1?dev_user_id=${studentId}`,
    });
    expect(figureResponse.statusCode).toBe(403);
    expect(figureResponse.json().error.code).toBe("COURSE_ACCESS_DENIED");
  });

  it("streams only a figure already authorized by the student source service", async () => {
    createApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/408/courses/data-structures/source-figures/ds_fig_1_1?dev_user_id=${studentId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/webp");
    expect(response.rawPayload.subarray(0, 4).toString("ascii")).toBe("RIFF");

    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/408/courses/data-structures/source-figures/unreviewed?dev_user_id=${studentId}`,
    });
    expect(denied.statusCode).toBe(404);
  });
});
