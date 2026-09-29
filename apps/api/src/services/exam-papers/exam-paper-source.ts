import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename, posix } from "node:path";

import { z } from "zod";
import { Open } from "unzipper";

import type {
  ExamPaperContentMode,
  ExamPaperType,
  ReviewStatus,
} from "@xuetu/contracts";

export interface ExamPaperArchiveEntry {
  path: string;
  uncompressedSize: number;
  read(): Promise<Buffer>;
}

export interface ExamPaperSourceRecord {
  examPaperId: string;
  university: string;
  year: number;
  subject: string;
  paperType: ExamPaperType;
  pageCount: number;
  fileSizeBytes: number;
  contentMode: ExamPaperContentMode;
  officialSourceUrl: string;
  landingPageUrl: string;
  archiveEntry: string;
  pdfSha256: string;
  archiveSha256: string;
  trainingAllowed: false;
  licenseStatus: "unverified";
  usageScope: "local_demo_only";
  reviewStatus: ReviewStatus;
}

export interface ExamPaperSource {
  datasetId: "self-authored-computer-exams-2017-2026";
  sourceProvider: "official_university_websites";
  generatedAt: string;
  archiveSha256: string;
  archiveFileName: string;
  manifestEntry: string;
  failureCount: number;
  records: ExamPaperSourceRecord[];
  counts: {
    papers: number;
    pages: number;
    bytes: number;
    scans: number;
    textLayer: number;
  };
}

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const sourceRecordSchema = z
  .object({
    university: z.string().min(1).max(200),
    year: z.number().int().min(1900).max(2100),
    subject: z.string().min(1).max(300),
    paper_type: z.enum(["试题", "样题"]),
    path: z.string().min(1).max(2_000),
    url: z.string().url(),
    landing_url: z.string().url(),
    source_member: z.unknown().nullable(),
    status: z.string().min(1).max(100),
    training_allowed: z.boolean(),
    pages: z.number().int().positive(),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    han_chars_sample: z.number().int().nonnegative(),
    language_check: z.enum([
      "中文文本通过",
      "官网扫描件/低文本量，已通过页面渲染",
    ]),
  })
  .strict();

const archiveManifestSchema = z
  .object({
    generated_at: z.string().min(1),
    scope: z.string().min(1),
    directory_rule: z.string().min(1),
    notice: z.string().min(1),
    counts: z
      .object({
        pdfs: z.number().int().nonnegative(),
        pages: z.number().int().nonnegative(),
        bytes: z.number().int().nonnegative(),
        by_school: z.record(z.string(), z.number().int().nonnegative()),
        by_year: z.record(z.string(), z.number().int().nonnegative()),
        by_subject: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    source_pages: z.array(z.unknown()),
    records: z.array(sourceRecordSchema).min(1),
    failures: z.array(z.unknown()),
  })
  .passthrough();

function isSafeRelativeArchivePath(value: string): boolean {
  if (!value || value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function normalizeArchiveSha256(value: string): string {
  const normalized = value.toLowerCase();
  return sha256Schema.parse(normalized);
}

function recordPaperType(value: "试题" | "样题"): ExamPaperType {
  return value === "试题" ? "exam" : "sample";
}

function recordContentMode(
  value: "中文文本通过" | "官网扫描件/低文本量，已通过页面渲染",
): ExamPaperContentMode {
  return value === "中文文本通过" ? "text_layer" : "scan";
}

export async function buildExamPaperSource(input: {
  archiveSha256: string;
  manifest: unknown;
  manifestEntryPath: string;
  entries: readonly ExamPaperArchiveEntry[];
  archiveFileName?: string;
}): Promise<ExamPaperSource> {
  const archiveSha256 = normalizeArchiveSha256(input.archiveSha256);
  if (!isSafeRelativeArchivePath(input.manifestEntryPath)) {
    throw new Error("Exam-paper manifest uses an unsafe archive path.");
  }
  const manifest = archiveManifestSchema.parse(input.manifest);
  if (!manifest.notice.includes("training_allowed=false")) {
    throw new Error("Exam-paper manifest does not preserve the training_allowed=false notice.");
  }

  const entries = new Map<string, ExamPaperArchiveEntry>();
  for (const candidate of input.entries) {
    if (!isSafeRelativeArchivePath(candidate.path)) {
      throw new Error(`Exam-paper archive contains an unsafe entry path: ${candidate.path}`);
    }
    if (entries.has(candidate.path)) {
      throw new Error(`Exam-paper archive contains a duplicate entry: ${candidate.path}`);
    }
    entries.set(candidate.path, candidate);
  }

  const manifestRoot = posix.dirname(input.manifestEntryPath);
  const recordPaths = new Set<string>();
  const records: ExamPaperSourceRecord[] = [];

  for (const record of manifest.records) {
    if (!isSafeRelativeArchivePath(record.path)) {
      throw new Error(`Exam-paper source record uses an unsafe path: ${record.path}`);
    }
    if (recordPaths.has(record.path)) {
      throw new Error(`Exam-paper source manifest contains a duplicate record path: ${record.path}`);
    }
    recordPaths.add(record.path);
    if (record.training_allowed !== false) {
      throw new Error(`Exam-paper record must keep training_allowed=false: ${record.path}`);
    }

    const archiveEntry = posix.join(manifestRoot, record.path);
    const entry = entries.get(archiveEntry);
    if (!entry) {
      throw new Error(`Exam-paper PDF entry is missing: ${archiveEntry}`);
    }
    if (entry.uncompressedSize !== record.bytes) {
      throw new Error(`Exam-paper byte count does not match the source record: ${archiveEntry}`);
    }
    const bytes = await entry.read();
    if (bytes.byteLength !== record.bytes) {
      throw new Error(`Exam-paper extracted byte count is invalid: ${archiveEntry}`);
    }
    const actualPdfSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualPdfSha256 !== record.sha256.toLowerCase()) {
      throw new Error(`Exam-paper PDF SHA256 does not match the source record: ${archiveEntry}`);
    }
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error(`Exam-paper entry is not a PDF: ${archiveEntry}`);
    }

    records.push({
      examPaperId: `exam_${actualPdfSha256.slice(0, 24)}`,
      university: record.university,
      year: record.year,
      subject: record.subject,
      paperType: recordPaperType(record.paper_type),
      pageCount: record.pages,
      fileSizeBytes: record.bytes,
      contentMode: recordContentMode(record.language_check),
      officialSourceUrl: record.url,
      landingPageUrl: record.landing_url,
      archiveEntry,
      pdfSha256: actualPdfSha256,
      archiveSha256,
      trainingAllowed: false,
      licenseStatus: "unverified",
      usageScope: "local_demo_only",
      reviewStatus: "unreviewed",
    });
  }

  const pages = records.reduce((sum, record) => sum + record.pageCount, 0);
  const bytes = records.reduce((sum, record) => sum + record.fileSizeBytes, 0);
  if (
    records.length !== manifest.counts.pdfs
    || pages !== manifest.counts.pages
    || bytes !== manifest.counts.bytes
  ) {
    throw new Error("Exam-paper source counts do not match the archive manifest.");
  }

  return {
    datasetId: "self-authored-computer-exams-2017-2026",
    sourceProvider: "official_university_websites",
    generatedAt: new Date(manifest.generated_at).toISOString(),
    archiveSha256,
    archiveFileName: input.archiveFileName ?? "自命题试卷.zip",
    manifestEntry: input.manifestEntryPath,
    failureCount: manifest.failures.length,
    records,
    counts: {
      papers: records.length,
      pages,
      bytes,
      scans: records.filter((record) => record.contentMode === "scan").length,
      textLayer: records.filter((record) => record.contentMode === "text_layer").length,
    },
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

export async function loadExamPaperArchive(input: {
  archivePath: string;
  expectedArchiveSha256: string;
}): Promise<ExamPaperSource> {
  const expectedArchiveSha256 = normalizeArchiveSha256(input.expectedArchiveSha256);
  const archiveSha256 = await sha256File(input.archivePath);
  if (archiveSha256 !== expectedArchiveSha256) {
    throw new Error("Exam-paper archive SHA256 does not match the tracked manifest.");
  }

  const directory = await Open.file(input.archivePath);
  const files = directory.files.filter((entry) => entry.type === "File");
  const manifestFiles = files.filter((entry) => entry.path.endsWith("/来源与下载记录.json"));
  if (manifestFiles.length !== 1) {
    throw new Error("Exam-paper archive must contain exactly one source manifest.");
  }
  const manifestFile = manifestFiles[0];
  if (!manifestFile) {
    throw new Error("Exam-paper source manifest is missing.");
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse((await manifestFile.buffer()).toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Exam-paper source manifest is not valid UTF-8 JSON.", { cause: error });
  }

  return buildExamPaperSource({
    archiveSha256,
    manifest,
    manifestEntryPath: manifestFile.path,
    archiveFileName: basename(input.archivePath),
    entries: files.map((file) => ({
      path: file.path,
      uncompressedSize: file.uncompressedSize,
      read: () => file.buffer(),
    })),
  });
}
