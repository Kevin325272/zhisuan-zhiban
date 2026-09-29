import { createHash, randomUUID } from "node:crypto";

import {
  mockExamSessionSchema,
  mockExamSubmissionResultSchema,
  questionAssetReferenceSchema,
  questionDtoSchema,
  questionPracticeItemSchema,
  type AnswerSubmission,
  type MockExamSession,
  type MockExamStartRequest,
  type MockExamSubmitRequest,
  type QuestionAssetReference,
  type QuestionPracticeItem,
} from "@xuetu/contracts";

import {
  withTransaction,
  type SqlClient,
  type SqlQueryablePool,
} from "../../database/client.js";
import type {
  QuestionEvaluationBundle,
  SnapshotQuestionEvaluation,
} from "./question-bank.js";
import {
  MockExamError,
  type MockExamService,
  type MockExamSubmission,
} from "./mock-exam.js";
import { studentQuestionContentReviewSql, studentQuestionExposureSql, studentQuestionExposureWithLocalPastExamsSql } from "./student-question-exposure.js";

export interface TransactionalQuestionEvaluator {
  readonly courseId: string;
  evaluateInTransaction(
    client: SqlClient,
    userId: string,
    submission: AnswerSubmission,
    idempotencyKey: string,
  ): Promise<QuestionEvaluationBundle>;
  evaluateSnapshotInTransaction(
    client: SqlClient,
    userId: string,
    submission: AnswerSubmission,
    idempotencyKey: string,
    snapshot: SnapshotQuestionEvaluation,
  ): Promise<QuestionEvaluationBundle>;
}

interface MockExamOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
  allowLocalDemoPastExams?: boolean;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  course_id: string;
  paper_year: number;
  status: "active" | "submitted";
  duration_minutes: number;
  question_count: number;
  objective_count: number;
  subjective_count: number;
  started_at: Date | string;
  expires_at: Date | string;
  submitted_at: Date | string | null;
  submission_key_hash: string | null;
  result_payload: unknown;
}

interface PaperYearRow {
  paper_year: number;
}

interface PaperQuestionRow {
  course_id?: string;
  question_id: string;
  year: number | null;
  number: number;
  subject: string;
  question_type: "choice" | "subjective";
  multiple: boolean;
  question_text: string;
  options: unknown;
  tags: string[];
  assets: unknown;
  source_provider: string;
  dataset_id: string;
  source_url: string;
  license_status: "unverified" | "verified" | "restricted";
  usage_scope: "local_demo_only" | "authorized_product_use";
  source_type: "past_exam" | "mock_exam" | "self_authored_practice";
  allowed_modes: Array<"diagnostic" | "targeted" | "past_exam" | "mock_exam" | "mistake_review">;
  paper_year: number;
  protect_full_paper: boolean;
  importance: "core" | "extended";
  content_review_status: "pending_teacher_review" | "teacher_verified" | "demo_validated";
  answer_key?: unknown;
  explanation_text?: string | null;
  solution_text?: string | null;
}

interface SnapshotQuestionRow {
  question_id: string;
  question_type: "choice" | "subjective";
  ordinal: number;
  question_payload: unknown;
  evaluation_payload: unknown;
}

const FULL_PAPER_DURATION_MINUTES = 180;
const SELF_AUTHORED_MINUTES_PER_QUESTION = 5;

function paperDurationMinutes(rows: PaperQuestionRow[]): number {
  if (rows.every((row) => row.source_type === "self_authored_practice")) {
    return Math.max(15, Math.min(240, rows.length * SELF_AUTHORED_MINUTES_PER_QUESTION));
  }
  return FULL_PAPER_DURATION_MINUTES;
}

function date(value: Date | string, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid mock-exam ${label}.`);
  return parsed;
}

function publicAssets(value: unknown): QuestionAssetReference[] {
  if (!Array.isArray(value)) return [];
  return value.filter((asset): asset is QuestionAssetReference => (
    Boolean(asset)
    && typeof asset === "object"
    && Reflect.get(asset, "role") === "question"
  ));
}

function practiceItem(row: PaperQuestionRow): QuestionPracticeItem {
  return questionPracticeItemSchema.parse({
    question: {
      id: row.question_id,
      year: row.year === null ? null : Number(row.year),
      number: Number(row.number),
      subject: row.subject,
      type: row.question_type,
      multiple: row.multiple,
      question: row.question_text,
      options: row.options,
      tags: row.tags,
      assets: publicAssets(row.assets),
      content_format: "plain_text",
      source: {
        provider: row.source_provider,
        dataset_id: row.dataset_id,
        source_url: row.source_url,
        license_status: row.license_status,
        usage_scope: row.usage_scope,
      },
    },
    learning_metadata: {
      source_type: row.source_type,
      allowed_modes: row.allowed_modes,
      paper_year: Number(row.paper_year),
      protect_full_paper: row.protect_full_paper,
      importance: row.importance,
      content_review_status: row.content_review_status,
    },
    ranking: null,
  });
}

function snapshotItem(row: SnapshotQuestionRow): QuestionPracticeItem {
  return questionPracticeItemSchema.parse(row.question_payload);
}

function snapshotEvaluation(row: SnapshotQuestionRow): SnapshotQuestionEvaluation {
  const raw = typeof row.evaluation_payload === "string"
    ? JSON.parse(row.evaluation_payload) as unknown
    : row.evaluation_payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MockExamError(
      "MOCK_EXAM_EVALUATION_SNAPSHOT_UNAVAILABLE",
      "本次模考缺少可用的评分快照，暂时无法交卷。",
      409,
    );
  }
  const record = raw as Record<string, unknown>;
  const question = snapshotItem(row).question;
  const answerAssets = Array.isArray(record.answer_assets)
    ? record.answer_assets
      .map((asset) => questionAssetReferenceSchema.safeParse(asset))
      .filter((parsed): parsed is { success: true; data: QuestionAssetReference } => parsed.success)
      .map((parsed) => parsed.data)
      .filter((asset) => asset.role === "explanation" || asset.role === "solution")
    : [];
  const correctOptionIds = Array.isArray(record.answer_key)
    ? record.answer_key.filter((value): value is string => typeof value === "string")
    : [];
  if (typeof record.course_id !== "string" || record.course_id.trim().length === 0) {
    throw new Error("Mock-exam evaluation snapshot has no course.");
  }
  if (record.explanation !== null && typeof record.explanation !== "string") {
    throw new Error("Mock-exam evaluation snapshot explanation is invalid.");
  }
  if (record.reference_solution !== null && typeof record.reference_solution !== "string") {
    throw new Error("Mock-exam evaluation snapshot solution is invalid.");
  }
  return {
    courseId: record.course_id,
    question: questionDtoSchema.parse(question),
    correctOptionIds,
    explanation: record.explanation as string | null,
    referenceSolution: record.reference_solution as string | null,
    answerAssets,
  };
}

function evaluationPayload(row: PaperQuestionRow, fallbackCourseId: string) {
  return {
    course_id: row.course_id ?? fallbackCourseId,
    answer_key: Array.isArray(row.answer_key)
      ? row.answer_key.filter((value): value is string => typeof value === "string")
      : [],
    explanation: row.explanation_text ?? null,
    reference_solution: row.solution_text ?? null,
    answer_assets: Array.isArray(row.assets)
      ? row.assets.filter((asset): asset is QuestionAssetReference => (
          Boolean(asset)
          && typeof asset === "object"
          && (Reflect.get(asset, "role") === "explanation" || Reflect.get(asset, "role") === "solution")
        ))
      : [],
  };
}

function canonicalSubmission(request: MockExamSubmitRequest) {
  return [...request.answers]
    .map((answer) => answer.answer_type === "choice"
      ? {
          ...answer,
          selected_option_ids: [...answer.selected_option_ids].sort(),
        }
      : answer)
    .sort((left, right) => left.question_id.localeCompare(right.question_id));
}

function submissionFingerprint(idempotencyKey: string, request: MockExamSubmitRequest) {
  return createHash("sha256")
    .update(JSON.stringify({ idempotencyKey, answers: canonicalSubmission(request) }))
    .digest("hex");
}

function sessionResponse(
  row: SessionRow,
  questions: QuestionPracticeItem[],
  resumed: boolean,
  serverNow: Date,
): MockExamSession {
  return mockExamSessionSchema.parse({
    session_id: row.session_id,
    year: Number(row.paper_year),
    status: row.status,
    duration_minutes: Number(row.duration_minutes),
    server_now: serverNow.toISOString(),
    started_at: date(row.started_at, "start timestamp").toISOString(),
    expires_at: date(row.expires_at, "expiry timestamp").toISOString(),
    submitted_at: row.submitted_at
      ? date(row.submitted_at, "submission timestamp").toISOString()
      : null,
    resumed,
    questions,
  });
}

export class PostgresMockExam implements MockExamService {
  readonly courseId: string;
  readonly #now: () => Date;
  readonly #createId: (prefix: string) => string;
  readonly #contentReviewSql: string;
  readonly #exposureSql: string;

  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly evaluator: TransactionalQuestionEvaluator,
    options: MockExamOptions = {},
  ) {
    this.courseId = evaluator.courseId;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.#contentReviewSql = studentQuestionContentReviewSql(options.allowLocalDemoPastExams === true);
    this.#exposureSql = options.allowLocalDemoPastExams === true
      ? studentQuestionExposureWithLocalPastExamsSql
      : studentQuestionExposureSql;
  }

  async start(userId: string, request: MockExamStartRequest): Promise<MockExamSession> {
    return withTransaction(this.pool, async (client) => {
      const serverNow = this.#now();
      const active = await client.query<SessionRow>(
        `SELECT session_id, user_id, course_id, paper_year, status,
                duration_minutes, question_count, objective_count, subjective_count,
                started_at, expires_at, submitted_at, submission_key_hash, result_payload
         FROM practice_exam_sessions
         WHERE user_id = $1
           AND course_id = $2
           AND status = 'active'
           AND ($3::integer IS NULL OR paper_year = $3)
         ORDER BY started_at DESC
         LIMIT 1
         FOR UPDATE`,
        [userId, this.courseId, request.year ?? null],
      );
      const existing = active.rows[0];
      if (existing) {
        const snapshots = await this.#loadSnapshots(client, existing.session_id);
        if (snapshots.length !== Number(existing.question_count)) {
          throw new Error("Mock-exam question snapshot is incomplete.");
        }
        if (date(existing.expires_at, "expiry timestamp").getTime() <= serverNow.getTime()) {
          const durationMinutes = Number(existing.duration_minutes);
          const expiresAt = new Date(serverNow.getTime() + durationMinutes * 60_000);
          const restarted = await client.query(
            `UPDATE practice_exam_sessions
             SET started_at = $2, expires_at = $3, updated_at = $2
             WHERE session_id = $1 AND status = 'active'`,
            [existing.session_id, serverNow.toISOString(), expiresAt.toISOString()],
          );
          if ((restarted.rowCount ?? 0) !== 1) {
            throw new Error("Expired mock-exam session could not be restarted.");
          }
          return sessionResponse({
            ...existing,
            started_at: serverNow,
            expires_at: expiresAt,
          }, snapshots.map(snapshotItem), false, serverNow);
        }
        return sessionResponse(existing, snapshots.map(snapshotItem), true, serverNow);
      }

      const paperYear = request.year ?? await this.#defaultPaperYear(client, userId);
      if (paperYear === null) {
        throw new MockExamError("MOCK_EXAM_YEAR_UNAVAILABLE", "暂无可开始的限时模考题组。", 404);
      }
      const paper = await this.#loadPaper(client, paperYear);
      if (paper.length === 0) {
        throw new MockExamError("MOCK_EXAM_YEAR_UNAVAILABLE", "该题组暂无已审核的可用题目。", 404);
      }
      const items = paper.map(practiceItem);
      const durationMinutes = paperDurationMinutes(paper);
      const startedAt = serverNow;
      const expiresAt = new Date(startedAt.getTime() + durationMinutes * 60_000);
      const sessionId = this.#createId("exam_session");
      const objectiveCount = items.filter((item) => item.question.type === "choice").length;
      const subjectiveCount = items.length - objectiveCount;
      await client.query(
        `INSERT INTO practice_exam_sessions(
           session_id, user_id, course_id, paper_year, status, duration_minutes,
           question_count, objective_count, subjective_count, started_at, expires_at,
           submitted_at, submission_key_hash, result_payload, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,NULL,NULL,NULL,$9,$9)`,
        [
          sessionId,
          userId,
          this.courseId,
          paperYear,
          durationMinutes,
          items.length,
          objectiveCount,
          subjectiveCount,
          startedAt.toISOString(),
          expiresAt.toISOString(),
        ],
      );
      for (const [index, row] of paper.entries()) {
        const item = items[index]!;
        await client.query(
          `INSERT INTO practice_exam_session_questions(
             session_id, question_id, ordinal, question_type, question_payload,
             evaluation_payload, created_at
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
          [
            sessionId,
            item.question.id,
            index + 1,
            item.question.type,
            JSON.stringify(item),
            JSON.stringify(evaluationPayload(row, this.courseId)),
            startedAt.toISOString(),
          ],
        );
      }
      return mockExamSessionSchema.parse({
        session_id: sessionId,
        year: paperYear,
        status: "active",
        duration_minutes: durationMinutes,
        server_now: serverNow.toISOString(),
        started_at: startedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        submitted_at: null,
        resumed: false,
        questions: items,
      });
    });
  }

  async submit(
    userId: string,
    sessionId: string,
    request: MockExamSubmitRequest,
    idempotencyKey: string,
  ): Promise<MockExamSubmission> {
    const trimmedKey = idempotencyKey.trim();
    if (!trimmedKey || trimmedKey.length > 200) {
      throw new MockExamError("IDEMPOTENCY_KEY_REQUIRED", "缺少有效的 Idempotency-Key。", 400);
    }
    if (new Set(request.answers.map((answer) => answer.question_id)).size !== request.answers.length) {
      throw new MockExamError("MOCK_EXAM_DUPLICATE_QUESTION", "同一道题不能重复提交。", 400);
    }
    const fingerprint = submissionFingerprint(trimmedKey, request);

    return withTransaction(this.pool, async (client) => {
      const locked = await client.query<SessionRow>(
        `SELECT session_id, user_id, course_id, paper_year, status,
                duration_minutes, question_count, objective_count, subjective_count,
                started_at, expires_at, submitted_at, submission_key_hash, result_payload
         FROM practice_exam_sessions
         WHERE session_id = $1
         FOR UPDATE`,
        [sessionId],
      );
      const session = locked.rows[0];
      if (!session) {
        throw new MockExamError("MOCK_EXAM_NOT_FOUND", "模考会话不存在。", 404);
      }
      if (session.user_id !== userId || session.course_id !== this.courseId) {
        throw new MockExamError("MOCK_EXAM_ACCESS_DENIED", "不能访问其他学生的模考会话。", 403);
      }
      if (session.status === "submitted") {
        if (session.submission_key_hash === fingerprint && session.result_payload) {
          return {
            ...mockExamSubmissionResultSchema.parse(session.result_payload),
            idempotency_replayed: true,
          };
        }
        throw new MockExamError("MOCK_EXAM_ALREADY_SUBMITTED", "该模考已经交卷。", 409);
      }
      if (date(session.expires_at, "expiry timestamp").getTime() <= this.#now().getTime()) {
        throw new MockExamError(
          "MOCK_EXAM_EXPIRED",
          `该模考会话已超过 ${Number(session.duration_minutes)} 分钟。`,
          410,
        );
      }

      const snapshots = await this.#loadSnapshots(client, sessionId);
      if (snapshots.length !== Number(session.question_count)) {
        throw new Error("Mock-exam question snapshot is incomplete.");
      }
      const snapshotById = new Map(snapshots.map((row) => [row.question_id, row]));
      for (const answer of request.answers) {
        const snapshot = snapshotById.get(answer.question_id);
        if (!snapshot) {
          throw new MockExamError(
            "MOCK_EXAM_QUESTION_MISMATCH",
            "提交中包含不属于本次整卷的题目。",
            422,
          );
        }
        if (snapshot.question_type !== answer.answer_type) {
          throw new MockExamError(
            "MOCK_EXAM_ANSWER_TYPE_MISMATCH",
            "作答类型与本次整卷题型不一致。",
            422,
          );
        }
      }

      const answerById = new Map(request.answers.map((answer) => [answer.question_id, answer]));
      const evaluations: QuestionEvaluationBundle[] = [];
      for (const snapshot of snapshots) {
        const answer = answerById.get(snapshot.question_id);
        if (!answer) continue;
        const evaluation = await this.evaluator.evaluateSnapshotInTransaction(
          client,
          userId,
          answer,
          `mock:${sessionId}:${snapshot.question_id}`,
          snapshotEvaluation(snapshot),
        );
        evaluations.push(evaluation);
        await client.query(
          `INSERT INTO practice_exam_session_attempts(
             session_id, question_id, attempt_id, created_at
           ) VALUES ($1,$2,$3,$4)
           ON CONFLICT (session_id, question_id) DO NOTHING`,
          [sessionId, snapshot.question_id, evaluation.attempt.attempt_id, this.#now().toISOString()],
        );
      }

      const objectiveEvaluations = evaluations.filter(
        (bundle) => bundle.evaluation.grading_mode === "deterministic_choice",
      );
      const subjectiveEvaluations = evaluations.filter(
        (bundle) => bundle.evaluation.grading_mode === "ai_or_teacher_review_required",
      );
      const submittedAt = this.#now().toISOString();
      const result = mockExamSubmissionResultSchema.parse({
        session_id: sessionId,
        year: Number(session.paper_year),
        status: "submitted",
        submitted_at: submittedAt,
        question_count: Number(session.question_count),
        answered_count: evaluations.length,
        unanswered_count: Number(session.question_count) - evaluations.length,
        objective: {
          question_count: Number(session.objective_count),
          answered_count: objectiveEvaluations.length,
          correct_count: objectiveEvaluations.filter((bundle) => bundle.evaluation.status === "correct").length,
          score: objectiveEvaluations.filter((bundle) => bundle.evaluation.status === "correct").length * 2,
          max_score: Number(session.objective_count) * 2,
        },
        subjective: {
          question_count: Number(session.subjective_count),
          submitted_count: subjectiveEvaluations.length,
          pending_review_count: subjectiveEvaluations.filter(
            (bundle) => bundle.evaluation.status === "pending_review",
          ).length,
        },
        score_status: "partial_pending_subjective_review",
        evaluations: evaluations.map((bundle) => bundle.evaluation),
      });
      const completed = await client.query(
        `UPDATE practice_exam_sessions
         SET status = 'submitted',
             submitted_at = $2,
             submission_key_hash = $3,
             result_payload = $4::jsonb,
             updated_at = $2
         WHERE session_id = $1 AND status = 'active'`,
        [sessionId, submittedAt, fingerprint, JSON.stringify(result)],
      );
      if ((completed.rowCount ?? 0) !== 1) {
        throw new Error("Mock-exam session could not be completed.");
      }
      return { ...result, idempotency_replayed: false };
    });
  }

  async #defaultPaperYear(client: SqlClient, userId: string): Promise<number | null> {
    const result = await client.query<PaperYearRow>(
      `SELECT meta.paper_year
       FROM question_learning_metadata meta
       JOIN questions q ON q.question_id = meta.question_id
       WHERE q.course_id = $2
         AND q.review_status = 'approved'
         AND ${this.#contentReviewSql}
         AND ${this.#exposureSql}
         AND meta.paper_year IS NOT NULL
         AND 'mock_exam' = ANY(meta.allowed_modes)
         AND NOT EXISTS (
           SELECT 1
           FROM practice_exam_sessions completed
           WHERE completed.user_id = $1
             AND completed.course_id = $2
             AND completed.paper_year = meta.paper_year
             AND completed.status = 'submitted'
         )
       GROUP BY meta.paper_year
       ORDER BY meta.paper_year DESC
       LIMIT 1`,
      [userId, this.courseId],
    );
    return result.rows[0] ? Number(result.rows[0].paper_year) : null;
  }

  async #loadPaper(client: SqlClient, year: number): Promise<PaperQuestionRow[]> {
    const result = await client.query<PaperQuestionRow>(
      `SELECT q.question_id, q.course_id, q.year, q.number, q.subject, q.question_type,
              q.multiple, q.question_text, q.options, q.tags, q.assets,
              q.answer_key, q.explanation_text, q.solution_text,
              batch.source_provider, batch.dataset_id, q.source_url,
              q.license_status, q.usage_scope, meta.source_type,
              meta.allowed_modes, meta.paper_year, meta.protect_full_paper,
              meta.importance, meta.content_review_status
       FROM questions q
       JOIN question_import_batches batch ON batch.import_batch_id = q.import_batch_id
       JOIN question_learning_metadata meta ON meta.question_id = q.question_id
       WHERE q.course_id = $1
         AND meta.paper_year = $2
         AND meta.source_type IN ('past_exam', 'mock_exam', 'self_authored_practice')
         AND 'mock_exam' = ANY(meta.allowed_modes)
         AND q.review_status = 'approved'
         AND ${this.#contentReviewSql}
         AND ${this.#exposureSql}
         AND (
           (q.question_type = 'choice' AND jsonb_array_length(q.answer_key) > 0)
           OR (q.question_type = 'subjective' AND NULLIF(trim(q.solution_text), '') IS NOT NULL)
         )
       ORDER BY meta.paper_year, q.number, q.question_id
       FOR SHARE`,
      [this.courseId, year],
    );
    return result.rows;
  }

  async #loadSnapshots(client: SqlClient, sessionId: string): Promise<SnapshotQuestionRow[]> {
    const result = await client.query<SnapshotQuestionRow>(
      `SELECT snapshot.question_id, snapshot.question_type,
              snapshot.ordinal, snapshot.question_payload,
              snapshot.evaluation_payload
       FROM practice_exam_session_questions snapshot
       WHERE snapshot.session_id = $1
       ORDER BY snapshot.ordinal`,
      [sessionId],
    );
    return result.rows;
  }
}
