import { describe, expect, it } from "vitest";

import {
  courseConceptVideoListSchema,
  courseVideoEpisodePageSchema,
  courseVideoSeriesPageSchema,
} from "../src/index.js";

const safeVideo = {
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
} as const;

describe("course-video student contracts", () => {
  it("allows only a bounded student-safe external-link payload", () => {
    const result = courseConceptVideoListSchema.parse({
      course_slug: "data-structures",
      concept_id: "ds_c01_01",
      external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
      items: [safeVideo],
    });

    expect(result.items).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(
      /sha256|license_status|usage_scope|review_status|match_confidence|raw_metadata|original_path/iu,
    );
  });

  it("rejects governance metadata, non-Bilibili URLs and more than two items", () => {
    const base = {
      course_slug: "data-structures",
      concept_id: "ds_c01_01",
      external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
    } as const;
    expect(() => courseConceptVideoListSchema.parse({
      ...base,
      items: [{ ...safeVideo, review_status: "approved" }],
    })).toThrow();
    expect(() => courseConceptVideoListSchema.parse({
      ...base,
      items: [{ ...safeVideo, external_url: "https://example.com/video" }],
    })).toThrow();
    expect(() => courseConceptVideoListSchema.parse({
      ...base,
      items: [safeVideo, { ...safeVideo, episode_id: "episode_2" }, { ...safeVideo, episode_id: "episode_3" }],
    })).toThrow();
  });

  it("parses a paginated student-safe course series index", () => {
    const result = courseVideoSeriesPageSchema.parse({
      course_slug: "data-structures",
      course_title: "数据结构",
      external_only: true,
      notice: "外部来源索引，元数据未逐集人工复核。",
      query: "栈",
      kind: "teaching",
      total_series: 40,
      total_episodes: 2065,
      page: 1,
      page_size: 10,
      total_pages: 4,
      items: [{
        series_id: "course_video_series_BVTEST0",
        series_title: "数据结构基础课程",
        uploader: "演示UP主",
        video_kind: "teaching",
        total_duration: "10:00:00",
        total_seconds: 36_000,
        episode_count: 48,
        canonical_url: "https://www.bilibili.com/video/BVTEST0",
        platform: "bilibili",
      }],
    });

    expect(result.items[0]?.episode_count).toBe(48);
    expect(JSON.stringify(result)).not.toMatch(
      /sha256|license_status|usage_scope|review_status|raw_metadata|play_count/iu,
    );
  });

  it("parses a paginated student-safe series episode index", () => {
    const result = courseVideoEpisodePageSchema.parse({
      course_slug: "data-structures",
      series: {
        series_id: "course_video_series_BVTEST0",
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
      notice: "外部来源索引，元数据未逐集人工复核。",
      page: 1,
      page_size: 30,
      total_pages: 2,
      total_episodes: 48,
      items: [{
        episode_id: "course_video_episode_BVTEST0_0001",
        episode_title: "栈的定义",
        episode_number: 1,
        duration: "00:10:00",
        duration_seconds: 600,
        external_url: "https://www.bilibili.com/video/BVTEST0?p=1",
        platform: "bilibili",
      }],
    });

    expect(result.items[0]?.episode_title).toBe("栈的定义");
  });

  it("rejects unsafe library URLs, governance fields and excessive page sizes", () => {
    const seriesPage = {
      course_slug: "data-structures",
      course_title: "数据结构",
      external_only: true,
      notice: "外部来源索引，元数据未逐集人工复核。",
      query: "",
      kind: "all",
      total_series: 40,
      total_episodes: 2065,
      page: 1,
      page_size: 10,
      total_pages: 4,
      items: [{
        series_id: "course_video_series_BVTEST0",
        series_title: "数据结构基础课程",
        uploader: "演示UP主",
        video_kind: "teaching",
        total_duration: "10:00:00",
        total_seconds: 36_000,
        episode_count: 48,
        canonical_url: "https://www.bilibili.com/video/BVTEST0",
        platform: "bilibili",
      }],
    } as const;

    expect(() => courseVideoSeriesPageSchema.parse({ ...seriesPage, page_size: 21 })).toThrow();
    expect(() => courseVideoSeriesPageSchema.parse({
      ...seriesPage,
      items: [{ ...seriesPage.items[0], canonical_url: "https://example.com/video" }],
    })).toThrow();
    expect(() => courseVideoSeriesPageSchema.parse({
      ...seriesPage,
      items: [{ ...seriesPage.items[0], review_status: "approved" }],
    })).toThrow();

    const episodePage = {
      course_slug: "data-structures",
      series: seriesPage.items[0],
      external_only: true,
      notice: "外部来源索引，元数据未逐集人工复核。",
      page: 1,
      page_size: 30,
      total_pages: 2,
      total_episodes: 48,
      items: [{
        episode_id: "course_video_episode_BVTEST0_0001",
        episode_title: "栈的定义",
        episode_number: 1,
        duration: "00:10:00",
        duration_seconds: 600,
        external_url: "https://www.bilibili.com/video/BVTEST0?p=1",
        platform: "bilibili",
      }],
    } as const;
    expect(() => courseVideoEpisodePageSchema.parse({ ...episodePage, page_size: 51 })).toThrow();
    expect(() => courseVideoEpisodePageSchema.parse({
      ...episodePage,
      items: [{ ...episodePage.items[0], external_url: "http://www.bilibili.com/video/BVTEST0?p=1" }],
    })).toThrow();
  });
});
