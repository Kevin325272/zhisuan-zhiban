import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { posix } from "node:path";

import { z } from "zod";
import { Open } from "unzipper";

export interface CourseSourceArchiveEntry {
  path: string;
  uncompressedSize: number;
  read(): Promise<Buffer>;
}

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const courseIdSchema = z.enum(["course_408_ds", "course_408_os", "course_408_cn"]);

const bookSchema = z.object({
  book_id: z.string().min(1),
  title: z.string().min(1),
  course: z.string().min(1),
  course_id: courseIdSchema,
  version: z.string().min(1),
  isbn: z.string().min(1),
  language: z.string().min(1),
  source_files: z.array(z.string().min(1)).min(1),
  license_status: z.literal("unverified"),
  usage_boundary: z.literal("local_demo_only"),
}).passthrough();

const chunkFigureSchema = z.object({
  figure_asset_id: z.string().min(1),
  figure_no: z.string().min(1),
  title: z.string().min(1),
  image: z.string().min(1),
  fallback_png: z.string().min(1),
  review_status: z.enum(["machine_verified", "human_verified", "needs_human_review"]),
}).passthrough();

const chunkSchema = z.object({
  chunk_id: z.string().min(1),
  chapter: z.string().min(1),
  title: z.string().min(1),
  printed_page: z.number().int().positive(),
  content_type: z.string().min(1),
  text: z.string().min(1),
  keywords: z.array(z.string()),
  figures: z.array(chunkFigureSchema),
  quality_score: z.number().min(0).max(1),
  needs_review: z.boolean(),
}).passthrough();

const courseJsonSchema = z.object({
  schema_version: z.literal("2.1"),
  generated_at: z.string().datetime({ offset: true }),
  book: bookSchema,
  data_contract: z.record(z.string(), z.string()),
  statistics: z.object({
    chunks: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    figures: z.number().int().nonnegative(),
    chunks_needing_review: z.number().int().nonnegative(),
  }).passthrough(),
  chunks: z.array(chunkSchema).min(1),
}).passthrough();

const assetSchema = z.object({
  figure_asset_id: z.string().min(1),
  figure_no: z.string().min(1),
  title: z.string().min(1),
  course_id: courseIdSchema,
  chapter: z.string().min(1),
  source_document: z.string().min(1),
  version: z.string().min(1),
  isbn: z.string().min(1),
  printed_page: z.number().int().positive(),
  physical_page: z.number().int().positive(),
  crop_rect: z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).strict(),
  sha256: sha256Schema,
  review_status: z.enum(["machine_verified", "human_verified", "needs_human_review"]),
  license_status: z.literal("unverified"),
  usage_boundary: z.literal("local_demo_only"),
  source_file: z.string().min(1),
  source_part: z.string().min(1),
  combined_physical_page: z.number().int().positive(),
  crop_coordinate_space: z.string().min(1),
  source_page_size: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
  png_path: z.string().min(1),
  webp_path: z.string().min(1),
  webp_sha256: sha256Schema,
  pixel_size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  ocr_caption: z.string(),
  ocr_confidence: z.number().min(0).max(1),
  ocr_correction: z.string(),
  quality_checks: z.record(z.string(), z.boolean()),
  ink_ratio: z.number().min(0).max(1),
}).passthrough();

const assetManifestSchema = z.object({
  schema_version: z.literal("1.0"),
  generated_at: z.string().datetime({ offset: true }),
  visibility: z.literal("backend_only"),
  assets: z.array(assetSchema),
}).passthrough();

const relationSchema = z.object({
  source_chunk_id: z.string().min(1),
  figure_asset_id: z.string().min(1),
  anchor: z.string().min(1),
  display_role: z.string().min(1),
  confidence: z.enum(["high", "medium", "low", "unknown"]),
  source_document: z.string().min(1),
  printed_page: z.number().int().positive(),
}).passthrough();

const relationManifestSchema = z.object({
  schema_version: z.literal("1.0"),
  generated_at: z.string().datetime({ offset: true }),
  relations: z.array(relationSchema),
}).passthrough();

export interface SourceCourseSummary {
  courseId: z.infer<typeof courseIdSchema>;
  bookId: string;
  title: string;
  courseLabel: string;
  version: string;
  isbn: string;
  sourceFiles: string[];
  schemaVersion: "2.1";
  generatedAt: string;
  chunks: number;
  chapters: string[];
  figures: number;
  figuresWithFiles: number;
  figuresNeedsHumanReview: number;
  chunksNeedsReview: number;
  qualityScoreMedian: number;
  licenseStatus: "unverified";
  usageBoundary: "local_demo_only";
}

export interface SourceChunkRecord {
  chunkId: string;
  courseId: z.infer<typeof courseIdSchema>;
  sourceItemId: string;
  chapter: string;
  title: string;
  printedPage: number;
  contentType: string;
  text: string;
  keywords: string[];
  qualityScore: number;
  needsReview: boolean;
  ordinal: number;
}

export interface SourceFigureAssetRecord {
  figureAssetId: string;
  courseId: z.infer<typeof courseIdSchema>;
  figureNo: string;
  title: string;
  chapter: string;
  sourceDocument: string;
  version: string;
  isbn: string;
  printedPage: number;
  physicalPage: number;
  cropRect: { x: number; y: number; width: number; height: number };
  assetSha256: string;
  pngSha256: string;
  webpSha256: string;
  pngPath: string;
  webpPath: string;
  sourceFile: string;
  sourcePart: string;
  combinedPhysicalPage: number;
  cropCoordinateSpace: string;
  sourcePageSize: { width: number; height: number };
  pixelSize: { width: number; height: number };
  ocrCaption: string;
  ocrConfidence: number;
  ocrCorrection: string;
  qualityChecks: Record<string, boolean>;
  inkRatio: number;
  reviewStatus: "machine_verified" | "human_verified" | "needs_human_review";
  licenseStatus: "unverified";
  usageBoundary: "local_demo_only";
  imageAvailable: boolean;
  rawMetadata: Record<string, unknown>;
}

export interface SourceFigureRelationRecord {
  sourceChunkId: string;
  figureAssetId: string;
  anchor: string;
  displayRole: string;
  confidence: "high" | "medium" | "low" | "unknown";
  sourceDocument: string;
  printedPage: number;
}

export interface CourseSourceLayer {
  datasetId: "408-three-course-source-v1";
  archiveSha256: string;
  archiveFileName: string;
  courses: SourceCourseSummary[];
  chunks: SourceChunkRecord[];
  figureAssets: SourceFigureAssetRecord[];
  relations: SourceFigureRelationRecord[];
  counts: {
    courses: number;
    chunks: number;
    figures: number;
    relations: number;
    displayableFigures: number;
    needsHumanReviewFigures: number;
  };
}

function isSafeRelativeArchivePath(value: string): boolean {
  if (!value || value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:/u.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function normalizeSha256(value: string) {
  return sha256Schema.parse(value.toLowerCase());
}

function hash(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson<T>(bytes: Buffer, label: string): T {
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON.`, { cause: error });
  }
}

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function resolveReferencedEntry(entries: Map<string, CourseSourceArchiveEntry>, path: string) {
  if (!isSafeRelativeArchivePath(path)) throw new Error(`Unsafe source asset path: ${path}`);
  const normalized = path.replace(/^\.\//u, "");
  const candidates = [
    normalized,
    `output/${normalized}`,
    `output/pdf/408课本插图资产/${normalized}`,
  ];
  for (const candidate of candidates) {
    const found = entries.get(candidate);
    if (found) return found;
  }
  return null;
}

function assertPng(bytes: Buffer, label: string) {
  if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    throw new Error(`${label} is not a PNG.`);
  }
}

function assertWebp(bytes: Buffer, label: string) {
  if (
    bytes.length < 12
    || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error(`${label} is not a WebP.`);
  }
}

function findJsonEntry(
  entries: Map<string, CourseSourceArchiveEntry>,
  predicate: (path: string) => boolean,
  label: string,
) {
  const matches = [...entries.values()].filter((entry) => predicate(entry.path));
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label} JSON, found ${matches.length}.`);
  return matches[0]!;
}

export async function build408CourseSource(input: {
  archiveSha256: string;
  archiveFileName?: string;
  entries: readonly CourseSourceArchiveEntry[];
}): Promise<CourseSourceLayer> {
  const archiveSha256 = normalizeSha256(input.archiveSha256);
  const entries = new Map<string, CourseSourceArchiveEntry>();
  for (const candidate of input.entries) {
    if (!isSafeRelativeArchivePath(candidate.path)) {
      throw new Error(`Unsafe archive entry path: ${candidate.path}`);
    }
    if (entries.has(candidate.path)) {
      throw new Error(`Duplicate archive entry path: ${candidate.path}`);
    }
    if (candidate.uncompressedSize < 0) throw new Error(`Invalid archive entry size: ${candidate.path}`);
    entries.set(candidate.path, candidate);
  }

  const courseEntries = [...entries.values()]
    .filter((entry) => entry.path.startsWith("output/json/408课本清洗数据/") && entry.path.endsWith(".json"));
  if (courseEntries.length !== 3) {
    throw new Error(`Expected exactly three 408 course JSON files, found ${courseEntries.length}.`);
  }
  const assetEntry = findJsonEntry(entries, (path) => path.endsWith("插图资产清单.json"), "figure asset manifest");
  const relationEntry = findJsonEntry(entries, (path) => path.endsWith("正文插图关联.json"), "figure relation manifest");

  const parsedCourses = [] as Array<z.infer<typeof courseJsonSchema>>;
  for (const entry of courseEntries) {
    const parsed = courseJsonSchema.parse(parseJson<unknown>(await entry.read(), entry.path));
    parsedCourses.push(parsed);
  }
  const courseIds = parsedCourses.map((course) => course.book.course_id);
  if (new Set(courseIds).size !== 3 || !["course_408_ds", "course_408_os", "course_408_cn"].every((id) => courseIds.includes(id as typeof courseIds[number]))) {
    throw new Error("The source archive must contain data-structures, operating-systems and computer-networks courses exactly once.");
  }

  const assets = assetManifestSchema.parse(parseJson<unknown>(await assetEntry.read(), assetEntry.path)).assets;
  const relations = relationManifestSchema.parse(parseJson<unknown>(await relationEntry.read(), relationEntry.path)).relations;
  const assetById = new Map<string, z.infer<typeof assetSchema>>();
  for (const asset of assets) {
    if (assetById.has(asset.figure_asset_id)) throw new Error(`Duplicate figure asset: ${asset.figure_asset_id}`);
    assetById.set(asset.figure_asset_id, asset);
  }

  const chunkById = new Map<string, { course: z.infer<typeof courseJsonSchema>; chunk: z.infer<typeof chunkSchema>; ordinal: number }>();
  const normalizedChunks: SourceChunkRecord[] = [];
  const summaries: SourceCourseSummary[] = [];
  for (const course of parsedCourses) {
    if (course.statistics.chunks !== course.chunks.length) {
      throw new Error(`${course.book.course_id} declared chunk count does not match JSON.`);
    }
    const figureReferences = course.chunks.flatMap((chunk) => chunk.figures);
    if (course.statistics.figures !== figureReferences.length) {
      throw new Error(`${course.book.course_id} declared figure count does not match chunk references.`);
    }
    const needsReviewCount = course.chunks.filter((chunk) => chunk.needs_review).length;
    if (course.statistics.chunks_needing_review !== needsReviewCount) {
      throw new Error(`${course.book.course_id} declared needs_review count does not match JSON.`);
    }
    const localIds = new Set<string>();
    for (const [ordinal, chunk] of course.chunks.entries()) {
      if (localIds.has(chunk.chunk_id) || chunkById.has(chunk.chunk_id)) throw new Error(`Duplicate chunk: ${chunk.chunk_id}`);
      localIds.add(chunk.chunk_id);
      chunkById.set(chunk.chunk_id, { course, chunk, ordinal });
      normalizedChunks.push({
        chunkId: chunk.chunk_id,
        courseId: course.book.course_id,
        sourceItemId: chunk.chunk_id,
        chapter: chunk.chapter,
        title: chunk.title,
        printedPage: chunk.printed_page,
        contentType: chunk.content_type,
        text: chunk.text,
        keywords: chunk.keywords,
        qualityScore: chunk.quality_score,
        needsReview: chunk.needs_review,
        ordinal,
      });
    }
    const qualityScores = course.chunks.map((chunk) => chunk.quality_score);
    summaries.push({
      courseId: course.book.course_id,
      bookId: course.book.book_id,
      title: course.book.title,
      courseLabel: course.book.course,
      version: course.book.version,
      isbn: course.book.isbn,
      sourceFiles: course.book.source_files,
      schemaVersion: course.schema_version,
      generatedAt: new Date(course.generated_at).toISOString(),
      chunks: course.chunks.length,
      chapters: [...new Set(course.chunks.map((chunk) => chunk.chapter))],
      figures: figureReferences.length,
      figuresWithFiles: 0,
      figuresNeedsHumanReview: 0,
      chunksNeedsReview: needsReviewCount,
      qualityScoreMedian: median(qualityScores),
      licenseStatus: course.book.license_status,
      usageBoundary: course.book.usage_boundary,
    });
  }

  const normalizedAssets: SourceFigureAssetRecord[] = [];
  for (const asset of assets) {
    const pngEntry = resolveReferencedEntry(entries, asset.png_path);
    const webpEntry = resolveReferencedEntry(entries, asset.webp_path);
    const present = Boolean(pngEntry && webpEntry);
    if ((pngEntry && !webpEntry) || (!pngEntry && webpEntry)) {
      throw new Error(`Figure ${asset.figure_asset_id} has an incomplete PNG/WebP pair.`);
    }
    if (!present && asset.review_status !== "needs_human_review") {
      throw new Error(`Machine-verified figure ${asset.figure_asset_id} has no image files.`);
    }
    if (present) {
      const pngBytes = await pngEntry!.read();
      const webpBytes = await webpEntry!.read();
      assertPng(pngBytes, asset.figure_asset_id);
      assertWebp(webpBytes, asset.figure_asset_id);
      if (hash(pngBytes) !== asset.sha256.toLowerCase()) throw new Error(`PNG SHA256 mismatch for ${asset.figure_asset_id}.`);
      if (hash(webpBytes) !== asset.webp_sha256.toLowerCase()) throw new Error(`WebP SHA256 mismatch for ${asset.figure_asset_id}.`);
    }
    normalizedAssets.push({
      figureAssetId: asset.figure_asset_id,
      courseId: asset.course_id,
      figureNo: asset.figure_no,
      title: asset.title,
      chapter: asset.chapter,
      sourceDocument: asset.source_document,
      version: asset.version,
      isbn: asset.isbn,
      printedPage: asset.printed_page,
      physicalPage: asset.physical_page,
      cropRect: asset.crop_rect,
      assetSha256: asset.sha256,
      pngSha256: asset.sha256,
      webpSha256: asset.webp_sha256,
      pngPath: asset.png_path,
      webpPath: asset.webp_path,
      sourceFile: asset.source_file,
      sourcePart: asset.source_part,
      combinedPhysicalPage: asset.combined_physical_page,
      cropCoordinateSpace: asset.crop_coordinate_space,
      sourcePageSize: asset.source_page_size,
      pixelSize: asset.pixel_size,
      ocrCaption: asset.ocr_caption,
      ocrConfidence: asset.ocr_confidence,
      ocrCorrection: asset.ocr_correction,
      qualityChecks: asset.quality_checks,
      inkRatio: asset.ink_ratio,
      reviewStatus: asset.review_status,
      licenseStatus: asset.license_status,
      usageBoundary: asset.usage_boundary,
      imageAvailable: present,
      rawMetadata: asset,
    });
  }

  const normalizedRelations: SourceFigureRelationRecord[] = [];
  for (const relation of relations) {
    const sourceChunk = chunkById.get(relation.source_chunk_id);
    const asset = assetById.get(relation.figure_asset_id);
    if (!sourceChunk || !asset) throw new Error(`Relation references an unknown chunk or figure: ${relation.source_chunk_id}/${relation.figure_asset_id}`);
    if (asset.course_id !== sourceChunk.course.book.course_id || asset.source_document !== relation.source_document || asset.printed_page !== relation.printed_page) {
      throw new Error(`Relation metadata does not match its source: ${relation.source_chunk_id}/${relation.figure_asset_id}`);
    }
    normalizedRelations.push({
      sourceChunkId: relation.source_chunk_id,
      figureAssetId: relation.figure_asset_id,
      anchor: relation.anchor,
      displayRole: relation.display_role,
      confidence: relation.confidence,
      sourceDocument: relation.source_document,
      printedPage: relation.printed_page,
    });
  }

  const referencedAssetIds = new Set(normalizedRelations.map((relation) => relation.figureAssetId));
  if (referencedAssetIds.size !== normalizedRelations.length) throw new Error("Duplicate chunk-to-figure relation.");
  const summaryByCourse = new Map(summaries.map((summary) => [summary.courseId, summary]));
  for (const asset of normalizedAssets) {
    const summary = summaryByCourse.get(asset.courseId)!;
    if (asset.imageAvailable) summary.figuresWithFiles += 1;
    if (asset.reviewStatus === "needs_human_review") summary.figuresNeedsHumanReview += 1;
  }

  return {
    datasetId: "408-three-course-source-v1",
    archiveSha256,
    archiveFileName: input.archiveFileName ?? "output.zip",
    courses: summaries.sort((left, right) => {
      const order = { course_408_ds: 1, course_408_os: 2, course_408_cn: 3 } as const;
      return order[left.courseId] - order[right.courseId];
    }),
    chunks: normalizedChunks,
    figureAssets: normalizedAssets,
    relations: normalizedRelations,
    counts: {
      courses: summaries.length,
      chunks: normalizedChunks.length,
      figures: normalizedAssets.length,
      relations: normalizedRelations.length,
      displayableFigures: normalizedAssets.filter((asset) => asset.imageAvailable).length,
      needsHumanReviewFigures: normalizedAssets.filter((asset) => asset.reviewStatus === "needs_human_review").length,
    },
  };
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return digest.digest("hex");
}

export async function load408CourseSourceArchive(input: {
  archivePath: string;
  expectedArchiveSha256: string;
}): Promise<CourseSourceLayer> {
  const expected = normalizeSha256(input.expectedArchiveSha256);
  const actual = await sha256File(input.archivePath);
  if (actual !== expected) throw new Error("408 source archive SHA256 does not match the tracked manifest.");
  const directory = await Open.file(input.archivePath);
  const files = directory.files.filter((entry) => entry.type === "File");
  return build408CourseSource({
    archiveSha256: actual,
    archiveFileName: basename(input.archivePath),
    entries: files.map((file) => ({
      path: file.path,
      uncompressedSize: file.uncompressedSize,
      read: () => file.buffer(),
    })),
  });
}

export function isSafe408ArchivePath(value: string) {
  return isSafeRelativeArchivePath(value);
}

export function resolve408AssetPath(path: string) {
  if (!isSafeRelativeArchivePath(path)) throw new Error(`Unsafe source asset path: ${path}`);
  return posix.normalize(`output/pdf/408课本插图资产/${path.replace(/^\.\//u, "")}`);
}
