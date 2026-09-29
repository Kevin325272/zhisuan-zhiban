import { randomUUID } from "node:crypto";

import {
  studentCareLightStepSchema,
  studentCareResponseActionSchema,
  studentCareSignalSchema,
  type StudentCareLightStep,
  type StudentCareResponseAction,
} from "@xuetu/contracts";

import { withTransaction, type SqlQueryablePool } from "../../database/client.js";
import {
  StudentCareInteractionError,
  type StoredStudentCareInteraction,
  type StudentCareInteractionResponse,
  type StudentCareRepository,
  type StudentCareRespondPersistenceInput,
} from "./student-care-service.js";
import type { StudentCareRuleEvidence, StudentCareRuleMatch } from "./student-care-rules.js";

export { StudentCareInteractionError } from "./student-care-service.js";

interface ActivityRow {
  active_learning_dates: unknown;
  last_learning_at: Date | string | null;
}

interface SessionRow {
  created_at: Date | string;
}

interface AccuracyRow {
  course_id: string;
  recent_attempt_count: number | string;
  recent_incorrect_count: number | string;
  recent_concept_count: number | string;
  baseline_attempt_count: number | string;
  baseline_incorrect_count: number | string;
}

interface RhythmRow {
  baseline_completed_day_count: number | string;
  recent_completed_day_count: number | string;
  has_pending_task: boolean;
  has_due_review: boolean;
}

interface PreferenceRow {
  enabled: boolean;
  updated_at: Date | string;
}

interface InteractionRow {
  interaction_id: string;
  user_id: string;
  signal_code: string;
  rule_version: string;
  status: "presented" | "responded" | "expired";
  evidence_summary: unknown;
  reason_summary: string;
  response: string | null;
  presented_at: Date | string;
  responded_at: Date | string | null;
  expires_at: Date | string;
  cooldown_until: Date | string | null;
  light_session_expires_at: Date | string | null;
  light_step: unknown;
  talk_course_id: string | null;
  talk_fallback_step: unknown;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const interactionColumnNames = [
  "interaction_id",
  "user_id",
  "signal_code",
  "rule_version",
  "status",
  "evidence_summary",
  "reason_summary",
  "response",
  "presented_at",
  "responded_at",
  "expires_at",
  "cooldown_until",
  "light_session_expires_at",
  "light_step",
  "talk_course_id",
  "talk_fallback_step",
] as const;
const interactionColumns = interactionColumnNames.join(", ");
const qualifiedInteractionColumns = interactionColumnNames
  .map((column) => `interaction.${column}`)
  .join(", ");

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function count(value: number | string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Invalid student-care aggregate count.");
  return parsed;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid student-care evidence summary.");
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function startOfShanghaiDay(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ) - SHANGHAI_OFFSET_MS);
}

function startOfShanghaiDayWindow(value: Date, includedDayCount: number) {
  return new Date(startOfShanghaiDay(value).getTime() - (includedDayCount - 1) * DAY_MS);
}

function mapInteraction(row: InteractionRow): StoredStudentCareInteraction {
  const signalCode = studentCareSignalSchema.parse(row.signal_code);
  const response = row.response === null ? null : studentCareResponseActionSchema.parse(row.response);
  const lightStep = row.light_step === null ? null : studentCareLightStepSchema.parse(row.light_step);
  const talkFallbackStep = row.talk_fallback_step == null
    ? null
    : studentCareLightStepSchema.parse(row.talk_fallback_step);
  if (row.rule_version !== "student_care_v1") throw new Error("Unsupported student-care rule version.");
  return {
    interactionId: row.interaction_id,
    userId: row.user_id,
    signalCode,
    ruleVersion: row.rule_version,
    status: row.status,
    evidenceSummary: objectValue(row.evidence_summary),
    reasonSummary: row.reason_summary,
    response,
    presentedAt: iso(row.presented_at),
    respondedAt: nullableIso(row.responded_at),
    expiresAt: iso(row.expires_at),
    cooldownUntil: nullableIso(row.cooldown_until),
    lightSessionExpiresAt: nullableIso(row.light_session_expires_at),
    lightStep,
    talkCourseId: row.talk_course_id ?? null,
    talkFallbackStep,
  };
}

export class PostgresStudentCareRepository implements StudentCareRepository {
  constructor(private readonly pool: SqlQueryablePool) {}

  async getRuleEvidence(userId: string, now: Date): Promise<StudentCareRuleEvidence> {
    const recentStart = startOfShanghaiDayWindow(now, 7);
    const baselineStart = new Date(recentStart.getTime() - 28 * DAY_MS);
    const rhythmBaselineStart = new Date(recentStart.getTime() - 14 * DAY_MS);
    const activityStart = startOfShanghaiDayWindow(now, 28);
    const sessionStart = startOfShanghaiDayWindow(now, 36);
    const [activity, sessions, accuracy, rhythm] = await Promise.all([
      this.pool.query<ActivityRow>(
        `WITH learning_activity AS (
           SELECT evidence.created_at AS activity_at
           FROM learning_evidence evidence
           WHERE evidence.user_id = $1
             AND evidence.created_at >= $2
             AND evidence.created_at <= $3
             AND evidence.eligible_for_learning_state_update IS TRUE
             AND evidence.grading_mode = 'deterministic_choice'
             AND evidence.outcome IN ('correct', 'incorrect')
           UNION ALL
           SELECT progress.updated_at AS activity_at
           FROM course_reading_progress progress
           WHERE progress.user_id = $1
             AND progress.updated_at >= $2
             AND progress.updated_at <= $3
           UNION ALL
           SELECT assignment.completed_at AS activity_at
           FROM student_learning_task_assignments assignment
           WHERE assignment.user_id = $1
             AND assignment.status = 'completed'
             AND assignment.completed_at >= $2
             AND assignment.completed_at <= $3
         )
         SELECT COALESCE(
                  array_agg(DISTINCT to_char(activity_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')),
                  ARRAY[]::text[]
                ) AS active_learning_dates,
                MAX(activity_at) AS last_learning_at
         FROM learning_activity`,
        [userId, activityStart.toISOString(), now.toISOString()],
      ),
      this.pool.query<SessionRow>(
        `SELECT created_at
         FROM account_sessions
         WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3
         ORDER BY created_at DESC
         LIMIT 32`,
        [userId, sessionStart.toISOString(), now.toISOString()],
      ),
      this.pool.query<AccuracyRow>(
        `SELECT evidence.course_id,
                COUNT(*) FILTER (
                  WHERE evidence.created_at >= $3 AND evidence.created_at <= $4
                )::int AS recent_attempt_count,
                COUNT(*) FILTER (
                  WHERE evidence.created_at >= $3 AND evidence.created_at <= $4
                    AND evidence.outcome = 'incorrect'
                )::int AS recent_incorrect_count,
                COUNT(DISTINCT evidence.concept_id) FILTER (
                  WHERE evidence.created_at >= $3 AND evidence.created_at <= $4
                )::int AS recent_concept_count,
                COUNT(*) FILTER (
                  WHERE evidence.created_at >= $2 AND evidence.created_at < $3
                )::int AS baseline_attempt_count,
                COUNT(*) FILTER (
                  WHERE evidence.created_at >= $2 AND evidence.created_at < $3
                    AND evidence.outcome = 'incorrect'
                )::int AS baseline_incorrect_count
         FROM learning_evidence evidence
         WHERE evidence.user_id = $1
           AND evidence.created_at >= $2
           AND evidence.created_at <= $4
           AND evidence.grading_mode = 'deterministic_choice'
           AND evidence.eligible_for_learning_state_update IS TRUE
           AND evidence.outcome IN ('correct', 'incorrect')
           AND evidence.concept_id IS NOT NULL
         GROUP BY evidence.course_id
         ORDER BY evidence.course_id`,
        [userId, baselineStart.toISOString(), recentStart.toISOString(), now.toISOString()],
      ),
      this.pool.query<RhythmRow>(
        `SELECT
           (SELECT COUNT(DISTINCT (assignment.completed_at AT TIME ZONE 'Asia/Shanghai')::date)::int
            FROM student_learning_task_assignments assignment
            WHERE assignment.user_id = $1
              AND assignment.status = 'completed'
              AND assignment.completed_at >= $2
              AND assignment.completed_at < $3) AS baseline_completed_day_count,
           (SELECT COUNT(DISTINCT (assignment.completed_at AT TIME ZONE 'Asia/Shanghai')::date)::int
            FROM student_learning_task_assignments assignment
            WHERE assignment.user_id = $1
              AND assignment.status = 'completed'
              AND assignment.completed_at >= $3
              AND assignment.completed_at <= $4) AS recent_completed_day_count,
           EXISTS (
             SELECT 1 FROM student_learning_task_assignments assignment
             WHERE assignment.user_id = $1 AND assignment.status = 'pending'
           ) AS has_pending_task,
           EXISTS (
             SELECT 1
             FROM practice_mistake_review_states review_state
             JOIN practice_mistakes mistake
               ON mistake.mistake_id = review_state.mistake_id
              AND mistake.user_id = review_state.user_id
             WHERE review_state.user_id = $1
               AND mistake.status = 'needs_review'
               AND review_state.next_review_at <= $4
           ) AS has_due_review`,
        [
          userId,
          rhythmBaselineStart.toISOString(),
          recentStart.toISOString(),
          now.toISOString(),
        ],
      ),
    ]);
    const activityRow = activity.rows[0];
    const rhythmRow = rhythm.rows[0];
    return {
      activeLearningDates: stringArray(activityRow?.active_learning_dates),
      lastLearningAt: activityRow?.last_learning_at ? iso(activityRow.last_learning_at) : null,
      sessionStartedAt: sessions.rows.map((row) => iso(row.created_at)),
      accuracyByCourse: accuracy.rows.map((row) => ({
        courseId: row.course_id,
        recentAttemptCount: count(row.recent_attempt_count),
        recentIncorrectCount: count(row.recent_incorrect_count),
        recentConceptCount: count(row.recent_concept_count),
        baselineAttemptCount: count(row.baseline_attempt_count),
        baselineIncorrectCount: count(row.baseline_incorrect_count),
      })),
      rhythm: {
        baselineCompletedDayCount: count(rhythmRow?.baseline_completed_day_count ?? 0),
        recentCompletedDayCount: count(rhythmRow?.recent_completed_day_count ?? 0),
        hasPendingTask: rhythmRow?.has_pending_task ?? false,
        hasDueReview: rhythmRow?.has_due_review ?? false,
      },
    };
  }

  async getPreference(userId: string) {
    const result = await this.pool.query<PreferenceRow>(
      "SELECT enabled, updated_at FROM student_care_preferences WHERE user_id = $1",
      [userId],
    );
    const row = result.rows[0];
    return row
      ? { enabled: row.enabled, updatedAt: iso(row.updated_at) }
      : { enabled: true, updatedAt: null };
  }

  async setPreference(userId: string, enabled: boolean, updatedAt: Date) {
    const result = await this.pool.query<PreferenceRow>(
      `INSERT INTO student_care_preferences(user_id, enabled, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at
       RETURNING enabled, updated_at`,
      [userId, enabled, updatedAt.toISOString()],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Student-care preference was not persisted.");
    return { enabled: row.enabled, updatedAt: iso(row.updated_at) };
  }

  async expirePendingInvitations(userId: string, now: Date) {
    await this.pool.query(
      `UPDATE student_care_interactions
       SET status = 'expired', updated_at = $2
       WHERE user_id = $1 AND status = 'presented' AND expires_at <= $2`,
      [userId, now.toISOString()],
    );
  }

  async expireAllPendingInvitations(userId: string, now: Date) {
    await this.pool.query(
      `UPDATE student_care_interactions
       SET status = 'expired', updated_at = $2
       WHERE user_id = $1 AND status = 'presented'`,
      [userId, now.toISOString()],
    );
  }

  async findInteraction(userId: string, interactionId: string) {
    const result = await this.pool.query<InteractionRow>(
      `SELECT ${interactionColumns}
       FROM student_care_interactions
       WHERE user_id = $1 AND interaction_id = $2`,
      [userId, interactionId],
    );
    return result.rows[0] ? mapInteraction(result.rows[0]) : null;
  }

  async findPendingInvitation(userId: string, now: Date) {
    const result = await this.pool.query<InteractionRow>(
      `SELECT ${interactionColumns}
       FROM student_care_interactions
       WHERE user_id = $1 AND status = 'presented' AND expires_at > $2
       ORDER BY presented_at DESC LIMIT 1`,
      [userId, now.toISOString()],
    );
    return result.rows[0] ? mapInteraction(result.rows[0]) : null;
  }

  async findActiveLightSession(userId: string, now: Date) {
    const result = await this.pool.query<InteractionRow>(
      `SELECT ${interactionColumns}
       FROM student_care_interactions
       WHERE user_id = $1 AND status = 'responded' AND response = 'lighten'
         AND light_session_expires_at > $2
       ORDER BY responded_at DESC LIMIT 1`,
      [userId, now.toISOString()],
    );
    return result.rows[0] ? mapInteraction(result.rows[0]) : null;
  }

  async findCooldownUntil(userId: string, now: Date) {
    const result = await this.pool.query<{ cooldown_until: Date | string }>(
      `SELECT cooldown_until
       FROM student_care_interactions
       WHERE user_id = $1 AND status = 'responded' AND cooldown_until > $2
       ORDER BY cooldown_until DESC LIMIT 1`,
      [userId, now.toISOString()],
    );
    return result.rows[0] ? iso(result.rows[0].cooldown_until) : null;
  }

  async createInvitation(
    userId: string,
    match: StudentCareRuleMatch,
    input: { ruleVersion: "student_care_v1"; presentedAt: Date; expiresAt: Date },
  ) {
    const interactionId = `care_${randomUUID()}`;
    const result = await this.pool.query<InteractionRow>(
      `INSERT INTO student_care_interactions(
         interaction_id, user_id, signal_code, rule_version, status,
         evidence_summary, reason_summary, presented_at, expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'presented', $5::jsonb, $6, $7, $8, $7, $7)
       ON CONFLICT DO NOTHING
       RETURNING ${interactionColumns}`,
      [
        interactionId,
        userId,
        match.signalCode,
        input.ruleVersion,
        JSON.stringify(match.evidenceSummary),
        match.reasonSummary,
        input.presentedAt.toISOString(),
        input.expiresAt.toISOString(),
      ],
    );
    if (result.rows[0]) return mapInteraction(result.rows[0]);
    const existing = await this.findPendingInvitation(userId, input.presentedAt);
    if (!existing) throw new Error("Student-care invitation was not persisted.");
    return existing;
  }

  async respondToInteraction(
    userId: string,
    interactionId: string,
    action: StudentCareResponseAction,
    input: StudentCareRespondPersistenceInput,
  ): Promise<StudentCareInteractionResponse> {
    const lightStep: StudentCareLightStep | null = input.lightStep === null
      ? null
      : studentCareLightStepSchema.parse(input.lightStep);
    const talkFallbackStep: StudentCareLightStep | null = input.talkFallbackStep === null
      ? null
      : studentCareLightStepSchema.parse(input.talkFallbackStep);
    if ((action === "lighten") !== (lightStep !== null && input.lightSessionExpiresAt !== null)) {
      throw new Error("Only a lighten response may persist a light step and expiry.");
    }
    if ((action === "talk") !== (input.talkCourseId !== null && talkFallbackStep !== null)) {
      throw new Error("Only a talk response may persist a talk course and fallback step.");
    }
    const outcome = await withTransaction(this.pool, async (client) => {
      const locked = await client.query<InteractionRow>(
        `SELECT ${interactionColumns}
         FROM student_care_interactions
         WHERE user_id = $1 AND interaction_id = $2
         FOR UPDATE`,
        [userId, interactionId],
      );
      const row = locked.rows[0];
      if (!row) {
        return { error: new StudentCareInteractionError(
          "CARE_INTERACTION_NOT_FOUND",
          "关怀提示不存在或不属于当前学生。",
          404,
        ) } as const;
      }
      const interaction = mapInteraction(row);
      if (interaction.status === "responded") {
        if (interaction.response === action) {
          return { interaction: { ...interaction, idempotent: true } } as const;
        }
        return { error: new StudentCareInteractionError(
          "CARE_INTERACTION_ALREADY_RESPONDED",
          "这条关怀提示已经按另一项选择处理。",
          409,
        ) } as const;
      }
      if (
        interaction.status === "expired"
        || Date.parse(interaction.expiresAt) <= input.respondedAt.getTime()
      ) {
        if (interaction.status !== "expired") {
          await client.query(
            `UPDATE student_care_interactions
             SET status = 'expired', updated_at = $3
             WHERE user_id = $1 AND interaction_id = $2`,
            [userId, interactionId, input.respondedAt.toISOString()],
          );
        }
        return { error: new StudentCareInteractionError(
          "CARE_INTERACTION_EXPIRED",
          "这条关怀提示已过期，请刷新当前状态。",
          409,
        ) } as const;
      }
      const updated = await client.query<InteractionRow>(
        `UPDATE student_care_interactions
         SET status = 'responded', response = $3, responded_at = $4,
             cooldown_until = $5, light_session_expires_at = $6,
             light_step = $7::jsonb, talk_course_id = $8,
             talk_fallback_step = $9::jsonb, updated_at = $4
         WHERE user_id = $1 AND interaction_id = $2
         RETURNING ${interactionColumns}`,
        [
          userId,
          interactionId,
          action,
          input.respondedAt.toISOString(),
          input.cooldownUntil?.toISOString() ?? null,
          input.lightSessionExpiresAt?.toISOString() ?? null,
          lightStep === null ? null : JSON.stringify(lightStep),
          input.talkCourseId,
          talkFallbackStep === null ? null : JSON.stringify(talkFallbackStep),
        ],
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new Error("Student-care interaction was not persisted.");
      if (action === "disable") {
        await client.query(
          `INSERT INTO student_care_preferences(user_id, enabled, updated_at)
           VALUES ($1, false, $2)
           ON CONFLICT (user_id) DO UPDATE SET enabled = false, updated_at = EXCLUDED.updated_at`,
          [userId, input.respondedAt.toISOString()],
        );
      }
      return { interaction: { ...mapInteraction(updatedRow), idempotent: false } } as const;
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.interaction;
  }

  async findRecentTalkConsent(userId: string, courseId: string, since: Date) {
    const result = await this.pool.query<InteractionRow>(
      `SELECT ${qualifiedInteractionColumns}
       FROM student_care_interactions interaction
       WHERE interaction.user_id = $1
         AND interaction.status = 'responded'
         AND interaction.response = 'talk'
         AND interaction.talk_course_id = $2
         AND interaction.responded_at >= $3
         AND EXISTS (
           SELECT 1 FROM course_memberships membership
            WHERE membership.user_id = interaction.user_id
              AND membership.course_id = $2
              AND membership.membership_role = 'student'
              AND membership.status = 'active'
         )
       ORDER BY interaction.responded_at DESC LIMIT 1`,
      [userId, courseId, since.toISOString()],
    );
    return result.rows[0] ? mapInteraction(result.rows[0]) : null;
  }
}
