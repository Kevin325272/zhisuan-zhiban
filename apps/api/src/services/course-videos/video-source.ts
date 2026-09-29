import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { Open } from "unzipper";
import { z } from "zod";

export interface CourseVideoArchiveEntry {
  path: string;
  uncompressedSize: number;
  read(): Promise<Buffer>;
}

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const courseSlugSchema = z.enum([
  "data-structures",
  "computer-organization",
  "operating-systems",
  "computer-networks",
]);
const courseIdSchema = z.enum([
  "course_408_ds",
  "course_408_co",
  "course_408_os",
  "course_408_cn",
]);
const videoKindSchema = z.enum(["teaching", "question_explanation"]);
const sourceSubjectSchema = z.enum([
  "数据结构",
  "计算机组成原理",
  "操作系统",
  "计算机网络",
]);
const sourceKindSchema = z.enum(["教学", "题目讲解"]);
const bvIdSchema = z.string().regex(/^BV[0-9A-Za-z]+$/u);

const manifestSchema = z.object({
  schema_version: z.literal("1.0"),
  dataset_id: z.string().min(1),
  archive_file: z.string().min(1),
  archive_sha256: sha256Schema,
  source_provider: z.string().min(1),
  original_path: z.string().min(1),
  collected_at: z.string().datetime({ offset: true }),
  license_status: z.literal("unverified"),
  usage_scope: z.literal("local_demo_only"),
  review_status: z.enum(["pending_review", "approved", "rejected"]),
  content_mode: z.literal("external_links_only"),
  expected: z.object({
    json_files: z.number().int().positive(),
    series: z.number().int().nonnegative(),
    episodes: z.number().int().nonnegative(),
    subjects: z.number().int().positive(),
    platforms: z.array(z.literal("www.bilibili.com")).length(1),
  }).strict(),
  notice: z.string().min(1),
}).strict();

const episodeSchema = z.object({
  分集序号: z.number().int().positive(),
  分集标题: z.string().min(1),
  分集时长: z.string().min(1),
  分集秒数: z.number().int().nonnegative(),
  分集网址: z.string().min(1),
  CID: z.union([z.string().min(1), z.number().int().nonnegative()]),
}).passthrough();

const seriesSchema = z.object({
  BV号: bvIdSchema,
  视频名称: z.string().min(1),
  UP主: z.string().min(1),
  总秒数: z.number().int().nonnegative(),
  总时间: z.string().min(1),
  分P数: z.number().int().positive(),
  播放量: z.number().int().nonnegative(),
  点赞数: z.number().int().nonnegative(),
  收藏数: z.number().int().nonnegative(),
  投币数: z.number().int().nonnegative(),
  弹幕数: z.number().int().nonnegative(),
  评论数: z.number().int().nonnegative(),
  投稿日期: z.string(),
  简介: z.string(),
  网址: z.string().min(1),
  分集列表: z.array(episodeSchema).min(1),
  序号: z.number().int().positive(),
  科目: sourceSubjectSchema,
  类型: sourceKindSchema,
  命中搜索词: z.string(),
  采集时间: z.string().min(1),
}).passthrough();

const sourceFileSchema = z.object({
  科目: sourceSubjectSchema,
  类型: sourceKindSchema,
  采集时间: z.string().min(1),
  课程数量: z.number().int().nonnegative(),
  分集总数: z.number().int().nonnegative(),
  课程列表: z.array(seriesSchema),
}).passthrough();

export interface CourseVideoCuratedLinkInput {
  courseSlug: z.infer<typeof courseSlugSchema>;
  conceptId: string;
  bvId: string;
  episodeNumber: number;
  displayRole: "primary" | "related";
  ordinal: number;
  matchMethod: "metadata_title_review";
  matchConfidence: number;
  reviewStatus: "approved" | "pending_review" | "rejected";
  reviewNote: string;
}

const curatedLinkSchema = z.object({
  courseSlug: courseSlugSchema,
  conceptId: z.string().min(1),
  bvId: bvIdSchema,
  episodeNumber: z.number().int().positive(),
  displayRole: z.enum(["primary", "related"]),
  ordinal: z.number().int().positive(),
  matchMethod: z.literal("metadata_title_review"),
  matchConfidence: z.number().min(0).max(1),
  reviewStatus: z.enum(["approved", "pending_review", "rejected"]),
  reviewNote: z.string().min(1),
}).strict();

const curatedFileSchema = z.object({
  schema_version: z.literal("1.0"),
  curation_method: z.literal("metadata_title_review"),
  review_scope: z.string().min(1),
  usage_scope: z.literal("local_demo_only"),
  license_status: z.literal("unverified"),
  links: z.array(z.object({
    course_slug: courseSlugSchema,
    concept_id: z.string().min(1),
    bv_id: bvIdSchema,
    episode_number: z.number().int().positive(),
    display_role: z.enum(["primary", "related"]),
    ordinal: z.number().int().positive(),
    match_method: z.literal("metadata_title_review"),
    match_confidence: z.number().min(0).max(1),
    review_status: z.enum(["approved", "pending_review", "rejected"]),
    review_note: z.string().min(1),
  }).strict()),
}).strict();

const courseBySubject = {
  数据结构: { courseId: "course_408_ds", courseSlug: "data-structures" },
  计算机组成原理: { courseId: "course_408_co", courseSlug: "computer-organization" },
  操作系统: { courseId: "course_408_os", courseSlug: "operating-systems" },
  计算机网络: { courseId: "course_408_cn", courseSlug: "computer-networks" },
} as const satisfies Record<
  z.infer<typeof sourceSubjectSchema>,
  { courseId: z.infer<typeof courseIdSchema>; courseSlug: z.infer<typeof courseSlugSchema> }
>;

const kindBySource = {
  教学: "teaching",
  题目讲解: "question_explanation",
} as const satisfies Record<z.infer<typeof sourceKindSchema>, z.infer<typeof videoKindSchema>>;

export interface CourseVideoImportBatchRecord {
  importBatchId: string;
  datasetId: string;
  archiveFileName: string;
  archiveSha256: string;
  sourceProvider: string;
  originalPath: string;
  collectedAt: string;
  licenseStatus: "unverified";
  usageScope: "local_demo_only";
  reviewStatus: "pending_review" | "approved" | "rejected";
  contentMode: "external_links_only";
  notice: string;
  rawManifest: Record<string, unknown>;
}

export interface CourseVideoSeriesRecord {
  seriesId: string;
  importBatchId: string;
  courseId: z.infer<typeof courseIdSchema>;
  courseSlug: z.infer<typeof courseSlugSchema>;
  subjectLabel: z.infer<typeof sourceSubjectSchema>;
  kind: z.infer<typeof videoKindSchema>;
  platform: "bilibili";
  bvId: string;
  title: string;
  uploader: string;
  totalSeconds: number;
  totalDuration: string;
  episodeCount: number;
  canonicalUrl: string;
  description: string;
  publishedOn: string;
  sourceCollectedAt: string;
  licenseStatus: "unverified";
  usageScope: "local_demo_only";
  reviewStatus: "pending_review" | "approved" | "rejected";
  rawMetadata: Record<string, unknown>;
}

export interface CourseVideoEpisodeRecord {
  episodeId: string;
  seriesId: string;
  bvId: string;
  episodeNumber: number;
  title: string;
  duration: string;
  durationSeconds: number;
  externalUrl: string;
  cid: string;
  rawMetadata: Record<string, unknown>;
}

export interface CourseConceptVideoLinkRecord {
  linkId: string;
  courseId: z.infer<typeof courseIdSchema>;
  courseSlug: z.infer<typeof courseSlugSchema>;
  conceptId: string;
  seriesId: string;
  episodeId: string;
  displayRole: "primary" | "related";
  ordinal: number;
  matchMethod: "metadata_title_review";
  matchConfidence: number;
  reviewStatus: "approved" | "pending_review" | "rejected";
  reviewNote: string;
}

export interface CourseVideoSource {
  importBatch: CourseVideoImportBatchRecord;
  series: CourseVideoSeriesRecord[];
  episodes: CourseVideoEpisodeRecord[];
  curatedLinks: CourseConceptVideoLinkRecord[];
  counts: { jsonFiles: number; series: number; episodes: number; subjects: number };
}

function isSafeArchivePath(value: string) {
  if (!value || value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON.`, { cause: error });
  }
}

function assertBilibiliUrl(value: string, bvId: string, episodeNumber?: number) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`Invalid Bilibili external URL for ${bvId}.`, { cause: error });
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "www.bilibili.com"
    || url.username
    || url.password
    || url.pathname !== `/video/${bvId}`
  ) {
    throw new Error(`Invalid Bilibili external URL for ${bvId}.`);
  }
  if (episodeNumber !== undefined) {
    const part = url.searchParams.get("p");
    if (part !== String(episodeNumber) && !(episodeNumber === 1 && part === null)) {
      throw new Error(`Bilibili episode URL does not match episode ${episodeNumber} for ${bvId}.`);
    }
  }
  return url.toString();
}

function seriesId(bvId: string) {
  return `course_video_series_${bvId}`;
}

function episodeId(bvId: string, episodeNumber: number) {
  return `course_video_episode_${bvId}_${String(episodeNumber).padStart(4, "0")}`;
}

function assertExpectedCount(label: string, actual: number, expected: number) {
  if (actual !== expected) throw new Error(`${label} count mismatch: expected ${expected}, found ${actual}.`);
}

export async function buildCourseVideoSource(input: {
  archiveSha256: string;
  archiveFileName?: string;
  manifest: unknown;
  entries: readonly CourseVideoArchiveEntry[];
  curatedLinks: readonly CourseVideoCuratedLinkInput[];
}): Promise<CourseVideoSource> {
  const archiveSha256 = sha256Schema.parse(input.archiveSha256.toLowerCase());
  const manifest = manifestSchema.parse(input.manifest);
  if (manifest.archive_sha256 !== archiveSha256) {
    throw new Error("Course video archive SHA256 does not match the tracked manifest.");
  }
  if (input.archiveFileName && manifest.archive_file !== input.archiveFileName) {
    throw new Error("Course video archive file name does not match the tracked manifest.");
  }

  const seenPaths = new Set<string>();
  for (const entry of input.entries) {
    if (!isSafeArchivePath(entry.path)) throw new Error(`Unsafe archive entry path: ${entry.path}`);
    if (seenPaths.has(entry.path)) throw new Error(`Duplicate archive entry path: ${entry.path}`);
    if (entry.uncompressedSize < 0) throw new Error(`Invalid archive entry size: ${entry.path}`);
    seenPaths.add(entry.path);
  }
  const jsonEntries = input.entries.filter((entry) => entry.path.endsWith(".json"));
  assertExpectedCount("JSON file", jsonEntries.length, manifest.expected.json_files);

  const parsedFiles = [] as Array<z.infer<typeof sourceFileSchema>>;
  const subjectKindPairs = new Set<string>();
  for (const entry of jsonEntries) {
    const parsed = sourceFileSchema.parse(parseJson(await entry.read(), entry.path));
    const expectedSuffix = `${parsed.科目}_${parsed.类型}视频网址.json`;
    if (!entry.path.endsWith(expectedSuffix)) {
      throw new Error(`Course video source file name does not match its subject/type: ${entry.path}.`);
    }
    const pair = `${parsed.科目}/${parsed.类型}`;
    if (subjectKindPairs.has(pair)) throw new Error(`Duplicate course video subject/type source: ${pair}.`);
    subjectKindPairs.add(pair);
    assertExpectedCount(`${entry.path} series`, parsed.课程列表.length, parsed.课程数量);
    assertExpectedCount(
      `${entry.path} episode`,
      parsed.课程列表.reduce((total, series) => total + series.分集列表.length, 0),
      parsed.分集总数,
    );
    parsedFiles.push(parsed);
  }

  const normalizedSeries: CourseVideoSeriesRecord[] = [];
  const normalizedEpisodes: CourseVideoEpisodeRecord[] = [];
  const seriesByBvId = new Map<string, CourseVideoSeriesRecord>();
  const episodeByKey = new Map<string, CourseVideoEpisodeRecord>();

  for (const sourceFile of parsedFiles) {
    const course = courseBySubject[sourceFile.科目];
    const kind = kindBySource[sourceFile.类型];
    for (const rawSeries of sourceFile.课程列表) {
      if (rawSeries.科目 !== sourceFile.科目 || rawSeries.类型 !== sourceFile.类型) {
        throw new Error(`Series metadata does not match its source file: ${rawSeries.BV号}.`);
      }
      if (seriesByBvId.has(rawSeries.BV号)) throw new Error(`Duplicate BV series: ${rawSeries.BV号}.`);
      assertExpectedCount(`${rawSeries.BV号} episode`, rawSeries.分集列表.length, rawSeries.分P数);
      const normalized: CourseVideoSeriesRecord = {
        seriesId: seriesId(rawSeries.BV号),
        importBatchId: manifest.dataset_id,
        courseId: course.courseId,
        courseSlug: course.courseSlug,
        subjectLabel: sourceFile.科目,
        kind,
        platform: "bilibili",
        bvId: rawSeries.BV号,
        title: rawSeries.视频名称,
        uploader: rawSeries.UP主,
        totalSeconds: rawSeries.总秒数,
        totalDuration: rawSeries.总时间,
        episodeCount: rawSeries.分P数,
        canonicalUrl: assertBilibiliUrl(rawSeries.网址, rawSeries.BV号),
        description: rawSeries.简介,
        publishedOn: rawSeries.投稿日期,
        sourceCollectedAt: rawSeries.采集时间,
        licenseStatus: manifest.license_status,
        usageScope: manifest.usage_scope,
        reviewStatus: manifest.review_status,
        rawMetadata: rawSeries,
      };
      normalizedSeries.push(normalized);
      seriesByBvId.set(normalized.bvId, normalized);

      for (const rawEpisode of rawSeries.分集列表) {
        const key = `${rawSeries.BV号}/${rawEpisode.分集序号}`;
        if (episodeByKey.has(key)) throw new Error(`Duplicate course video episode: ${key}.`);
        const episode: CourseVideoEpisodeRecord = {
          episodeId: episodeId(rawSeries.BV号, rawEpisode.分集序号),
          seriesId: normalized.seriesId,
          bvId: normalized.bvId,
          episodeNumber: rawEpisode.分集序号,
          title: rawEpisode.分集标题,
          duration: rawEpisode.分集时长,
          durationSeconds: rawEpisode.分集秒数,
          externalUrl: assertBilibiliUrl(
            rawEpisode.分集网址,
            rawSeries.BV号,
            rawEpisode.分集序号,
          ),
          cid: String(rawEpisode.CID),
          rawMetadata: rawEpisode,
        };
        normalizedEpisodes.push(episode);
        episodeByKey.set(key, episode);
      }
    }
  }

  const subjects = new Set(normalizedSeries.map((series) => series.courseId));
  assertExpectedCount("series", normalizedSeries.length, manifest.expected.series);
  assertExpectedCount("episode", normalizedEpisodes.length, manifest.expected.episodes);
  assertExpectedCount("subject", subjects.size, manifest.expected.subjects);
  if (subjectKindPairs.size !== manifest.expected.json_files) {
    throw new Error("Course video source does not contain every subject/type pair exactly once.");
  }

  const normalizedLinks: CourseConceptVideoLinkRecord[] = [];
  const seenLinks = new Set<string>();
  for (const candidate of input.curatedLinks) {
    const link = curatedLinkSchema.parse(candidate);
    const episode = episodeByKey.get(`${link.bvId}/${link.episodeNumber}`);
    if (!episode) throw new Error(`Curated concept video link references an unknown episode: ${link.bvId}/${link.episodeNumber}.`);
    const series = seriesByBvId.get(link.bvId)!;
    if (series.courseSlug !== link.courseSlug) {
      throw new Error(`Curated concept video link crosses course boundaries: ${link.conceptId}.`);
    }
    const id = `${link.conceptId}/${episode.episodeId}`;
    if (seenLinks.has(id)) throw new Error(`Duplicate curated concept video link: ${id}.`);
    seenLinks.add(id);
    normalizedLinks.push({
      linkId: `course_concept_video_${link.conceptId}_${episode.episodeId}`,
      courseId: series.courseId,
      courseSlug: series.courseSlug,
      conceptId: link.conceptId,
      seriesId: series.seriesId,
      episodeId: episode.episodeId,
      displayRole: link.displayRole,
      ordinal: link.ordinal,
      matchMethod: link.matchMethod,
      matchConfidence: link.matchConfidence,
      reviewStatus: link.reviewStatus,
      reviewNote: link.reviewNote,
    });
  }

  return {
    importBatch: {
      importBatchId: manifest.dataset_id,
      datasetId: manifest.dataset_id,
      archiveFileName: manifest.archive_file,
      archiveSha256,
      sourceProvider: manifest.source_provider,
      originalPath: manifest.original_path,
      collectedAt: new Date(manifest.collected_at).toISOString(),
      licenseStatus: manifest.license_status,
      usageScope: manifest.usage_scope,
      reviewStatus: manifest.review_status,
      contentMode: manifest.content_mode,
      notice: manifest.notice,
      rawManifest: manifest,
    },
    series: normalizedSeries,
    episodes: normalizedEpisodes,
    curatedLinks: normalizedLinks,
    counts: {
      jsonFiles: jsonEntries.length,
      series: normalizedSeries.length,
      episodes: normalizedEpisodes.length,
      subjects: subjects.size,
    },
  };
}

function filesystemPath(value: string | URL) {
  return value instanceof URL ? fileURLToPath(value) : value;
}

async function sha256File(path: string) {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return digest.digest("hex");
}

export async function loadCourseVideoSourceArchive(input: {
  archivePath: string | URL;
  manifestPath: string | URL;
  curatedLinksPath: string | URL;
}): Promise<CourseVideoSource> {
  const archivePath = filesystemPath(input.archivePath);
  const manifest = manifestSchema.parse(
    parseJson(await readFile(filesystemPath(input.manifestPath)), "Course video manifest"),
  );
  const curated = curatedFileSchema.parse(
    parseJson(await readFile(filesystemPath(input.curatedLinksPath)), "Course video curation manifest"),
  );
  if (curated.license_status !== manifest.license_status || curated.usage_scope !== manifest.usage_scope) {
    throw new Error("Course video curation boundary does not match the source manifest.");
  }
  const archiveSha256 = await sha256File(archivePath);
  const directory = await Open.file(archivePath);
  const entries: CourseVideoArchiveEntry[] = directory.files
    .filter((entry) => entry.type === "File")
    .map((entry) => ({
      path: entry.path,
      uncompressedSize: entry.uncompressedSize,
      read: () => entry.buffer(),
    }));
  return buildCourseVideoSource({
    archiveSha256,
    archiveFileName: basename(archivePath),
    manifest,
    entries,
    curatedLinks: curated.links.map((link) => ({
      courseSlug: link.course_slug,
      conceptId: link.concept_id,
      bvId: link.bv_id,
      episodeNumber: link.episode_number,
      displayRole: link.display_role,
      ordinal: link.ordinal,
      matchMethod: link.match_method,
      matchConfidence: link.match_confidence,
      reviewStatus: link.review_status,
      reviewNote: link.review_note,
    })),
  });
}
