import { describe, expect, it } from "vitest";

import type { SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import {
  CourseVideoConceptNotFoundError,
  CourseVideoCourseNotFoundError,
  CourseVideoSeriesNotFoundError,
} from "../src/services/course-videos/course-video-library.js";
import { PostgresCourseVideoLibrary } from "../src/services/course-videos/postgres-course-video-library.js";

function poolWithCourse(conceptId: string | null): SqlQueryablePool {
  return {
    async connect() { throw new Error("not used"); },
    async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
      if (sql.includes("FROM course_catalog_entries")) {
        return {
          rows: [{ course_id: "course_408_ds", concept_id: conceptId } as Row],
          rowCount: 1,
        };
      }
      return {
        rows: [{
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
        } as Row],
        rowCount: 1,
      };
    },
  };
}

describe("PostgreSQL course-video library", () => {
  it("returns at most reviewed enabled links as the strict student DTO", async () => {
    const library = new PostgresCourseVideoLibrary(poolWithCourse("ds_c01_01"));
    const result = await library.listConceptVideos("data-structures", "ds_c01_01");

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ platform: "bilibili", display_role: "primary" });
    expect(JSON.stringify(result)).not.toMatch(
      /sha256|license_status|usage_scope|review_status|match_confidence|raw_metadata|original_path/iu,
    );
  });

  it("distinguishes an unknown course from a concept outside the course", async () => {
    const noCourse: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row = Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
        return { rows: [], rowCount: 0 };
      },
    };
    await expect(
      new PostgresCourseVideoLibrary(noCourse).listConceptVideos("missing-course", "ds_c01_01"),
    ).rejects.toBeInstanceOf(CourseVideoCourseNotFoundError);
    await expect(
      new PostgresCourseVideoLibrary(poolWithCourse(null)).listConceptVideos("data-structures", "os_c01_01"),
    ).rejects.toBeInstanceOf(CourseVideoConceptNotFoundError);
  });

  it("lists filtered course series with stable parameterized pagination", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, parameters });
        if (sql.includes("FROM course_catalog_entries")) {
          return {
            rows: [{ course_id: "course_408_ds", course_title: "数据结构" } as Row],
            rowCount: 1,
          };
        }
        if (sql.includes("AS total_series")) {
          return {
            rows: [{ total_series: 1, total_episodes: 2065 } as Row],
            rowCount: 1,
          };
        }
        return {
          rows: [{
            series_id: "course_video_series_BVTEST0",
            series_title: "数据结构基础课程",
            uploader: "演示UP主",
            video_kind: "teaching",
            total_duration: "10:00:00",
            total_seconds: 36_000,
            episode_count: 48,
            canonical_url: "https://www.bilibili.com/video/BVTEST0",
          } as Row],
          rowCount: 1,
        };
      },
    };

    const result = await new PostgresCourseVideoLibrary(pool).listCourseVideoSeries(
      "data-structures",
      { q: "栈", kind: "teaching", page: 2, pageSize: 10 },
    );

    expect(result).toMatchObject({
      course_slug: "data-structures",
      course_title: "数据结构",
      query: "栈",
      kind: "teaching",
      total_series: 1,
      total_episodes: 2065,
      page: 2,
      page_size: 10,
      total_pages: 1,
    });
    expect(result.items[0]).toMatchObject({ platform: "bilibili", episode_count: 48 });
    expect(calls.some((call) => call.sql.includes("EXISTS") && call.sql.includes("ILIKE"))).toBe(true);
    expect(calls.find((call) => call.sql.includes("AS total_series"))?.sql)
      .toMatch(/COUNT\(episode\.episode_id\)[\s\S]+FROM course_video_episodes/u);
    expect(calls.at(-1)?.sql).toContain("LIMIT");
    expect(calls.at(-1)?.sql).toContain("OFFSET");
    expect(calls.at(-1)?.parameters).toEqual(expect.arrayContaining(["teaching", "栈", 10]));
    expect(JSON.stringify(result)).not.toMatch(
      /sha256|license_status|usage_scope|review_status|raw_metadata|play_count/iu,
    );
  });

  it("lists one course-owned series in bounded episode pages", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, parameters });
        if (sql.includes("FROM course_catalog_entries")) {
          return {
            rows: [{ course_id: "course_408_ds", course_title: "数据结构" } as Row],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM course_video_series") && sql.includes("series.series_id = $2")) {
          return {
            rows: [{
              series_id: "course_video_series_BVTEST0",
              series_title: "数据结构基础课程",
              uploader: "演示UP主",
              video_kind: "teaching",
              total_duration: "10:00:00",
              total_seconds: 36_000,
              episode_count: 48,
              canonical_url: "https://www.bilibili.com/video/BVTEST0",
            } as Row],
            rowCount: 1,
          };
        }
        return {
          rows: [{
            episode_id: "course_video_episode_BVTEST0_0031",
            episode_title: "栈的应用",
            episode_number: 31,
            duration: "00:08:00",
            duration_seconds: 480,
            external_url: "https://www.bilibili.com/video/BVTEST0?p=31",
          } as Row],
          rowCount: 1,
        };
      },
    };

    const result = await new PostgresCourseVideoLibrary(pool).listSeriesEpisodes(
      "data-structures",
      "course_video_series_BVTEST0",
      { page: 2, pageSize: 30 },
    );

    expect(result).toMatchObject({
      course_slug: "data-structures",
      page: 2,
      page_size: 30,
      total_pages: 2,
      total_episodes: 48,
    });
    expect(result.items[0]).toMatchObject({ episode_number: 31, platform: "bilibili" });
    expect(calls.at(-1)?.parameters).toEqual([
      "course_video_series_BVTEST0",
      30,
      30,
    ]);
  });

  it("rejects a series outside the requested course", async () => {
    const pool: SqlQueryablePool = {
      async connect() { throw new Error("not used"); },
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        if (sql.includes("FROM course_catalog_entries")) {
          return {
            rows: [{ course_id: "course_408_ds", course_title: "数据结构" } as Row],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await expect(
      new PostgresCourseVideoLibrary(pool).listSeriesEpisodes(
        "data-structures",
        "course_video_series_OTHER",
        { page: 1, pageSize: 30 },
      ),
    ).rejects.toBeInstanceOf(CourseVideoSeriesNotFoundError);
  });
});
