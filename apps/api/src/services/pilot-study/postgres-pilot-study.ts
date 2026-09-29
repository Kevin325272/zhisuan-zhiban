import { randomUUID } from "node:crypto";

import {
  pilotTaskResultSchema,
  type AnswerSubmission,
  type PilotConsentRequest,
  type PilotFeedback,
  type PilotFeedbackRequest,
  type PilotManagementReport,
  type PilotParticipant,
  type PilotParticipantEnrollment,
  type PilotReportParticipant,
  type PilotReportTask,
  type PilotStudentStudy,
  type PilotTaskEvaluationResponse,
  type PilotTaskResult,
} from "@xuetu/contracts";

import {
  withTransaction,
  type SqlClient,
  type SqlQueryablePool,
} from "../../database/client.js";
import {
  ACTIVE_PILOT_STUDY_ID,
  buildPilotManagementReport,
  derivePilotTaskStatuses,
  PilotStudyError,
  redactPilotEvaluation,
  type PilotChoiceEvaluator,
  type PilotStudyService,
  type PilotTaskStatusInput,
} from "./pilot-study.js";

type DateValue = string | Date;

interface StudentStudyRow {
  study_id: string;
  study_title: string;
  notice_version: string;
  notice_text: string;
  study_status: "draft" | "active" | "closed";
  participant_id: string;
  participant_code: string;
  role_label: string;
  participant_kind: "real_trial" | "synthetic_verification";
  consent_notice_version: string | null;
  consented_at: DateValue | null;
  baseline_confidence: number | null;
  participant_completed_at: DateValue | null;
  ease_of_use: number | null;
  guidance_helpfulness: number | null;
  confidence_after: number | null;
  continued_use_intent: number | null;
  open_feedback: string | null;
  feedback_submitted_at: DateValue | null;
  task_id: string;
  ordinal: number;
  stage: "baseline" | "guided" | "transfer";
  evidence_kind: "verified_choice_attempt" | "verified_course_reading";
  task_title: string;
  instructions: string;
  course_id: string;
  concept_id: string | null;
  question_id: string | null;
  href: string;
  assistance_policy: "independent" | "platform_guidance";
  progress_started_at: DateValue | null;
  progress_completed_at: DateValue | null;
  progress_attempt_id: string | null;
  evidence_snapshot: unknown;
}

interface AccountEligibilityRow {
  user_id: string;
  account_status: "active" | "disabled";
  account_origin: "legacy_demo" | "registered" | "seeded_admin";
  roles: string[];
}

interface ChoiceEvidenceRow {
  attempt_id: string;
  evaluation_status: "correct" | "incorrect";
  score: string | number;
  grading_mode: "deterministic_choice";
  submitted_at: DateValue;
  evidence_at?: DateValue;
}

interface ReadingEvidenceRow {
  chunk_id: string;
  paragraph_index: number | string;
  updated_at: DateValue;
}

interface StudyDescriptorRow {
  study_id: string;
  title: string;
  notice_version: string;
  notice_text: string;
  status: "draft" | "active" | "closed";
}

function iso(value: DateValue) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: DateValue | null) {
  return value === null ? null : iso(value);
}

function resultFromSnapshot(value: unknown): PilotTaskResult | null {
  if (!value) return null;
  const parsed = pilotTaskResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function taskInput(row: StudentStudyRow): PilotTaskStatusInput {
  return {
    task_id: row.task_id,
    ordinal: Number(row.ordinal),
    stage: row.stage,
    evidence_kind: row.evidence_kind,
    title: row.task_title,
    instructions: row.instructions,
    course_id: row.course_id,
    concept_id: row.concept_id,
    question_id: row.question_id,
    href: row.href,
    assistance_policy: row.assistance_policy,
    started_at: nullableIso(row.progress_started_at),
    completed_at: nullableIso(row.progress_completed_at),
    result: resultFromSnapshot(row.evidence_snapshot),
  };
}

function feedbackFromRow(row: StudentStudyRow): PilotFeedback | null {
  if (
    row.feedback_submitted_at === null
    || row.ease_of_use === null
    || row.guidance_helpfulness === null
    || row.confidence_after === null
    || row.continued_use_intent === null
    || row.open_feedback === null
  ) return null;
  return {
    ease_of_use: Number(row.ease_of_use),
    guidance_helpfulness: Number(row.guidance_helpfulness),
    confidence_after: Number(row.confidence_after),
    continued_use_intent: Number(row.continued_use_intent),
    open_feedback: row.open_feedback,
    submitted_at: iso(row.feedback_submitted_at),
  };
}

function participantFromRow(row: StudentStudyRow): PilotParticipant {
  return {
    participant_code: row.participant_code,
    role_label: row.role_label,
    participant_kind: row.participant_kind,
    consent_notice_version: row.consent_notice_version,
    consented_at: nullableIso(row.consented_at),
    baseline_confidence: row.baseline_confidence === null
      ? null
      : Number(row.baseline_confidence),
    completed_at: nullableIso(row.participant_completed_at),
  };
}

function studentStudyFromRows(rows: StudentStudyRow[]): PilotStudentStudy {
  const first = rows[0];
  if (!first) return { kind: "not_enrolled" };
  const participant = participantFromRow(first);
  const currentConsentAt = participant.consented_at !== null
    && participant.consent_notice_version === first.notice_version
    ? participant.consented_at
    : null;
  return {
    kind: "enrolled",
    study: {
      study_id: first.study_id,
      title: first.study_title,
      notice_version: first.notice_version,
      notice_text: first.notice_text,
    },
    participant,
    tasks: derivePilotTaskStatuses(rows.map(taskInput), currentConsentAt),
    feedback: feedbackFromRow(first),
  };
}

const studentStudySelect = `SELECT
  study.study_id,
  study.title AS study_title,
  study.notice_version,
  study.notice_text,
  study.status AS study_status,
  participant.participant_id,
  participant.participant_code,
  participant.role_label,
  participant.participant_kind,
  participant.consent_notice_version,
  participant.consented_at,
  participant.baseline_confidence,
  participant.completed_at AS participant_completed_at,
  feedback.ease_of_use,
  feedback.guidance_helpfulness,
  feedback.confidence_after,
  feedback.continued_use_intent,
  feedback.open_feedback,
  feedback.submitted_at AS feedback_submitted_at,
  task.task_id,
  task.ordinal,
  task.stage,
  task.evidence_kind,
  task.title AS task_title,
  task.instructions,
  task.course_id,
  task.concept_id,
  task.question_id,
  task.href,
  task.assistance_policy,
  progress.started_at AS progress_started_at,
  progress.completed_at AS progress_completed_at,
  progress.attempt_id AS progress_attempt_id,
  progress.evidence_snapshot
FROM pilot_participants participant
JOIN pilot_studies study ON study.study_id = participant.study_id
JOIN pilot_tasks task ON task.study_id = study.study_id
LEFT JOIN pilot_task_progress progress
  ON progress.participant_id = participant.participant_id
 AND progress.task_id = task.task_id
LEFT JOIN pilot_feedback feedback ON feedback.participant_id = participant.participant_id`;

export class PostgresPilotStudy implements PilotStudyService {
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;
  private readonly choiceEvaluator: PilotChoiceEvaluator | null;

  constructor(
    private readonly pool: SqlQueryablePool,
    options: {
      now?: () => Date;
      createId?: (prefix: string) => string;
      choiceEvaluator?: PilotChoiceEvaluator | null;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.choiceEvaluator = options.choiceEvaluator ?? null;
  }

  private async loadStudentRows(
    queryable: Pick<SqlQueryablePool, "query"> | Pick<SqlClient, "query">,
    userId: string,
    forUpdate = false,
  ) {
    const result = await queryable.query<StudentStudyRow>(
      `${studentStudySelect}
       WHERE participant.user_id = $1 AND study.study_id = $2
       ORDER BY task.ordinal
       ${forUpdate ? "FOR UPDATE OF participant" : ""}`,
      [userId, ACTIVE_PILOT_STUDY_ID],
    );
    return result.rows;
  }

  async getStudentStudy(userId: string): Promise<PilotStudentStudy> {
    return studentStudyFromRows(await this.loadStudentRows(this.pool, userId));
  }

  async enrollParticipant(
    adminUserId: string,
    input: PilotParticipantEnrollment,
  ): Promise<PilotParticipant> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const study = await client.query<StudyDescriptorRow>(
          `SELECT study_id, title, notice_version, notice_text, status
           FROM pilot_studies
           WHERE study_id = $1
           FOR UPDATE`,
          [ACTIVE_PILOT_STUDY_ID],
        );
        if (study.rows[0]?.status !== "active") {
          throw new PilotStudyError("PILOT_STUDY_NOT_ACTIVE", "当前试用方案尚未启用。");
        }
        const account = await client.query<AccountEligibilityRow>(
          `SELECT account.user_id, account.account_status, account.account_origin,
                  ARRAY(
                    SELECT role.role_key
                    FROM user_roles role
                    WHERE role.user_id = account.user_id
                    ORDER BY role.role_key
                  ) AS roles
           FROM users account
           WHERE lower(account.username) = lower($1)
           FOR UPDATE OF account`,
          [input.username],
        );
        const eligible = account.rows[0];
        if (!eligible) {
          throw new PilotStudyError("PILOT_ACCOUNT_NOT_FOUND", "没有找到该学生账户。");
        }
        if (
          eligible.account_status !== "active"
          || !eligible.roles.includes("student")
          || eligible.roles.includes("admin")
          || (input.participant_kind === "real_trial" && eligible.account_origin === "legacy_demo")
        ) {
          throw new PilotStudyError(
            "PILOT_ACCOUNT_NOT_STUDENT",
            "该账户不能登记为真实试用学生。",
          );
        }

        const created = await client.query<{
          participant_code: string;
          role_label: string;
          participant_kind: "real_trial" | "synthetic_verification";
        }>(
          `INSERT INTO pilot_participants(
             participant_id, study_id, user_id, participant_code, role_label,
             participant_kind, enrolled_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING participant_code, role_label, participant_kind`,
          [
            this.createId("pilot_participant"),
            ACTIVE_PILOT_STUDY_ID,
            eligible.user_id,
            input.participant_code,
            input.role_label,
            input.participant_kind,
            adminUserId,
          ],
        );
        const row = created.rows[0];
        if (!row) throw new Error("Pilot participant insert returned no row.");
        return {
          ...row,
          consent_notice_version: null,
          consented_at: null,
          baseline_confidence: null,
          completed_at: null,
        };
      });
    } catch (error) {
      if (error instanceof PilotStudyError) throw error;
      if ((error as { code?: string }).code === "23505") {
        throw new PilotStudyError(
          "PILOT_PARTICIPANT_EXISTS",
          "该账户或匿名编号已经登记到当前试用。",
        );
      }
      throw error;
    }
  }

  async recordConsent(userId: string, input: PilotConsentRequest) {
    await withTransaction(this.pool, async (client) => {
      const rows = await this.requireActiveParticipant(client, userId);
      const current = rows[0]!;
      if (current.notice_version !== input.notice_version) {
        throw new PilotStudyError(
          "PILOT_CONSENT_VERSION_MISMATCH",
          "知情说明已更新，请重新阅读当前版本。",
        );
      }
      if (
        current.consented_at !== null
        && current.consent_notice_version === current.notice_version
      ) return;
      const consentedAt = this.now().toISOString();
      await client.query(
        `UPDATE pilot_participants
         SET consent_notice_version = $2,
              consented_at = $3,
              baseline_confidence = $4,
             updated_at = $3
          WHERE participant_id = $1
            AND (
              consented_at IS NULL
              OR consent_notice_version IS DISTINCT FROM $2
            )`,
        [
          current.participant_id,
          input.notice_version,
          consentedAt,
          input.baseline_confidence,
        ],
      );
    });
    return this.getStudentStudy(userId);
  }

  async startTask(userId: string, taskId: string) {
    await withTransaction(this.pool, async (client) => {
      const rows = await this.requireActiveParticipant(client, userId);
      const first = rows[0]!;
      this.assertCurrentConsent(first);
      const task = studentStudyFromRows(rows);
      if (task.kind !== "enrolled") throw new Error("Pilot participant disappeared.");
      const target = task.tasks.find((item) => item.task_id === taskId);
      if (!target) throw new PilotStudyError("PILOT_TASK_NOT_FOUND", "试用任务不存在。");
      if (target.status === "started" || target.status === "completed") return;
      if (target.status !== "ready") {
        throw new PilotStudyError(
          "PILOT_TASK_SEQUENCE_INVALID",
          "请先完成上一项试用任务。",
        );
      }
      await client.query(
        `INSERT INTO pilot_task_progress(
           progress_id, participant_id, task_id, started_at
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (participant_id, task_id) DO NOTHING`,
        [this.createId("pilot_progress"), first.participant_id, taskId, this.now().toISOString()],
      );
    });
    return this.getStudentStudy(userId);
  }

  async completeTask(
    userId: string,
    taskId: string,
    input: { attempt_id?: string },
  ) {
    await withTransaction(this.pool, (client) => this.completeTaskInTransaction(
      client,
      userId,
      taskId,
      input,
    ));
    return this.getStudentStudy(userId);
  }

  private async completeTaskInTransaction(
    client: SqlClient,
    userId: string,
    taskId: string,
    input: { attempt_id?: string },
  ) {
    const rows = await this.requireActiveParticipant(client, userId);
      const study = studentStudyFromRows(rows);
      if (study.kind !== "enrolled") throw new Error("Pilot participant disappeared.");
      const task = study.tasks.find((item) => item.task_id === taskId);
      const row = rows.find((item) => item.task_id === taskId);
      if (!task || !row) throw new PilotStudyError("PILOT_TASK_NOT_FOUND", "试用任务不存在。");
      this.assertCurrentConsent(row);
      if (task.status === "completed") return;
      if (task.status === "locked") {
        throw new PilotStudyError(
          "PILOT_TASK_SEQUENCE_INVALID",
          "请先完成上一项试用任务。",
        );
      }
      if (task.status !== "started" || !task.started_at) {
        throw new PilotStudyError("PILOT_TASK_NOT_STARTED", "请先开始当前试用任务。");
      }

      let attemptId: string | null = null;
      let snapshot: PilotTaskResult;
      if (row.evidence_kind === "verified_choice_attempt") {
        if (!input.attempt_id || !row.question_id) {
          throw new PilotStudyError(
            "PILOT_EVIDENCE_NOT_FOUND",
            "没有找到当前任务的客观作答证据。",
          );
        }
        const evidence = await client.query<ChoiceEvidenceRow>(
          `SELECT attempt.attempt_id,
                  evaluation.status AS evaluation_status,
                  evaluation.score,
                  evaluation.grading_mode,
                  attempt.submitted_at,
                  evaluation.created_at AS evidence_at
           FROM practice_attempts attempt
           JOIN evaluations evaluation ON evaluation.attempt_id = attempt.attempt_id
           WHERE attempt.attempt_id = $1
             AND attempt.user_id = $2
             AND attempt.question_id = $3
             AND attempt.submitted_at >= $4
             AND evaluation.status IN ('correct', 'incorrect')
             AND evaluation.grading_mode = 'deterministic_choice'`,
          [input.attempt_id, userId, row.question_id, task.started_at],
        );
        const verified = evidence.rows[0];
        if (!verified) {
          throw new PilotStudyError(
            "PILOT_EVIDENCE_NOT_FOUND",
            "该作答不属于当前用户、固定题目或任务时间范围。",
          );
        }
        attemptId = verified.attempt_id;
        snapshot = {
          outcome: verified.evaluation_status,
          score: Number(verified.score),
          grading_mode: "deterministic_choice",
          evidence_at: iso(verified.evidence_at ?? verified.submitted_at),
        };
      } else {
        if (!row.concept_id) {
          throw new PilotStudyError("PILOT_EVIDENCE_NOT_FOUND", "阅读任务缺少固定知识点。");
        }
        const evidence = await client.query<ReadingEvidenceRow>(
          `SELECT progress.chunk_id, progress.paragraph_index, progress.updated_at
           FROM course_reading_progress progress
           JOIN course_concept_sources source ON source.chunk_id = progress.chunk_id
           WHERE progress.user_id = $1
             AND progress.course_id = $2
              AND source.concept_id = $3
              AND progress.updated_at >= $4
              AND progress.paragraph_index >= 2
              AND progress.source_expanded = true
           ORDER BY progress.updated_at DESC
           LIMIT 1`,
          [userId, row.course_id, row.concept_id, task.started_at],
        );
        const verified = evidence.rows[0];
        if (!verified) {
          throw new PilotStudyError(
            "PILOT_EVIDENCE_NOT_FOUND",
            "尚未找到任务开始后的阅读位置和来源曝光记录，请回到课程至少阅读到第 3 段。",
          );
        }
        snapshot = {
          outcome: "read",
          score: null,
          grading_mode: "course_reading",
          evidence_at: iso(verified.updated_at),
        };
      }

      const completedAt = this.now().toISOString();
      const progressUpdate = await client.query(
        `UPDATE pilot_task_progress
         SET completed_at = $3,
             attempt_id = $4,
             evidence_snapshot = $5::jsonb
         WHERE participant_id = $1
           AND task_id = $2
           AND completed_at IS NULL`,
        [row.participant_id, taskId, completedAt, attemptId, JSON.stringify(snapshot)],
      );
      if ((progressUpdate.rowCount ?? 0) === 0) return;
      const finalTaskCompleted = study.tasks.every(
        (candidate) => candidate.task_id === taskId || candidate.status === "completed",
      );
      if (finalTaskCompleted) {
        await client.query(
          `UPDATE pilot_participants
           SET completed_at = COALESCE(completed_at, $2), updated_at = $2
           WHERE participant_id = $1`,
          [row.participant_id, completedAt],
        );
      }
  }

  async evaluateChoiceTask(
    userId: string,
    taskId: string,
    selectedOptionIds: string[],
    idempotencyKey: string,
  ): Promise<PilotTaskEvaluationResponse> {
    return withTransaction(this.pool, async (client) => {
      // The participant row is the serialization point. Keep the lock until
      // evaluation evidence and pilot progress are committed together.
      const rows = await this.requireActiveParticipant(client, userId);
      const task = rows.find((row) => row.task_id === taskId);
      if (!task) throw new PilotStudyError("PILOT_TASK_NOT_FOUND", "试用任务不存在。");
      this.assertCurrentConsent(task);
      const study = studentStudyFromRows(rows);
      if (study.kind !== "enrolled") throw new Error("Pilot participant disappeared.");
      const taskStatus = study.tasks.find((candidate) => candidate.task_id === taskId);
      if (!taskStatus) throw new PilotStudyError("PILOT_TASK_NOT_FOUND", "试用任务不存在。");
      if (task.evidence_kind !== "verified_choice_attempt" || !task.question_id) {
        throw new PilotStudyError("PILOT_EVIDENCE_NOT_FOUND", "当前试用任务不是选择题评测任务。");
      }
      if (taskStatus.status === "completed") {
        const stored = resultFromSnapshot(task.evidence_snapshot);
        if (!stored || stored.grading_mode !== "deterministic_choice" || !task.progress_attempt_id) {
          throw new PilotStudyError("PILOT_EVIDENCE_NOT_FOUND", "当前试用任务缺少可重放的服务端评测记录。");
        }
        return {
          task_id: taskId,
          attempt_id: task.progress_attempt_id,
          question_id: task.question_id,
          outcome: stored.outcome === "correct" ? "correct" : "incorrect",
          score: stored.score ?? 0,
          grading_mode: "deterministic_choice" as const,
          evidence_at: stored.evidence_at,
          task_completed: true as const,
        };
      }
      if (taskStatus.status !== "started" || !task.progress_started_at) {
        throw new PilotStudyError("PILOT_TASK_NOT_STARTED", "请先开始当前试用任务。");
      }
      if (!this.choiceEvaluator) {
        throw new PilotStudyError("PILOT_EVALUATION_NOT_CONFIGURED", "试用评测服务尚未配置。");
      }
      const submission: AnswerSubmission = {
        question_id: task.question_id,
        answer_type: "choice",
        selected_option_ids: selectedOptionIds,
      };
      const evaluated = await this.choiceEvaluator.evaluateInTransaction(
        client,
        userId,
        submission,
        idempotencyKey,
      );
      if (
        evaluated.attempt.user_id !== userId
        || evaluated.attempt.question_id !== task.question_id
        || evaluated.attempt.answer_type !== "choice"
      ) {
        throw new PilotStudyError("PILOT_EVIDENCE_NOT_FOUND", "评测结果未绑定到当前试用任务。");
      }
      const redacted = redactPilotEvaluation(taskId, evaluated);
      await this.completeTaskInTransaction(client, userId, taskId, {
        attempt_id: redacted.attempt_id,
      });
      return redacted;
    });
  }

  async submitFeedback(userId: string, input: PilotFeedbackRequest) {
    await withTransaction(this.pool, async (client) => {
      const rows = await this.requireActiveParticipant(client, userId);
      if (rows.some((row) => !row.progress_completed_at || !row.evidence_snapshot)) {
        throw new PilotStudyError(
          "PILOT_TASKS_INCOMPLETE",
          "请完成全部三项任务后再提交反馈。",
        );
      }
      const existing = rows[0]!;
      if (existing.feedback_submitted_at !== null) {
        const same = existing.ease_of_use === input.ease_of_use
          && existing.guidance_helpfulness === input.guidance_helpfulness
          && existing.confidence_after === input.confidence_after
          && existing.continued_use_intent === input.continued_use_intent
          && existing.open_feedback === input.open_feedback;
        if (same) return;
        throw new PilotStudyError(
          "PILOT_FEEDBACK_ALREADY_SUBMITTED",
          "反馈已经提交，不能覆盖既有记录。",
        );
      }
      const participantId = existing.participant_id;
      const submittedAt = this.now().toISOString();
      const inserted = await client.query(
        `INSERT INTO pilot_feedback(
           participant_id, ease_of_use, guidance_helpfulness, confidence_after,
           continued_use_intent, open_feedback, submitted_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (participant_id) DO NOTHING`,
        [
          participantId,
          input.ease_of_use,
          input.guidance_helpfulness,
          input.confidence_after,
          input.continued_use_intent,
          input.open_feedback,
          submittedAt,
        ],
      );
      if ((inserted.rowCount ?? 0) === 0) {
        throw new PilotStudyError(
          "PILOT_FEEDBACK_ALREADY_SUBMITTED",
          "反馈已经提交，不能覆盖既有记录。",
        );
      }
    });
    return this.getStudentStudy(userId);
  }

  async getManagementReport(includeSynthetic = false): Promise<PilotManagementReport> {
    const studyResult = await this.pool.query<StudyDescriptorRow>(
      `SELECT study_id, title, notice_version, notice_text, status
       FROM pilot_studies
       WHERE study_id = $1`,
      [ACTIVE_PILOT_STUDY_ID],
    );
    const study = studyResult.rows[0];
    if (!study) {
      throw new PilotStudyError("PILOT_STUDY_NOT_ACTIVE", "当前试用方案尚未初始化。");
    }
    const rows = await this.pool.query<StudentStudyRow>(
      `${studentStudySelect}
       WHERE study.study_id = $1
       ORDER BY participant.participant_code, task.ordinal`,
      [ACTIVE_PILOT_STUDY_ID],
    );
    const grouped = new Map<string, StudentStudyRow[]>();
    for (const row of rows.rows) {
      const current = grouped.get(row.participant_id) ?? [];
      current.push(row);
      grouped.set(row.participant_id, current);
    }
    const participants: PilotReportParticipant[] = [...grouped.values()].map((items) => {
      const first = items[0]!;
      const participant = participantFromRow(first);
      const tasks: PilotReportTask[] = items.map((row) => ({
        task_id: row.task_id,
        ordinal: Number(row.ordinal),
        stage: row.stage,
        title: row.task_title,
        started_at: nullableIso(row.progress_started_at),
        completed_at: nullableIso(row.progress_completed_at),
        result: resultFromSnapshot(row.evidence_snapshot),
      }));
      return { ...participant, tasks, feedback: feedbackFromRow(first) };
    });
    return buildPilotManagementReport({
      study: {
        study_id: study.study_id,
        title: study.title,
        notice_version: study.notice_version,
        notice_text: study.notice_text,
      },
      generatedAt: this.now().toISOString(),
      participants,
    }, includeSynthetic);
  }

  private async requireActiveParticipant(client: SqlClient, userId: string) {
    const rows = await this.loadStudentRows(client, userId, true);
    const first = rows[0];
    if (!first) throw new PilotStudyError("PILOT_NOT_ENROLLED", "当前账户未加入试用。");
    if (first.study_status !== "active") {
      throw new PilotStudyError("PILOT_STUDY_NOT_ACTIVE", "当前试用方案尚未启用。");
    }
    return rows;
  }

  private assertCurrentConsent(row: StudentStudyRow) {
    if (!row.consented_at) {
      throw new PilotStudyError("PILOT_CONSENT_REQUIRED", "请先阅读并确认知情说明。");
    }
    if (row.consent_notice_version !== row.notice_version) {
      throw new PilotStudyError(
        "PILOT_CONSENT_VERSION_MISMATCH",
        "知情说明已更新，请重新阅读当前版本。",
      );
    }
  }
}
