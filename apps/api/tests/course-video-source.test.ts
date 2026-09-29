import { describe, expect, it } from "vitest";

import {
  buildCourseVideoSource,
  loadCourseVideoSourceArchive,
  type CourseVideoArchiveEntry,
} from "../src/services/course-videos/video-source.js";

const realSourceDirectory = new URL("../../../data/course-materials/408-video-links/", import.meta.url);

const archiveSha256 = "a".repeat(64);

const subjects = [
  ["数据结构", "teaching"],
  ["数据结构", "question_explanation"],
  ["操作系统", "teaching"],
  ["操作系统", "question_explanation"],
  ["计算机组成原理", "teaching"],
  ["计算机组成原理", "question_explanation"],
  ["计算机网络", "teaching"],
  ["计算机网络", "question_explanation"],
] as const;

function jsonEntry(path: string, value: unknown): CourseVideoArchiveEntry {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  return {
    path,
    uncompressedSize: bytes.byteLength,
    async read() {
      return bytes;
    },
  };
}

function manifest() {
  return {
    schema_version: "1.0",
    dataset_id: "video-test",
    archive_file: "videos.zip",
    archive_sha256: archiveSha256,
    source_provider: "workflow_group_link_archive",
    original_path: "local-test",
    collected_at: "2026-08-10T07:31:09.000Z",
    license_status: "unverified",
    usage_scope: "local_demo_only",
    review_status: "pending_review",
    content_mode: "external_links_only",
    expected: {
      json_files: 8,
      series: 8,
      episodes: 8,
      subjects: 4,
      platforms: ["www.bilibili.com"],
    },
    notice: "test",
  };
}

function entries() {
  return subjects.map(([subject, kind], index) => {
    const file = `${subject}_${kind === "teaching" ? "教学" : "题目讲解"}视频网址.json`;
    return jsonEntry(`408四科视频网址/${file}`, {
      科目: subject,
      类型: kind === "teaching" ? "教学" : "题目讲解",
      采集时间: "2026-08-10 15:31:09",
      课程数量: 1,
      分集总数: 1,
      课程列表: [{
        BV号: `BVTEST${index}`,
        视频名称: `${subject}基础课程`,
        UP主: "演示UP主",
        总秒数: 600,
        总时间: "00:10:00",
        分P数: 1,
        播放量: 0,
        点赞数: 0,
        收藏数: 0,
        投币数: 0,
        弹幕数: 0,
        评论数: 0,
        投稿日期: "2026-08-10",
        简介: "test",
        网址: `https://www.bilibili.com/video/BVTEST${index}`,
        分集列表: [{
          分集序号: 1,
          分集标题: `${subject}基础概念`,
          分集时长: "00:10:00",
          分集秒数: 600,
          分集网址: `https://www.bilibili.com/video/BVTEST${index}?p=1`,
          CID: `cid-${index}`,
        }],
        序号: 1,
        科目: subject,
        类型: kind === "teaching" ? "教学" : "题目讲解",
        命中搜索词: subject,
        采集时间: "2026-08-10 15:31:09",
      }],
    });
  });
}

describe("408 course video source", () => {
  it("loads the tracked archive and resolves the reviewed concept links", async () => {
    const source = await loadCourseVideoSourceArchive({
      archivePath: new URL("raw/408四科视频网址(1).zip", realSourceDirectory),
      manifestPath: new URL("manifest.json", realSourceDirectory),
      curatedLinksPath: new URL("curated/concept-video-links.json", realSourceDirectory),
    });

    expect(source.counts).toEqual({ jsonFiles: 8, series: 149, episodes: 6438, subjects: 4 });
    expect(source.curatedLinks).toHaveLength(11);
    expect(source.curatedLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        courseSlug: "data-structures",
        conceptId: "ds_c03_01",
        seriesId: "course_video_series_BV1pU4y157uN",
        episodeId: "course_video_episode_BV1pU4y157uN_0001",
      }),
      expect.objectContaining({
        courseSlug: "computer-organization",
        conceptId: "co_c01_01",
        seriesId: "course_video_series_BV1PbokYVE2i",
        episodeId: "course_video_episode_BV1PbokYVE2i_0007",
      }),
    ]));
    expect(source.curatedLinks.every((link) => link.reviewStatus === "approved")).toBe(true);
  });

  it("normalizes all four subjects and preserves safe external-link provenance", async () => {
    const source = await buildCourseVideoSource({
      archiveSha256,
      manifest: manifest(),
      archiveFileName: "videos.zip",
      entries: entries(),
      curatedLinks: [{
        courseSlug: "data-structures",
        conceptId: "ds_c01_01",
        bvId: "BVTEST0",
        episodeNumber: 1,
        displayRole: "primary",
        ordinal: 1,
        matchMethod: "metadata_title_review",
        matchConfidence: 0.98,
        reviewStatus: "approved",
        reviewNote: "test",
      }],
    });

    expect(source.counts).toEqual({ jsonFiles: 8, series: 8, episodes: 8, subjects: 4 });
    expect(source.series[0]).toMatchObject({
      courseId: "course_408_ds",
      kind: "teaching",
      platform: "bilibili",
      licenseStatus: "unverified",
      usageScope: "local_demo_only",
    });
    expect(source.episodes[0]).toMatchObject({
      externalUrl: expect.stringMatching(/^https:\/\/www\.bilibili\.com\/video\//u),
    });
    expect(source.curatedLinks).toHaveLength(1);
  });

  it("rejects unsafe archive paths before parsing content", async () => {
    await expect(
      buildCourseVideoSource({
        archiveSha256,
        manifest: manifest(),
        entries: [...entries(), jsonEntry("../outside.json", {})],
        curatedLinks: [],
      }),
    ).rejects.toThrow(/unsafe/i);
  });

  it("rejects an invalid non-Bilibili external URL", async () => {
    const unsafe = entries();
    const first = unsafe[0]!;
    const data = JSON.parse((await first.read()).toString("utf8")) as {
      课程列表: Array<{ 网址: string; 分集列表: Array<{ 分集网址: string }> }>;
    };
    data.课程列表[0]!.网址 = "javascript:alert(1)";
    data.课程列表[0]!.分集列表[0]!.分集网址 = "https://example.com/video";
    unsafe[0] = jsonEntry(first.path, data);

    await expect(
      buildCourseVideoSource({
        archiveSha256,
        manifest: manifest(),
        entries: unsafe,
        curatedLinks: [],
      }),
    ).rejects.toThrow(/Bilibili|external URL/i);
  });

  it("rejects declared counts that do not match the archive", async () => {
    const invalidManifest = manifest();
    invalidManifest.expected.series = 9;

    await expect(
      buildCourseVideoSource({
        archiveSha256,
        manifest: invalidManifest,
        entries: entries(),
        curatedLinks: [],
      }),
    ).rejects.toThrow(/series count/i);
  });

  it("rejects duplicate BV series before assigning stable ids", async () => {
    const duplicated = entries();
    const second = duplicated[1]!;
    const data = JSON.parse((await second.read()).toString("utf8")) as {
      课程列表: Array<{
        BV号: string;
        网址: string;
        分集列表: Array<{ 分集网址: string }>;
      }>;
    };
    data.课程列表[0]!.BV号 = "BVTEST0";
    data.课程列表[0]!.网址 = "https://www.bilibili.com/video/BVTEST0";
    data.课程列表[0]!.分集列表[0]!.分集网址 = "https://www.bilibili.com/video/BVTEST0?p=1";
    duplicated[1] = jsonEntry(second.path, data);

    await expect(
      buildCourseVideoSource({
        archiveSha256,
        manifest: manifest(),
        entries: duplicated,
        curatedLinks: [],
      }),
    ).rejects.toThrow(/duplicate.*BV/i);
  });

  it("rejects a curated concept link that does not resolve to an episode", async () => {
    await expect(
      buildCourseVideoSource({
        archiveSha256,
        manifest: manifest(),
        entries: entries(),
        curatedLinks: [{
          courseSlug: "data-structures",
          conceptId: "ds_c01_01",
          bvId: "BVMISSING",
          episodeNumber: 1,
          displayRole: "primary",
          ordinal: 1,
          matchMethod: "metadata_title_review",
          matchConfidence: 0.98,
          reviewStatus: "approved",
          reviewNote: "test",
        }],
      }),
    ).rejects.toThrow(/unknown episode/i);
  });
});
