import { describe, expect, it } from "vitest";

import type {
  ExternalQuestionConfirmation,
  ExternalQuestionExplanation,
  ExternalQuestionRecognition,
} from "@xuetu/contracts";

import type {
  SqlClient,
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import { loadMigrations } from "../src/database/migrate.js";
import {
  ExternalQuestionRepositoryError,
  type ExternalQuestionImageRecord,
} from "../src/services/external-questions/external-question.js";
import { PostgresExternalQuestionRepository } from "../src/services/external-questions/postgres-external-question.js";

function result<Row>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

function createPool(
  handler: (sql: string, parameters: readonly unknown[]) => SqlQueryResult,
) {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const client: SqlClient = {
    async query<Row = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ) {
      calls.push({ sql, parameters });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
        return result() as SqlQueryResult<Row>;
      }
      return handler(sql, parameters) as SqlQueryResult<Row>;
    },
    release() {},
  };
  const pool: SqlQueryablePool = {
    connect: async () => client,
    query: client.query.bind(client),
  };
  return { pool, calls };
}

const now = new Date("2026-08-24T08:00:00.000Z");
const expiresAt = new Date("2026-08-25T08:00:00.000Z");
const image: ExternalQuestionImageRecord = {
  storageRef: "93cf786f-0348-4d75-a981-19d5ef9b46ab.webp",
  sha256: "a".repeat(64),
  mimeType: "image/webp",
  width: 1_280,
  height: 960,
  byteSize: 128_000,
};
const recognition: ExternalQuestionRecognition = {
  status: "recognized",
  subject: "data_structures",
  question_type: "choice",
  question_text: "循环队列为空的判断条件是什么？",
  options: [
    { label: "A", text: "front = rear" },
    { label: "B", text: "front != rear" },
  ],
  formulae: [],
  diagram_description: null,
  knowledge_keywords: ["循环队列", "队头", "队尾"],
  warnings: [],
};
const confirmation: ExternalQuestionConfirmation = {
  subject: "data_structures",
  question_type: "choice",
  question_text: recognition.question_text,
  options: recognition.options,
  formulae: [],
  diagram_description: null,
};
const explanation: ExternalQuestionExplanation = {
  depth: "direction",
  summary: "先明确循环队列中队头和队尾指针的约定。",
  knowledge_points: [{
    concept_id: "ds_queue_circular",
    title: "循环队列",
    reason: "题干直接考查队空判定。",
  }],
  approach: ["写出队空与队满的判定式并对比。"],
  steps: [],
  self_check: "你的实现是否预留了一个空位置？",
  final_answer: null,
  uncertainty: null,
};
const conceptCandidate = {
  concept_id: "ds_queue_circular",
  course_id: "course_408_ds",
  course_slug: "data-structures" as const,
  title: "循环队列",
  reason: "题干直接考查循环队列。",
  reading_href: "/student/courses/data-structures?concept_id=ds_queue_circular",
  practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_queue_circular",
};
const trace = {
  requested_model: "gpt-5.6-terra",
  provider_model: "gpt-5.6-terra",
  matched: true,
  latency_ms: 420,
};

function questionRow(overrides: Record<string, unknown> = {}) {
  return {
    external_question_id: "external_question_001",
    user_id: "student_a",
    status: "recognized",
    content_revision: 0,
    image_storage_ref: image.storageRef,
    image_sha256: image.sha256,
    image_mime_type: image.mimeType,
    pixel_width: image.width,
    pixel_height: image.height,
    image_byte_size: image.byteSize,
    recognition_payload: recognition,
    confirmed_payload: null,
    concept_candidates: [],
    model_trace: trace,
    saved_at: null,
    expires_at: expiresAt,
    deleted_at: null,
    cleanup_claimed_at: null,
    image_removed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("external-question migration", () => {
  it("stores bounded private metadata, revisioned explanations and idempotency", () => {
    const migration = loadMigrations().find((entry) => entry.version === "032");
    expect(migration).toBeDefined();
    const sql = migration?.sql ?? "";

    expect(sql).toContain("CREATE TABLE student_external_questions");
    expect(sql).toContain("CREATE TABLE student_external_question_explanations");
    expect(sql).toContain("CREATE TABLE student_external_question_idempotency");
    expect(sql).toContain("REFERENCES users(user_id) ON DELETE CASCADE");
    expect(sql).toContain("recognition_failed");
    expect(sql).toContain("needs_better_image");
    expect(sql).toContain("unsupported");
    expect(sql).toContain("recognized");
    expect(sql).toContain("confirmed");
    expect(sql).toContain("deleted");
    expect(sql).toContain("content_revision >= 0");
    expect(sql).toContain("content_revision > 0");
    expect(sql).toContain("jsonb_typeof(recognition_payload) = 'object'");
    expect(sql).toContain("jsonb_typeof(confirmed_payload) = 'object'");
    expect(sql).toContain("jsonb_array_length(concept_candidates) <= 8");
    expect(sql).toContain("jsonb_typeof(response_payload) = 'object'");
    expect(sql).toContain("depth IN ('direction', 'steps', 'complete')");
    expect(sql).toContain("UNIQUE (external_question_id, content_revision, depth)");
    expect(sql).toContain("PRIMARY KEY (user_id, operation, idempotency_key)");
    expect(sql).toContain("student_external_questions_user_list_idx");
    expect(sql).toContain("student_external_questions_cleanup_idx");
    expect(sql).toContain("student_external_question_explanations_current_idx");
    expect(sql).not.toMatch(/\bbytea\b|base64|api_key|learning_evidence|practice_mistakes|student_question_memory_states/iu);
  });
});

describe("PostgresExternalQuestionRepository ownership and lifecycle", () => {
  it("scopes reads and every mutation to the authenticated owner", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM users") && sql.includes("FOR UPDATE")) {
        return result([{ user_id: "student_a" }]);
      }
      if (sql.includes("COUNT(*)") || sql.includes("COALESCE(SUM")) {
        return result([{ temporary_count: 0, saved_count: 0, saved_bytes: 0 }]);
      }
      return result();
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.getOwned("student_a", "external_question_b", now))
      .rejects.toMatchObject({ code: "EXTERNAL_QUESTION_NOT_FOUND" });
    await expect(repository.confirm({
      userId: "student_a",
      externalQuestionId: "external_question_b",
      confirmation,
      conceptCandidates: [],
      idempotencyKey: "confirm-b",
      now,
    })).rejects.toMatchObject({ code: "EXTERNAL_QUESTION_NOT_FOUND" });
    await expect(repository.save({
      userId: "student_a",
      externalQuestionId: "external_question_b",
      idempotencyKey: "save-b",
      now,
    })).rejects.toMatchObject({ code: "EXTERNAL_QUESTION_NOT_FOUND" });
    await expect(repository.storeExplanation({
      userId: "student_a",
      externalQuestionId: "external_question_b",
      expectedContentRevision: 1,
      explanation,
      conceptIds: ["ds_queue_circular"],
      modelTrace: trace,
      idempotencyKey: "explain-b",
      now,
    })).rejects.toMatchObject({ code: "EXTERNAL_QUESTION_NOT_FOUND" });
    await expect(repository.markDeleted({
      userId: "student_a",
      externalQuestionId: "external_question_b",
      idempotencyKey: "delete-b",
      now,
    })).rejects.toMatchObject({ code: "EXTERNAL_QUESTION_NOT_FOUND" });

    const ownedQueries = calls.filter((call) => call.sql.includes("student_external_questions"));
    expect(ownedQueries.length).toBeGreaterThanOrEqual(5);
    for (const call of ownedQueries) {
      expect(call.sql).toMatch(/user_id\s*=\s*\$1/iu);
      expect(call.parameters[0]).toBe("student_a");
      expect(call.parameters).toContain("external_question_b");
    }
  });

  it("distinguishes an expired unsaved record and excludes it from lists", async () => {
    const expiredRow = questionRow({ expires_at: new Date("2026-08-23T08:00:00.000Z") });
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("ORDER BY")) return result();
      if (sql.includes("FROM student_external_questions") && sql.includes("external_question_id")) {
        return result([expiredRow]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.getOwned("student_a", "external_question_001", now))
      .rejects.toMatchObject({
        code: "EXTERNAL_QUESTION_EXPIRED",
        statusCode: 410,
      });
    await expect(repository.listOwned("student_a", now)).resolves.toEqual([]);

    const listCall = calls.find((call) => call.sql.includes("ORDER BY"));
    expect(listCall?.sql).toContain("saved_at IS NOT NULL OR expires_at > $2");
    expect(listCall?.sql).toContain("deleted_at IS NULL");
    expect(listCall?.parameters).toEqual(["student_a", now.toISOString()]);
  });

  it("rejects the eleventh active temporary record", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("student_external_question_idempotency")) return result();
      if (sql.includes("FROM users") && sql.includes("FOR UPDATE")) {
        return result([{ user_id: "student_a" }]);
      }
      if (sql.includes("AS temporary_count")) return result([{ temporary_count: 10 }]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.createTemporary({
      userId: "student_a",
      image,
      idempotencyKey: "upload-011",
      requestFingerprint: "b".repeat(64),
      now,
      expiresAt,
    })).rejects.toMatchObject({ code: "EXTERNAL_QUESTION_TEMPORARY_LIMIT" });
    expect(calls.some((call) => call.sql.includes("INSERT INTO student_external_questions")))
      .toBe(false);
  });

  it.each([
    {
      name: "the 101st saved record",
      aggregate: { saved_count: 100, saved_bytes: 20_000_000 },
      code: "EXTERNAL_QUESTION_SAVED_LIMIT",
    },
    {
      name: "a saved-byte total over 250 MiB",
      aggregate: { saved_count: 8, saved_bytes: 250 * 1024 * 1024 },
      code: "EXTERNAL_QUESTION_SAVED_BYTES_LIMIT",
    },
  ])("rejects $name", async ({ aggregate, code }) => {
    const confirmedRow = questionRow({
      status: "confirmed",
      content_revision: 1,
      confirmed_payload: confirmation,
    });
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("student_external_question_idempotency")) return result();
      if (sql.includes("FROM users") && sql.includes("FOR UPDATE")) {
        return result([{ user_id: "student_a" }]);
      }
      if (sql.includes("FROM student_external_questions") && sql.includes("FOR UPDATE")) {
        return result([confirmedRow]);
      }
      if (sql.includes("AS saved_count")) return result([aggregate]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.save({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      idempotencyKey: `save-${code}`,
      now,
    })).rejects.toMatchObject({ code });
    expect(calls.some((call) => /SET\s+saved_at/iu.test(call.sql))).toBe(false);
  });
});

describe("PostgresExternalQuestionRepository revision and idempotency", () => {
  it("serializes upload and recognition before checking their replay records", async () => {
    const uploadReplay = {
      kind: "upload",
      externalQuestionId: "external_question_001",
    };
    const uploadPool = createPool((sql) => {
      if (sql.includes("FROM users") && sql.includes("FOR UPDATE")) {
        return result([{ user_id: "student_a" }]);
      }
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result([{ response_payload: uploadReplay, fingerprint_matches: true }]);
      }
      throw new Error(`Unexpected upload replay SQL: ${sql}`);
    });
    const uploadRepository = new PostgresExternalQuestionRepository(uploadPool.pool);
    await expect(uploadRepository.createTemporary({
      userId: "student_a",
      image,
      idempotencyKey: "upload-serialized-replay",
      requestFingerprint: "f".repeat(64),
      now,
      expiresAt,
    })).resolves.toEqual({ ...uploadReplay, idempotencyReplayed: true });
    expect(uploadPool.calls.map((call) => call.sql)).toEqual([
      "BEGIN",
      expect.stringContaining("FROM users"),
      expect.stringContaining("student_external_question_idempotency"),
      "COMMIT",
    ]);

    const recognitionReplay = {
      kind: "recognition",
      externalQuestionId: "external_question_001",
      status: "recognized",
    };
    const recognitionPool = createPool((sql) => {
      if (sql.includes("FROM student_external_questions") && sql.includes("FOR UPDATE")) {
        return result([questionRow()]);
      }
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result([{ response_payload: recognitionReplay, fingerprint_matches: true }]);
      }
      throw new Error(`Unexpected recognition replay SQL: ${sql}`);
    });
    const recognitionRepository = new PostgresExternalQuestionRepository(recognitionPool.pool);
    await expect(recognitionRepository.recordRecognition({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      status: "recognized",
      recognition,
      modelTrace: trace,
      idempotencyKey: "recognition-serialized-replay",
      now,
    })).resolves.toEqual({ ...recognitionReplay, idempotencyReplayed: true });
    expect(recognitionPool.calls.map((call) => call.sql)).toEqual([
      "BEGIN",
      expect.stringContaining("FROM student_external_questions"),
      expect.stringContaining("student_external_question_idempotency"),
      "COMMIT",
    ]);
  });

  it("looks up recognition and explanation replays before an AI call", async () => {
    const recognitionReplay = {
      kind: "recognition",
      externalQuestionId: "external_question_001",
      status: "recognized",
    };
    const explanationReplay = {
      kind: "explanation",
      externalQuestionId: "external_question_001",
      explanation: {
        explanationId: "explanation_direction",
        contentRevision: 2,
        explanation,
        modelTrace: trace,
        createdAt: now.toISOString(),
      },
    };
    const { pool, calls } = createPool((_sql, parameters) => {
      const operation = parameters[1];
      return result([{
        response_payload: operation === "recognition" ? recognitionReplay : explanationReplay,
        fingerprint_matches: true,
      }]);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.findRecognitionReplay({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      idempotencyKey: "recognition-preflight",
    })).resolves.toEqual({ ...recognitionReplay, idempotencyReplayed: true });
    await expect(repository.findExplanationReplay({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      contentRevision: 2,
      depth: "direction",
      idempotencyKey: "explanation-preflight",
    })).resolves.toEqual({ ...explanationReplay, idempotencyReplayed: true });

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.parameters[3])).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/u),
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    ]);
    expect(calls[0]?.parameters[3]).not.toBe(calls[1]?.parameters[3]);
  });

  it("rejects a stale explanation when the confirmed content revision changed", async () => {
    const current = questionRow({
      status: "confirmed",
      content_revision: 2,
      confirmed_payload: confirmation,
    });
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FOR UPDATE")) return result([current]);
      throw new Error(`Unexpected SQL after stale revision check: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.storeExplanation({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      expectedContentRevision: 1,
      explanation,
      conceptIds: ["ds_queue_circular"],
      modelTrace: trace,
      idempotencyKey: "stale-explanation",
      now,
    })).rejects.toMatchObject({
      name: "ExternalQuestionRepositoryError",
      code: "EXTERNAL_QUESTION_INVALID_STATE",
      statusCode: 409,
    });
    expect(calls.map((call) => call.sql)).toEqual(["BEGIN", expect.stringContaining("FOR UPDATE"), "ROLLBACK"]);
  });

  it("increments content_revision only for semantically new confirmation", async () => {
    const sameRow = questionRow({
      status: "confirmed",
      content_revision: 1,
      confirmed_payload: confirmation,
    });
    const changed = { ...confirmation, question_text: `${confirmation.question_text}（修订）` };

    const samePool = createPool((sql) => {
      if (sql.includes("student_external_question_idempotency")) return result();
      if (sql.includes("FOR UPDATE")) return result([sameRow]);
      if (sql.includes("INSERT INTO student_external_question_idempotency")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const sameRepository = new PostgresExternalQuestionRepository(samePool.pool);
    await expect(sameRepository.confirm({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      confirmation,
      conceptCandidates: [],
      idempotencyKey: "confirm-same",
      now,
    })).resolves.toMatchObject({ contentRevision: 1, changed: false });
    expect(samePool.calls.some((call) => /content_revision\s*=\s*content_revision\s*\+\s*1/iu.test(call.sql)))
      .toBe(false);

    const changedPool = createPool((sql) => {
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result();
      }
      if (sql.includes("FOR UPDATE")) return result([sameRow]);
      if (/content_revision\s*=\s*content_revision\s*\+\s*1/iu.test(sql)) {
        return result([questionRow({
          status: "confirmed",
          content_revision: 2,
          confirmed_payload: changed,
        })]);
      }
      if (sql.includes("INSERT INTO student_external_question_idempotency")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const changedRepository = new PostgresExternalQuestionRepository(changedPool.pool);
    await expect(changedRepository.confirm({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      confirmation: changed,
      conceptCandidates: [],
      idempotencyKey: "confirm-changed",
      now,
    })).resolves.toMatchObject({ contentRevision: 2, changed: true });
    const update = changedPool.calls.find((call) => /content_revision\s*=\s*content_revision\s*\+\s*1/iu.test(call.sql));
    expect(update?.parameters[0]).toBe("student_a");
    expect(update?.parameters).toContain("external_question_001");
  });

  it("increments content_revision when verified concept candidates change", async () => {
    const previous = questionRow({
      status: "confirmed",
      content_revision: 1,
      confirmed_payload: confirmation,
      concept_candidates: [],
    });
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FOR UPDATE")) return result([previous]);
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result();
      }
      if (/content_revision\s*=\s*content_revision\s*\+\s*1/iu.test(sql)) {
        return result([questionRow({
          status: "confirmed",
          content_revision: 2,
          confirmed_payload: confirmation,
          concept_candidates: [conceptCandidate],
        })]);
      }
      if (sql.includes("INSERT INTO student_external_question_idempotency")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.confirm({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      confirmation,
      conceptCandidates: [conceptCandidate],
      idempotencyKey: "confirm-new-candidate",
      now,
    })).resolves.toMatchObject({ contentRevision: 2, changed: true });
    const update = calls.find((call) => /content_revision\s*=\s*content_revision\s*\+\s*1/iu.test(call.sql));
    expect(update?.parameters).toContain(JSON.stringify([conceptCandidate]));
  });

  it("rolls back when PostgreSQL does not return the updated confirmation", async () => {
    const previous = questionRow({
      status: "confirmed",
      content_revision: 1,
      confirmed_payload: confirmation,
    });
    const changed = { ...confirmation, question_text: `${confirmation.question_text}（修订）` };
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result();
      }
      if (sql.includes("FOR UPDATE")) return result([previous]);
      if (/content_revision\s*=\s*content_revision\s*\+\s*1/iu.test(sql)) return result([], 1);
      if (sql.includes("INSERT INTO student_external_question_idempotency")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.confirm({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      confirmation: changed,
      conceptCandidates: [],
      idempotencyKey: "confirmation-empty-returning",
      now,
    })).rejects.toThrow("PostgreSQL did not return the updated external question.");
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(calls.some((call) => call.sql.includes("INSERT INTO student_external_question_idempotency")))
      .toBe(false);
  });

  it("returns the stored response for a repeated idempotency key", async () => {
    const replay = {
      kind: "confirmation",
      externalQuestionId: "external_question_001",
      contentRevision: 2,
      changed: true,
    };
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM student_external_questions") && sql.includes("FOR UPDATE")) {
        return result([questionRow({
          status: "confirmed",
          content_revision: 2,
          confirmed_payload: confirmation,
        })]);
      }
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result([{ response_payload: replay, fingerprint_matches: true }]);
      }
      throw new Error(`Unexpected SQL after idempotency replay: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.confirm({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      confirmation,
      conceptCandidates: [],
      idempotencyKey: "confirm-replay",
      now,
    })).resolves.toEqual({ ...replay, idempotencyReplayed: true });
    expect(calls).toHaveLength(4);
    expect(calls.map((call) => call.sql)).toEqual([
      "BEGIN",
      expect.stringContaining("FROM student_external_questions"),
      expect.stringContaining("student_external_question_idempotency"),
      "COMMIT",
    ]);
  });

  it("keeps audit revisions but returns explanations only for current content", async () => {
    const current = questionRow({
      status: "confirmed",
      content_revision: 2,
      confirmed_payload: confirmation,
    });
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM student_external_questions")) return result([current]);
      if (sql.includes("FROM student_external_question_explanations")) {
        return result([{
          explanation_id: "explanation_current",
          content_revision: 2,
          response_payload: explanation,
          model_trace: trace,
          created_at: now,
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.getOwned("student_a", "external_question_001", now))
      .resolves.toMatchObject({
        contentRevision: 2,
        explanations: [{ explanationId: "explanation_current", contentRevision: 2 }],
      });
    const explanationQuery = calls.find((call) => call.sql.includes("student_external_question_explanations"));
    expect(explanationQuery?.sql).toContain("content_revision = $3");
    expect(explanationQuery?.parameters).toEqual([
      "student_a",
      "external_question_001",
      2,
    ]);
    expect(explanationQuery?.sql).not.toMatch(/DELETE|UPDATE/iu);
  });

  it("rolls back when PostgreSQL does not return an inserted explanation", async () => {
    const confirmedRow = questionRow({
      status: "confirmed",
      content_revision: 1,
      confirmed_payload: confirmation,
    });
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result();
      }
      if (sql.includes("FROM student_external_questions") && sql.includes("FOR UPDATE")) {
        return result([confirmedRow]);
      }
      if (sql.includes("FROM student_external_question_explanations")) return result();
      if (sql.includes("INSERT INTO student_external_question_explanations")) return result([], 1);
      if (sql.includes("INSERT INTO student_external_question_idempotency")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.storeExplanation({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      expectedContentRevision: 1,
      explanation,
      conceptIds: ["ds_queue_circular"],
      modelTrace: trace,
      idempotencyKey: "explanation-empty-returning",
      now,
    })).rejects.toThrow("PostgreSQL did not return the inserted external-question explanation.");
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(calls.some((call) => call.sql.includes("INSERT INTO student_external_question_idempotency")))
      .toBe(false);
  });
});

describe("PostgresExternalQuestionRepository deletion cleanup", () => {
  it("blocks reads immediately and emits the file cleanup reference once", async () => {
    let deleted = false;
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result();
      }
      if (sql.includes("FOR UPDATE")) {
        return result([questionRow(deleted ? {
          status: "deleted",
          deleted_at: now,
          cleanup_claimed_at: now,
        } : {})]);
      }
      if (sql.includes("SET status = 'deleted'")) {
        deleted = true;
        return result([{
          external_question_id: "external_question_001",
          image_storage_ref: image.storageRef,
        }]);
      }
      if (sql.includes("INSERT INTO student_external_question_idempotency")) return result([], 1);
      if (sql.includes("FROM student_external_questions")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    const first = await repository.markDeleted({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      idempotencyKey: "delete-once",
      now,
    });
    expect(first.cleanupRef).toEqual({
      externalQuestionId: "external_question_001",
      storageRef: image.storageRef,
    });

    const repeated = await repository.markDeleted({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      idempotencyKey: "delete-repeated",
      now,
    });
    expect(repeated).toMatchObject({
      deleted: true,
      cleanupRef: null,
    });

    await expect(repository.getOwned("student_a", "external_question_001", now))
      .rejects.toMatchObject({ code: "EXTERNAL_QUESTION_NOT_FOUND" });
    const ownedRead = calls.findLast((call) => call.sql.includes("FROM student_external_questions"));
    expect(ownedRead?.sql).toContain("deleted_at IS NULL");
  });

  it("rolls back when PostgreSQL does not return the deleted question", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("student_external_question_idempotency") && sql.includes("SELECT")) {
        return result();
      }
      if (sql.includes("FOR UPDATE")) return result([questionRow()]);
      if (sql.includes("SET status = 'deleted'")) return result([], 1);
      if (sql.includes("INSERT INTO student_external_question_idempotency")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.markDeleted({
      userId: "student_a",
      externalQuestionId: "external_question_001",
      idempotencyKey: "delete-empty-returning",
      now,
    })).rejects.toThrow("PostgreSQL did not return the deleted external question.");
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(calls.some((call) => call.sql.includes("INSERT INTO student_external_question_idempotency")))
      .toBe(false);
  });

  it("claims cleanup rows once and finalizes the matching private reference", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FOR UPDATE SKIP LOCKED")) {
        return result([{
          external_question_id: "external_question_001",
          image_storage_ref: image.storageRef,
        }]);
      }
      if (sql.includes("SET cleanup_claimed_at")) {
        return result([{
          external_question_id: "external_question_001",
          image_storage_ref: image.storageRef,
        }]);
      }
      if (sql.includes("SET image_removed_at")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresExternalQuestionRepository(pool);

    await expect(repository.findCleanupBatch(now, 20)).resolves.toEqual([{
      externalQuestionId: "external_question_001",
      storageRef: image.storageRef,
    }]);
    await expect(repository.finalizeCleanup({
      externalQuestionId: "external_question_001",
      storageRef: image.storageRef,
      now,
    })).resolves.toBe(true);

    const claim = calls.find((call) => call.sql.includes("FOR UPDATE SKIP LOCKED"));
    const staleClaimBefore = new Date(now.getTime() - 10 * 60 * 1_000).toISOString();
    expect(claim?.sql).toContain("cleanup_claimed_at <= $3");
    expect(claim?.parameters).toEqual([now.toISOString(), 20, staleClaimBefore]);
    const claimUpdate = calls.find((call) => call.sql.includes("SET cleanup_claimed_at"));
    expect(claimUpdate?.sql).toContain("cleanup_claimed_at <= $3");
    expect(claimUpdate?.parameters).toEqual([now.toISOString(), ["external_question_001"], staleClaimBefore]);
    const finalize = calls.find((call) => call.sql.includes("SET image_removed_at"));
    expect(finalize?.parameters).toEqual([
      "external_question_001",
      image.storageRef,
      now.toISOString(),
    ]);
  });
});

it("exposes bounded repository errors without leaking ownership", () => {
  const error = new ExternalQuestionRepositoryError(
    "EXTERNAL_QUESTION_NOT_FOUND",
    404,
    "题目不存在。",
  );
  expect(error).toMatchObject({
    name: "ExternalQuestionRepositoryError",
    code: "EXTERNAL_QUESTION_NOT_FOUND",
    statusCode: 404,
  });
});
