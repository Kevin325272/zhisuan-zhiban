import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";
import {
  CourseVideoConceptNotFoundError,
  CourseVideoSeriesNotFoundError,
  type CourseVideoLibrary,
} from "../src/services/course-videos/course-video-library.js";

const studentId = "user_student_001";

function access(assignedCourseIds: readonly string[] = ["course_408_ds"]): PlatformAccessService {
  return {
    async getActor(userId) {
      if (userId === studentId) {
        return {
          user: {
            user_id: userId,
            display_name: "本地学生",
            account_status: "active",
            auth_source: "local_development",
            created_at: "2026-08-14T00:00:00.000Z",
            updated_at: "2026-08-14T00:00:00.000Z",
          },
          roles: ["student"],
        };
      }
      if (userId === "user_admin_001") {
        return {
          user: {
            user_id: userId,
            display_name: "本地管理员",
            account_status: "active",
            auth_source: "local_development",
            created_at: "2026-08-14T00:00:00.000Z",
            updated_at: "2026-08-14T00:00:00.000Z",
          },
          roles: ["admin"],
        };
      }
      return null;
    },
    async isCourseAssigned(_userId, courseId, membershipRole) {
      return membershipRole === "student" && assignedCourseIds.includes(courseId);
    },
  };
}

describe("course-video student routes", () => {
  let app: FastifyInstance;

  afterEach(async () => app?.close());

  function createApp(
    overrides: Partial<CourseVideoLibrary>,
    assignedCourseIds: readonly string[] = ["course_408_ds"],
  ) {
    const library: CourseVideoLibrary = {
      async listConceptVideos(courseSlug, conceptId) {
        return {
          course_slug: courseSlug,
          concept_id: conceptId,
          external_only: true,
          notice: "外部视频资源，打开后将在哔哩哔哩播放。",
          items: [],
        };
      },
      async listCourseVideoSeries(courseSlug, query) {
        return {
          course_slug: courseSlug,
          course_title: "数据结构",
          external_only: true,
          notice: "外部视频来源索引，元数据未逐集人工复核。",
          query: query.q,
          kind: query.kind,
          total_series: 0,
          total_episodes: 0,
          page: query.page,
          page_size: query.pageSize,
          total_pages: 0,
          items: [],
        };
      },
      async listSeriesEpisodes(courseSlug, _seriesId, query) {
        return {
          course_slug: courseSlug,
          series: {
            series_id: "course_video_series_BVTEST0",
            series_title: "数据结构基础课程",
            uploader: "演示UP主",
            video_kind: "teaching",
            total_duration: "10:00:00",
            total_seconds: 36_000,
            episode_count: 1,
            canonical_url: "https://www.bilibili.com/video/BVTEST0",
            platform: "bilibili",
          },
          external_only: true,
          notice: "外部视频来源索引，元数据未逐集人工复核。",
          page: query.page,
          page_size: query.pageSize,
          total_pages: 1,
          total_episodes: 1,
          items: [],
        };
      },
      ...overrides,
    };
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: access(assignedCourseIds),
      courseVideos: library,
    });
  }

  it("requires the student role and returns only student-safe fields", async () => {
    createApp({
      async listConceptVideos(courseSlug, conceptId) {
        return {
          course_slug: courseSlug,
          concept_id: conceptId,
          external_only: true,
          notice: "外部视频资源，打开后将在哔哩哔哩播放。",
          items: [{
            episode_id: "course_video_episode_BVTEST0_0001",
            series_title: "数据结构基础课程",
            episode_title: "数据结构基础概念",
            episode_number: 1,
            duration: "00:10:00",
            duration_seconds: 600,
            uploader: "演示UP主",
            external_url: "https://www.bilibili.com/video/BVTEST0?p=1",
            display_role: "primary",
            ordinal: 1,
            platform: "bilibili",
          }],
        };
      },
    });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/concepts/ds_c01_01/videos",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/concepts/ds_c01_01/videos",
      headers: { "x-dev-user-id": "user_admin_001" },
    });
    expect(forbidden.statusCode).toBe(403);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/concepts/ds_c01_01/videos",
      headers: { "x-dev-user-id": studentId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    expect(response.body).not.toMatch(
      /sha256|license_status|usage_scope|review_status|match_confidence|raw_metadata|original_path/iu,
    );
  });

  it("denies concept, series and episode video routes outside the student's memberships", async () => {
    const listConceptVideos = vi.fn<CourseVideoLibrary["listConceptVideos"]>();
    const listCourseVideoSeries = vi.fn<CourseVideoLibrary["listCourseVideoSeries"]>();
    const listSeriesEpisodes = vi.fn<CourseVideoLibrary["listSeriesEpisodes"]>();
    createApp(
      { listConceptVideos, listCourseVideoSeries, listSeriesEpisodes },
      ["course_408_co"],
    );

    const urls = [
      "/api/v1/408/courses/data-structures/concepts/ds_c01_01/videos",
      "/api/v1/408/courses/data-structures/videos",
      "/api/v1/408/courses/data-structures/videos/course_video_series_BVTEST0/episodes",
    ];
    for (const url of urls) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { "x-dev-user-id": studentId },
      });
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error.code).toBe("COURSE_ACCESS_DENIED");
    }
    expect(listConceptVideos).not.toHaveBeenCalled();
    expect(listCourseVideoSeries).not.toHaveBeenCalled();
    expect(listSeriesEpisodes).not.toHaveBeenCalled();
  });

  it("returns a structured 404 for a concept outside the course", async () => {
    createApp({
      async listConceptVideos(_courseSlug, conceptId) {
        throw new CourseVideoConceptNotFoundError(conceptId);
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/concepts/os_c01_01/videos",
      headers: { "x-dev-user-id": studentId },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("COURSE_CONCEPT_NOT_FOUND");
  });

  it("rejects malformed course or concept identifiers before querying the library", async () => {
    createApp({
      async listConceptVideos() {
        throw new Error("must not be called");
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/concepts/%20/videos",
      headers: { "x-dev-user-id": studentId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("COURSE_VIDEO_PARAMS_INVALID");
  });

  it("lists course series and one series episode page with normalized query input", async () => {
    const listCourseVideoSeries = vi.fn<CourseVideoLibrary["listCourseVideoSeries"]>(
      async (courseSlug, query) => ({
        course_slug: courseSlug,
        course_title: "数据结构",
        external_only: true,
        notice: "外部视频来源索引，元数据未逐集人工复核。",
        query: query.q,
        kind: query.kind,
        total_series: 1,
        total_episodes: 48,
        page: query.page,
        page_size: query.pageSize,
        total_pages: 1,
        items: [],
      }),
    );
    const listSeriesEpisodes = vi.fn<CourseVideoLibrary["listSeriesEpisodes"]>(
      async (courseSlug, seriesId, query) => ({
        course_slug: courseSlug,
        series: {
          series_id: seriesId,
          series_title: "数据结构基础课程",
          uploader: "演示UP主",
          video_kind: "teaching",
          total_duration: "10:00:00",
          total_seconds: 36_000,
          episode_count: 48,
          canonical_url: "https://www.bilibili.com/video/BVTEST0",
          platform: "bilibili",
        },
        external_only: true,
        notice: "外部视频来源索引，元数据未逐集人工复核。",
        page: query.page,
        page_size: query.pageSize,
        total_pages: 2,
        total_episodes: 48,
        items: [],
      }),
    );
    createApp({ listCourseVideoSeries, listSeriesEpisodes });

    const seriesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/videos?q=%20%E6%A0%88%20&kind=teaching&page=2&page_size=10",
      headers: { "x-dev-user-id": studentId },
    });
    expect(seriesResponse.statusCode).toBe(200);
    expect(seriesResponse.json().data).toMatchObject({ query: "栈", page: 2, page_size: 10 });
    expect(listCourseVideoSeries).toHaveBeenCalledWith("data-structures", {
      q: "栈",
      kind: "teaching",
      page: 2,
      pageSize: 10,
    });

    const episodeResponse = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/videos/course_video_series_BVTEST0/episodes?page=2&page_size=30",
      headers: { "x-dev-user-id": studentId },
    });
    expect(episodeResponse.statusCode).toBe(200);
    expect(episodeResponse.json().data).toMatchObject({ page: 2, page_size: 30 });
    expect(listSeriesEpisodes).toHaveBeenCalledWith(
      "data-structures",
      "course_video_series_BVTEST0",
      { page: 2, pageSize: 30 },
    );
  });

  it("validates complete-library pagination before calling the database", async () => {
    const listCourseVideoSeries = vi.fn<CourseVideoLibrary["listCourseVideoSeries"]>();
    const listSeriesEpisodes = vi.fn<CourseVideoLibrary["listSeriesEpisodes"]>();
    createApp({ listCourseVideoSeries, listSeriesEpisodes });

    const badSeriesPage = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/videos?page=0&page_size=21",
      headers: { "x-dev-user-id": studentId },
    });
    expect(badSeriesPage.statusCode).toBe(400);
    expect(badSeriesPage.json().error.code).toBe("COURSE_VIDEO_QUERY_INVALID");

    const badEpisodePage = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/videos/course_video_series_BVTEST0/episodes?page_size=51",
      headers: { "x-dev-user-id": studentId },
    });
    expect(badEpisodePage.statusCode).toBe(400);
    expect(badEpisodePage.json().error.code).toBe("COURSE_VIDEO_QUERY_INVALID");
    expect(listCourseVideoSeries).not.toHaveBeenCalled();
    expect(listSeriesEpisodes).not.toHaveBeenCalled();
  });

  it("protects the complete library and maps a cross-course series to 404", async () => {
    createApp({
      async listSeriesEpisodes(_courseSlug, seriesId) {
        throw new CourseVideoSeriesNotFoundError(seriesId);
      },
    });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/videos",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/videos",
      headers: { "x-dev-user-id": "user_admin_001" },
    });
    expect(forbidden.statusCode).toBe(403);

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses/data-structures/videos/course_video_series_OTHER/episodes",
      headers: { "x-dev-user-id": studentId },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("COURSE_VIDEO_SERIES_NOT_FOUND");
  });
});
