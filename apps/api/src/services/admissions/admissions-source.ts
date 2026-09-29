import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ADMISSIONS_NORMALIZED_SHA256 =
  "c1954a2769acd84098839207914a71912d6451c4a71b15a18e91fb92cdaf9287";
const EXPECTED_WORKBOOK_SHA256 =
  "365f5d9bf5fc1059bc635b1847af4afbe92248e777fdb4f782810cdcd141eaf8";

export interface AdmissionsManifest {
  dataset_id: string;
  license_status: "unverified" | "verified" | "restricted";
  usage_scope: "local_demo_only" | "authorized_product_use";
  training_allowed: false;
  source_workbook_sha256?: string;
  source_provider?: string;
  primary_source_provider?: string;
  review_status?: "pending_official_verification" | "verified";
}

export interface AdmissionsRetestLine {
  line_id: string;
  target_id: string;
  year: number;
  school: string;
  training_unit: string;
  program_code: string;
  program_name: string;
  study_mode: string;
  exam_category: "统考408";
  retest_score: number;
  subject_scores: {
    politics: number | null;
    foreign_language: number | null;
    business_course_1: number | null;
    business_course_2: number | null;
  };
  direction: string | null;
  initial_subjects: string | null;
  subject_source_url: string | null;
  retest_source_url: string;
  source_domain: string;
  source_type: string;
  review_status: "pending_official_verification";
  original_note: string;
}

export interface AdmissionsTarget {
  target_id: string;
  school: string;
  training_unit: string;
  program_code: string;
  program_name: string;
  study_mode: string;
}

export interface AdmissionsSource {
  manifest: AdmissionsManifest;
  allRecordCount: number;
  targets: AdmissionsTarget[];
  lines: AdmissionsRetestLine[];
}

interface RawDataset {
  schema_version?: unknown;
  dataset?: Record<string, unknown>;
  records?: unknown;
}

interface RawRecord {
  record_id?: unknown;
  year?: unknown;
  school?: unknown;
  training_unit?: unknown;
  program_code?: unknown;
  program_name?: unknown;
  study_mode?: unknown;
  exam_category?: unknown;
  retest_score?: unknown;
  subject_scores?: unknown;
  direction?: unknown;
  initial_subjects?: unknown;
  subject_source_url?: unknown;
  retest_source_url?: unknown;
  source_domain?: unknown;
  source_type?: unknown;
  review_status?: unknown;
  original_note?: unknown;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Admissions source field ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredString(value, field);
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Admissions source field ${field} must be a finite number.`);
  }
  return value;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === "国家线") return null;
  return requiredNumber(value, field);
}

function stableTargetId(target: AdmissionsTarget): string {
  const key = [
    target.school,
    target.training_unit,
    target.program_code,
    target.program_name,
    target.study_mode,
  ].join("\u001f");
  return `admission_target_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function readManifest(sourceRoot: string): AdmissionsManifest {
  const raw = JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")) as Record<string, unknown>;
  if (raw.license_status !== "unverified" || raw.usage_scope !== "local_demo_only" || raw.training_allowed !== false) {
    throw new Error("Admissions manifest has an unsupported data boundary.");
  }
  const datasetId = requiredString(raw.dataset_id, "manifest.dataset_id");
  const workbookSha = raw.source_workbook_sha256;
  if (workbookSha !== EXPECTED_WORKBOOK_SHA256) {
    throw new Error("Admissions workbook SHA256 does not match the verified source manifest.");
  }
  return {
    dataset_id: datasetId,
    license_status: "unverified",
    usage_scope: "local_demo_only",
    training_allowed: false,
    source_workbook_sha256: workbookSha,
    ...(typeof raw.source_provider === "string"
      ? { source_provider: raw.source_provider }
      : {}),
    ...(typeof raw.primary_source_provider === "string"
      ? { primary_source_provider: raw.primary_source_provider }
      : {}),
    review_status: "pending_official_verification",
  };
}

export function loadAdmissionsSource(sourceRoot: string): AdmissionsSource {
  const root = resolve(sourceRoot);
  const manifest = readManifest(root);
  const workbookBytes = readFileSync(join(root, "raw", "院校复试信息.xlsx"));
  const workbookSha = createHash("sha256").update(workbookBytes).digest("hex");
  if (workbookSha !== EXPECTED_WORKBOOK_SHA256) {
    throw new Error("Admissions workbook bytes failed SHA256 verification.");
  }
  const normalizedBytes = readFileSync(join(root, "processed", "retest-lines.normalized.json"));
  const normalizedSha = createHash("sha256").update(normalizedBytes).digest("hex");
  if (normalizedSha !== ADMISSIONS_NORMALIZED_SHA256) {
    throw new Error("Admissions normalized JSON failed SHA256 verification.");
  }

  const dataset = JSON.parse(normalizedBytes.toString("utf8")) as RawDataset;
  if (!Array.isArray(dataset.records) || dataset.records.length === 0) {
    throw new Error("Admissions normalized JSON must contain records.");
  }
  const records = dataset.records as RawRecord[];
  const targetMap = new Map<string, AdmissionsTarget>();
  const lines: AdmissionsRetestLine[] = [];

  for (const raw of records) {
    if (raw.exam_category !== "统考408") continue;
    const target: AdmissionsTarget = {
      target_id: "",
      school: requiredString(raw.school, "school"),
      training_unit: requiredString(raw.training_unit, "training_unit"),
      program_code: requiredString(raw.program_code, "program_code"),
      program_name: requiredString(raw.program_name, "program_name"),
      study_mode: requiredString(raw.study_mode, "study_mode"),
    };
    target.target_id = stableTargetId(target);
    targetMap.set(target.target_id, target);
    const scores = raw.subject_scores;
    if (!scores || typeof scores !== "object") throw new Error(`Missing subject scores for ${String(raw.record_id)}`);
    const scoreRecord = scores as Record<string, unknown>;
    const line: AdmissionsRetestLine = {
      ...target,
      line_id: requiredString(raw.record_id, "record_id"),
      target_id: target.target_id,
      year: requiredNumber(raw.year, "year"),
      exam_category: "统考408",
      retest_score: requiredNumber(raw.retest_score, "retest_score"),
      subject_scores: {
        politics: nullableNumber(scoreRecord.politics, "subject_scores.politics"),
        foreign_language: nullableNumber(scoreRecord.foreign_language, "subject_scores.foreign_language"),
        business_course_1: nullableNumber(scoreRecord.business_course_1, "subject_scores.business_course_1"),
        business_course_2: nullableNumber(scoreRecord.business_course_2, "subject_scores.business_course_2"),
      },
      direction: nullableString(raw.direction, "direction"),
      initial_subjects: nullableString(raw.initial_subjects, "initial_subjects"),
      subject_source_url: nullableString(raw.subject_source_url, "subject_source_url"),
      retest_source_url: requiredString(raw.retest_source_url, "retest_source_url"),
      source_domain: requiredString(raw.source_domain, "source_domain"),
      source_type: requiredString(raw.source_type, "source_type"),
      review_status: "pending_official_verification",
      original_note: requiredString(raw.original_note, "original_note"),
    };
    lines.push(line);
  }

  const targetOrder = [...targetMap.values()].sort((left, right) => left.target_id.localeCompare(right.target_id));
  lines.sort((left, right) => left.line_id.localeCompare(right.line_id));
  return {
    manifest,
    allRecordCount: records.length,
    targets: targetOrder,
    lines,
  };
}
