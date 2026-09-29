import { describe, expect, it } from "vitest";

import type { SqlClient, SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresPilotStudy } from "../src/services/pilot-study/postgres-pilot-study.js";

function result<Row>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

type QueryCall = { sql: string; parameters: readonly unknown[] };
type DateValue = string | Date;

function createPool(
  handler: (sql: string, parameters: readonly unknown[]) => SqlQueryResult,
) {
  const calls: QueryCall[] = [];
  const client: SqlClient = {
    async query<Row = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> {
      calls.push({ sql, parameters });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result() as SqlQueryResult<Row>;
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

const startedAt = "2026-08-22T09:01:00.000Z";

function studyRows(options: {
  baselineCompleted?: boolean;
  guidedStarted?: boolean;
  guidedCompleted?: boolean;
  transferStarted?: boolean;
  transferCompleted?: boolean;
  feedbackSubmitted?: boolean;
  storedConsentNoticeVersion?: string | null;
  consentedAt?: DateValue;
  baselineConfidence?: number;
} = {}) {
  const completedAt = options.baselineCompleted ? "2026-08-22T09:03:00.000Z" : null;
  const baselineResult = options.baselineCompleted ? {
    outcome: "incorrect",
    score: 0,
    grading_mode: "deterministic_choice",
    evidence_at: "2026-08-22T09:02:30.000Z",
  } : null;
  const guidedCompletedAt = options.guidedCompleted ? "2026-08-22T09:12:00.000Z" : null;
  const guidedResult = options.guidedCompleted ? {
    outcome: "read",
    score: null,
    grading_mode: "course_reading",
    evidence_at: "2026-08-22T09:11:30.000Z",
  } : null;
  const transferCompletedAt = options.transferCompleted
    ? "2026-08-22T09:24:00.000Z"
    : null;
  const transferResult = transferCompletedAt ? {
    outcome: "correct",
    score: 100,
    grading_mode: "deterministic_choice",
    evidence_at: "2026-08-22T09:23:30.000Z",
  } : null;
  const feedback = options.feedbackSubmitted ? {
    ease_of_use: 4,
    guidance_helpfulness: 4,
    confidence_after: 4,
    continued_use_intent: 4,
    open_feedback: "已提交。",
    feedback_submitted_at: new Date("2026-08-22T09:30:00.000Z"),
  } : null;
  const common = {
    study_id: "pilot_408_queue_v1",
    study_title: "队列知识点三阶段试用",
    notice_version: "pilot_notice_v1",
    notice_text: "知情说明",
    study_status: "active",
    participant_id: "participant_001",
    participant_code: "P001",
    role_label: "2023级计算机科学与技术专业学生",
    participant_kind: "real_trial",
    consented_at: new Date(options.consentedAt ?? "2026-08-22T09:00:00.000Z"),
    consent_notice_version: options.storedConsentNoticeVersion ?? "pilot_notice_v1",
    baseline_confidence: options.baselineConfidence ?? 2,
    participant_completed_at: null,
    ease_of_use: feedback?.ease_of_use ?? null,
    guidance_helpfulness: feedback?.guidance_helpfulness ?? null,
    confidence_after: feedback?.confidence_after ?? null,
    continued_use_intent: feedback?.continued_use_intent ?? null,
    open_feedback: feedback?.open_feedback ?? null,
    feedback_submitted_at: feedback?.feedback_submitted_at ?? null,
  };
  return [
    {
      ...common,
      task_id: "pilot_queue_baseline_v1",
      ordinal: 1,
      stage: "baseline",
      evidence_kind: "verified_choice_attempt",
      task_title: "独立完成基线题",
      instructions: "独立完成",
      course_id: "course_408_ds",
      concept_id: "ds_c03_02",
      question_id: "2010-02",
      href: "/student/practice?question_id=2010-02",
      assistance_policy: "independent",
      progress_started_at: new Date(startedAt),
      progress_completed_at: completedAt ? new Date(completedAt) : null,
      evidence_snapshot: baselineResult,
    },
    {
      ...common,
      task_id: "pilot_queue_guided_v1",
      ordinal: 2,
      stage: "guided",
      evidence_kind: "verified_course_reading",
      task_title: "学习队列核心规则",
      instructions: "展开来源",
      course_id: "course_408_ds",
      concept_id: "ds_c03_02",
      question_id: null,
      href: "/student/courses/data-structures?concept_id=ds_c03_02",
      assistance_policy: "platform_guidance",
      progress_started_at: options.guidedStarted ? new Date("2026-08-22T09:04:00.000Z") : null,
      progress_completed_at: guidedCompletedAt ? new Date(guidedCompletedAt) : null,
      evidence_snapshot: guidedResult,
    },
    {
      ...common,
      task_id: "pilot_queue_transfer_v1",
      ordinal: 3,
      stage: "transfer",
      evidence_kind: "verified_choice_attempt",
      task_title: "独立完成迁移题",
      instructions: "独立完成",
      course_id: "course_408_ds",
      concept_id: "ds_c03_02",
      question_id: "2021-02",
      href: "/student/practice?question_id=2021-02",
      assistance_policy: "independent",
      progress_started_at: options.transferStarted ? new Date("2026-08-22T09:20:00.000Z") : null,
      progress_completed_at: transferCompletedAt ? new Date(transferCompletedAt) : null,
      evidence_snapshot: transferResult,
    },
  ];
}

describe("PostgresPilotStudy evidence ownership", () => {
  it("returns an explicit non-enrolled state without leaking an account record", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresPilotStudy(pool).getStudentStudy("student_unenrolled"))
      .resolves.toEqual({ kind: "not_enrolled" });
  });

  it("locks the account without combining FOR UPDATE with an aggregate query", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM pilot_studies")) {
        return result([{
          study_id: "pilot_408_queue_v1",
          title: "队列知识点三阶段试用",
          notice_version: "pilot_notice_v1",
          notice_text: "知情说明",
          status: "active",
        }]);
      }
      if (sql.includes("FROM users account")) {
        expect(sql).toContain("FOR UPDATE OF account");
        expect(sql).not.toMatch(/\bGROUP BY\b|\barray_agg\s*\(/iu);
        expect(sql).toMatch(/ARRAY\s*\(\s*SELECT role\.role_key/iu);
        return result([{
          user_id: "user_student_001",
          account_status: "active",
          account_origin: "legacy_demo",
          roles: ["student"],
        }]);
      }
      if (sql.includes("INSERT INTO pilot_participants")) {
        return result([{
          participant_code: "SYN_E2E_01",
          role_label: "自动化浏览器验收账户",
          participant_kind: "synthetic_verification",
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresPilotStudy(pool, {
      createId: () => "pilot_participant_e2e",
    }).enrollParticipant("user_admin_001", {
      username: "user_student_001",
      participant_code: "SYN_E2E_01",
      role_label: "自动化浏览器验收账户",
      participant_kind: "synthetic_verification",
    })).resolves.toMatchObject({
      participant_code: "SYN_E2E_01",
      participant_kind: "synthetic_verification",
    });
  });

  it("completes a fixed choice task only from the owner's post-start evaluation", async () => {
    let completed = false;
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(studyRows({ baselineCompleted: completed }));
      }
      if (sql.includes("FROM practice_attempts attempt")) {
        return result([{
          attempt_id: "attempt_001",
          evaluation_status: "incorrect",
          score: "0",
          grading_mode: "deterministic_choice",
          submitted_at: new Date("2026-08-22T09:02:30.000Z"),
        }]);
      }
      if (sql.includes("UPDATE pilot_task_progress")) {
        completed = true;
        return result([], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresPilotStudy(pool, {
      now: () => new Date("2026-08-22T09:03:00.000Z"),
    });

    const resolved = await service.completeTask(
      "student_001",
      "pilot_queue_baseline_v1",
      { attempt_id: "attempt_001" },
    );

    expect(resolved.kind).toBe("enrolled");
    const evidenceQuery = calls.find((call) => call.sql.includes("FROM practice_attempts attempt"));
    expect(evidenceQuery?.sql).toMatch(/attempt\.user_id\s*=\s*\$2/iu);
    expect(evidenceQuery?.sql).toMatch(/attempt\.question_id\s*=\s*\$3/iu);
    expect(evidenceQuery?.sql).toMatch(/attempt\.submitted_at\s*>=\s*\$4/iu);
    expect(evidenceQuery?.parameters).toEqual([
      "attempt_001",
      "student_001",
      "2010-02",
      startedAt,
    ]);
    expect(calls.some((call) => call.sql.includes("UPDATE pilot_task_progress"))).toBe(true);
  });

  it("fails before completion when the supplied attempt is not eligible", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) return result(studyRows());
      if (sql.includes("FROM practice_attempts attempt")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresPilotStudy(pool).completeTask(
      "student_001",
      "pilot_queue_baseline_v1",
      { attempt_id: "attempt_from_another_student" },
    )).rejects.toMatchObject({ code: "PILOT_EVIDENCE_NOT_FOUND" });
    expect(calls.some((call) => call.sql.includes("UPDATE pilot_task_progress"))).toBe(false);
  });

  it("verifies guided reading against the concept source and post-start expansion", async () => {
    let completed = false;
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(studyRows({ baselineCompleted: true, guidedStarted: true }).map((row) => (
          completed && row.stage === "guided"
            ? {
                ...row,
                progress_completed_at: new Date("2026-08-22T09:12:00.000Z"),
                evidence_snapshot: {
                  outcome: "read",
                  score: null,
                  grading_mode: "course_reading",
                  evidence_at: "2026-08-22T09:11:30.000Z",
                },
              }
            : row
        )));
      }
      if (sql.includes("FROM course_reading_progress progress")) {
        return result([{
          chunk_id: "chunk_queue_001",
          paragraph_index: 2,
          updated_at: new Date("2026-08-22T09:11:30.000Z"),
        }]);
      }
      if (sql.includes("UPDATE pilot_task_progress")) {
        completed = true;
        return result([], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresPilotStudy(pool, {
      now: () => new Date("2026-08-22T09:12:00.000Z"),
    }).completeTask("student_001", "pilot_queue_guided_v1", {});

    const readingQuery = calls.find((call) => call.sql.includes("FROM course_reading_progress progress"));
    expect(readingQuery?.sql).toContain("JOIN course_concept_sources source");
    expect(readingQuery?.sql).toMatch(/progress\.user_id\s*=\s*\$1/iu);
    expect(readingQuery?.sql).toContain("source.concept_id = $3");
    expect(readingQuery?.sql).toContain("progress.updated_at >= $4");
    expect(readingQuery?.sql).toContain("progress.source_expanded = true");
    expect(readingQuery?.parameters).toEqual([
      "student_001",
      "course_408_ds",
      "ds_c03_02",
      "2026-08-22T09:04:00.000Z",
    ]);
  });

  it("does not accept source expansion before the required reading position", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(studyRows({ baselineCompleted: true, guidedStarted: true }));
      }
      if (sql.includes("FROM course_reading_progress progress")) {
        if (sql.includes("progress.paragraph_index >= 2")) return result();
        return result([{
          chunk_id: "chunk_queue_001",
          paragraph_index: 1,
          updated_at: new Date("2026-08-22T09:05:30.000Z"),
        }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresPilotStudy(pool).completeTask(
      "student_001",
      "pilot_queue_guided_v1",
      {},
    )).rejects.toMatchObject({ code: "PILOT_EVIDENCE_NOT_FOUND" });
    expect(calls.some((call) => call.sql.includes("UPDATE pilot_task_progress"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("progress.paragraph_index >= 2"))).toBe(true);
  });

  it("records participant completion at the final task boundary", async () => {
    let completed = false;
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(studyRows({
          baselineCompleted: true,
          guidedCompleted: true,
          transferStarted: true,
          transferCompleted: false,
        }).map((row) => completed && row.stage === "transfer"
          ? {
              ...row,
              progress_completed_at: new Date("2026-08-22T09:25:00.000Z"),
              evidence_snapshot: {
                outcome: "correct",
                score: 100,
                grading_mode: "deterministic_choice",
                evidence_at: "2026-08-22T09:24:30.000Z",
              },
            }
          : row));
      }
      if (sql.includes("FROM practice_attempts attempt")) {
        return result([{
          attempt_id: "attempt_transfer_001",
          evaluation_status: "correct",
          score: "100",
          grading_mode: "deterministic_choice",
          submitted_at: new Date("2026-08-22T09:24:30.000Z"),
        }]);
      }
      if (sql.includes("UPDATE pilot_task_progress")) {
        completed = true;
        return result([], 1);
      }
      if (sql.includes("UPDATE pilot_participants")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresPilotStudy(pool, {
      now: () => new Date("2026-08-22T09:25:00.000Z"),
    }).completeTask("student_001", "pilot_queue_transfer_v1", {
      attempt_id: "attempt_transfer_001",
    });

    const participantUpdate = calls.find((call) => call.sql.includes("UPDATE pilot_participants"));
    expect(participantUpdate?.sql).toContain("completed_at = COALESCE(completed_at");
    expect(participantUpdate?.parameters).toEqual([
      "participant_001",
      "2026-08-22T09:25:00.000Z",
    ]);
  });

  it("does not silently overwrite an already submitted feedback record", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(studyRows({
          baselineCompleted: true,
          guidedCompleted: true,
          transferStarted: true,
          transferCompleted: true,
          feedbackSubmitted: true,
        }));
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresPilotStudy(pool).submitFeedback("student_001", {
      ease_of_use: 2,
      guidance_helpfulness: 2,
      confidence_after: 2,
      continued_use_intent: 2,
      open_feedback: "第二次提交",
    })).rejects.toMatchObject({ code: "PILOT_FEEDBACK_ALREADY_SUBMITTED" });
    expect(calls.some((call) => call.sql.includes("INSERT INTO pilot_feedback"))).toBe(false);
  });

  it("rejects a participant whose recorded consent version is stale", async () => {
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(studyRows({ storedConsentNoticeVersion: "pilot_notice_old" }));
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresPilotStudy(pool).startTask(
      "student_001",
      "pilot_queue_baseline_v1",
    )).rejects.toMatchObject({ code: "PILOT_CONSENT_VERSION_MISMATCH" });
    expect(calls.some((call) => call.sql.includes("INSERT INTO pilot_task_progress"))).toBe(false);
  });

  it("keeps every task locked in the student DTO when consent belongs to an old notice", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(studyRows({ storedConsentNoticeVersion: "pilot_notice_old" }));
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresPilotStudy(pool).getStudentStudy("student_001")).resolves.toMatchObject({
      kind: "enrolled",
      tasks: [
        { task_id: "pilot_queue_baseline_v1", status: "locked" },
        { task_id: "pilot_queue_guided_v1", status: "locked" },
        { task_id: "pilot_queue_transfer_v1", status: "locked" },
      ],
    });
  });

  it("allows explicit re-consent when the stored notice version is stale", async () => {
    let updated = false;
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(updated
          ? studyRows({
              storedConsentNoticeVersion: "pilot_notice_v1",
              consentedAt: "2026-08-22T10:00:00.000Z",
              baselineConfidence: 4,
            })
          : studyRows({ storedConsentNoticeVersion: "pilot_notice_old" }));
      }
      if (sql.includes("UPDATE pilot_participants") && sql.includes("consent_notice_version")) {
        updated = true;
        return result([], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresPilotStudy(pool, {
      now: () => new Date("2026-08-22T10:00:00.000Z"),
    }).recordConsent("student_001", {
      accepted: true,
      notice_version: "pilot_notice_v1",
      baseline_confidence: 4,
    })).resolves.toMatchObject({
      kind: "enrolled",
      participant: {
        consent_notice_version: "pilot_notice_v1",
        consented_at: "2026-08-22T10:00:00.000Z",
        baseline_confidence: 4,
      },
    });
    const update = calls.find((call) => call.sql.includes("UPDATE pilot_participants") && call.sql.includes("consent_notice_version"));
    expect(update?.parameters).toEqual([
      "participant_001",
      "pilot_notice_v1",
      "2026-08-22T10:00:00.000Z",
      4,
    ]);
  });

  it("binds pilot evaluation to the persisted task question and returns only a redacted result", async () => {
    let completed = false;
    let receivedSubmission: unknown;
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM pilot_participants participant")) {
        return result(studyRows({ baselineCompleted: completed }));
      }
      if (sql.includes("FROM practice_attempts attempt")) {
        return result([{
          attempt_id: "attempt_pilot_001",
          evaluation_status: "incorrect",
          score: "0",
          grading_mode: "deterministic_choice",
          submitted_at: new Date("2026-08-22T09:02:30.000Z"),
        }]);
      }
      if (sql.includes("UPDATE pilot_task_progress")) {
        completed = true;
        return result([], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const choiceEvaluator = {
      async evaluateInTransaction(_client: SqlClient, _userId: string, submission: unknown) {
        receivedSubmission = submission;
        return {
          attempt: {
            attempt_id: "attempt_pilot_001",
            user_id: "student_001",
            course_id: "course_408_001",
            question_id: "2010-02",
            answer_type: "choice",
            selected_option_ids: ["B"],
            response_text: null,
            status: "evaluated",
            submitted_at: "2026-08-22T09:02:30.000Z",
          },
          evaluation: {
            evaluation_id: "evaluation_pilot_001",
            submission_id: "attempt_pilot_001",
            question_id: "2010-02",
            grading_mode: "deterministic_choice",
            status: "incorrect",
            is_correct: false,
            score: 0,
            correct_option_ids: ["A"],
            explanation: "不得返回",
            reference_solution: "不得返回",
            answer_assets: [],
            review_required: false,
            created_at: "2026-08-22T09:02:30.000Z",
            source: {
              provider: "local",
              dataset_id: "pilot",
              source_url: "https://example.test",
              license_status: "unverified",
              usage_scope: "local_demo_only",
            },
          },
          evidence: {} as never,
        };
      },
    };

    const response = await new PostgresPilotStudy(pool, { choiceEvaluator: choiceEvaluator as never }).evaluateChoiceTask(
      "student_001",
      "pilot_queue_baseline_v1",
      ["B"],
      "pilot-key-001",
    );

    expect(receivedSubmission).toEqual({
      question_id: "2010-02",
      answer_type: "choice",
      selected_option_ids: ["B"],
    });
    expect(response).toEqual({
      task_id: "pilot_queue_baseline_v1",
      attempt_id: "attempt_pilot_001",
      question_id: "2010-02",
      outcome: "incorrect",
      score: 0,
      grading_mode: "deterministic_choice",
      evidence_at: "2026-08-22T09:02:30.000Z",
      task_completed: true,
    });
    expect(response).not.toHaveProperty("correct_option_ids");
  });

  it("serializes concurrent evaluations for the same pilot task before creating an attempt", async () => {
    let completed = false;
    let progressUpdates = 0;
    let evaluationCalls = 0;
    let releaseFirstEvaluation!: () => void;
    let firstEvaluationStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstEvaluationStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirstEvaluation = resolve;
    });
    let participantLockHeld = false;
    const lockWaiters: Array<() => void> = [];

    const currentRows = () => studyRows({ baselineCompleted: completed }).map((row) => {
      if (!completed || row.task_id !== "pilot_queue_baseline_v1") return row;
      return {
        ...row,
        progress_attempt_id: "attempt_pilot_001",
        evidence_snapshot: {
          outcome: "incorrect",
          score: 0,
          grading_mode: "deterministic_choice",
          evidence_at: "2026-08-22T09:02:30.000Z",
        },
      };
    });

    const acquireParticipantLock = async () => {
      if (!participantLockHeld) {
        participantLockHeld = true;
        return;
      }
      await new Promise<void>((resolve) => lockWaiters.push(resolve));
      participantLockHeld = true;
    };

    const releaseParticipantLock = () => {
      const next = lockWaiters.shift();
      if (next) next();
      else participantLockHeld = false;
    };

    const createClient = (): SqlClient => {
      let ownsParticipantLock = false;
      return {
        async query<Row = Record<string, unknown>>(
          sql: string,
          _parameters: readonly unknown[] = [],
        ): Promise<SqlQueryResult<Row>> {
          if (sql === "BEGIN") return result() as SqlQueryResult<Row>;
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (ownsParticipantLock) {
              ownsParticipantLock = false;
              releaseParticipantLock();
            }
            return result() as SqlQueryResult<Row>;
          }
          if (sql.includes("FROM pilot_participants participant")) {
            if (sql.includes("FOR UPDATE OF participant") && !ownsParticipantLock) {
              await acquireParticipantLock();
              ownsParticipantLock = true;
            }
            return result(currentRows()) as SqlQueryResult<Row>;
          }
          if (sql.includes("FROM practice_attempts attempt")) {
            return result([{
              attempt_id: "attempt_pilot_001",
              evaluation_status: "incorrect",
              score: "0",
              grading_mode: "deterministic_choice",
              submitted_at: new Date("2026-08-22T09:02:30.000Z"),
            }]) as SqlQueryResult<Row>;
          }
          if (sql.includes("UPDATE pilot_task_progress")) {
            progressUpdates += 1;
            completed = true;
            return result([], 1) as SqlQueryResult<Row>;
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    };

    const pool: SqlQueryablePool = {
      connect: async () => createClient(),
      async query<Row = Record<string, unknown>>(
        sql: string,
        _parameters: readonly unknown[] = [],
      ): Promise<SqlQueryResult<Row>> {
        if (sql.includes("FROM pilot_participants participant")) {
          return result(currentRows()) as SqlQueryResult<Row>;
        }
        throw new Error(`Unexpected pool SQL: ${sql}`);
      },
    };

    const choiceEvaluator = {
      async evaluateInTransaction() {
        evaluationCalls += 1;
        if (evaluationCalls === 1) {
          firstEvaluationStarted();
          await firstGate;
        }
        return {
          attempt: {
            attempt_id: `attempt_pilot_00${evaluationCalls}`,
            user_id: "student_001",
            course_id: "course_408_ds",
            question_id: "2010-02",
            answer_type: "choice",
            selected_option_ids: ["B"],
            response_text: null,
            status: "evaluated",
            submitted_at: "2026-08-22T09:02:30.000Z",
          },
          evaluation: {
            evaluation_id: `evaluation_pilot_00${evaluationCalls}`,
            submission_id: `attempt_pilot_00${evaluationCalls}`,
            question_id: "2010-02",
            grading_mode: "deterministic_choice",
            status: "incorrect",
            is_correct: false,
            score: 0,
            correct_option_ids: ["A"],
            explanation: null,
            reference_solution: null,
            answer_assets: [],
            review_required: false,
            created_at: "2026-08-22T09:02:30.000Z",
            source: {
              provider: "local",
              dataset_id: "pilot",
              source_url: "https://example.test",
              license_status: "unverified",
              usage_scope: "local_demo_only",
            },
          },
          evidence: {} as never,
        };
      },
    };

    const service = new PostgresPilotStudy(pool, {
      choiceEvaluator: choiceEvaluator as never,
      now: () => new Date("2026-08-22T09:03:00.000Z"),
    });
    const first = service.evaluateChoiceTask(
      "student_001",
      "pilot_queue_baseline_v1",
      ["B"],
      "pilot-key-concurrent-1",
    );
    await firstStarted;
    const second = service.evaluateChoiceTask(
      "student_001",
      "pilot_queue_baseline_v1",
      ["B"],
      "pilot-key-concurrent-2",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callsBeforeRelease = evaluationCalls;
    releaseFirstEvaluation();
    const results = await Promise.all([first, second]);

    expect(callsBeforeRelease).toBe(1);
    expect(progressUpdates).toBe(1);
    expect(results[0]?.attempt_id).toBe("attempt_pilot_001");
    expect(results[1]?.attempt_id).toBe("attempt_pilot_001");
  });
});
