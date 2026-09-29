import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryResult } from "../src/database/client.js";
import { seedCourseVideos } from "../src/database/seed-course-videos.js";
import type { CourseVideoSource } from "../src/services/course-videos/video-source.js";

const source: CourseVideoSource = {
  importBatch: {
    importBatchId: "video-test",
    datasetId: "video-test",
    archiveFileName: "videos.zip",
    archiveSha256: "a".repeat(64),
    sourceProvider: "workflow_group_link_archive",
    originalPath: "local-test",
    collectedAt: "2026-08-10T07:31:09.000Z",
    licenseStatus: "unverified",
    usageScope: "local_demo_only",
    reviewStatus: "pending_review",
    contentMode: "external_links_only",
    notice: "test",
    rawManifest: {},
  },
  series: [{
    seriesId: "course_video_series_BVTEST0",
    importBatchId: "video-test",
    courseId: "course_408_ds",
    courseSlug: "data-structures",
    subjectLabel: "数据结构",
    kind: "teaching",
    platform: "bilibili",
    bvId: "BVTEST0",
    title: "数据结构基础课程",
    uploader: "演示UP主",
    totalSeconds: 600,
    totalDuration: "00:10:00",
    episodeCount: 1,
    canonicalUrl: "https://www.bilibili.com/video/BVTEST0",
    description: "test",
    publishedOn: "2026-08-10",
    sourceCollectedAt: "2026-08-10 15:31:09",
    licenseStatus: "unverified",
    usageScope: "local_demo_only",
    reviewStatus: "pending_review",
    rawMetadata: {},
  }],
  episodes: [{
    episodeId: "course_video_episode_BVTEST0_0001",
    seriesId: "course_video_series_BVTEST0",
    bvId: "BVTEST0",
    episodeNumber: 1,
    title: "数据结构基础概念",
    duration: "00:10:00",
    durationSeconds: 600,
    externalUrl: "https://www.bilibili.com/video/BVTEST0?p=1",
    cid: "cid-0",
    rawMetadata: {},
  }],
  curatedLinks: [{
    linkId: "course_concept_video_ds_c01_01_course_video_episode_BVTEST0_0001",
    courseId: "course_408_ds",
    courseSlug: "data-structures",
    conceptId: "ds_c01_01",
    seriesId: "course_video_series_BVTEST0",
    episodeId: "course_video_episode_BVTEST0_0001",
    displayRole: "primary",
    ordinal: 1,
    matchMethod: "metadata_title_review",
    matchConfidence: 0.98,
    reviewStatus: "approved",
    reviewNote: "test",
  }],
  counts: { jsonFiles: 8, series: 1, episodes: 1, subjects: 1 },
};

describe("course-video PostgreSQL seed", () => {
  it("upserts traceable source entities and reviewed links in one non-destructive transaction", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("FROM course_core_concepts")) {
          return {
            rows: [{ concept_id: "ds_c01_01", course_id: "course_408_ds" } as Row],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };

    const result = await seedCourseVideos(
      { async connect() { return client; } },
      source,
      () => new Date("2026-08-14T00:00:00.000Z"),
    );

    expect(result).toEqual({ batches: 1, series: 1, episodes: 1, conceptLinks: 1 });
    expect(statements[0]?.sql).toBe("BEGIN");
    expect(statements.at(-1)?.sql).toBe("COMMIT");
    for (const table of [
      "course_video_import_batches",
      "course_video_series",
      "course_video_episodes",
      "course_concept_video_links",
    ]) {
      expect(statements.some((entry) => entry.sql.includes(`INSERT INTO ${table}`))).toBe(true);
    }
    expect(statements.filter((entry) => entry.sql.includes("INSERT INTO")).every(
      (entry) => entry.sql.includes("ON CONFLICT"),
    )).toBe(true);
    expect(statements.every((entry) => !/\b(?:DELETE|TRUNCATE|DROP)\b/iu.test(entry.sql))).toBe(true);
    expect(JSON.stringify(statements)).toContain("local_demo_only");
    expect(JSON.stringify(statements)).toContain("unverified");
  });

  it("rejects a concept mapping that crosses its course boundary", async () => {
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        if (sql.includes("FROM course_core_concepts")) {
          return {
            rows: [{ concept_id: "ds_c01_01", course_id: "course_408_os" } as Row],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };

    await expect(seedCourseVideos({ async connect() { return client; } }, source)).rejects.toThrow(
      /course boundary/i,
    );
  });
});
