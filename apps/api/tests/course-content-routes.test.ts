import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";
import type { CourseContentService } from "../src/services/course-content/course-content.js";

const boundary = {
  usage_scope: "local_demo_only" as const,
  license_status: "unverified" as const,
  provenance_status: "source_unknown_unverified" as const,
  notice: "原始资料未提供作者、版本或授权信息，仅限本地挑战杯演示。",
};

describe("408 course-content routes", () => {
  let app: FastifyInstance;
  let receivedChapter: string | undefined;
  let receivedProgressUserId: string | undefined;
  let receivedProgressUpdate: unknown;
  let assignedCourseIds: Set<string>;

  beforeEach(() => {
    assignedCourseIds = new Set(["course_408_co"]);
    const service: CourseContentService = {
      async listCourses() {
        return {
          courses: [{
            course_id: "course_408_co",
            slug: "computer-organization",
            course_code: "CS408-CO",
            title: "计算机组成原理",
            summary: "理解计算机系统中的数据表示、存储、指令与控制。",
            question_subject: "组成原理",
            display_order: 2,
            question_count: 150,
            material_status: "available",
            knowledge_chunk_count: 504,
            core_concept_count: 46,
            qa_example_count: 123,
            chapter_count: 11,
            source_boundary: boundary,
          }],
          recommended_start: {
            course_slug: "computer-organization",
            chunk_id: "co_chunk_001",
            chapter: "1 计算机系统概论",
            page: 3,
            basis: "first_available_content",
          },
          generated_at: "2026-07-28T00:00:00.000Z",
        };
      },
      async listChapters() {
        return { course_slug: "computer-organization", items: [{
          chapter: "1 计算机系统概论", chunk_count: 2, page_start: 3, page_end: 4,
          first_chunk_id: "co_chunk_001",
        }] };
      },
      async getCurriculumMap() {
        return {
          course_id: "course_408_co",
          course_slug: "computer-organization",
          title: "课程知识地图",
          curation_method: "source_constrained_course_design",
          chapters: [{
            chapter_id: "co_ch01",
            source_chapter: "1 计算机系统概论",
            title: "计算机系统概论",
            ordinal: 1,
            modules: [{
              module_id: "co_m01_01",
              title: "系统基础",
              ordinal: 1,
              concepts: [{
                concept_id: "co_c01_01",
                title: "硬件、软件与计算机系统",
                learning_objective: "区分硬件与软件，并说明二者如何共同构成计算机系统。",
                prerequisite_concept_ids: [],
                key_terms: ["硬件", "软件"],
                learning_note: {
                  kind: "misconception",
                  text: "不要把计算机系统只理解为硬件。",
                },
                sources: [{
                  chunk_id: "co_chunk_001",
                  print_page: 3,
                  chunk_offset: 0,
                }],
                importance: "core",
                review_status: "verified",
                ordinal: 1,
                figure_guidance: {
                  primary: null,
                  related: [],
                },
              }],
            }],
          }],
          concept_count: 1,
          traceability: {
            source_reference_count: 1,
            valid_source_reference_count: 1,
            rate: 1,
          },
          generated_at: "2026-07-28T00:00:00.000Z",
        };
      },
      async listKnowledge(slug, query) {
        receivedChapter = query.chapter;
        return { course_slug: slug, items: [{
          chunk_id: "co_chunk_001", source_item_id: "1", chapter: "1 计算机系统概论",
          page: 3, text: "计算机系统由硬件和软件共同组成。", content_format: "plain_text",
          figure_references: [{
            reference_id: "co_reference_k0013_1_1",
            figure_label: "图1.1",
            reference_text: "其过程如图1.1所示。",
            ordinal: 0,
            asset: {
              asset_id: "co_figure_1_1",
              figure_label: "图1.1",
              caption: "计算机的解题过程",
              textbook_title: "计算机组成原理",
              author_name: "唐朔飞",
              edition: "第3版",
              publisher: "高等教育出版社",
              publication_year: 2020,
              isbn: "978-7-04-054518-0",
              print_page: 4,
              pdf_physical_page: 11,
              source_pdf_sha256: "a".repeat(64),
              asset_sha256: "b".repeat(64),
              storage_ref: "/course-assets/computer-organization/k0013/figure-1-1.png",
              mime_type: "image/png",
              pixel_width: 760,
              pixel_height: 245,
              verification_status: "human_verified",
              usage_scope: "local_demo_only",
              license_status: "unverified",
            },
          }],
          source_boundary: boundary,
        }], total: 1, limit: query.limit, offset: query.offset };
      },
      async listQaExamples(slug, query) {
        return { course_slug: slug, items: [{
          qa_id: "co_qa_001", source_item_id: "1", chapter: null, page: null,
          question: "什么是机器字长？", answer: "CPU 一次能处理的二进制位数。",
          content_format: "plain_text", source_boundary: boundary,
        }], total: 1, limit: query.limit, offset: query.offset };
      },
      async getReadingProgress(userId, slug) {
        receivedProgressUserId = userId;
        return {
          progress: {
            course_slug: slug,
            chapter: "1 计算机系统概论",
            chunk_id: "co_chunk_k0013",
            chunk_offset: 1,
            paragraph_index: 3,
            source_expanded: true,
            updated_at: "2026-07-28T09:00:00.000Z",
          },
        };
      },
      async saveReadingProgress(userId, slug, update) {
        receivedProgressUserId = userId;
        receivedProgressUpdate = update;
        return {
          course_slug: slug,
          chunk_offset: 1,
          updated_at: "2026-07-28T09:01:00.000Z",
          ...update,
        };
      },
    };
    const access: PlatformAccessService = {
      async getActor(userId) {
        return { user: {
          user_id: userId, display_name: "本地演示学生", account_status: "active",
          auth_source: "local_development", created_at: "2026-07-28T00:00:00.000Z",
          updated_at: "2026-07-28T00:00:00.000Z",
        }, roles: ["student"] };
      },
      async isCourseAssigned(_userId, courseId, membershipRole) {
        return membershipRole === "student" && assignedCourseIds.has(courseId);
      },
    };
    app = buildApp({
      answerModel: null,
      courseContent: service,
      courseSourcePages: {
        async describe(slug, id) {
          return slug === "computer-organization" && id === "1" ? {
            page_id: "012345abcdef-p11", print_page: 4, physical_page: 11,
            title: "计算机组成原理", width: 1300, height: 1800,
            image_url: `/api/v1/408/courses/computer-organization/source-pages/012345abcdef-p11?v=${"a".repeat(64)}`,
          } : null;
        },
        async open(slug, id) {
          if (id === "broken") throw new Error("integrity failure");
          return slug === "computer-organization" && id === "012345abcdef-p11" ? Buffer.from("page") : null;
        },
      },
      platformAccess: access,
      allowLocalDevAuth: true,
    });
  });

  afterEach(async () => app.close());

  it("requires the explicit local student identity", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/408/courses" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("authenticates page images and returns failures without exposing local paths", async () => {
    const url = "/api/v1/408/courses/computer-organization/source-pages/";
    expect((await app.inject({ url: url + "012345abcdef-p11" })).statusCode).toBe(401);
    const headers = { "x-dev-user-id": "user_student_001" };
    const image = await app.inject({ url: url + "012345abcdef-p11", headers });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/webp");
    expect(image.headers["cache-control"]).toContain("private");
    expect((await app.inject({ url: url + "unknown", headers })).statusCode).toBe(404);
    const failed = await app.inject({ url: url + "broken", headers });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain("integrity failure");
  });

  it("returns database-backed course counts and content boundaries", async () => {
    const response = await app.inject({
      method: "GET", url: "/api/v1/408/courses",
      headers: { "x-dev-user-id": "user_student_001" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.courses[0]).toMatchObject({
      question_count: 150, knowledge_chunk_count: 504, core_concept_count: 46,
      qa_example_count: 123,
      source_boundary: { usage_scope: "local_demo_only", license_status: "unverified" },
    });
  });

  it("denies every course-specific read and progress write outside the student's memberships", async () => {
    assignedCourseIds = new Set(["course_408_ds"]);
    const headers = { "x-dev-user-id": "user_student_001" };
    const requests = [
      { method: "GET" as const, url: "/api/v1/408/courses/computer-organization/chapters" },
      { method: "GET" as const, url: "/api/v1/408/courses/computer-organization/curriculum-map" },
      { method: "GET" as const, url: "/api/v1/408/courses/computer-organization/knowledge" },
      { method: "GET" as const, url: "/api/v1/408/courses/computer-organization/source-pages/012345abcdef-p11" },
      { method: "GET" as const, url: "/api/v1/408/courses/computer-organization/qa-examples" },
      { method: "GET" as const, url: "/api/v1/408/courses/computer-organization/reading-progress" },
      {
        method: "PUT" as const,
        url: "/api/v1/408/courses/computer-organization/reading-progress",
        payload: {
          chapter: "1 计算机系统概论",
          chunk_id: "co_chunk_k0013",
          paragraph_index: 4,
          source_expanded: true,
        },
      },
    ];

    for (const request of requests) {
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(403);
      expect(response.json().error.code).toBe("COURSE_ACCESS_DENIED");
    }
    expect(receivedProgressUserId).toBeUndefined();
    expect(receivedProgressUpdate).toBeUndefined();
  });

  it("returns chapter/page traceability and validates paging", async () => {
    const headers = { "x-dev-user-id": "user_student_001" };
    const chapters = await app.inject({
      method: "GET", url: "/api/v1/408/courses/computer-organization/chapters", headers,
    });
    expect(chapters.statusCode).toBe(200);
    expect(chapters.json().data.items[0]).toMatchObject({ page_start: 3, page_end: 4 });

    const knowledge = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/computer-organization/knowledge?chapter=1%20%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%B3%BB%E7%BB%9F%E6%A6%82%E8%AE%BA&limit=1&offset=0",
      headers,
    });
    expect(knowledge.statusCode).toBe(200);
    expect(receivedChapter).toBe("1 计算机系统概论");
    expect(knowledge.json().data.items[0].content_format).toBe("plain_text");
    expect(knowledge.json().data.items[0].source_page).toMatchObject({ print_page: 4, physical_page: 11 });
    expect(knowledge.json().data.items[0].figure_references[0]).toMatchObject({
      figure_label: "图1.1",
      asset: {
        print_page: 4,
        pdf_physical_page: 11,
        usage_scope: "local_demo_only",
        license_status: "unverified",
      },
    });

    const bad = await app.inject({
      method: "GET", url: "/api/v1/408/courses/computer-organization/knowledge?limit=500", headers,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("COURSE_CONTENT_QUERY_INVALID");
  });

  it("returns the curated three-level curriculum map instead of OCR fragments", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/computer-organization/curriculum-map",
      headers: { "x-dev-user-id": "user_student_001" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      title: "课程知识地图",
      concept_count: 1,
      traceability: { rate: 1 },
    });
    expect(response.json().data.chapters[0].modules[0].concepts[0]).toMatchObject({
      title: "硬件、软件与计算机系统",
      sources: [{ chunk_id: "co_chunk_001", print_page: 3, chunk_offset: 0 }],
    });
    expect(response.body).not.toContain("前言、目录或参考资料");
  });

  it("returns real stored QA examples without claiming live AI", async () => {
    const response = await app.inject({
      method: "GET", url: "/api/v1/408/courses/computer-organization/qa-examples?limit=3",
      headers: { "x-dev-user-id": "user_student_001" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toMatchObject({ page: null, content_format: "plain_text" });
    expect(response.body).not.toContain("live_ai");
  });

  it("reads and updates only the authenticated student's course-reading position", async () => {
    const headers = { "x-dev-user-id": "user_student_001" };
    const read = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/computer-organization/reading-progress",
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.progress).toMatchObject({
      chunk_id: "co_chunk_k0013",
      paragraph_index: 3,
      source_expanded: true,
    });
    expect(receivedProgressUserId).toBe("user_student_001");

    const update = await app.inject({
      method: "PUT",
      url: "/api/v1/408/courses/computer-organization/reading-progress",
      headers,
      payload: {
        chapter: "1 计算机系统概论",
        chunk_id: "co_chunk_k0013",
        paragraph_index: 4,
        source_expanded: true,
      },
    });
    expect(update.statusCode).toBe(200);
    expect(receivedProgressUpdate).toEqual({
      chapter: "1 计算机系统概论",
      chunk_id: "co_chunk_k0013",
      paragraph_index: 4,
      source_expanded: true,
    });

    const invalid = await app.inject({
      method: "PUT",
      url: "/api/v1/408/courses/computer-organization/reading-progress",
      headers,
      payload: {
        chapter: "1 计算机系统概论",
        chunk_id: "co_chunk_k0013",
        paragraph_index: 4,
        source_expanded: false,
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("READING_PROGRESS_INVALID");
  });
});
