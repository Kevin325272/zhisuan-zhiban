import { randomUUID } from "node:crypto";

import {
  learningProbeOfferSchema,
  learningProbeResultSchema,
  learningProbeSessionSchema,
  type LearningProbeEventRequest,
  type LearningProbeOffer,
  type LearningProbeResult,
  type LearningProbeSession,
} from "@xuetu/contracts";

import {
  withTransaction,
  type SqlClient,
  type SqlQueryablePool,
} from "../../database/client.js";
import {
  applyConceptEvidence,
  emptyConceptEvidence,
  type ConceptEvidenceInput,
  type ConceptEvidenceSnapshot,
} from "./concept-evidence.js";
import {
  validateQuestionPair,
  type QuestionPairCandidate,
} from "./question-pair-governance.js";
import {
  LearningProbeError,
  type LearningProbeService,
} from "./learning-probe-service.js";
import {
  QuestionSubmissionError,
  type QuestionBankService,
  type QuestionEvaluationBundle,
} from "./question-bank.js";
import { studentQuestionExposureSqlForAliases } from "./student-question-exposure.js";

interface ProbeOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
  /**
   * Probe questions live in their governed course scope. The regular question
   * bank is intentionally an aggregate 408 view, so probe reads/writes must
   * resolve a course-scoped bank before selecting or evaluating a question.
   */
  questionBankForCourse?: (courseId: string) => QuestionBankService | null;
}

interface AnchorRow {
  attempt_id: string;
  evaluation_id: string;
  question_id: string;
  course_id: string;
  concept_id: string | null;
  concept_title: string | null;
  subject: string;
  outcome: "correct" | "incorrect" | "pending_review";
  grading_mode: "deterministic_choice" | "ai_or_teacher_review_required";
  eligible_for_learning_state_update: boolean;
  created_at: Date | string;
  data_origin?: "real_trial" | "synthetic_verification" | "local_demo";
}

interface PairRow extends QuestionPairCandidate {
  pair_id: string;
  pair_group_id: string;
  question_id: string;
  contrast_question_id: string;
  hypothesis_code: QuestionPairCandidate["hypothesis_code"];
  surface_difference: string;
  question_role: QuestionPairCandidate["question_role"];
}

interface SessionRow {
  probe_session_id: string;
  user_id: string;
  pair_id: string;
  course_id: string;
  concept_id: string;
  concept_title?: string | null;
  source_attempt_id: string;
  anchor_question_id: string;
  contrast_question_id: string;
  question_role: "contrast" | "transfer";
  status: LearningProbeSession["status"];
  data_origin: "real_trial" | "synthetic_verification" | "local_demo";
  started_at: Date | string | null;
  completed_at: Date | string | null;
  skipped_at?: Date | string | null;
}

interface EvidenceEventRow {
  outcome: ConceptEvidenceInput["outcome"];
  question_id: string;
  attempt_id: string | null;
  created_at: Date | string;
  question_role: ConceptEvidenceInput["question_role"];
  independent: boolean;
  eligible_for_learning_state_update: boolean;
}

interface StoredProbeResultRow {
  result_payload: unknown;
}

const ISO_ORIGIN = new Set(["real_trial", "synthetic_verification", "local_demo"]);

function iso(value: Date | string | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function origin(value: unknown): "real_trial" | "synthetic_verification" | "local_demo" {
  return typeof value === "string" && ISO_ORIGIN.has(value)
    ? value as "real_trial" | "synthetic_verification" | "local_demo"
    : "local_demo";
}

function mapStatusLabel(status: LearningProbeSession["status"] extends never ? never : ConceptEvidenceSnapshot["status"]) {
  switch (status) {
    case "signal": return "待确认";
    case "developing": return "继续观察";
    case "provisionally_stable": return "证据较稳定";
    case "transfer_validated": return "已有迁移证据";
  }
}

function evidenceStatement(snapshot: ConceptEvidenceSnapshot) {
  switch (snapshot.status) {
    case "signal": return "先确认一下这部分是否需要补强。";
    case "developing": return `新增 ${snapshot.correct_question_ids.length} 条不同题面的正确证据，继续观察。`;
    case "provisionally_stable": return "不同题面和间隔时间内的证据较稳定，仍保留后续迁移练习。";
    case "transfer_validated": return "已有一次无提示的新情境正确记录，后续继续按复习安排推进。";
  }
}

function unknowns(snapshot: ConceptEvidenceSnapshot): string[] {
  const values: string[] = [];
  if (snapshot.correct_question_ids.length < 2) values.push("还需要另一道不同题面的独立证据");
  if (snapshot.correct_question_ids.length < 3) values.push("还没有达到三次独立正确记录");
  if (snapshot.first_correct_at && snapshot.last_correct_at
    && new Date(snapshot.last_correct_at).getTime() - new Date(snapshot.first_correct_at).getTime() < 7 * 24 * 60 * 60 * 1000) {
    values.push("还没有跨过七天观察窗口");
  }
  return values.slice(0, 4);
}

function isSnapshotStatus(value: string): value is ConceptEvidenceSnapshot["status"] {
  return value === "signal"
    || value === "developing"
    || value === "provisionally_stable"
    || value === "transfer_validated";
}

export class PostgresLearningProbe implements LearningProbeService {
  readonly #now: () => Date;
  readonly #createId: (prefix: string) => string;
  readonly #questionBankForCourse: (courseId: string) => QuestionBankService | null;

  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly questionBank: QuestionBankService,
    options: ProbeOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.#questionBankForCourse = options.questionBankForCourse ?? (() => questionBank);
  }

  async offerForAttempt(userId: string, attemptId: string): Promise<LearningProbeOffer | null> {
    const anchorResult = await this.pool.query<AnchorRow>(
      `SELECT anchor_attempt.attempt_id,
              evaluation.evaluation_id,
              anchor_attempt.question_id,
              COALESCE(concept.course_id, anchor_attempt.course_id) AS course_id,
              COALESCE(anchor_attempt.concept_id, mistake.concept_id) AS concept_id,
              concept.title AS concept_title,
              question.subject,
              evaluation.status AS outcome,
              evaluation.grading_mode,
              evidence.eligible_for_learning_state_update,
              COALESCE(evidence.created_at, evaluation.created_at) AS created_at,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM pilot_participants participant
                   WHERE participant.user_id = anchor_attempt.user_id
                     AND participant.participant_kind = 'synthetic_verification'
                ) THEN 'synthetic_verification'
                WHEN EXISTS (
                  SELECT 1 FROM pilot_participants participant
                   WHERE participant.user_id = anchor_attempt.user_id
                     AND participant.participant_kind = 'real_trial'
                ) THEN 'real_trial'
                WHEN EXISTS (
                  SELECT 1 FROM users account
                   WHERE account.user_id = anchor_attempt.user_id
                     AND account.account_origin = 'legacy_demo'
                 ) THEN 'local_demo'
                ELSE 'local_demo'
              END AS data_origin
         FROM practice_attempts anchor_attempt
         JOIN evaluations evaluation ON evaluation.attempt_id = anchor_attempt.attempt_id
         JOIN questions question ON question.question_id = anchor_attempt.question_id
         LEFT JOIN learning_evidence evidence ON evidence.attempt_id = anchor_attempt.attempt_id
         LEFT JOIN practice_mistakes mistake
           ON mistake.user_id = anchor_attempt.user_id
          AND mistake.question_id = anchor_attempt.question_id
         LEFT JOIN course_core_concepts concept
           ON concept.concept_id = COALESCE(anchor_attempt.concept_id, mistake.concept_id)
        WHERE anchor_attempt.user_id = $1
          AND anchor_attempt.attempt_id = $2
          AND evaluation.status = 'incorrect'
          AND evaluation.grading_mode = 'deterministic_choice'
          AND evidence.eligible_for_learning_state_update = true
        LIMIT 1`,
      [userId, attemptId],
    );
    const anchor = anchorResult.rows[0];
    if (!anchor || !anchor.concept_id) return null;

    const pairResult = await this.pool.query<PairRow>(
      `SELECT pair.pair_id,
              pair.pair_group_id,
              pair.course_id,
              pair.concept_id,
              pair.question_id,
              pair.contrast_question_id,
              pair.hypothesis_code,
              pair.surface_difference,
              pair.question_role,
              pair.content_review_status,
               pair.status,
                pair.algorithm_version,
                pair.source_provenance,
                anchor_question.course_id AS anchor_course_id,
                anchor_catalog.course_id AS anchor_catalog_course_id,
                anchor_link.concept_id AS anchor_concept_id,
                anchor_question.question_type AS anchor_question_type,
                anchor_question.review_status AS anchor_review_status,
                anchor_meta.content_review_status AS anchor_content_review_status,
                anchor_meta.allowed_modes AS anchor_allowed_modes,
                anchor_meta.protect_full_paper AS anchor_protect_full_paper,
                anchor_meta.source_type AS anchor_source_type,
                anchor_question.usage_scope AS anchor_usage_scope,
                anchor_question.license_status AS anchor_license_status,
                true AS anchor_assets_complete,
                contrast.course_id AS contrast_course_id,
                contrast_link.concept_id AS contrast_concept_id,
                contrast.question_type AS contrast_question_type,
               contrast.review_status AS contrast_review_status,
               contrast_meta.content_review_status AS contrast_content_review_status,
                contrast_meta.allowed_modes AS contrast_allowed_modes,
                contrast_meta.protect_full_paper AS contrast_protect_full_paper,
                contrast_meta.source_type AS contrast_source_type,
                contrast.usage_scope AS contrast_usage_scope,
                contrast.license_status AS contrast_license_status,
               true AS contrast_assets_complete
         FROM learning_question_pairs pair
         JOIN course_core_concepts pair_concept
           ON pair_concept.concept_id = pair.concept_id
          AND pair_concept.course_id = pair.course_id
          AND pair_concept.review_status = 'verified'
         JOIN course_catalog_entries pair_catalog
           ON pair_catalog.course_id = pair.course_id
         JOIN questions anchor_question ON anchor_question.question_id = pair.question_id
          JOIN course_catalog_entries anchor_catalog
            ON anchor_catalog.course_id = pair.course_id
           AND anchor_catalog.question_subject = anchor_question.subject
          JOIN question_learning_metadata anchor_meta
            ON anchor_meta.question_id = anchor_question.question_id
          LEFT JOIN course_concept_question_links anchor_link
            ON anchor_link.question_id = anchor_question.question_id
           AND anchor_link.concept_id = pair.concept_id
           AND anchor_link.status = 'active'
         JOIN questions contrast ON contrast.question_id = pair.contrast_question_id
         JOIN course_catalog_entries contrast_catalog
           ON contrast_catalog.course_id = pair.course_id
          AND contrast_catalog.question_subject = contrast.subject
         JOIN question_learning_metadata contrast_meta
           ON contrast_meta.question_id = contrast.question_id
         LEFT JOIN course_concept_question_links contrast_link
           ON contrast_link.question_id = contrast.question_id
          AND contrast_link.concept_id = pair.concept_id
          AND contrast_link.status = 'active'
        WHERE pair.course_id = $1
          AND pair.concept_id = $2
          AND pair.question_id = $3
           AND pair.status = 'active'
           AND pair.content_review_status = 'teacher_verified'
           AND pair.question_role IN ('contrast', 'transfer')
            AND anchor_question.question_type = 'choice'
            AND anchor_question.review_status = 'approved'
            AND anchor_meta.content_review_status = 'teacher_verified'
            AND 'targeted' = ANY(anchor_meta.allowed_modes)
            AND anchor_meta.source_type <> 'self_authored_screening'
            AND anchor_meta.protect_full_paper = false
            AND anchor_link.concept_id IS NOT NULL
            AND ${studentQuestionExposureSqlForAliases("anchor_question", "anchor_meta")}
            AND contrast.question_type = 'choice'
           AND contrast.review_status = 'approved'
           AND contrast_meta.content_review_status = 'teacher_verified'
           AND 'targeted' = ANY(contrast_meta.allowed_modes)
           AND contrast_meta.source_type <> 'self_authored_screening'
           AND contrast_meta.protect_full_paper = false
           AND contrast_link.concept_id IS NOT NULL
           AND pair.contrast_question_id <> pair.question_id
           AND ${studentQuestionExposureSqlForAliases("contrast", "contrast_meta")}
        ORDER BY pair.updated_at DESC, pair.pair_id ASC
        LIMIT 1`,
      [anchor.course_id, anchor.concept_id, anchor.question_id],
    );
    const pair = pairResult.rows[0];
    const anchorOrigin = origin(anchor.data_origin);

    if (!pair || !validateQuestionPair(pair).ok) {
      await this.recordAnchorSignal(userId, anchor, anchorOrigin);
      return null;
    }

    const questionBank = this.#questionBankForCourse(anchor.course_id);
    if (!questionBank) {
      await this.recordAnchorSignal(userId, anchor, anchorOrigin);
      return null;
    }
    const selected = await questionBank.select(userId, {
      mode: "targeted",
      subject: anchor.subject,
      concept_id: anchor.concept_id,
      question_id: pair.contrast_question_id,
      tags: [],
      tag_match: "all",
      limit: 1,
      offset: 0,
    });
    const question = selected.items[0];
    if (!question || question.question.id !== pair.contrast_question_id) {
      await this.recordAnchorSignal(userId, anchor, anchorOrigin);
      return null;
    }

    const session = await withTransaction(this.pool, async (client) => {
      await this.recordEvidenceEvent(client, {
        userId,
        courseId: anchor.course_id,
        conceptId: anchor.concept_id!,
        questionId: anchor.question_id,
        attemptId: anchor.attempt_id,
        evaluationId: anchor.evaluation_id,
        questionRole: "anchor",
        outcome: "incorrect",
        independent: false,
        eligible: true,
        dataOrigin: anchorOrigin,
        idempotencyKey: `anchor:${anchor.attempt_id}`,
        createdAt: iso(anchor.created_at) ?? this.#now().toISOString(),
      });
      await this.rebuildSnapshot(
        client,
        userId,
        anchor.course_id,
        anchor.concept_id!,
        anchorOrigin,
      );
      const inserted = await client.query<SessionRow>(
        `INSERT INTO student_learning_probe_sessions(
           probe_session_id, user_id, pair_id, course_id, concept_id,
           source_attempt_id, anchor_question_id, contrast_question_id,
           status, data_origin, idempotency_key, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'offered',$9,$10,$11,$11)
         ON CONFLICT (user_id, source_attempt_id, pair_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
         RETURNING probe_session_id, user_id, pair_id, course_id, concept_id,
                   source_attempt_id, anchor_question_id, contrast_question_id,
                   status, data_origin, started_at, completed_at, skipped_at`,
        [
          this.#createId("probe"), userId, pair.pair_id, anchor.course_id,
          anchor.concept_id, anchor.attempt_id, anchor.question_id,
          pair.contrast_question_id, anchorOrigin,
          `offer:${anchor.attempt_id}:${pair.pair_id}`,
          iso(this.#now())!,
        ],
      );
      let row = inserted.rows[0];
      if (!row) {
        const existing = await client.query<SessionRow>(
          `SELECT session.probe_session_id, session.user_id, session.pair_id,
                  session.course_id, session.concept_id, concept.title AS concept_title,
                  session.source_attempt_id, session.anchor_question_id,
                  session.contrast_question_id, pair.question_role,
                  session.status, session.data_origin, session.started_at,
                  session.completed_at, session.skipped_at
             FROM student_learning_probe_sessions session
             JOIN learning_question_pairs pair ON pair.pair_id = session.pair_id
             JOIN course_core_concepts concept ON concept.concept_id = session.concept_id
            WHERE session.user_id = $1
              AND session.source_attempt_id = $2
              AND session.pair_id = $3
            LIMIT 1`,
          [userId, anchor.attempt_id, pair.pair_id],
        );
        row = existing.rows[0];
      }
      if (!row) throw new LearningProbeError("LEARNING_PROBE_CREATE_FAILED", "探针记录暂时无法创建。", 503);
      await client.query(
        `INSERT INTO student_learning_probe_events(
           event_id, probe_session_id, user_id, event_type, evidence_payload,
           idempotency_key, created_at
         ) VALUES ($1,$2,$3,'offered',$4::jsonb,$5,$6)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
        [
          this.#createId("probe_event"), row.probe_session_id, userId,
          JSON.stringify({ source_attempt_id: anchor.attempt_id, pair_id: pair.pair_id }),
          `offered:${row.probe_session_id}`, iso(this.#now())!,
        ],
      );
      return row;
    });

    return learningProbeOfferSchema.parse({
      probe_session_id: session.probe_session_id,
      course_id: anchor.course_id,
      concept_id: anchor.concept_id,
      concept_title: anchor.concept_title ?? "当前知识点",
      source_attempt_id: anchor.attempt_id,
      anchor_question_id: anchor.question_id,
      question,
      hypothesis_code: pair.hypothesis_code,
      surface_difference: pair.surface_difference,
      status: session.status,
      fallback: false,
      fallback_reason: null,
    });
  }

  async start(userId: string, probeSessionId: string): Promise<LearningProbeOffer | null> {
    const row = await withTransaction(this.pool, async (client) => {
      const result = await client.query<SessionRow>(
        `SELECT session.probe_session_id, session.user_id, session.pair_id,
                session.course_id, session.concept_id, concept.title AS concept_title,
                session.source_attempt_id, session.anchor_question_id,
                session.contrast_question_id, pair.question_role,
                session.status, session.data_origin, session.started_at,
                session.completed_at, session.skipped_at
           FROM student_learning_probe_sessions session
           JOIN learning_question_pairs pair ON pair.pair_id = session.pair_id
           JOIN course_core_concepts concept ON concept.concept_id = session.concept_id
          WHERE session.user_id = $1 AND session.probe_session_id = $2
          FOR UPDATE`,
        [userId, probeSessionId],
      );
      const session = result.rows[0];
      if (!session) throw new LearningProbeError("LEARNING_PROBE_NOT_FOUND", "探针记录不存在.", 404);
      if (session.status === "completed" || session.status === "skipped" || session.status === "expired") {
        throw new LearningProbeError("LEARNING_PROBE_NOT_ACTIVE", "该探针已经结束。", 409);
      }
      if (session.status === "offered") {
        await client.query(
          `UPDATE student_learning_probe_sessions
              SET status = 'started', started_at = COALESCE(started_at, $3), updated_at = $3
            WHERE user_id = $1 AND probe_session_id = $2`,
          [userId, probeSessionId, iso(this.#now())!],
        );
        await client.query(
          `INSERT INTO student_learning_probe_events(
             event_id, probe_session_id, user_id, event_type, evidence_payload,
             idempotency_key, created_at
           ) VALUES ($1,$2,$3,'started','{}'::jsonb,$4,$5)
           ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
          [this.#createId("probe_event"), probeSessionId, userId, `started:${probeSessionId}`, iso(this.#now())!],
        );
        session.status = "started";
        session.started_at = iso(this.#now());
      }
      return session;
    });
    return this.offerFromSession(userId, row);
  }

  async skip(userId: string, probeSessionId: string): Promise<LearningProbeSession> {
    await withTransaction(this.pool, async (client) => {
      const result = await client.query<SessionRow>(
        `SELECT session.probe_session_id, session.user_id, session.pair_id,
                session.course_id, session.concept_id, concept.title AS concept_title,
                session.source_attempt_id, session.anchor_question_id,
                session.contrast_question_id, pair.question_role,
                session.status, session.data_origin, session.started_at,
                session.completed_at, session.skipped_at
           FROM student_learning_probe_sessions session
           JOIN learning_question_pairs pair ON pair.pair_id = session.pair_id
           JOIN course_core_concepts concept ON concept.concept_id = session.concept_id
          WHERE session.user_id = $1 AND session.probe_session_id = $2
          FOR UPDATE`,
        [userId, probeSessionId],
      );
      const session = result.rows[0];
      if (!session) throw new LearningProbeError("LEARNING_PROBE_NOT_FOUND", "探针记录不存在。", 404);
      if (session.status === "completed") throw new LearningProbeError("LEARNING_PROBE_ALREADY_COMPLETED", "该探针已经提交。", 409);
      if (session.status === "expired") throw new LearningProbeError("LEARNING_PROBE_NOT_ACTIVE", "该探针已经结束。", 409);
      if (session.status !== "offered" && session.status !== "started" && session.status !== "skipped") {
        throw new LearningProbeError("LEARNING_PROBE_NOT_ACTIVE", "该探针已经结束。", 409);
      }
      if (session.status !== "skipped") {
        const now = iso(this.#now())!;
        await client.query(
          `UPDATE student_learning_probe_sessions
              SET status = 'skipped', skipped_at = $3, updated_at = $3
            WHERE user_id = $1 AND probe_session_id = $2`,
          [userId, probeSessionId, now],
        );
        await client.query(
          `INSERT INTO student_learning_probe_events(
             event_id, probe_session_id, user_id, event_type, evidence_payload,
             idempotency_key, created_at
           ) VALUES ($1,$2,$3,'skipped','{}'::jsonb,$4,$5)
           ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
          [this.#createId("probe_event"), probeSessionId, userId, `skipped:${probeSessionId}`, now],
        );
      }
    });
    const session = await this.getSession(userId, probeSessionId);
    if (!session) throw new LearningProbeError("LEARNING_PROBE_NOT_FOUND", "探针记录不存在。", 404);
    return session;
  }

  async submit(
    userId: string,
    probeSessionId: string,
    input: LearningProbeEventRequest,
    idempotencyKey: string,
  ): Promise<LearningProbeResult> {
    return withTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`learning-probe-submit:${userId}:${probeSessionId}`],
      );
      const replay = await client.query<StoredProbeResultRow & {
        probe_session_id: string;
        event_type: string;
      }>(
        `SELECT probe_session_id, event_type, result_payload
           FROM student_learning_probe_events
          WHERE user_id = $1 AND idempotency_key = $2
          LIMIT 1`,
        [userId, idempotencyKey],
      );
      const existingKey = replay.rows[0];
      if (existingKey) {
        if (existingKey.probe_session_id !== probeSessionId || existingKey.event_type !== "submitted") {
          throw new LearningProbeError("IDEMPOTENCY_KEY_CONFLICT", "同一个提交键不能用于不同探针提交。", 409);
        }
        if (existingKey.result_payload) {
          return {
            ...learningProbeResultSchema.parse(existingKey.result_payload),
            idempotency_replayed: true,
          };
        }
        throw new LearningProbeError("IDEMPOTENCY_KEY_CONFLICT", "该提交键对应的探针结果尚未完成。", 409);
      }

      const locked = await client.query<SessionRow>(
        `SELECT session.probe_session_id, session.user_id, session.pair_id,
                session.course_id, session.concept_id, concept.title AS concept_title,
                session.source_attempt_id, session.anchor_question_id,
                session.contrast_question_id, pair.question_role,
                session.status, session.data_origin, session.started_at,
                session.completed_at, session.skipped_at
           FROM student_learning_probe_sessions session
           JOIN learning_question_pairs pair ON pair.pair_id = session.pair_id
           JOIN course_core_concepts concept ON concept.concept_id = session.concept_id
          WHERE session.user_id = $1 AND session.probe_session_id = $2
          LIMIT 1
          FOR UPDATE OF session`,
        [userId, probeSessionId],
      );
      const session = locked.rows[0];
      if (!session) throw new LearningProbeError("LEARNING_PROBE_NOT_FOUND", "探针记录不存在。", 404);
      if (input.question_id !== session.contrast_question_id) {
        throw new LearningProbeError("LEARNING_PROBE_QUESTION_MISMATCH", "提交的题目不是服务端分配的对照题。", 422);
      }
      if (session.status !== "started" && session.status !== "offered") {
        throw new LearningProbeError("LEARNING_PROBE_NOT_ACTIVE", "该探针不能再次提交。", 409);
      }

      let evaluation: QuestionEvaluationBundle;
      try {
        const questionBank = this.#questionBankForCourse(session.course_id);
        if (!questionBank) {
          throw new LearningProbeError("LEARNING_PROBE_UNAVAILABLE", "当前课程暂时无法准备验证题，请稍后重试。", 503);
        }
        const evaluate = questionBank.evaluateInTransaction
          ? questionBank.evaluateInTransaction.bind(questionBank)
          : undefined;
        const evaluationKey = `probe:${probeSessionId}:${idempotencyKey}`;
        evaluation = evaluate
          ? await evaluate(client, userId, {
            question_id: input.question_id,
            answer_type: "choice",
            selected_option_ids: input.selected_option_ids,
            concept_id: session.concept_id,
          }, evaluationKey)
          : await questionBank.evaluate(userId, {
          question_id: input.question_id,
          answer_type: "choice",
          selected_option_ids: input.selected_option_ids,
          concept_id: session.concept_id,
          }, evaluationKey);
      } catch (error) {
        if (error instanceof QuestionSubmissionError) {
          throw new LearningProbeError(error.code, error.message, 422);
        }
        throw error;
      }

      const now = iso(this.#now())!;
      const completed = await client.query(
        `UPDATE student_learning_probe_sessions
            SET status = 'completed',
                started_at = COALESCE(started_at, $3),
                completed_at = $3,
                updated_at = $3
          WHERE user_id = $1 AND probe_session_id = $2
            AND status IN ('offered', 'started')`,
        [userId, probeSessionId, now],
      );
      if (completed.rowCount !== 1) {
        throw new LearningProbeError("LEARNING_PROBE_NOT_ACTIVE", "该探针不能再次提交。", 409);
      }
      const eligible = evaluation.evidence.eligible_for_learning_state_update
        && (evaluation.evidence.outcome === "correct" || evaluation.evidence.outcome === "incorrect");
      await this.recordEvidenceEvent(client, {
        userId,
        courseId: session.course_id,
        conceptId: session.concept_id,
        questionId: input.question_id,
        attemptId: evaluation.attempt.attempt_id,
        evaluationId: evaluation.evaluation.evaluation_id,
        probeSessionId,
        questionRole: session.question_role,
        outcome: evaluation.evidence.outcome,
        independent: true,
        eligible,
        dataOrigin: origin(session.data_origin),
        idempotencyKey,
        createdAt: evaluation.evidence.created_at,
      });
      const snapshot = await this.rebuildSnapshot(client, userId, session.course_id, session.concept_id, origin(session.data_origin));
      const summary = this.toEvidenceSummary(snapshot);
      const sessionView = learningProbeSessionSchema.parse({
        probe_session_id: probeSessionId,
        status: "completed",
        question_id: input.question_id,
        course_id: session.course_id,
        concept_id: session.concept_id,
        evidence: summary,
        next_review_at: evaluation.evidence.outcome === "incorrect"
          ? new Date(new Date(evaluation.evidence.created_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
          : null,
        completed_at: now,
      });
      const response = learningProbeResultSchema.parse({
        session: sessionView,
        evaluation: evaluation.evaluation,
        evidence_kind: eligible ? "concept_evidence" : "item_review",
        evidence_statement: eligible
          ? summary.statement
          : "本次结果只进入题目复习记录，概念状态暂不改变。",
        next_task: evaluation.evidence.outcome === "incorrect"
          ? {
              label: "回到错题复习",
              href: `/student/mistakes?course_id=${encodeURIComponent(session.course_id)}&concept_id=${encodeURIComponent(session.concept_id)}`,
            }
          : null,
      });
      await client.query(
        `INSERT INTO student_learning_probe_events(
           event_id, probe_session_id, user_id, event_type, attempt_id,
           evaluation_id, outcome, evidence_payload, idempotency_key, created_at
         ) VALUES ($1,$2,$3,'submitted',$4,$5,$6,$7::jsonb,$8,$9)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
        [
          this.#createId("probe_event"),
          probeSessionId,
          userId,
          evaluation.attempt.attempt_id,
          evaluation.evaluation.evaluation_id,
          evaluation.evaluation.status,
          JSON.stringify({
            question_id: input.question_id,
            outcome: evaluation.evidence.outcome,
            eligible_for_learning_state_update: eligible,
          }),
          idempotencyKey,
          now,
        ],
      );
      await client.query(
        `UPDATE student_learning_probe_events
            SET result_payload = $3::jsonb
          WHERE user_id = $1 AND idempotency_key = $2 AND event_type = 'submitted'`,
        [userId, idempotencyKey, JSON.stringify(response)],
      );
      return { ...response, idempotency_replayed: false };
    });
  }

  async getSession(userId: string, probeSessionId: string): Promise<LearningProbeSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT session.probe_session_id, session.user_id, session.pair_id,
              session.course_id, session.concept_id, concept.title AS concept_title,
              session.source_attempt_id, session.anchor_question_id,
              session.contrast_question_id, pair.question_role,
              session.status, session.data_origin, session.started_at,
              session.completed_at, session.skipped_at
         FROM student_learning_probe_sessions session
         JOIN learning_question_pairs pair ON pair.pair_id = session.pair_id
         JOIN course_core_concepts concept ON concept.concept_id = session.concept_id
        WHERE session.user_id = $1 AND session.probe_session_id = $2
        LIMIT 1`,
      [userId, probeSessionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const snapshot = await this.loadSnapshot(userId, row.course_id, row.concept_id);
    return learningProbeSessionSchema.parse({
      probe_session_id: row.probe_session_id,
      status: row.status,
      question_id: row.contrast_question_id,
      course_id: row.course_id,
      concept_id: row.concept_id,
      evidence: this.toEvidenceSummary(snapshot),
      next_review_at: null,
      completed_at: iso(row.completed_at),
    });
  }

  async getOffer(userId: string, probeSessionId: string): Promise<LearningProbeOffer | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT session.probe_session_id, session.user_id, session.pair_id,
              session.course_id, session.concept_id, concept.title AS concept_title,
              session.source_attempt_id, session.anchor_question_id,
              session.contrast_question_id, pair.question_role,
              session.status, session.data_origin, session.started_at,
              session.completed_at, session.skipped_at
         FROM student_learning_probe_sessions session
         JOIN learning_question_pairs pair ON pair.pair_id = session.pair_id
         JOIN course_core_concepts concept ON concept.concept_id = session.concept_id
        WHERE session.user_id = $1 AND session.probe_session_id = $2
        LIMIT 1`,
      [userId, probeSessionId],
    );
    const row = result.rows[0];
    if (!row || (row.status !== "offered" && row.status !== "started")) return null;
    return this.offerFromSession(userId, row);
  }

  private async offerFromSession(userId: string, session: SessionRow): Promise<LearningProbeOffer | null> {
    const pairResult = await this.pool.query<PairRow>(
      `SELECT pair.pair_id, pair.pair_group_id, pair.course_id, pair.concept_id,
               pair.question_id, pair.contrast_question_id, pair.hypothesis_code,
               pair.surface_difference, pair.question_role, pair.content_review_status,
               pair.status, pair.algorithm_version, pair.source_provenance,
               anchor_question.course_id AS anchor_course_id,
               anchor_catalog.course_id AS anchor_catalog_course_id,
               anchor_link.concept_id AS anchor_concept_id,
               anchor_question.question_type AS anchor_question_type,
               anchor_question.review_status AS anchor_review_status,
               anchor_meta.content_review_status AS anchor_content_review_status,
               anchor_meta.allowed_modes AS anchor_allowed_modes,
               anchor_meta.protect_full_paper AS anchor_protect_full_paper,
               anchor_meta.source_type AS anchor_source_type,
               anchor_question.usage_scope AS anchor_usage_scope,
               anchor_question.license_status AS anchor_license_status,
               true AS anchor_assets_complete,
               contrast.course_id AS contrast_course_id,
              contrast_link.concept_id AS contrast_concept_id,
              contrast.question_type AS contrast_question_type,
              contrast.review_status AS contrast_review_status,
              contrast_meta.content_review_status AS contrast_content_review_status,
               contrast_meta.allowed_modes AS contrast_allowed_modes,
               contrast_meta.protect_full_paper AS contrast_protect_full_paper,
               contrast_meta.source_type AS contrast_source_type,
               contrast.usage_scope AS contrast_usage_scope,
              contrast.license_status AS contrast_license_status,
              true AS contrast_assets_complete
         FROM learning_question_pairs pair
          JOIN course_core_concepts pair_concept
            ON pair_concept.concept_id = pair.concept_id
           AND pair_concept.course_id = pair.course_id
           AND pair_concept.review_status = 'verified'
          JOIN questions anchor_question ON anchor_question.question_id = pair.question_id
          JOIN course_catalog_entries anchor_catalog
            ON anchor_catalog.course_id = pair.course_id
           AND anchor_catalog.question_subject = anchor_question.subject
          JOIN question_learning_metadata anchor_meta
            ON anchor_meta.question_id = anchor_question.question_id
          LEFT JOIN course_concept_question_links anchor_link
            ON anchor_link.question_id = anchor_question.question_id
           AND anchor_link.concept_id = pair.concept_id
           AND anchor_link.status = 'active'
          JOIN questions contrast ON contrast.question_id = pair.contrast_question_id
         JOIN course_catalog_entries contrast_catalog
           ON contrast_catalog.course_id = pair.course_id
          AND contrast_catalog.question_subject = contrast.subject
         JOIN question_learning_metadata contrast_meta
           ON contrast_meta.question_id = contrast.question_id
         LEFT JOIN course_concept_question_links contrast_link
           ON contrast_link.question_id = contrast.question_id
          AND contrast_link.concept_id = pair.concept_id
          AND contrast_link.status = 'active'
         WHERE pair.pair_id = $1
           AND pair.question_id = $2
           AND pair.contrast_question_id = $3
           AND pair.status = 'active'
           AND pair.content_review_status = 'teacher_verified'
           AND pair.question_role IN ('contrast', 'transfer')
           AND anchor_question.question_type = 'choice'
           AND anchor_question.review_status = 'approved'
           AND anchor_meta.content_review_status = 'teacher_verified'
           AND 'targeted' = ANY(anchor_meta.allowed_modes)
           AND anchor_meta.source_type <> 'self_authored_screening'
           AND anchor_meta.protect_full_paper = false
           AND anchor_link.concept_id IS NOT NULL
           AND ${studentQuestionExposureSqlForAliases("anchor_question", "anchor_meta")}
           AND contrast.question_type = 'choice'
          AND contrast.review_status = 'approved'
          AND contrast_meta.content_review_status = 'teacher_verified'
          AND 'targeted' = ANY(contrast_meta.allowed_modes)
          AND contrast_meta.source_type <> 'self_authored_screening'
          AND contrast_meta.protect_full_paper = false
          AND contrast_link.concept_id IS NOT NULL
          AND ${studentQuestionExposureSqlForAliases("contrast", "contrast_meta")}
         LIMIT 1`,
      [session.pair_id, session.anchor_question_id, session.contrast_question_id],
    );
    const pair = pairResult.rows[0];
    if (!pair || !validateQuestionPair(pair).ok) return null;
    const questionBank = this.#questionBankForCourse(session.course_id);
    if (!questionBank) return null;
    const selected = await questionBank.select(userId, {
      mode: "targeted",
      concept_id: session.concept_id,
      question_id: session.contrast_question_id,
      tags: [],
      tag_match: "all",
      limit: 1,
      offset: 0,
    });
    const question = selected.items[0];
    if (!question) return null;
    return learningProbeOfferSchema.parse({
      probe_session_id: session.probe_session_id,
      course_id: session.course_id,
      concept_id: session.concept_id,
      concept_title: session.concept_title ?? "当前知识点",
      source_attempt_id: session.source_attempt_id,
      anchor_question_id: session.anchor_question_id,
      question,
      hypothesis_code: pair.hypothesis_code,
      surface_difference: pair.surface_difference,
      status: session.status,
      fallback: false,
      fallback_reason: null,
    });
  }

  private async recordAnchorSignal(userId: string, anchor: AnchorRow, dataOrigin: "real_trial" | "synthetic_verification" | "local_demo") {
    if (!anchor.concept_id) return;
    await withTransaction(this.pool, async (client) => {
      await this.recordEvidenceEvent(client, {
        userId,
        courseId: anchor.course_id,
        conceptId: anchor.concept_id!,
        questionId: anchor.question_id,
        attemptId: anchor.attempt_id,
        evaluationId: anchor.evaluation_id,
        questionRole: "anchor",
        outcome: "incorrect",
        independent: false,
        eligible: true,
        dataOrigin,
        idempotencyKey: `anchor:${anchor.attempt_id}`,
        createdAt: iso(anchor.created_at) ?? this.#now().toISOString(),
      });
      await this.rebuildSnapshot(client, userId, anchor.course_id, anchor.concept_id!, dataOrigin);
    });
  }

  private async loadSnapshot(userId: string, courseId: string, conceptId: string): Promise<ConceptEvidenceSnapshot> {
    return withTransaction(this.pool, async (client) => this.rebuildSnapshot(client, userId, courseId, conceptId, "real_trial", false));
  }

  private async rebuildSnapshot(
    client: SqlClient,
    userId: string,
    courseId: string,
    conceptId: string,
    dataOrigin: "real_trial" | "synthetic_verification" | "local_demo",
    persist = true,
  ): Promise<ConceptEvidenceSnapshot> {
    const events = await client.query<EvidenceEventRow>(
      `SELECT outcome, question_id, attempt_id, created_at,
              question_role, independent, eligible_for_learning_state_update
         FROM student_concept_evidence_events
        WHERE user_id = $1 AND course_id = $2 AND concept_id = $3
        ORDER BY created_at ASC, evidence_event_id ASC`,
      [userId, courseId, conceptId],
    );
    let snapshot = emptyConceptEvidence(conceptId);
    for (const event of events.rows) {
      snapshot = applyConceptEvidence(snapshot, {
        outcome: event.outcome,
        question_id: event.question_id,
        attempt_id: event.attempt_id,
        evaluated_at: iso(event.created_at) ?? this.#now().toISOString(),
        question_role: event.question_role,
        independent: event.independent,
        eligible: event.eligible_for_learning_state_update,
      });
    }
    if (persist) {
      await client.query(
        `INSERT INTO student_concept_evidence(
           user_id, course_id, concept_id, status,
           independent_correct_count, distinct_correct_question_count,
           reliable_incorrect_count, pending_count, first_correct_at,
           last_correct_at, last_evidence_at, data_origin, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11)
         ON CONFLICT (user_id, concept_id) DO UPDATE SET
           course_id = EXCLUDED.course_id,
           status = EXCLUDED.status,
           independent_correct_count = EXCLUDED.independent_correct_count,
           distinct_correct_question_count = EXCLUDED.distinct_correct_question_count,
           reliable_incorrect_count = EXCLUDED.reliable_incorrect_count,
           pending_count = EXCLUDED.pending_count,
           first_correct_at = EXCLUDED.first_correct_at,
           last_correct_at = EXCLUDED.last_correct_at,
           last_evidence_at = EXCLUDED.last_evidence_at,
           data_origin = EXCLUDED.data_origin,
           updated_at = EXCLUDED.updated_at`,
        [
          userId, courseId, conceptId, snapshot.status,
          snapshot.correct_attempt_ids.length, snapshot.correct_question_ids.length,
          snapshot.incorrect_attempt_ids.length, snapshot.pending_count,
          snapshot.first_correct_at, snapshot.last_correct_at,
          snapshot.updated_at ?? this.#now().toISOString(), dataOrigin,
        ],
      );
    }
    return snapshot;
  }

  private async recordEvidenceEvent(
    client: SqlClient,
    input: {
      userId: string;
      courseId: string;
      conceptId: string;
      questionId: string;
      attemptId: string | null;
      evaluationId: string | null;
      probeSessionId?: string;
      questionRole: ConceptEvidenceInput["question_role"];
      outcome: ConceptEvidenceInput["outcome"];
      independent: boolean;
      eligible: boolean;
      dataOrigin: "real_trial" | "synthetic_verification" | "local_demo";
      idempotencyKey: string;
      createdAt: string;
    },
  ) {
    await client.query(
      `INSERT INTO student_concept_evidence_events(
         evidence_event_id, user_id, course_id, concept_id, question_id,
         attempt_id, evaluation_id, probe_session_id, question_role, outcome,
         independent, eligible_for_learning_state_update, data_origin,
         evidence_payload, idempotency_key, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
      [
        this.#createId("concept_event"), input.userId, input.courseId,
        input.conceptId, input.questionId, input.attemptId, input.evaluationId,
        input.probeSessionId ?? null, input.questionRole, input.outcome,
        input.independent, input.eligible, input.dataOrigin,
         JSON.stringify({ source: "deterministic_evaluation" }),
        input.idempotencyKey, input.createdAt,
      ],
    );
  }

  private toEvidenceSummary(snapshot: ConceptEvidenceSnapshot) {
    const status = isSnapshotStatus(snapshot.status) ? snapshot.status : "signal";
    return {
      status,
      status_label: mapStatusLabel(status),
      statement: evidenceStatement(snapshot),
      independent_correct_count: snapshot.correct_attempt_ids.length,
      distinct_correct_question_count: snapshot.correct_question_ids.length,
      first_correct_at: snapshot.first_correct_at,
      last_correct_at: snapshot.last_correct_at,
      unknowns: unknowns(snapshot),
    };
  }
}
