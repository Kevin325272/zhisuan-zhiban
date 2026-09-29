import { createHash, randomUUID } from "node:crypto";

import {
  externalQuestionConceptCandidateSchema,
  externalQuestionConfirmationSchema,
  externalQuestionExplanationSchema,
  externalQuestionModelTraceSchema,
  externalQuestionRecognitionSchema,
  type ExternalQuestionConceptCandidate,
  type ExternalQuestionConfirmation,
  type ExternalQuestionExplanation,
  type ExternalQuestionModelTrace,
  type ExternalQuestionRecognition,
} from "@xuetu/contracts";

import { EXTERNAL_QUESTION_LIMITS } from "../../config/external-questions.js";
import { withTransaction, type SqlClient, type SqlQueryablePool } from "../../database/client.js";
import {
  ExternalQuestionRepositoryError,
  type ExternalQuestionCleanupRef,
  type ExternalQuestionConfirmationResult,
  type ExternalQuestionCreateResult,
  type ExternalQuestionDeleteResult,
  type ExternalQuestionExplanationResult,
  type ExternalQuestionImageRecord,
  type ExternalQuestionRecognitionResult,
  type ExternalQuestionRepository,
  type ExternalQuestionSaveResult,
  type StoredExternalQuestion,
  type StoredExternalQuestionExplanation,
} from "./external-question.js";

const CLEANUP_CLAIM_LEASE_MS = 10 * 60 * 1_000;

interface ExternalQuestionRow {
  external_question_id: string;
  user_id: string;
  status: "recognition_failed" | "needs_better_image" | "unsupported" | "recognized" | "confirmed" | "deleted";
  content_revision: number;
  image_storage_ref: string;
  image_sha256: string;
  image_mime_type: string;
  pixel_width: number;
  pixel_height: number;
  image_byte_size: number;
  recognition_payload: unknown;
  confirmed_payload: unknown;
  concept_candidates: unknown;
  model_trace: unknown;
  saved_at: Date | string | null;
  expires_at: Date | string;
  deleted_at: Date | string | null;
  cleanup_claimed_at: Date | string | null;
  image_removed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ExplanationRow {
  explanation_id: string;
  content_revision: number;
  response_payload: unknown;
  model_trace: unknown;
  created_at: Date | string;
}

interface IdempotencyRow {
  response_payload: unknown;
  fingerprint_matches: boolean;
}

interface QuotaRow {
  temporary_count?: number | string;
  saved_count?: number | string;
  saved_bytes?: number | string;
}

type IdempotencyOperation = "upload" | "recognition" | "confirmation" | "explanation" | "save" | "delete";
type ReplayPayload = Record<string, unknown>;

const questionColumns = [
  "external_question_id",
  "user_id",
  "status",
  "content_revision",
  "image_storage_ref",
  "image_sha256",
  "image_mime_type",
  "pixel_width",
  "pixel_height",
  "image_byte_size",
  "recognition_payload",
  "confirmed_payload",
  "concept_candidates",
  "model_trace",
  "saved_at",
  "expires_at",
  "deleted_at",
  "cleanup_claimed_at",
  "image_removed_at",
  "created_at",
  "updated_at",
] as const;
const selectedQuestionColumns = questionColumns.join(", ");

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function boundedCount(value: number | string | undefined, label: string) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid external-question ${label}.`);
  }
  return parsed;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function recognitionRequestFingerprint(externalQuestionId: string) {
  return fingerprint({ externalQuestionId });
}

function explanationRequestFingerprint(
  externalQuestionId: string,
  contentRevision: number,
  depth: ExternalQuestionExplanation["depth"],
) {
  return fingerprint({ externalQuestionId, contentRevision, depth });
}

function sameSemanticValue(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}

function parseConceptCandidates(value: unknown): ExternalQuestionConceptCandidate[] {
  if (!Array.isArray(value)) throw new Error("Invalid external-question concept candidates.");
  return value.map((item) => externalQuestionConceptCandidateSchema.parse(item));
}

function parseOptionalTrace(value: unknown): ExternalQuestionModelTrace | null {
  return value == null ? null : externalQuestionModelTraceSchema.parse(value);
}

function parseOptionalRecognition(value: unknown): ExternalQuestionRecognition | null {
  return value == null ? null : externalQuestionRecognitionSchema.parse(value);
}

function parseOptionalConfirmation(value: unknown): ExternalQuestionConfirmation | null {
  return value == null ? null : externalQuestionConfirmationSchema.parse(value);
}

function mapExplanation(row: ExplanationRow): StoredExternalQuestionExplanation {
  return {
    explanationId: row.explanation_id,
    contentRevision: Number(row.content_revision),
    explanation: externalQuestionExplanationSchema.parse(row.response_payload),
    modelTrace: parseOptionalTrace(row.model_trace),
    createdAt: iso(row.created_at),
  };
}

function mapQuestion(
  row: ExternalQuestionRow,
  explanations: StoredExternalQuestionExplanation[] = [],
): StoredExternalQuestion {
  if (row.status === "deleted" || row.deleted_at !== null) {
    throw new ExternalQuestionRepositoryError(
      "EXTERNAL_QUESTION_NOT_FOUND",
      404,
      "题目不存在。",
    );
  }
  if (row.image_mime_type !== "image/webp") {
    throw new Error("Invalid external-question image MIME type.");
  }
  return {
    externalQuestionId: row.external_question_id,
    userId: row.user_id,
    status: row.status,
    contentRevision: Number(row.content_revision),
    image: {
      storageRef: row.image_storage_ref,
      sha256: row.image_sha256,
      mimeType: "image/webp",
      width: Number(row.pixel_width),
      height: Number(row.pixel_height),
      byteSize: Number(row.image_byte_size),
    },
    recognition: parseOptionalRecognition(row.recognition_payload),
    confirmation: parseOptionalConfirmation(row.confirmed_payload),
    conceptCandidates: parseConceptCandidates(row.concept_candidates),
    explanations,
    modelTrace: parseOptionalTrace(row.model_trace),
    savedAt: nullableIso(row.saved_at),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function assertAccessible(row: ExternalQuestionRow, now: Date) {
  if (row.status === "deleted" || row.deleted_at !== null) {
    throw new ExternalQuestionRepositoryError(
      "EXTERNAL_QUESTION_NOT_FOUND",
      404,
      "题目不存在。",
    );
  }
  if (row.saved_at === null && new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new ExternalQuestionRepositoryError(
      "EXTERNAL_QUESTION_EXPIRED",
      410,
      "临时题目已过期，请重新上传。",
    );
  }
}

function notFound(): never {
  throw new ExternalQuestionRepositoryError(
    "EXTERNAL_QUESTION_NOT_FOUND",
    404,
    "题目不存在。",
  );
}

function invalidState(message: string): never {
  throw new ExternalQuestionRepositoryError(
    "EXTERNAL_QUESTION_INVALID_STATE",
    409,
    message,
  );
}

function replayPayload(value: unknown): ReplayPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid external-question idempotency payload.");
  }
  return value as ReplayPayload;
}

export class PostgresExternalQuestionRepository implements ExternalQuestionRepository {
  constructor(private readonly pool: SqlQueryablePool) {}

  async findRecognitionReplay(input: {
    userId: string;
    externalQuestionId: string;
    idempotencyKey: string;
  }): Promise<ExternalQuestionRecognitionResult | null> {
    const replay = await this.findReplay(
      this.pool,
      input.userId,
      "recognition",
      input.idempotencyKey,
      recognitionRequestFingerprint(input.externalQuestionId),
    );
    return replay
      ? { ...replay, idempotencyReplayed: true } as ExternalQuestionRecognitionResult
      : null;
  }

  async findExplanationReplay(input: {
    userId: string;
    externalQuestionId: string;
    contentRevision: number;
    depth: ExternalQuestionExplanation["depth"];
    idempotencyKey: string;
  }): Promise<ExternalQuestionExplanationResult | null> {
    const replay = await this.findReplay(
      this.pool,
      input.userId,
      "explanation",
      input.idempotencyKey,
      explanationRequestFingerprint(
        input.externalQuestionId,
        input.contentRevision,
        input.depth,
      ),
    );
    return replay
      ? { ...replay, idempotencyReplayed: true } as ExternalQuestionExplanationResult
      : null;
  }

  async createTemporary(input: {
    userId: string;
    image: ExternalQuestionImageRecord;
    idempotencyKey: string;
    requestFingerprint: string;
    now: Date;
    expiresAt: Date;
  }): Promise<ExternalQuestionCreateResult> {
    return withTransaction(this.pool, async (client) => {
      await this.lockUser(client, input.userId);
      const replay = await this.findReplay(
        client,
        input.userId,
        "upload",
        input.idempotencyKey,
        input.requestFingerprint,
      );
      if (replay) return { ...replay, idempotencyReplayed: true } as ExternalQuestionCreateResult;
      const quota = await client.query<QuotaRow>(
        `SELECT COUNT(*)::int AS temporary_count
         FROM student_external_questions
         WHERE user_id = $1
           AND deleted_at IS NULL
           AND saved_at IS NULL
           AND expires_at > $2`,
        [input.userId, input.now.toISOString()],
      );
      if (boundedCount(quota.rows[0]?.temporary_count, "temporary count") >= EXTERNAL_QUESTION_LIMITS.maxTemporaryPerUser) {
        throw new ExternalQuestionRepositoryError(
          "EXTERNAL_QUESTION_TEMPORARY_LIMIT",
          409,
          "未保存题目已达到上限，请先处理或删除一项。",
        );
      }

      const externalQuestionId = randomUUID();
      await client.query(
        `INSERT INTO student_external_questions(
           external_question_id, user_id, status, content_revision,
           image_storage_ref, image_sha256, image_mime_type,
           pixel_width, pixel_height, image_byte_size,
           expires_at, created_at, updated_at
         ) VALUES (
           $1, $2, 'recognition_failed', 0,
           $3, $4, $5, $6, $7, $8, $9, $10, $10
         )`,
        [
          externalQuestionId,
          input.userId,
          input.image.storageRef,
          input.image.sha256,
          input.image.mimeType,
          input.image.width,
          input.image.height,
          input.image.byteSize,
          input.expiresAt.toISOString(),
          input.now.toISOString(),
        ],
      );
      const response = { kind: "upload" as const, externalQuestionId };
      await this.storeReplay(
        client,
        input.userId,
        "upload",
        input.idempotencyKey,
        input.requestFingerprint,
        externalQuestionId,
        response,
        input.now,
      );
      return { ...response, idempotencyReplayed: false };
    });
  }

  async recordRecognition(input: {
    userId: string;
    externalQuestionId: string;
    status: ExternalQuestionRecognitionResult["status"];
    recognition: ExternalQuestionRecognition | null;
    modelTrace: ExternalQuestionModelTrace | null;
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionRecognitionResult> {
    const parsedRecognition = input.recognition === null
      ? null
      : externalQuestionRecognitionSchema.parse(input.recognition);
    const parsedTrace = input.modelTrace === null
      ? null
      : externalQuestionModelTraceSchema.parse(input.modelTrace);
    const requestFingerprint = recognitionRequestFingerprint(input.externalQuestionId);
    return withTransaction(this.pool, async (client) => {
      const row = await this.lockOwned(client, input.userId, input.externalQuestionId);
      assertAccessible(row, input.now);
      const replay = await this.findReplay(client, input.userId, "recognition", input.idempotencyKey, requestFingerprint);
      if (replay) return { ...replay, idempotencyReplayed: true } as ExternalQuestionRecognitionResult;
      if (row.status === "confirmed") invalidState("已确认题目不能重新执行识别。");

      await client.query(
        `UPDATE student_external_questions
         SET status = $3,
             recognition_payload = $4::jsonb,
             model_trace = $5::jsonb,
             updated_at = $6
         WHERE user_id = $1 AND external_question_id = $2 AND deleted_at IS NULL`,
        [
          input.userId,
          input.externalQuestionId,
          input.status,
          parsedRecognition === null ? null : JSON.stringify(parsedRecognition),
          parsedTrace === null ? null : JSON.stringify(parsedTrace),
          input.now.toISOString(),
        ],
      );
      const response = {
        kind: "recognition" as const,
        externalQuestionId: input.externalQuestionId,
        status: input.status,
      };
      await this.storeReplay(client, input.userId, "recognition", input.idempotencyKey, requestFingerprint, input.externalQuestionId, response, input.now);
      return { ...response, idempotencyReplayed: false };
    });
  }

  async confirm(input: {
    userId: string;
    externalQuestionId: string;
    confirmation: ExternalQuestionConfirmation;
    conceptCandidates: ExternalQuestionConceptCandidate[];
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionConfirmationResult> {
    const parsedConfirmation = externalQuestionConfirmationSchema.parse(input.confirmation);
    const parsedCandidates = input.conceptCandidates.map((item) => externalQuestionConceptCandidateSchema.parse(item));
    if (parsedCandidates.length > 8) invalidState("关联知识点超过上限。");
    const requestFingerprint = fingerprint({
      externalQuestionId: input.externalQuestionId,
      confirmation: parsedConfirmation,
      conceptCandidates: parsedCandidates,
    });
    return withTransaction(this.pool, async (client) => {
      const row = await this.lockOwned(client, input.userId, input.externalQuestionId);
      assertAccessible(row, input.now);
      const replay = await this.findReplay(client, input.userId, "confirmation", input.idempotencyKey, requestFingerprint);
      if (replay) return { ...replay, idempotencyReplayed: true } as ExternalQuestionConfirmationResult;

      const previous = parseOptionalConfirmation(row.confirmed_payload);
      const previousCandidates = parseConceptCandidates(row.concept_candidates);
      const changed = previous === null
        || !sameSemanticValue(previous, parsedConfirmation)
        || !sameSemanticValue(previousCandidates, parsedCandidates);
      let contentRevision = Number(row.content_revision);
      if (changed) {
        const updated = await client.query<ExternalQuestionRow>(
          `UPDATE student_external_questions
           SET status = 'confirmed',
               content_revision = content_revision + 1,
               confirmed_payload = $3::jsonb,
               concept_candidates = $4::jsonb,
               updated_at = $5
           WHERE user_id = $1 AND external_question_id = $2 AND deleted_at IS NULL
           RETURNING ${selectedQuestionColumns}`,
          [
            input.userId,
            input.externalQuestionId,
            JSON.stringify(parsedConfirmation),
            JSON.stringify(parsedCandidates),
            input.now.toISOString(),
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) {
          throw new Error("PostgreSQL did not return the updated external question.");
        }
        contentRevision = Number(updatedRow.content_revision);
      }
      const response = {
        kind: "confirmation" as const,
        externalQuestionId: input.externalQuestionId,
        contentRevision,
        changed,
      };
      await this.storeReplay(client, input.userId, "confirmation", input.idempotencyKey, requestFingerprint, input.externalQuestionId, response, input.now);
      return { ...response, idempotencyReplayed: false };
    });
  }

  async save(input: {
    userId: string;
    externalQuestionId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionSaveResult> {
    const requestFingerprint = fingerprint({ externalQuestionId: input.externalQuestionId });
    return withTransaction(this.pool, async (client) => {
      await this.lockUser(client, input.userId);
      const row = await this.lockOwned(client, input.userId, input.externalQuestionId);
      assertAccessible(row, input.now);
      const replay = await this.findReplay(client, input.userId, "save", input.idempotencyKey, requestFingerprint);
      if (replay) return { ...replay, idempotencyReplayed: true } as ExternalQuestionSaveResult;
      if (row.status !== "confirmed" || row.confirmed_payload === null) {
        invalidState("请先确认题目内容再保存。");
      }
      if (row.saved_at !== null) {
        const response = {
          kind: "save" as const,
          externalQuestionId: input.externalQuestionId,
          savedAt: iso(row.saved_at),
        };
        await this.storeReplay(client, input.userId, "save", input.idempotencyKey, requestFingerprint, input.externalQuestionId, response, input.now);
        return { ...response, idempotencyReplayed: false };
      }

      const quota = await client.query<QuotaRow>(
        `SELECT COUNT(*)::int AS saved_count,
                COALESCE(SUM(image_byte_size), 0)::bigint AS saved_bytes
         FROM student_external_questions
         WHERE user_id = $1 AND saved_at IS NOT NULL AND deleted_at IS NULL`,
        [input.userId],
      );
      const savedCount = boundedCount(quota.rows[0]?.saved_count, "saved count");
      const savedBytes = boundedCount(quota.rows[0]?.saved_bytes, "saved bytes");
      if (savedCount >= EXTERNAL_QUESTION_LIMITS.maxSavedPerUser) {
        throw new ExternalQuestionRepositoryError(
          "EXTERNAL_QUESTION_SAVED_LIMIT",
          409,
          "个人题目已达到保存数量上限。",
        );
      }
      if (savedBytes + Number(row.image_byte_size) > EXTERNAL_QUESTION_LIMITS.maxSavedBytesPerUser) {
        throw new ExternalQuestionRepositoryError(
          "EXTERNAL_QUESTION_SAVED_BYTES_LIMIT",
          409,
          "个人题目图片已达到存储上限。",
        );
      }

      await client.query(
        `UPDATE student_external_questions
         SET saved_at = $3, updated_at = $3
         WHERE user_id = $1 AND external_question_id = $2 AND deleted_at IS NULL`,
        [input.userId, input.externalQuestionId, input.now.toISOString()],
      );
      const response = {
        kind: "save" as const,
        externalQuestionId: input.externalQuestionId,
        savedAt: input.now.toISOString(),
      };
      await this.storeReplay(client, input.userId, "save", input.idempotencyKey, requestFingerprint, input.externalQuestionId, response, input.now);
      return { ...response, idempotencyReplayed: false };
    });
  }

  async storeExplanation(input: {
    userId: string;
    externalQuestionId: string;
    expectedContentRevision: number;
    explanation: ExternalQuestionExplanation;
    conceptIds: string[];
    modelTrace: ExternalQuestionModelTrace | null;
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionExplanationResult> {
    const parsedExplanation = externalQuestionExplanationSchema.parse(input.explanation);
    const parsedTrace = input.modelTrace === null ? null : externalQuestionModelTraceSchema.parse(input.modelTrace);
    const conceptIds = [...new Set(input.conceptIds)];
    if (conceptIds.length > 8) invalidState("讲解关联知识点超过上限。");
    return withTransaction(this.pool, async (client) => {
      const row = await this.lockOwned(client, input.userId, input.externalQuestionId);
      assertAccessible(row, input.now);
      if (row.status !== "confirmed" || Number(row.content_revision) <= 0) {
        invalidState("请先确认题目内容再获取讲解。");
      }
      if (Number(row.content_revision) !== input.expectedContentRevision) {
        invalidState("题目内容已更新，请基于最新版本重新获取讲解。");
      }
      const requestFingerprint = explanationRequestFingerprint(
        input.externalQuestionId,
        Number(row.content_revision),
        parsedExplanation.depth,
      );
      const replay = await this.findReplay(client, input.userId, "explanation", input.idempotencyKey, requestFingerprint);
      if (replay) return { ...replay, idempotencyReplayed: true } as ExternalQuestionExplanationResult;

      const existing = await client.query<ExplanationRow>(
        `SELECT explanation_id, content_revision, response_payload, model_trace, created_at
         FROM student_external_question_explanations
         WHERE user_id = $1
           AND external_question_id = $2
           AND content_revision = $3
           AND depth = $4`,
        [input.userId, input.externalQuestionId, Number(row.content_revision), parsedExplanation.depth],
      );
      let stored: StoredExternalQuestionExplanation;
      if (existing.rows[0]) {
        stored = mapExplanation(existing.rows[0]);
      } else {
        const inserted = await client.query<ExplanationRow>(
          `INSERT INTO student_external_question_explanations(
             explanation_id, external_question_id, user_id, content_revision,
             depth, concept_ids, response_payload, model_trace, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
           RETURNING explanation_id, content_revision, response_payload, model_trace, created_at`,
          [
            randomUUID(),
            input.externalQuestionId,
            input.userId,
            Number(row.content_revision),
            parsedExplanation.depth,
            JSON.stringify(conceptIds),
            JSON.stringify(parsedExplanation),
            parsedTrace === null ? null : JSON.stringify(parsedTrace),
            input.now.toISOString(),
          ],
        );
        const insertedRow = inserted.rows[0];
        if (!insertedRow) {
          throw new Error(
            "PostgreSQL did not return the inserted external-question explanation.",
          );
        }
        stored = mapExplanation(insertedRow);
      }
      const response = {
        kind: "explanation" as const,
        externalQuestionId: input.externalQuestionId,
        explanation: stored,
      };
      await this.storeReplay(client, input.userId, "explanation", input.idempotencyKey, requestFingerprint, input.externalQuestionId, response, input.now);
      return { ...response, idempotencyReplayed: false };
    });
  }

  async getOwned(userId: string, externalQuestionId: string, now: Date): Promise<StoredExternalQuestion> {
    const question = await this.pool.query<ExternalQuestionRow>(
      `SELECT ${selectedQuestionColumns}
       FROM student_external_questions
       WHERE user_id = $1 AND external_question_id = $2 AND deleted_at IS NULL`,
      [userId, externalQuestionId],
    );
    const row = question.rows[0];
    if (!row) notFound();
    assertAccessible(row, now);
    const explanations = Number(row.content_revision) > 0
      ? await this.pool.query<ExplanationRow>(
          `SELECT explanation_id, content_revision, response_payload, model_trace, created_at
           FROM student_external_question_explanations
           WHERE user_id = $1 AND external_question_id = $2 AND content_revision = $3
           ORDER BY created_at ASC
           LIMIT 3`,
          [userId, externalQuestionId, Number(row.content_revision)],
        )
      : { rows: [] as ExplanationRow[], rowCount: 0 };
    return mapQuestion(row, explanations.rows.map(mapExplanation));
  }

  async listOwned(userId: string, now: Date): Promise<StoredExternalQuestion[]> {
    const questions = await this.pool.query<ExternalQuestionRow>(
      `SELECT ${selectedQuestionColumns}
       FROM student_external_questions
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND (saved_at IS NOT NULL OR expires_at > $2)
       ORDER BY COALESCE(saved_at, updated_at) DESC, external_question_id
       LIMIT 100`,
      [userId, now.toISOString()],
    );
    return questions.rows.map((row) => mapQuestion(row));
  }

  async markDeleted(input: {
    userId: string;
    externalQuestionId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<ExternalQuestionDeleteResult> {
    const requestFingerprint = fingerprint({ externalQuestionId: input.externalQuestionId });
    return withTransaction(this.pool, async (client) => {
      const row = await this.lockOwned(client, input.userId, input.externalQuestionId, true);
      const replay = await this.findReplay(client, input.userId, "delete", input.idempotencyKey, requestFingerprint);
      if (replay) return { ...replay, idempotencyReplayed: true } as ExternalQuestionDeleteResult;
      const alreadyDeleted = row.status === "deleted" || row.deleted_at !== null;
      let cleanupRef: ExternalQuestionCleanupRef | null = null;
      if (!alreadyDeleted) {
        const updated = await client.query<{ external_question_id: string; image_storage_ref: string }>(
          `UPDATE student_external_questions
           SET status = 'deleted',
               deleted_at = $3,
               cleanup_claimed_at = $3,
               updated_at = $3
           WHERE user_id = $1 AND external_question_id = $2 AND deleted_at IS NULL
           RETURNING external_question_id, image_storage_ref`,
          [input.userId, input.externalQuestionId, input.now.toISOString()],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) {
          throw new Error("PostgreSQL did not return the deleted external question.");
        }
        cleanupRef = {
          externalQuestionId: updatedRow.external_question_id,
          storageRef: updatedRow.image_storage_ref,
        };
      }
      const response = {
        kind: "delete" as const,
        externalQuestionId: input.externalQuestionId,
        deleted: true as const,
        cleanupRef,
      };
      await this.storeReplay(client, input.userId, "delete", input.idempotencyKey, requestFingerprint, input.externalQuestionId, response, input.now);
      return { ...response, idempotencyReplayed: false };
    });
  }

  async findCleanupBatch(now: Date, limit: number): Promise<ExternalQuestionCleanupRef[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("External-question cleanup limit must be between 1 and 100.");
    }
    const staleClaimBefore = new Date(now.getTime() - CLEANUP_CLAIM_LEASE_MS).toISOString();
    return withTransaction(this.pool, async (client) => {
      const candidates = await client.query<{ external_question_id: string; image_storage_ref: string }>(
        `SELECT external_question_id, image_storage_ref
         FROM student_external_questions
         WHERE image_removed_at IS NULL
           AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at <= $3)
           AND (deleted_at IS NOT NULL OR (saved_at IS NULL AND expires_at <= $1))
         ORDER BY COALESCE(deleted_at, expires_at), external_question_id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [now.toISOString(), limit, staleClaimBefore],
      );
      if (candidates.rows.length === 0) return [];
      const ids = candidates.rows.map((row) => row.external_question_id);
      const claimed = await client.query<{ external_question_id: string; image_storage_ref: string }>(
         `UPDATE student_external_questions
          SET cleanup_claimed_at = $1, updated_at = $1
         WHERE external_question_id = ANY($2::text[])
           AND image_removed_at IS NULL
           AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at <= $3)
         RETURNING external_question_id, image_storage_ref`,
        [now.toISOString(), ids, staleClaimBefore],
      );
      return claimed.rows.map((row) => ({
        externalQuestionId: row.external_question_id,
        storageRef: row.image_storage_ref,
      }));
    });
  }

  async finalizeCleanup(input: ExternalQuestionCleanupRef & { now: Date }): Promise<boolean> {
    const updated = await this.pool.query(
      `UPDATE student_external_questions
       SET image_removed_at = $3, updated_at = $3
       WHERE external_question_id = $1
         AND image_storage_ref = $2
         AND cleanup_claimed_at IS NOT NULL
         AND image_removed_at IS NULL`,
      [input.externalQuestionId, input.storageRef, input.now.toISOString()],
    );
    return updated.rowCount === 1;
  }

  async releaseCleanup(input: ExternalQuestionCleanupRef): Promise<boolean> {
    const updated = await this.pool.query(
      `UPDATE student_external_questions
       SET cleanup_claimed_at = NULL
       WHERE external_question_id = $1
         AND image_storage_ref = $2
         AND image_removed_at IS NULL`,
      [input.externalQuestionId, input.storageRef],
    );
    return updated.rowCount === 1;
  }

  private async lockUser(client: SqlClient, userId: string) {
    const user = await client.query<{ user_id: string }>(
      `SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) notFound();
  }

  private async lockOwned(
    client: SqlClient,
    userId: string,
    externalQuestionId: string,
    includeDeleted = false,
  ) {
    const question = await client.query<ExternalQuestionRow>(
      `SELECT ${selectedQuestionColumns}
       FROM student_external_questions
       WHERE user_id = $1 AND external_question_id = $2${includeDeleted ? "" : " AND deleted_at IS NULL"}
       FOR UPDATE`,
      [userId, externalQuestionId],
    );
    return question.rows[0] ?? notFound();
  }

  private async findReplay(
    client: Pick<SqlClient, "query">,
    userId: string,
    operation: IdempotencyOperation,
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<ReplayPayload | null> {
    const replay = await client.query<IdempotencyRow>(
      `SELECT response_payload,
              request_fingerprint = $4 AS fingerprint_matches
       FROM student_external_question_idempotency
       WHERE user_id = $1 AND operation = $2 AND idempotency_key = $3`,
      [userId, operation, idempotencyKey, requestFingerprint],
    );
    if (!replay.rows[0]) return null;
    if (!replay.rows[0].fingerprint_matches) {
      throw new ExternalQuestionRepositoryError(
        "EXTERNAL_QUESTION_IDEMPOTENCY_CONFLICT",
        409,
        "幂等键已用于不同请求。",
      );
    }
    return replayPayload(replay.rows[0].response_payload);
  }

  private async storeReplay(
    client: SqlClient,
    userId: string,
    operation: IdempotencyOperation,
    idempotencyKey: string,
    requestFingerprint: string,
    externalQuestionId: string,
    response: ReplayPayload,
    now: Date,
  ) {
    await client.query(
      `INSERT INTO student_external_question_idempotency(
         user_id, operation, idempotency_key, request_fingerprint,
         external_question_id, response_payload, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        userId,
        operation,
        idempotencyKey,
        requestFingerprint,
        externalQuestionId,
        JSON.stringify(response),
        now.toISOString(),
      ],
    );
  }
}
