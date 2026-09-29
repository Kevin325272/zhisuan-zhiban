import { randomUUID } from "node:crypto";

import type { ExternalQuestionDetail } from "@xuetu/contracts";
import sharp from "sharp";

import { readDatabaseConfig } from "../src/config/database.js";
import { loadLocalEnvironment } from "../src/config/local-env.js";
import { createPostgresPool } from "../src/database/client.js";

interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

class SmokeApiError extends Error {
  constructor(readonly code: string, readonly details: Record<string, unknown>) {
    super(code);
  }
}

const apiOrigin = (process.env.SMOKE_API_ORIGIN ?? "http://127.0.0.1:3312").replace(/\/$/u, "");
let sessionCookie = "";
let externalQuestionId: string | null = null;

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in the ignored local environment.`);
  return value;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...init.headers,
    },
  });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new SmokeApiError(
      envelope.error?.code ?? `HTTP_${response.status}`,
      envelope.error?.details ?? {},
    );
  }
  return { data: envelope.data, response };
}

async function activeSmokeQuestionIds() {
  const pool = createPostgresPool(readDatabaseConfig());
  try {
    const result = await pool.query<{ external_question_id: string }>(
      `SELECT DISTINCT question.external_question_id
       FROM student_external_questions question
       JOIN student_external_question_idempotency operation
         ON operation.external_question_id = question.external_question_id
       WHERE operation.idempotency_key LIKE 'relay-smoke-upload-%'
         AND question.deleted_at IS NULL`,
    );
    return result.rows.map((row) => row.external_question_id);
  } finally {
    await pool.end();
  }
}

async function generatedQuestionPng() {
  const svg = `
    <svg width="1200" height="720" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="720" fill="#ffffff"/>
      <rect x="45" y="45" width="1110" height="630" fill="none" stroke="#8b6d2d" stroke-width="4"/>
      <text x="75" y="115" font-family="Microsoft YaHei, sans-serif" font-size="42" font-weight="700" fill="#151515">数据结构 · 队列</text>
      <text x="75" y="205" font-family="Microsoft YaHei, sans-serif" font-size="34" fill="#151515">队列的基本操作遵循什么原则？</text>
      <text x="95" y="310" font-family="Microsoft YaHei, sans-serif" font-size="30" fill="#151515">A. 先进先出</text>
      <text x="95" y="390" font-family="Microsoft YaHei, sans-serif" font-size="30" fill="#151515">B. 后进先出</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  loadLocalEnvironment();
  const password = requireEnvironment("XUETU_LEGACY_STUDENT_PASSWORD");
  const requestedModel = process.env.LLM_MODEL?.trim() || "gpt-5.6-terra";
  const login = await request<{ account: unknown }>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "user_student_001", password }),
  });
  const setCookie = login.response.headers.get("set-cookie");
  if (!setCookie) throw new Error("SESSION_COOKIE_MISSING");
  sessionCookie = setCookie.split(";", 1)[0] ?? "";

  for (const staleQuestionId of await activeSmokeQuestionIds()) {
    await request<{ deleted: boolean }>(
      `/api/v1/student/external-questions/${encodeURIComponent(staleQuestionId)}`,
      {
        method: "DELETE",
        headers: { "Idempotency-Key": `relay-smoke-delete-${randomUUID()}` },
      },
    );
  }

  const before = await request<{ courses: unknown[] }>("/api/v1/student/learning-record");
  try {
    const image = await generatedQuestionPng();
    const form = new FormData();
    form.append("image", new Blob([image], { type: "image/png" }), "relay-smoke-question.png");
    let uploaded;
    try {
      uploaded = await request<ExternalQuestionDetail>("/api/v1/student/external-questions", {
        method: "POST",
        headers: { "Idempotency-Key": `relay-smoke-upload-${randomUUID()}` },
        body: form,
      });
    } catch (error) {
      if (error instanceof SmokeApiError) {
        const failedQuestionId = error.details.external_question_id;
        if (typeof failedQuestionId === "string") externalQuestionId = failedQuestionId;
      }
      throw error;
    }
    externalQuestionId = uploaded.data.external_question_id;
    const recognition = uploaded.data.recognition;
    if (
      recognition?.status !== "recognized"
      || recognition.subject === "unknown"
      || recognition.question_type === "unknown"
    ) {
      throw new Error("RECOGNITION_NOT_CONFIRMABLE");
    }

    const confirmed = await request<ExternalQuestionDetail>(
      `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}/confirmation`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `relay-smoke-confirm-${randomUUID()}`,
        },
        body: JSON.stringify({
          subject: recognition.subject,
          question_type: recognition.question_type,
          question_text: recognition.question_text,
          options: recognition.question_type === "choice" ? recognition.options : [],
          formulae: recognition.formulae,
          diagram_description: recognition.diagram_description,
        }),
      },
    );
    if (!confirmed.data.confirmation) throw new Error("CONFIRMATION_MISSING");

    const explained = await request<ExternalQuestionDetail>(
      `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}/explanations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `relay-smoke-explain-${randomUUID()}`,
        },
        body: JSON.stringify({ depth: "direction" }),
      },
    );
    const direction = [...explained.data.explanations]
      .reverse()
      .find((item) => item.depth === "direction");
    if (!direction) throw new Error("DIRECTION_EXPLANATION_MISSING");

    const after = await request<{ courses: unknown[] }>("/api/v1/student/learning-record");
    const trace = direction.model_trace ?? explained.data.model_trace ?? null;
    const summary = {
      recognition_status: recognition.status,
      requested_model: trace?.requested_model ?? requestedModel,
      provider_model: trace?.provider_model ?? null,
      model_matched: trace?.matched ?? null,
      direction_final_answer_null: direction.final_answer === null,
      learning_record_unchanged: JSON.stringify(after.data.courses) === JSON.stringify(before.data.courses),
    };
    if (
      summary.requested_model !== requestedModel
      || summary.provider_model !== requestedModel
      || summary.model_matched !== true
      || !summary.direction_final_answer_null
      || !summary.learning_record_unchanged
    ) {
      throw new Error("RELAY_SMOKE_ASSERTION_FAILED");
    }
    console.log(JSON.stringify(summary));
  } finally {
    if (externalQuestionId) {
      await request<{ deleted: boolean }>(
        `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}`,
        {
          method: "DELETE",
          headers: { "Idempotency-Key": `relay-smoke-delete-${randomUUID()}` },
        },
      ).catch(() => undefined);
    }
    await request<{ logged_out: boolean }>("/api/v1/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  }
}

await main();
