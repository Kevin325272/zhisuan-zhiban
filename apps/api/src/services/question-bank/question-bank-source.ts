import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, isAbsolute, join, posix, resolve, sep } from "node:path";

import {
  questionAssetReferenceSchema,
  questionDtoSchema,
  type QuestionAssetReference,
  type QuestionDto,
} from "@xuetu/contracts";
import { z } from "zod";

import { SafeSvgRenderer, type RenderedSafeSvg } from "./safe-svg-renderer.js";

const rawQuestionSchema = z
  .object({
    id: z.string().min(1),
    year: z.number().int(),
    number: z.number().int().positive(),
    subject: z.string().min(1),
    type: z.enum(["choice", "subjective"]),
    multiple: z.boolean().default(false),
    question: z.string(),
    question_html: z.string().default(""),
    options: z.record(z.string(), z.string()).default({}),
    option_html: z.record(z.string(), z.string()).default({}),
    answer: z.string().default(""),
    answer_list: z.array(z.string()).default([]),
    explanation: z.string().default(""),
    explanation_html: z.string().default(""),
    solution: z.string().default(""),
    solution_html: z.string().default(""),
    tags: z.array(z.string()).default([]),
    source_url: z.string().url(),
    question_images: z.array(z.string()).default([]),
    option_images: z.record(z.string(), z.array(z.string())).default({}),
    explanation_images: z.array(z.string()).default([]),
    solution_images: z.array(z.string()).default([]),
    external_assets: z.array(z.string()).default([]),
  })
  .passthrough();

const rawYearSchema = z
  .object({
    year: z.number().int(),
    question_count: z.number().int().nonnegative(),
    choice_count: z.number().int().nonnegative(),
    subjective_count: z.number().int().nonnegative(),
    questions: z.array(rawQuestionSchema),
  })
  .passthrough();

type RawQuestion = z.infer<typeof rawQuestionSchema>;

export interface QuestionImportRecord {
  question: QuestionDto;
  correctOptionIds: string[];
  explanation: string | null;
  referenceSolution: string | null;
  allAssets: QuestionAssetReference[];
  assetLinks: QuestionAssetImportLink[];
}

export type QuestionImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface QuestionAssetBlob {
  contentSha256: string;
  mimeType: QuestionImageMime;
  byteLength: number;
  content: Buffer;
}

export interface QuestionAssetImportLink {
  assetId: string;
  role: QuestionAssetReference["role"];
  optionId: string | null;
  contentSha256: string;
}

export interface QuestionBankImportSource {
  datasetId: "408_json_data";
  provider: "csgraduates.com";
  archiveSha256: string;
  licenseStatus: "unverified";
  usageScope: "local_demo_only";
  sourceUrl: string;
  counts: {
    years: number;
    questions: number;
    choice: number;
    subjective: number;
  };
  questions: QuestionImportRecord[];
  assetBlobs: QuestionAssetBlob[];
}

interface LoadOptions {
  expectedYears?: number[];
  archiveSha256: string;
}

export class QuestionBankSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionBankSourceError";
  }
}

const supportedImageMimes = new Set<QuestionImageMime>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const maximumImageBytes = 5 * 1024 * 1024;
const maximumAssetBytes = 128 * 1024 * 1024;

interface NormalizedAsset {
  reference: QuestionAssetReference;
  blob: QuestionAssetBlob | null;
}

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function sourceTextToPlainText(input: string): string {
  const withoutActiveContent = input
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/?(?:p|div|pre|ul|ol|table|thead|tbody|tr|h[1-6])\b[^>]*>/giu, "\n")
    .replace(/<li\b[^>]*>/giu, "\n- ")
    .replace(/<\/?(?:span|strong|em|b|i|code|li|td|th|sup|sub|a|img)\b[^>]*>/giu, "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<\/?[a-z][^>]*>/giu, "");
  return withoutActiveContent
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
      }
      if (normalized.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
      }
      return namedEntities[normalized] ?? entity;
    })
    .replace(/[\t ]+\n/gu, "\n")
    .replace(/\n[\t ]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function imageMimeFromPath(path: string): QuestionImageMime {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  throw new QuestionBankSourceError(`Unsupported local question image extension: ${extension || "none"}`);
}

function hasImageSignature(content: Buffer, mimeType: QuestionImageMime): boolean {
  if (mimeType === "image/png") {
    return content.length >= 8
      && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === "image/jpeg") {
    return content.length >= 3
      && content[0] === 0xff
      && content[1] === 0xd8
      && content[2] === 0xff;
  }
  if (mimeType === "image/gif") {
    const signature = content.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  }
  return content.length >= 12
    && content.subarray(0, 4).toString("ascii") === "RIFF"
    && content.subarray(8, 12).toString("ascii") === "WEBP";
}

function questionAssetBlob(content: Buffer, mimeType: QuestionImageMime): QuestionAssetBlob {
  if (content.length === 0 || content.length > maximumImageBytes) {
    throw new QuestionBankSourceError(
      `Question image size must be between 1 and ${maximumImageBytes} bytes.`,
    );
  }
  if (!hasImageSignature(content, mimeType)) {
    throw new QuestionBankSourceError(`Invalid question image signature for ${mimeType}.`);
  }
  return {
    contentSha256: createHash("sha256").update(content).digest("hex"),
    mimeType,
    byteLength: content.length,
    content,
  };
}

function decodeEmbeddedImage(mime: string, encoded: string): QuestionAssetBlob {
  const mimeType = mime.toLowerCase() as QuestionImageMime;
  if (!supportedImageMimes.has(mimeType)) {
    throw new QuestionBankSourceError(`Unsupported question image MIME type: ${mime}`);
  }
  const compact = encoded.replace(/\s/gu, "");
  if (!compact || compact.length % 4 === 1) {
    throw new QuestionBankSourceError("Invalid embedded question image base64 payload.");
  }
  const content = Buffer.from(compact, "base64");
  const canonicalInput = compact.replace(/=+$/u, "");
  const canonicalOutput = content.toString("base64").replace(/=+$/u, "");
  if (canonicalInput !== canonicalOutput) {
    throw new QuestionBankSourceError("Invalid embedded question image base64 payload.");
  }
  return questionAssetBlob(content, mimeType);
}

function assetReference(
  raw: string,
  year: number,
  role: QuestionAssetReference["role"],
  optionId: string | null,
  rootDirectory: string,
): NormalizedAsset {
  let referenceKind: QuestionAssetReference["reference_kind"];
  let sourceReference: string;
  let mimeType: string | null = null;
  let availability: QuestionAssetReference["availability"];
  let blob: QuestionAssetBlob | null = null;

  if (/^data:/iu.test(raw)) {
    const embedded = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/iu.exec(raw);
    if (!embedded?.[1] || embedded[2] === undefined) {
      throw new QuestionBankSourceError("Invalid embedded question image data URL.");
    }
    blob = decodeEmbeddedImage(embedded[1], embedded[2]);
    mimeType = blob.mimeType;
    sourceReference = `embedded:sha256:${createHash("sha256").update(raw).digest("hex")}`;
    referenceKind = "embedded_source";
    availability = "authenticated_api";
  } else if (/^https?:\/\//iu.test(raw)) {
    sourceReference = new URL(raw).toString();
    referenceKind = "external_url";
    availability = "external_reference";
  } else {
    const normalized = posix.normalize(raw.replace(/\\/gu, "/"));
    if (
      isAbsolute(raw) ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(normalized)
    ) {
      throw new QuestionBankSourceError(`Unsafe asset reference: ${raw}`);
    }
    sourceReference = `${year}/${normalized}`;
    referenceKind = "local_file";
    const root = resolve(rootDirectory);
    const localPath = resolve(root, String(year), normalized);
    if (localPath !== root && !localPath.startsWith(`${root}${sep}`)) {
      throw new QuestionBankSourceError(`Unsafe asset reference: ${raw}`);
    }
    const localMime = imageMimeFromPath(normalized);
    let content: Buffer;
    try {
      content = readFileSync(localPath);
    } catch {
      throw new QuestionBankSourceError(`Unable to read local question image: ${sourceReference}`);
    }
    blob = questionAssetBlob(content, localMime);
    mimeType = localMime;
    availability = "authenticated_api";
  }

  const assetId = `asset_${createHash("sha256")
    .update(`${role}|${optionId ?? ""}|${sourceReference}`)
    .digest("hex")}`;
  return {
    reference: questionAssetReferenceSchema.parse({
      asset_id: assetId,
      role,
      option_id: optionId,
      reference_kind: referenceKind,
      source_reference: sourceReference,
      mime_type: mimeType,
      availability,
    }),
    blob,
  };
}

function renderedSvgAsset(
  rendered: RenderedSafeSvg,
  role: QuestionAssetReference["role"],
  optionId: string | null,
  occurrenceIndex: number,
): NormalizedAsset {
  const blob = questionAssetBlob(rendered.content, "image/png");
  const sourceReference = `rendered-svg:sha256:${rendered.sourceSha256}`;
  const assetId = `asset_${createHash("sha256")
    .update(`${role}|${optionId ?? ""}|${sourceReference}|instance:${occurrenceIndex + 1}`)
    .digest("hex")}`;
  return {
    reference: questionAssetReferenceSchema.parse({
      asset_id: assetId,
      role,
      option_id: optionId,
      reference_kind: "embedded_source",
      source_reference: sourceReference,
      mime_type: "image/png",
      availability: "authenticated_api",
    }),
    blob,
  };
}

async function htmlSvgOrLegacyAssets(
  html: string,
  legacyAssets: string[],
  year: number,
  role: QuestionAssetReference["role"],
  optionId: string | null,
  rootDirectory: string,
  svgRenderer: SafeSvgRenderer,
) {
  const rendered = await svgRenderer.renderHtml(html);
  if (rendered.length > 0) {
    return rendered.map((asset, index) => renderedSvgAsset(asset, role, optionId, index));
  }
  return legacyAssets.map((asset) =>
    assetReference(asset, year, role, optionId, rootDirectory)
  );
}

async function normalizeQuestion(
  raw: RawQuestion,
  rootDirectory: string,
  svgRenderer: SafeSvgRenderer,
): Promise<{ record: QuestionImportRecord; blobs: QuestionAssetBlob[] }> {
  const questionAssetRecords = [
    ...await htmlSvgOrLegacyAssets(
      raw.question_html,
      raw.question_images,
      raw.year,
      "question",
      null,
      rootDirectory,
      svgRenderer,
    ),
    ...raw.external_assets.map((asset) =>
      assetReference(asset, raw.year, "question", null, rootDirectory)
    ),
  ];
  const optionAssetRecords = new Map<string, NormalizedAsset[]>();
  for (const optionId of Object.keys(raw.options)) {
    optionAssetRecords.set(
      optionId,
      await htmlSvgOrLegacyAssets(
        raw.option_html[optionId] ?? "",
        raw.option_images[optionId] ?? [],
        raw.year,
        "option",
        optionId,
        rootDirectory,
        svgRenderer,
      ),
    );
  }
  const explanationAssetRecords = await htmlSvgOrLegacyAssets(
    raw.explanation_html,
    raw.explanation_images,
    raw.year,
    "explanation",
    null,
    rootDirectory,
    svgRenderer,
  );
  const solutionAssetRecords = await htmlSvgOrLegacyAssets(
    raw.solution_html,
    raw.solution_images,
    raw.year,
    "solution",
    null,
    rootDirectory,
    svgRenderer,
  );
  const questionAssets = questionAssetRecords.map((asset) => asset.reference);
  const options = Object.entries(raw.options)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([optionId, text]) => ({
      option_id: optionId,
      text: sourceTextToPlainText(text),
      assets: (optionAssetRecords.get(optionId) ?? []).map((asset) => asset.reference),
    }));
  const correctOptionIds = [
    ...new Set(
      (raw.answer_list.length > 0
        ? raw.answer_list
        : (raw.answer.match(/[A-Z]/gu) ?? []))
        .map((answer) => answer.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (raw.type === "choice") {
    const optionIds = new Set(options.map((option) => option.option_id));
    if (
      correctOptionIds.length === 0 ||
      correctOptionIds.some((answer) => !optionIds.has(answer)) ||
      (!raw.multiple && correctOptionIds.length !== 1)
    ) {
      throw new QuestionBankSourceError(`Invalid choice answer key: ${raw.id}`);
    }
  }

  const question = questionDtoSchema.parse({
    id: raw.id,
    year: raw.year,
    number: raw.number,
    subject: sourceTextToPlainText(raw.subject),
    type: raw.type,
    multiple: raw.multiple,
    question: sourceTextToPlainText(raw.question),
    options: raw.type === "choice" ? options : [],
    tags: raw.tags.map(sourceTextToPlainText).filter(Boolean),
    assets: questionAssets,
    content_format: "plain_text",
    source: {
      provider: "csgraduates.com",
      dataset_id: "408_json_data",
      source_url: raw.source_url,
      license_status: "unverified",
      usage_scope: "local_demo_only",
    },
  });
  const allAssetRecords = [
    ...questionAssetRecords,
    ...[...optionAssetRecords.values()].flat(),
    ...explanationAssetRecords,
    ...solutionAssetRecords,
  ];
  return {
    record: {
      question,
      correctOptionIds: raw.type === "choice" ? correctOptionIds : [],
      explanation: sourceTextToPlainText(raw.explanation) || null,
      referenceSolution: sourceTextToPlainText(raw.solution) || null,
      allAssets: allAssetRecords.map((asset) => asset.reference),
      assetLinks: allAssetRecords.flatMap((asset) => asset.blob ? [{
        assetId: asset.reference.asset_id,
        role: asset.reference.role,
        optionId: asset.reference.option_id,
        contentSha256: asset.blob.contentSha256,
      }] : []),
    },
    blobs: allAssetRecords.flatMap((asset) => asset.blob ? [asset.blob] : []),
  };
}

export async function loadQuestionBankDirectory(
  rootDirectory: string,
  options: LoadOptions,
): Promise<QuestionBankImportSource> {
  if (!/^[a-f0-9]{64}$/iu.test(options.archiveSha256)) {
    throw new QuestionBankSourceError("Archive SHA-256 must contain 64 hexadecimal characters.");
  }
  const expectedYears = options.expectedYears ?? Array.from({ length: 18 }, (_, index) => 2009 + index);
  const records: QuestionImportRecord[] = [];
  const assetBlobs = new Map<string, QuestionAssetBlob>();
  const ids = new Set<string>();
  const svgRenderer = new SafeSvgRenderer();
  let choice = 0;
  let subjective = 0;

  for (const year of expectedYears) {
    const filePath = join(rootDirectory, String(year), `${year}.json`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new QuestionBankSourceError(
        `Unable to read question source for ${year}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const document = rawYearSchema.safeParse(parsed);
    if (!document.success) {
      throw new QuestionBankSourceError(`Invalid question source schema for ${year}.`);
    }
    if (document.data.year !== year || document.data.question_count !== document.data.questions.length) {
      throw new QuestionBankSourceError(`Question count or year mismatch for ${year}.`);
    }
    const actualChoice = document.data.questions.filter((item) => item.type === "choice").length;
    const actualSubjective = document.data.questions.length - actualChoice;
    if (
      actualChoice !== document.data.choice_count ||
      actualSubjective !== document.data.subjective_count
    ) {
      throw new QuestionBankSourceError(`Question type counts mismatch for ${year}.`);
    }
    for (const raw of document.data.questions) {
      if (ids.has(raw.id)) {
        throw new QuestionBankSourceError(`Duplicate question id: ${raw.id}`);
      }
      ids.add(raw.id);
      const normalized = await normalizeQuestion(raw, rootDirectory, svgRenderer);
      records.push(normalized.record);
      for (const blob of normalized.blobs) {
        const existing = assetBlobs.get(blob.contentSha256);
        if (existing) {
          if (
            existing.mimeType !== blob.mimeType
            || existing.byteLength !== blob.byteLength
            || !existing.content.equals(blob.content)
          ) {
            throw new QuestionBankSourceError(
              `Question image hash collision: ${blob.contentSha256}`,
            );
          }
          continue;
        }
        assetBlobs.set(blob.contentSha256, blob);
      }
    }
    choice += actualChoice;
    subjective += actualSubjective;
  }

  const totalAssetBytes = [...assetBlobs.values()].reduce(
    (total, blob) => total + blob.byteLength,
    0,
  );
  if (totalAssetBytes > maximumAssetBytes) {
    throw new QuestionBankSourceError(
      `Question image payloads exceed the ${maximumAssetBytes}-byte source limit.`,
    );
  }

  return {
    datasetId: "408_json_data",
    provider: "csgraduates.com",
    archiveSha256: options.archiveSha256.toLowerCase(),
    licenseStatus: "unverified",
    usageScope: "local_demo_only",
    sourceUrl: "https://www.csgraduates.com/study_methods/408quiz/",
    counts: {
      years: expectedYears.length,
      questions: records.length,
      choice,
      subjective,
    },
    questions: records,
    assetBlobs: [...assetBlobs.values()].sort((left, right) =>
      left.contentSha256.localeCompare(right.contentSha256)
    ),
  };
}
