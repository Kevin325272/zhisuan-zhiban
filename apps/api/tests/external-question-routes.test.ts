import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import type {
  ExternalQuestionConceptCandidate,
  ExternalQuestionConfirmation,
  ExternalQuestionDepth,
  ExternalQuestionExplanation,
  ExternalQuestionRecognition,
} from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import type { LocalAuthenticationService, PublicAccount } from "../src/services/auth/authentication.js";
import type { ExternalQuestionConceptMatcher } from "../src/services/external-questions/concept-matcher.js";
import {
  ExternalQuestionAiError,
  ExternalQuestionRepositoryError,
  type ExternalQuestionAiGateway,
  type ExternalQuestionCleanupRef,
  type ExternalQuestionImageRecord,
  type ExternalQuestionRepository,
  type StoredExternalQuestion,
} from "../src/services/external-questions/external-question.js";
import { ExternalQuestionImageError } from "../src/services/external-questions/image-service.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

const accounts: Record<string, PublicAccount> = {
  "student-a-session": account("student_a", ["student"]),
  "student-b-session": account("student_b", ["student"]),
  "admin-session": account("admin_001", ["admin"]),
};

function account(userId: string, roles: PublicAccount["roles"]): PublicAccount {
  return {
    user_id: userId,
    username: userId,
    display_name: userId,
    account_status: "active",
    roles,
    auth_source: "local_development",
    account_origin: "registered",
    data_boundary: "local_account",
    must_change_password: false,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
    last_login_at: null,
  };
}

const authentication = {
  async resolveSession(token: string) {
    const found = accounts[token];
    return found ? { account: found } : null;
  },
} as unknown as LocalAuthenticationService;

function platformAccess(assigned = true): PlatformAccessService {
  return {
    async getActor(userId) {
      const found = Object.values(accounts).find((item) => item.user_id === userId);
      return found ? {
        user: {
          user_id: found.user_id,
          display_name: found.display_name,
          account_status: "active",
          auth_source: "local_development",
          created_at: found.created_at,
          updated_at: found.updated_at,
        },
        roles: found.roles,
      } : null;
    },
    async isCourseAssigned(userId, courseId, role) {
      return assigned
        && userId.startsWith("student_")
        && role === "student"
        && courseId === "course_408_ds";
    },
  };
}

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
  knowledge_keywords: ["循环队列", "队空"],
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
const candidate: ExternalQuestionConceptCandidate = {
  concept_id: "ds_queue_circular",
  course_id: "course_408_ds",
  course_slug: "data-structures",
  title: "循环队列",
  reason: "题目关键词命中课程术语“循环队列”。",
  reading_href: "/student/courses/data-structures?concept_id=ds_queue_circular",
  practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_queue_circular",
};
const image: ExternalQuestionImageRecord = {
  storageRef: "7a3f1d4a-07f4-46f8-9ebc-2ed7fd9e6de4.webp",
  sha256: "a".repeat(64),
  mimeType: "image/webp",
  width: 1_280,
  height: 960,
  byteSize: 42,
};
const now = "2026-08-24T08:00:00.000Z";
const expiresAt = "2026-08-25T08:00:00.000Z";

function explanation(depth: ExternalQuestionDepth): ExternalQuestionExplanation {
  return {
    depth,
    summary: depth === "complete" ? "完整梳理循环队列判空约定。" : "先明确循环队列的指针约定。",
    knowledge_points: [{
      concept_id: candidate.concept_id,
      title: candidate.title,
      reason: "题干直接考查循环队列。",
    }],
    approach: ["对照当前实现使用的判空约定。"],
    steps: depth === "direction" ? [] : ["写出 front 与 rear 的初始关系。"],
    self_check: "你的实现是否预留一个空位置？",
    final_answer: depth === "complete" ? "在该约定下使用 front = rear 判空。" : null,
    uncertainty: depth === "complete" ? "不同教材可能采用额外标志位。" : null,
  };
}

function memoryServices() {
  const records = new Map<string, StoredExternalQuestion & { deleted?: boolean }>();
  const recognitionReplays = new Map<string, {
    kind: "recognition";
    externalQuestionId: string;
    status: "recognition_failed" | "needs_better_image" | "unsupported" | "recognized";
  }>();
  const explanationReplays = new Map<string, {
    kind: "explanation";
    externalQuestionId: string;
    explanation: StoredExternalQuestion["explanations"][number];
  }>();
  const aiCalls = { recognize: 0, explain: 0 };
  let sequence = 0;
  const owned = (userId: string, id: string) => {
    const record = records.get(id);
    if (!record || record.userId !== userId || record.deleted) {
      throw new ExternalQuestionRepositoryError(
        "EXTERNAL_QUESTION_NOT_FOUND",
        404,
        "题目不存在。",
      );
    }
    return record;
  };
  const repository: ExternalQuestionRepository = {
    async findRecognitionReplay(input) {
      const replay = recognitionReplays.get(`${input.userId}:${input.idempotencyKey}`);
      return replay ? { ...replay, idempotencyReplayed: true } : null;
    },
    async findExplanationReplay(input) {
      const replay = explanationReplays.get(`${input.userId}:${input.idempotencyKey}`);
      return replay ? { ...replay, idempotencyReplayed: true } : null;
    },
    async createTemporary(input) {
      const id = `external_question_${++sequence}`;
      records.set(id, {
        externalQuestionId: id,
        userId: input.userId,
        status: "recognition_failed",
        contentRevision: 0,
        image: input.image,
        recognition: null,
        confirmation: null,
        conceptCandidates: [],
        explanations: [],
        modelTrace: null,
        savedAt: null,
        expiresAt: input.expiresAt.toISOString(),
        createdAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
      });
      return { kind: "upload", externalQuestionId: id, idempotencyReplayed: false };
    },
    async recordRecognition(input) {
      const replayKey = `${input.userId}:${input.idempotencyKey}`;
      const replay = recognitionReplays.get(replayKey);
      if (replay) return { ...replay, idempotencyReplayed: true };
      const record = owned(input.userId, input.externalQuestionId);
      if (record.status === "confirmed") {
        throw new ExternalQuestionRepositoryError(
          "EXTERNAL_QUESTION_INVALID_STATE",
          409,
          "已确认题目不能重新执行识别。",
        );
      }
      record.status = input.status;
      record.recognition = input.recognition;
      record.modelTrace = input.modelTrace;
      const response = {
        kind: "recognition",
        externalQuestionId: input.externalQuestionId,
        status: input.status,
      } as const;
      recognitionReplays.set(replayKey, response);
      return { ...response, idempotencyReplayed: false };
    },
    async confirm(input) {
      const record = owned(input.userId, input.externalQuestionId);
      const changed = JSON.stringify(record.confirmation) !== JSON.stringify(input.confirmation);
      if (changed) record.contentRevision += 1;
      record.status = "confirmed";
      record.confirmation = input.confirmation;
      record.conceptCandidates = input.conceptCandidates;
      record.explanations = record.explanations.filter(
        (item) => item.contentRevision === record.contentRevision,
      );
      return {
        kind: "confirmation",
        externalQuestionId: input.externalQuestionId,
        contentRevision: record.contentRevision,
        changed,
        idempotencyReplayed: false,
      };
    },
    async save(input) {
      const record = owned(input.userId, input.externalQuestionId);
      record.savedAt = input.now.toISOString();
      return {
        kind: "save",
        externalQuestionId: input.externalQuestionId,
        savedAt: record.savedAt,
        idempotencyReplayed: false,
      };
    },
    async storeExplanation(input) {
      const replayKey = `${input.userId}:${input.idempotencyKey}`;
      const replay = explanationReplays.get(replayKey);
      if (replay) return { ...replay, idempotencyReplayed: true };
      const record = owned(input.userId, input.externalQuestionId);
      const stored = {
        explanationId: `explanation_${input.explanation.depth}`,
        contentRevision: record.contentRevision,
        explanation: input.explanation,
        modelTrace: input.modelTrace,
        createdAt: input.now.toISOString(),
      };
      record.explanations = [
        ...record.explanations.filter((item) => item.explanation.depth !== input.explanation.depth),
        stored,
      ];
      const response = {
        kind: "explanation",
        externalQuestionId: input.externalQuestionId,
        explanation: stored,
      } as const;
      explanationReplays.set(replayKey, response);
      return { ...response, idempotencyReplayed: false };
    },
    async getOwned(userId, id) { return owned(userId, id); },
    async listOwned(userId) {
      return [...records.values()].filter((record) => record.userId === userId && !record.deleted);
    },
    async markDeleted(input) {
      const record = owned(input.userId, input.externalQuestionId);
      record.deleted = true;
      return {
        kind: "delete",
        externalQuestionId: input.externalQuestionId,
        deleted: true,
        cleanupRef: {
          externalQuestionId: input.externalQuestionId,
          storageRef: record.image.storageRef,
        },
        idempotencyReplayed: false,
      };
    },
    async findCleanupBatch() { return []; },
    async finalizeCleanup() { return true; },
    async releaseCleanup() { return true; },
  };
  const files = new Map<string, Buffer>();
  const removed: ExternalQuestionCleanupRef[] = [];
  const imageService = {
    async normalize(input: { bytes: Buffer; declaredMimeType: string }) {
      if (input.declaredMimeType === "image/gif") {
        throw new ExternalQuestionImageError("IMAGE_TYPE_UNSUPPORTED", "只支持 PNG、JPEG 或 WebP 题目图片。");
      }
      files.set(image.storageRef, Buffer.from("normalized-webp"));
      return image;
    },
    async read(storageRef: string) {
      const bytes = files.get(storageRef);
      if (!bytes) throw new ExternalQuestionImageError("IMAGE_NOT_FOUND", "题目图片不存在。");
      return bytes;
    },
    async remove(storageRef: string) {
      removed.push({ externalQuestionId: "removed", storageRef });
      return files.delete(storageRef);
    },
  };
  const gateway: ExternalQuestionAiGateway = {
    async recognize() {
      aiCalls.recognize += 1;
      return {
        recognition,
        modelTrace: {
          requested_model: "gpt-5.6-terra",
          provider_model: "gpt-5.6-terra",
          matched: true,
          latency_ms: 18,
        },
      };
    },
    async explain(input) {
      aiCalls.explain += 1;
      return {
        explanation: explanation(input.depth),
        modelTrace: {
          requested_model: "gpt-5.6-terra",
          provider_model: "gpt-5.6-terra",
          matched: true,
          latency_ms: 22,
        },
      };
    },
  };
  const conceptMatcher: ExternalQuestionConceptMatcher = {
    async match() { return [candidate]; },
  };
  return {
    services: { repository, imageService, gateway, conceptMatcher },
    records,
    files,
    removed,
    aiCalls,
  };
}

async function multipart(parts: Array<{
  field: string;
  bytes: Uint8Array;
  type: string;
  name: string;
}> = [{
  field: "image",
  bytes: new TextEncoder().encode("fake-png"),
  type: "image/png",
  name: "question.png",
}]) {
  const form = new FormData();
  for (const part of parts) {
    const bytes = part.bytes.slice().buffer as ArrayBuffer;
    form.append(part.field, new Blob([bytes], { type: part.type }), part.name);
  }
  const request = new Request("http://xuetu.test/upload", { method: "POST", body: form });
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    headers: Object.fromEntries(request.headers.entries()),
  };
}

const studentA = { cookie: "xuetu_session=student-a-session" };
const studentB = { cookie: "xuetu_session=student-b-session" };

function buildExternalApp(
  services = memoryServices().services,
  options: { assigned?: boolean; aiRequestLimit?: Record<string, number> } = {},
) {
  return buildApp({
    authentication,
    platformAccess: platformAccess(options.assigned ?? true),
    externalQuestions: services,
    aiRequestLimit: options.aiRequestLimit,
  } as never);
}

describe("external-question routes", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("requires a student session and at least one assigned 408 course", async () => {
    const upload = await multipart();
    app = buildExternalApp();
    const anonymous = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, "idempotency-key": "upload-anonymous" },
      payload: upload.payload,
    });
    const admin = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: {
        ...upload.headers,
        cookie: "xuetu_session=admin-session",
        "idempotency-key": "upload-admin",
      },
      payload: upload.payload,
    });
    await app.close();
    app = buildExternalApp(memoryServices().services, { assigned: false });
    const unassigned = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-unassigned" },
      payload: upload.payload,
    });

    expect(anonymous.statusCode).toBe(401);
    expect(admin.statusCode).toBe(403);
    expect(unassigned.statusCode).toBe(403);
    expect(unassigned.json().error.code).toBe("EXTERNAL_QUESTION_408_ACCESS_REQUIRED");
  });

  it("rejects missing keys, non-multipart, missing, wrong, multiple and unsupported files", async () => {
    app = buildExternalApp();
    const valid = await multipart();
    const missingKey = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...valid.headers, ...studentA },
      payload: valid.payload,
    });
    const json = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...studentA, "idempotency-key": "upload-json" },
      payload: {},
    });
    const missing = await multipart([]);
    const missingFile = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...missing.headers, ...studentA, "idempotency-key": "upload-missing" },
      payload: missing.payload,
    });
    const wrong = await multipart([{ field: "document", bytes: new Uint8Array([1]), type: "image/png", name: "q.png" }]);
    const wrongField = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...wrong.headers, ...studentA, "idempotency-key": "upload-wrong" },
      payload: wrong.payload,
    });
    const multiple = await multipart([
      { field: "image", bytes: new Uint8Array([1]), type: "image/png", name: "a.png" },
      { field: "image", bytes: new Uint8Array([2]), type: "image/png", name: "b.png" },
    ]);
    const multipleFiles = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...multiple.headers, ...studentA, "idempotency-key": "upload-multiple" },
      payload: multiple.payload,
    });
    const gif = await multipart([{ field: "image", bytes: new Uint8Array([1]), type: "image/gif", name: "q.gif" }]);
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...gif.headers, ...studentA, "idempotency-key": "upload-gif" },
      payload: gif.payload,
    });

    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(json.statusCode).toBe(415);
    expect(missingFile.statusCode).toBe(400);
    expect(wrongField.statusCode).toBe(400);
    expect(multipleFiles.statusCode).toBe(400);
    expect(unsupported.statusCode).toBe(415);
  });

  it("keeps the five-MiB upload limit local to multipart", async () => {
    app = buildExternalApp();
    const oversized = await multipart([{
      field: "image",
      bytes: new Uint8Array(5 * 1024 * 1024 + 1),
      type: "image/png",
      name: "large.png",
    }]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...oversized.headers, ...studentA, "idempotency-key": "upload-large" },
      payload: oversized.payload,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("IMAGE_TOO_LARGE");
  });

  it("runs upload, retry, confirmation, all depths, save, private reads and delete", async () => {
    const state = memoryServices();
    app = buildExternalApp(state.services);
    const upload = await multipart();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-001" },
      payload: upload.payload,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.external_question_id as string;
    expect(created.json().data).toMatchObject({
      status: "recognized",
      content_revision: 0,
      recognition,
      confirmation: null,
    });
    expect(created.json().data).not.toHaveProperty("model_trace");

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/student/external-questions/${id}/recognition`,
      headers: { ...studentA, "idempotency-key": "recognize-002" },
      payload: {},
    });
    expect(retry.statusCode).toBe(200);

    const confirmed = await app.inject({
      method: "PUT",
      url: `/api/v1/student/external-questions/${id}/confirmation`,
      headers: { ...studentA, "idempotency-key": "confirm-001" },
      payload: confirmation,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data).toMatchObject({
      status: "confirmed",
      content_revision: 1,
      concept_candidates: [candidate],
    });

    for (const depth of ["direction", "steps", "complete"] as const) {
      const explained = await app.inject({
        method: "POST",
        url: `/api/v1/student/external-questions/${id}/explanations`,
        headers: { ...studentA, "idempotency-key": `explain-${depth}` },
        payload: { depth },
      });
      expect(explained.statusCode).toBe(200);
      const current = explained.json().data.explanations.find(
        (item: { depth: string }) => item.depth === depth,
      );
      expect(current).toMatchObject({ depth, content_revision: 1 });
      expect(current).not.toHaveProperty("model_trace");
      if (depth !== "complete") expect(current.final_answer).toBeNull();
    }

    const saved = await app.inject({
      method: "POST",
      url: `/api/v1/student/external-questions/${id}/save`,
      headers: { ...studentA, "idempotency-key": "save-001" },
      payload: {},
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.saved_at).toBeTruthy();

    const list = await app.inject({ method: "GET", url: "/api/v1/student/external-questions", headers: studentA });
    const detail = await app.inject({ method: "GET", url: `/api/v1/student/external-questions/${id}`, headers: studentA });
    const privateImage = await app.inject({ method: "GET", url: `/api/v1/student/external-questions/${id}/image`, headers: studentA });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items).toHaveLength(1);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).not.toHaveProperty("model_trace");
    expect(detail.json().data.explanations).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ model_trace: expect.anything() })]),
    );
    expect(privateImage.statusCode).toBe(200);
    expect(privateImage.headers["content-type"]).toContain("image/webp");
    expect(privateImage.headers["cache-control"]).toBe("private, no-store");
    expect(privateImage.headers["x-content-type-options"]).toBe("nosniff");

    const otherUser = await app.inject({ method: "GET", url: `/api/v1/student/external-questions/${id}`, headers: studentB });
    expect(otherUser.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/student/external-questions/${id}`,
      headers: { ...studentA, "idempotency-key": "delete-001" },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toEqual({ deleted: true });
    const afterDelete = await app.inject({ method: "GET", url: `/api/v1/student/external-questions/${id}`, headers: studentA });
    expect(afterDelete.statusCode).toBe(404);

    for (const response of [created, confirmed, saved, list, detail, deleted]) {
      const text = response.body;
      expect(text).not.toContain(image.storageRef);
      expect(text).not.toContain(image.sha256);
      expect(text).not.toContain("raw_model_output");
      expect(text).not.toContain("student_b");
      expect(text).not.toContain("user_id");
    }
  });

  it("replays sequential AI requests before calling the relay again", async () => {
    const state = memoryServices();
    app = buildExternalApp(state.services);
    const upload = await multipart();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-replay-ai" },
      payload: upload.payload,
    });
    const id = created.json().data.external_question_id as string;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retried = await app.inject({
        method: "POST",
        url: `/api/v1/student/external-questions/${id}/recognition`,
        headers: { ...studentA, "idempotency-key": "recognition-replay-ai" },
        payload: {},
      });
      expect(retried.statusCode).toBe(200);
    }

    const confirmed = await app.inject({
      method: "PUT",
      url: `/api/v1/student/external-questions/${id}/confirmation`,
      headers: { ...studentA, "idempotency-key": "confirmation-replay-ai" },
      payload: confirmation,
    });
    expect(confirmed.statusCode).toBe(200);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const explained = await app.inject({
        method: "POST",
        url: `/api/v1/student/external-questions/${id}/explanations`,
        headers: { ...studentA, "idempotency-key": "explanation-replay-ai" },
        payload: { depth: "direction" },
      });
      expect(explained.statusCode).toBe(200);
    }

    expect(state.aiCalls).toEqual({ recognize: 2, explain: 1 });
  });

  it("rejects recognition of a confirmed question before calling the relay", async () => {
    const state = memoryServices();
    app = buildExternalApp(state.services);
    const upload = await multipart();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-confirmed-recognition" },
      payload: upload.payload,
    });
    const id = created.json().data.external_question_id as string;
    const confirmed = await app.inject({
      method: "PUT",
      url: `/api/v1/student/external-questions/${id}/confirmation`,
      headers: { ...studentA, "idempotency-key": "confirm-before-recognition" },
      payload: confirmation,
    });
    expect(confirmed.statusCode).toBe(200);

    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/student/external-questions/${id}/recognition`,
      headers: { ...studentA, "idempotency-key": "recognize-after-confirmation" },
      payload: {},
    });

    expect(retried.statusCode).toBe(409);
    expect(retried.json().error.code).toBe("EXTERNAL_QUESTION_INVALID_STATE");
    expect(state.aiCalls.recognize).toBe(1);
  });

  it("releases an immediate cleanup claim when database finalization returns false", async () => {
    const state = memoryServices();
    let releaseCalls = 0;
    state.services.repository.finalizeCleanup = async () => false;
    state.services.repository.releaseCleanup = async () => {
      releaseCalls += 1;
      return true;
    };
    app = buildExternalApp(state.services);
    const upload = await multipart();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-cleanup-finalize-false" },
      payload: upload.payload,
    });
    const id = created.json().data.external_question_id as string;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/student/external-questions/${id}`,
      headers: { ...studentA, "idempotency-key": "delete-cleanup-finalize-false" },
    });

    expect(deleted.statusCode).toBe(200);
    expect(releaseCalls).toBe(1);
  });

  it("rate limits AI calls while leaving the created session retryable", async () => {
    app = buildExternalApp(memoryServices().services, {
      aiRequestLimit: { maxRequests: 1, windowMs: 60_000, maxConcurrent: 1, maxTrackedUsers: 100 },
    });
    const upload = await multipart();
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-limit-1" },
      payload: upload.payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-limit-2" },
      payload: upload.payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
    expect(second.json().error.code).toBe("AI_REQUEST_LIMITED");
    expect(second.json().error.details.external_question_id).toBeTruthy();
  });

  it("keeps an uploaded question when the relay is unavailable", async () => {
    const state = memoryServices();
    state.services.gateway.recognize = async () => {
      throw new ExternalQuestionAiError(
        "UPSTREAM_UNAVAILABLE",
        503,
        true,
        "AI 讲题服务暂不可用。",
      );
    };
    app = buildExternalApp(state.services);
    const upload = await multipart();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-offline" },
      payload: upload.payload,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      details: { external_question_id: expect.any(String) },
    });
    expect(state.records.size).toBe(1);
  });

  it("passes a request cancellation signal to recognition", async () => {
    const state = memoryServices();
    let requestSignal: AbortSignal | undefined;
    const recognize = state.services.gateway.recognize;
    state.services.gateway.recognize = async (input) => {
      requestSignal = input.signal;
      return recognize(input);
    };
    app = buildExternalApp(state.services);
    const upload = await multipart();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/external-questions",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-request-signal" },
      payload: upload.payload,
    });

    expect(response.statusCode).toBe(201);
    expect(requestSignal).toBeInstanceOf(AbortSignal);
  });

  it("aborts in-flight recognition when the HTTP client disconnects", async () => {
    const state = memoryServices();
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    let upstreamAborted = false;
    state.services.gateway.recognize = async (input) => {
      startedResolve?.();
      const signal = input.signal;
      if (!signal) throw new Error("request signal missing");
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          upstreamAborted = true;
          resolve();
          return;
        }
        signal.addEventListener("abort", () => {
          upstreamAborted = true;
          resolve();
        }, { once: true });
      });
      return {
        recognition,
        modelTrace: {
          requested_model: "gpt-5.6-terra",
          provider_model: "gpt-5.6-terra",
          matched: true,
          latency_ms: 18,
        },
      };
    };
    app = buildExternalApp(state.services);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a port");
    const upload = await multipart();
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${address.port}/api/v1/student/external-questions`, {
      method: "POST",
      headers: { ...upload.headers, ...studentA, "idempotency-key": "upload-client-disconnect" },
      body: upload.payload,
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(upstreamAborted).toBe(true);
    expect(state.records.size).toBe(1);
    expect([...state.records.values()][0]?.recognition).toBeNull();
  });
});
