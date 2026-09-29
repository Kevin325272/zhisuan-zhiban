import { describe, expect, it } from "vitest";

import type {
  SqlClient,
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import {
  PostgresStudentCareRepository,
} from "../src/services/student-care/postgres-student-care.js";

type QueryCall = { sql: string; parameters: readonly unknown[] };
type QueryHandler = (
  sql: string,
  parameters: readonly unknown[],
) => SqlQueryResult | Promise<SqlQueryResult>;

function result<Row>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

function createPool(handler: QueryHandler) {
  const calls: QueryCall[] = [];
  const client: SqlClient = {
    async query<Row = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> {
      calls.push({ sql, parameters });
      return await handler(sql, parameters) as SqlQueryResult<Row>;
    },
    release() {},
  };
  const pool: SqlQueryablePool = {
    connect: async () => client,
    query: client.query.bind(client),
  };
  return { pool, calls };
}

const now = new Date("2026-08-21T08:00:00.000Z");
const talkFallbackStep = {
  task_id: "task_ds_read",
  task_type: "course_reading" as const,
  course_id: "course_408_ds",
  course_title: "数据结构",
  title: "回到上次阅读位置",
  detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
  estimated_minutes: 10,
  href: "/student/courses/data-structures",
};

describe("PostgresStudentCareRepository evidence", () => {
  it("returns bounded aggregate evidence for only the authenticated student", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("WITH learning_activity")) {
        return result([{
          active_learning_dates: ["2026-08-01", "2026-08-03", "2026-08-05", "2026-08-07"],
          last_learning_at: "2026-08-15T08:00:00.000Z",
        }]);
      }
      if (sql.includes("FROM account_sessions")) {
        return result([
          { created_at: "2026-08-21T07:45:00.000Z" },
          { created_at: "2026-08-15T07:00:00.000Z" },
        ]);
      }
      if (sql.includes("AS recent_attempt_count")) {
        return result([{
          course_id: "course_408_ds",
          recent_attempt_count: "8",
          recent_incorrect_count: "5",
          recent_concept_count: "2",
          baseline_attempt_count: "20",
          baseline_incorrect_count: "7",
        }]);
      }
      if (sql.includes("AS baseline_completed_day_count")) {
        return result([{
          baseline_completed_day_count: "6",
          recent_completed_day_count: "1",
          has_pending_task: true,
          has_due_review: false,
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresStudentCareRepository(pool);

    await expect(repository.getRuleEvidence("student_001", now)).resolves.toEqual({
      activeLearningDates: ["2026-08-01", "2026-08-03", "2026-08-05", "2026-08-07"],
      lastLearningAt: "2026-08-15T08:00:00.000Z",
      sessionStartedAt: [
        "2026-08-21T07:45:00.000Z",
        "2026-08-15T07:00:00.000Z",
      ],
      accuracyByCourse: [{
        courseId: "course_408_ds",
        recentAttemptCount: 8,
        recentIncorrectCount: 5,
        recentConceptCount: 2,
        baselineAttemptCount: 20,
        baselineIncorrectCount: 7,
      }],
      rhythm: {
        baselineCompletedDayCount: 6,
        recentCompletedDayCount: 1,
        hasPendingTask: true,
        hasDueReview: false,
      },
    });

    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.parameters[0]).toBe("student_001");
    const accuracySql = calls.find((call) => call.sql.includes("AS recent_attempt_count"))?.sql ?? "";
    expect(accuracySql).toContain("evidence.grading_mode = 'deterministic_choice'");
    expect(accuracySql).toContain("evidence.eligible_for_learning_state_update IS TRUE");
    expect(accuracySql).toContain("evidence.outcome IN ('correct', 'incorrect')");
    expect(accuracySql).toContain("evidence.concept_id IS NOT NULL");
    expect(accuracySql).not.toContain("correct_option_ids");
    const activitySql = calls.find((call) => call.sql.includes("WITH learning_activity"))?.sql ?? "";
    expect(activitySql).toContain("course_reading_progress");
    expect(activitySql).toContain("student_learning_task_assignments");
  });

  it("aligns aggregate windows to Asia/Shanghai calendar-day boundaries", async () => {
    const captureBoundaries = async (instant: Date) => {
      const { pool, calls } = createPool((sql) => {
        if (sql.includes("WITH learning_activity")) {
          return result([{ active_learning_dates: [], last_learning_at: null }]);
        }
        if (sql.includes("FROM account_sessions")) return result();
        if (sql.includes("AS recent_attempt_count")) return result();
        if (sql.includes("AS baseline_completed_day_count")) {
          return result([{
            baseline_completed_day_count: 0,
            recent_completed_day_count: 0,
            has_pending_task: false,
            has_due_review: false,
          }]);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      await new PostgresStudentCareRepository(pool).getRuleEvidence("student_001", instant);
      const parametersFor = (fragment: string) =>
        calls.find((call) => call.sql.includes(fragment))?.parameters.slice(1);
      return {
        activity: parametersFor("WITH learning_activity"),
        sessions: parametersFor("FROM account_sessions"),
        accuracy: parametersFor("AS recent_attempt_count"),
        rhythm: parametersFor("AS baseline_completed_day_count"),
      };
    };

    await expect(captureBoundaries(new Date("2026-08-20T15:59:59.999Z"))).resolves.toEqual({
      activity: ["2026-07-23T16:00:00.000Z", "2026-08-20T15:59:59.999Z"],
      sessions: ["2026-07-15T16:00:00.000Z", "2026-08-20T15:59:59.999Z"],
      accuracy: [
        "2026-07-16T16:00:00.000Z",
        "2026-08-13T16:00:00.000Z",
        "2026-08-20T15:59:59.999Z",
      ],
      rhythm: [
        "2026-07-30T16:00:00.000Z",
        "2026-08-13T16:00:00.000Z",
        "2026-08-20T15:59:59.999Z",
      ],
    });
    await expect(captureBoundaries(new Date("2026-08-20T16:00:00.000Z"))).resolves.toEqual({
      activity: ["2026-07-24T16:00:00.000Z", "2026-08-20T16:00:00.000Z"],
      sessions: ["2026-07-16T16:00:00.000Z", "2026-08-20T16:00:00.000Z"],
      accuracy: [
        "2026-07-17T16:00:00.000Z",
        "2026-08-14T16:00:00.000Z",
        "2026-08-20T16:00:00.000Z",
      ],
      rhythm: [
        "2026-07-31T16:00:00.000Z",
        "2026-08-14T16:00:00.000Z",
        "2026-08-20T16:00:00.000Z",
      ],
    });
  });
});

describe("PostgresStudentCareRepository state", () => {
  it("finds an interaction only inside the current student's boundary", async () => {
    const owned = {
      interaction_id: "care_001",
      user_id: "student_001",
      signal_code: "accuracy_shift",
      rule_version: "student_care_v1",
      status: "presented",
      evidence_summary: { recent_attempt_count: 8 },
      response: null,
      reason_summary: "最近这部分学习比平时更费力。",
      presented_at: "2026-08-21T07:00:00.000Z",
      responded_at: null,
      expires_at: "2026-08-22T07:00:00.000Z",
      cooldown_until: null,
      light_session_expires_at: null,
      light_step: null,
    };
    const { pool, calls } = createPool(() => result([owned]));
    const repository = new PostgresStudentCareRepository(pool);

    await expect(repository.findInteraction("student_001", "care_001"))
      .resolves.toMatchObject({ interactionId: "care_001", userId: "student_001" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.parameters).toEqual(["student_001", "care_001"]);
    expect(calls[0]?.sql).toContain("WHERE user_id = $1 AND interaction_id = $2");
  });

  it("defaults to enabled and persists an explicit preference", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("SELECT enabled")) return result();
      if (sql.includes("INSERT INTO student_care_preferences")) {
        return result([{ enabled: false, updated_at: now.toISOString() }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresStudentCareRepository(pool);

    await expect(repository.getPreference("student_001")).resolves.toEqual({ enabled: true, updatedAt: null });
    await expect(repository.setPreference("student_001", false, now)).resolves.toEqual({
      enabled: false,
      updatedAt: now.toISOString(),
    });
    expect(calls.every((call) => call.parameters[0] === "student_001")).toBe(true);
  });

  it("locks one owned invitation and writes a same-day light session", async () => {
    const lightExpiresAt = new Date("2026-08-21T15:59:59.999Z");
    const interaction = {
      interaction_id: "care_001",
      user_id: "student_001",
      signal_code: "rhythm_drop",
      rule_version: "student_care_v1",
      status: "presented",
      evidence_summary: { recent_completed_day_count: 1 },
      response: null,
      reason_summary: "最近一周完成学习任务的天数比你前两周的节奏少。",
      presented_at: "2026-08-21T07:00:00.000Z",
      responded_at: null,
      expires_at: "2026-08-22T07:00:00.000Z",
      cooldown_until: null,
      light_session_expires_at: null,
      light_step: null,
    };
    const { pool, calls } = createPool((sql) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("FOR UPDATE")) return result([interaction]);
      if (sql.includes("UPDATE student_care_interactions")) {
        return result([{
          ...interaction,
          status: "responded",
          response: "lighten",
          responded_at: now.toISOString(),
          cooldown_until: "2026-08-28T08:00:00.000Z",
          light_session_expires_at: lightExpiresAt.toISOString(),
          light_step: {
            task_id: "task_ds_read",
            task_type: "course_reading",
            course_id: "course_408_ds",
            course_title: "数据结构",
            title: "回到上次阅读位置",
            detail: "先阅读约 10 分钟。",
            estimated_minutes: 10,
            href: "/student/courses/data-structures",
          },
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresStudentCareRepository(pool);

    const response = await repository.respondToInteraction(
      "student_001",
      "care_001",
      "lighten",
      {
        respondedAt: now,
        cooldownUntil: new Date("2026-08-28T08:00:00.000Z"),
        lightSessionExpiresAt: lightExpiresAt,
        lightStep: {
          task_id: "task_ds_read",
          task_type: "course_reading",
          course_id: "course_408_ds",
          course_title: "数据结构",
          title: "回到上次阅读位置",
          detail: "先阅读约 10 分钟。",
          estimated_minutes: 10,
          href: "/student/courses/data-structures",
        },
        talkCourseId: null,
        talkFallbackStep: null,
      },
    );

    expect(response).toMatchObject({ interactionId: "care_001", response: "lighten", idempotent: false });
    expect(calls.find((call) => call.sql.includes("FOR UPDATE"))?.parameters)
      .toEqual(["student_001", "care_001"]);
    expect(calls.some((call) => call.sql.includes("completion_evidence_refs"))).toBe(false);
  });

  it("returns the same result for one repeated action and rejects a competing action", async () => {
    const responded = {
      interaction_id: "care_001",
      user_id: "student_001",
      signal_code: "accuracy_shift",
      rule_version: "student_care_v1",
      status: "responded",
      evidence_summary: { recent_attempt_count: 8 },
      response: "talk",
      reason_summary: "最近这部分学习比平时更费力。",
      presented_at: "2026-08-21T07:00:00.000Z",
      responded_at: now.toISOString(),
      expires_at: "2026-08-22T07:00:00.000Z",
      cooldown_until: "2026-08-28T08:00:00.000Z",
      light_session_expires_at: null,
      light_step: null,
      talk_course_id: "course_408_ds",
    };
    const { pool } = createPool((sql) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("FOR UPDATE")) return result([responded]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresStudentCareRepository(pool);
    const input = {
      respondedAt: now,
      cooldownUntil: new Date("2026-08-28T08:00:00.000Z"),
      lightSessionExpiresAt: null,
      lightStep: null,
      talkCourseId: "course_408_ds",
      talkFallbackStep,
    };

    await expect(repository.respondToInteraction("student_001", "care_001", "talk", input))
      .resolves.toMatchObject({ response: "talk", idempotent: true });
    await expect(repository.respondToInteraction("student_001", "care_001", "continue", {
      ...input,
      talkCourseId: null,
      talkFallbackStep: null,
    }))
      .rejects.toMatchObject({
        code: "CARE_INTERACTION_ALREADY_RESPONDED",
        statusCode: 409,
      });
  });

  it("persists the server-owned course and fallback step with a talk response", async () => {
    const presented = {
      interaction_id: "care_talk_001",
      user_id: "student_001",
      signal_code: "rhythm_drop",
      rule_version: "student_care_v1",
      status: "presented",
      evidence_summary: { recent_completed_day_count: 1 },
      response: null,
      reason_summary: "最近一周完成学习任务的天数比此前少。",
      presented_at: "2026-08-21T07:00:00.000Z",
      responded_at: null,
      expires_at: "2026-08-22T07:00:00.000Z",
      cooldown_until: null,
      light_session_expires_at: null,
      light_step: null,
      talk_course_id: null,
    };
    const { pool, calls } = createPool((sql) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("FOR UPDATE")) return result([presented]);
      if (sql.includes("UPDATE student_care_interactions")) {
        return result([{
          ...presented,
          status: "responded",
          response: "talk",
          responded_at: now.toISOString(),
          cooldown_until: "2026-08-28T08:00:00.000Z",
          talk_course_id: "course_408_ds",
          talk_fallback_step: talkFallbackStep,
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresStudentCareRepository(pool);

    const response = await repository.respondToInteraction(
      "student_001",
      "care_talk_001",
      "talk",
      {
        respondedAt: now,
        cooldownUntil: new Date("2026-08-28T08:00:00.000Z"),
        lightSessionExpiresAt: null,
        lightStep: null,
        talkCourseId: "course_408_ds",
        talkFallbackStep,
      } as never,
    );

    expect(response).toMatchObject({
      response: "talk",
      talkCourseId: "course_408_ds",
      talkFallbackStep,
      idempotent: false,
    });
    const update = calls.find((call) => call.sql.includes("UPDATE student_care_interactions"));
    expect(update?.sql).toContain("talk_course_id");
    expect(update?.sql).toContain("talk_fallback_step");
    expect(update?.parameters).toContain("course_408_ds");
    expect(JSON.parse(String(update?.parameters[8]))).toEqual(talkFallbackStep);
  });

  it("expires an invitation before accepting a late response", async () => {
    const expired = {
      interaction_id: "care_expired",
      user_id: "student_001",
      signal_code: "return_after_gap",
      rule_version: "student_care_v1",
      status: "presented",
      evidence_summary: { inactivity_days: 6 },
      response: null,
      reason_summary: "最近几天没有新的学习记录。",
      presented_at: "2026-08-19T07:00:00.000Z",
      responded_at: null,
      expires_at: "2026-08-20T07:00:00.000Z",
      cooldown_until: null,
      light_session_expires_at: null,
      light_step: null,
    };
    const { pool, calls } = createPool((sql) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("FOR UPDATE")) return result([expired]);
      if (sql.includes("SET status = 'expired'")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresStudentCareRepository(pool);

    await expect(repository.respondToInteraction("student_001", "care_expired", "continue", {
      respondedAt: now,
      cooldownUntil: new Date("2026-08-28T08:00:00.000Z"),
      lightSessionExpiresAt: null,
      lightStep: null,
      talkCourseId: null,
      talkFallbackStep: null,
    })).rejects.toMatchObject({
      code: "CARE_INTERACTION_EXPIRED",
      statusCode: 409,
    });
    expect(calls.some((call) => call.sql.includes("SET status = 'expired'"))).toBe(true);
  });

  it("loads recent talk consent with explicit qualified columns and active membership", async () => {
    const responded = {
      interaction_id: "care_talk_001",
      user_id: "student_001",
      signal_code: "rhythm_drop",
      rule_version: "student_care_v1",
      status: "responded",
      evidence_summary: { recent_completed_day_count: 1 },
      response: "talk",
      reason_summary: "最近一周完成学习任务的天数比此前少。",
      presented_at: "2026-08-21T07:00:00.000Z",
      responded_at: now.toISOString(),
      expires_at: "2026-08-22T07:00:00.000Z",
      cooldown_until: "2026-08-28T08:00:00.000Z",
      light_session_expires_at: null,
      light_step: null,
      talk_fallback_step: talkFallbackStep,
    };
    const { pool, calls } = createPool(() => result([responded]));
    const repository = new PostgresStudentCareRepository(pool);
    const since = new Date("2026-08-20T08:00:00.000Z");

    await expect(repository.findRecentTalkConsent(
      "student_001",
      "course_408_co",
      since,
    )).resolves.toMatchObject({
      interactionId: "care_talk_001",
      response: "talk",
      respondedAt: now.toISOString(),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.parameters).toEqual([
      "student_001",
      "course_408_co",
      since.toISOString(),
    ]);
    expect(calls[0]?.sql).toContain("interaction.interaction_id");
    expect(calls[0]?.sql).toContain("interaction.evidence_summary");
    expect(calls[0]?.sql).toContain("interaction.light_step");
    expect(calls[0]?.sql).toContain("interaction.talk_course_id = $2");
    expect(calls[0]?.sql).toContain("membership.membership_role = 'student'");
  });
});
