import type {
  LearningRecord,
  OnboardingState,
} from "@xuetu/contracts";
import { describe, expect, it } from "vitest";

import type {
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import type { StudentOnboardingService } from "../src/services/onboarding/student-onboarding.js";
import { PostgresStudentLearningOrchestration } from "../src/services/orchestration/postgres-student-learning-orchestration.js";
import type { ReliableLearningLoopService } from "../src/services/question-bank/reliable-learning-loop.js";

const now = new Date("2026-08-12T08:00:00.000Z");
const userId = "user_orchestration_student";

function result(rows: Record<string, unknown>[] = []): SqlQueryResult {
  return { rows, rowCount: rows.length };
}

function onboardingState(): OnboardingState {
  return {
    status: "completed",
    current_step: "plan",
    goals: {
      target_exam_year: 2027,
      preparation_stage: "foundation",
      daily_minutes: 90,
      target_school: null,
      target_score: 120,
      saved_at: "2026-08-11T00:00:00.000Z",
    },
    self_assessments: [
      { course_id: "course_408_ds", level: "average" },
      { course_id: "course_408_co", level: "average" },
      { course_id: "course_408_os", level: "weak" },
      { course_id: "course_408_cn", level: "good" },
    ],
    profile: null,
    plan: null,
    updated_at: "2026-08-11T00:00:00.000Z",
  };
}

function learningRecord(): LearningRecord {
  const courses = [
    ["course_408_ds", "数据结构", "ds_c01", "算法复杂度", 3],
    ["course_408_co", "计算机组成原理", "co_c01", "计算机系统层次", 2],
    ["course_408_os", "操作系统", "os_c01", "操作系统作用", 1],
    ["course_408_cn", "计算机网络", "cn_c01", "协议分层", 2],
  ] as const;
  return {
    generated_at: now.toISOString(),
    courses: courses.map(([course_id, title, concept_id, conceptTitle, questionCount]) => ({
      course_id,
      title,
      concept_count: 1,
      started_concept_count: course_id === "course_408_ds" ? 1 : 0,
      practice_attempt_count: 0,
      correct_count: 0,
      incorrect_count: 0,
      needs_review_count: 0,
      mastered_count: 0,
      concepts: [{
        concept_id,
        title: conceptTitle,
        status: course_id === "course_408_ds" ? "reading" : "not_started",
        attempt_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        mistake_count: 0,
        practice_question_count: questionCount,
      }],
    })),
  };
}

describe("PostgresStudentLearningOrchestration", () => {
  it("uses the due reliable mistake recommendation before the course fallback", async () => {
    const recommendationCalls: Array<[string, unknown]> = [];
    const pool = {
      async query(sql: string) {
        if (sql.includes("course_reading_progress progress") || sql.includes("practice_attempts attempt")) return result([]);
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("FROM student_learning_probe_sessions")) return result([]);
        if (sql.includes("course_catalog_entries catalog")) return result([
          { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
          { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
          { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
          { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
        ]);
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async connect() { throw new Error("Transactions are not required for a read-only snapshot."); },
    } as SqlQueryablePool;
    const recommendationService = {
      async listRecommendations(requestedUserId: string, filter: unknown) {
        recommendationCalls.push([requestedUserId, filter]);
        return {
          algorithm_version: "evidence_weighted_v1" as const,
          generated_at: now.toISOString(),
          items: [{
            mistake_id: "mistake_ds_001",
            course_id: "course_408_ds",
            course_title: "数据结构",
            question_id: "question_ds_001",
            question_number: 8,
            concept_id: "ds_c01",
            concept_title: "算法复杂度",
            priority_score: 86,
            algorithm_version: "evidence_weighted_v1" as const,
            next_review_at: "2026-08-12T07:00:00.000Z",
            due_status: "due" as const,
            evidence_level: "grounded" as const,
            reason_lines: ["已到复习时间", "核心知识点"],
            evidence_refs: ["mistake:mistake_ds_001", "concept:ds_c01"],
            practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c01",
          }],
        };
      },
    };
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      { async getLearningRecord() { return learningRecord(); }, async listMistakes() { return { items: [] }; } } as unknown as ReliableLearningLoopService,
      { now: () => now, mistakeRecommendation: recommendationService } as never,
    );

    const snapshot = await service.getSnapshot(userId);

    expect(recommendationCalls).toEqual([[userId, { limit: 5 }]]);
    expect(snapshot.current_task).toMatchObject({
      source: "mistake",
      task_type: "mistake_review",
      mistake_id: "mistake_ds_001",
      reason: expect.stringContaining("已到复习时间"),
    });
    expect(snapshot.current_task.href).toContain("concept_id=ds_c01");
  });

  it("keeps the deterministic course fallback when recommendation lookup fails", async () => {
    const pool = {
      async query(sql: string) {
        if (sql.includes("course_reading_progress progress") || sql.includes("practice_attempts attempt")) return result([]);
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("FROM student_learning_probe_sessions")) return result([]);
        if (sql.includes("course_catalog_entries catalog")) return result([
          { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
          { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
          { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
          { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
        ]);
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async connect() { throw new Error("Transactions are not required for a read-only snapshot."); },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      { async getLearningRecord() { return learningRecord(); }, async listMistakes() { return { items: [] }; } } as unknown as ReliableLearningLoopService,
      {
        now: () => now,
        mistakeRecommendation: { async listRecommendations() { throw new Error("database unavailable"); } },
      } as never,
    );

    await expect(service.getSnapshot(userId)).resolves.toMatchObject({
      current_task: { source: "course_fallback", task_type: "course_reading" },
    });
  });

  it("builds one schema-valid snapshot from the requested student's live PostgreSQL evidence", async () => {
    const requestedUsers: string[] = [];
    const onboarding = onboardingState();
    const onboardingBefore = structuredClone(onboarding);
    const studentOnboarding = {
      async getState(requestedUserId: string) {
        requestedUsers.push(`onboarding:${requestedUserId}`);
        return onboarding;
      },
    } as StudentOnboardingService;
    const learningLoop = {
      async getLearningRecord(requestedUserId: string) {
        requestedUsers.push(`record:${requestedUserId}`);
        return learningRecord();
      },
      async listMistakes(requestedUserId: string) {
        requestedUsers.push(`mistakes:${requestedUserId}`);
        return { items: [] };
      },
    } as unknown as ReliableLearningLoopService;
    const queryCalls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = {
      async query(sql: string, parameters: readonly unknown[] = []) {
        queryCalls.push({ sql, parameters });
        if (sql.includes("FROM course_reading_progress progress")) {
          return result([{
            course_id: "course_408_ds",
            concept_id: "ds_c01",
            chunk_id: "ds_chunk_001",
            paragraph_index: 2,
            source_expanded: false,
            updated_at: "2026-08-12T07:30:00.000Z",
          }]);
        }
        if (sql.includes("FROM practice_attempts attempt")) {
          return result([{
            attempt_id: "attempt_001",
            course_id: "course_408_co",
            concept_id: "co_c01",
            outcome: "correct",
            submitted_at: "2026-08-12T07:00:00.000Z",
          }]);
        }
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("status = 'completed'")) {
          return result([{
            task_id: "completed_ds_read",
            task_type: "course_reading",
            course_id: "course_408_ds",
            concept_id: "ds_c01",
            completed_at: "2026-08-11T08:00:00.000Z",
          }]);
        }
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("status = 'pending'")) {
          return result([]);
        }
        if (sql.includes("FROM student_learning_probe_sessions")) {
          return result([]);
        }
        if (sql.includes("course_catalog_entries catalog")) {
          return result([
            { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
            { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
            { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
            { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
          ]);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async connect() {
        throw new Error("Transactions are not required for a read-only snapshot.");
      },
    } as SqlQueryablePool;

    const snapshot = await new PostgresStudentLearningOrchestration(
      pool,
      studentOnboarding,
      learningLoop,
      { now: () => now },
    ).getSnapshot(userId);

    expect(requestedUsers).toEqual([
      `onboarding:${userId}`,
      `record:${userId}`,
      `mistakes:${userId}`,
    ]);
    expect(queryCalls.filter((call) => call.sql.includes("course_reading_progress"))[0]?.parameters).toEqual([userId]);
    const readingSql = queryCalls.find((call) => call.sql.includes("FROM course_reading_progress progress"))?.sql ?? "";
    expect(readingSql).toContain("ORDER BY progress.course_id, progress.updated_at DESC");
    expect(queryCalls.filter((call) => call.sql.includes("practice_attempts"))[0]?.parameters).toEqual([userId]);
    const attemptSql = queryCalls.find((call) => call.sql.includes("FROM practice_attempts attempt"))?.sql ?? "";
    expect(attemptSql).toContain("JOIN questions question ON question.question_id = attempt.question_id");
    expect(attemptSql).toContain("JOIN course_catalog_entries catalog ON catalog.question_subject = question.subject");
    expect(attemptSql).toContain("catalog.course_id");
    expect(queryCalls.find((call) => call.sql.includes("FROM course_catalog_entries catalog"))?.parameters).toEqual([
      ["course_408_ds", "course_408_co", "course_408_os", "course_408_cn"],
    ]);
    const completedAssignmentSql = queryCalls.find((call) => (
      call.sql.includes("FROM student_learning_task_assignments")
      && call.sql.includes("status = 'completed'")
    ))?.sql ?? "";
    expect(completedAssignmentSql).toContain("task_type");
    expect(completedAssignmentSql).toContain("course_id");
    expect(completedAssignmentSql).toContain("concept_id");
    expect(completedAssignmentSql).toContain("completed_at");
    expect(completedAssignmentSql).toContain("completed_at IS NOT NULL");
    expect(snapshot.current_task).toMatchObject({
      source: "reading_progress",
      task_type: "course_reading",
      course_id: "course_408_ds",
      concept_id: "ds_c01",
    });
    expect(snapshot.evidence_summary).toMatchObject({
      basis: "live_evidence",
      reading_progress_count: 1,
      practice_attempt_count: 1,
      objective_evidence_count: 2,
    });
    expect(snapshot.challenge_journey.recent_activity.completed_day_count).toBe(1);
    expect(snapshot.challenge_journey.nodes[0]).toMatchObject({
      task_id: "completed_ds_read",
      status: "completed",
    });
    expect(onboarding).toEqual(onboardingBefore);
    expect(queryCalls.some((call) => /\b(?:INSERT|UPDATE|DELETE)\b/iu.test(call.sql))).toBe(false);
  });

  it("restores the student's offered probe as the current task after a refresh", async () => {
    const queryCalls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = {
      async query(sql: string, parameters: readonly unknown[] = []) {
        queryCalls.push({ sql, parameters });
        if (sql.includes("FROM course_reading_progress progress") || sql.includes("FROM practice_attempts attempt")) {
          return result([]);
        }
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("FROM student_learning_probe_sessions")) {
          return result([{
            probe_session_id: "probe_session_001",
            status: "offered",
            course_id: "course_408_co",
            concept_id: "co_c01",
            concept_title: "计算机系统层次",
            source_attempt_id: "attempt_co_001",
            created_at: "2026-08-12T07:30:00.000Z",
          }]);
        }
        if (sql.includes("course_catalog_entries catalog")) {
          return result([
            { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
            { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
            { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
            { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
          ]);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async connect() {
        throw new Error("Transactions are not required for a read-only snapshot.");
      },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      {
        async getLearningRecord() { return learningRecord(); },
        async listMistakes() { return { items: [] }; },
      } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    const snapshot = await service.getSnapshot(userId);

    expect(snapshot.current_task).toMatchObject({
      source: "probe",
      task_id: "probe_probe_session_001",
      probe_session_id: "probe_session_001",
    });
    const probeSql = queryCalls.find((call) => call.sql.includes("FROM student_learning_probe_sessions"));
    expect(probeSql?.parameters).toEqual([userId]);
    expect(probeSql?.sql).toContain("status IN ('offered', 'started')");
  });

  it("does not let a legacy probe assignment shadow the probe session after a refresh", async () => {
    const queryCalls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = {
      async query(sql: string, parameters: readonly unknown[] = []) {
        queryCalls.push({ sql, parameters });
        if (sql.includes("FROM course_reading_progress progress") || sql.includes("FROM practice_attempts attempt")) {
          return result([]);
        }
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("status = 'pending'")) {
          if (sql.includes("task_id NOT LIKE 'probe_%'")) return result([]);
          return result([{
            assignment_id: "legacy_probe_assignment",
            task_id: "probe_probe_session_001",
            task_type: "choice_practice",
            status: "pending",
            activated_at: "2026-08-12T07:45:00.000Z",
            course_id: "course_408_co",
            concept_id: "co_c01",
            mistake_id: null,
          }]);
        }
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("FROM student_learning_probe_sessions")) {
          return result([{
            probe_session_id: "probe_session_001",
            status: "offered",
            course_id: "course_408_co",
            concept_id: "co_c01",
            concept_title: "计算机系统层次",
            source_attempt_id: "attempt_co_001",
            created_at: "2026-08-12T07:30:00.000Z",
          }]);
        }
        if (sql.includes("course_catalog_entries catalog")) {
          return result([
            { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
            { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
            { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
            { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
          ]);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async connect() {
        throw new Error("Transactions are not required for a read-only snapshot.");
      },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      {
        async getLearningRecord() { return learningRecord(); },
        async listMistakes() { return { items: [] }; },
      } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    const snapshot = await service.getSnapshot(userId);

    expect(snapshot.current_task).toMatchObject({
      source: "probe",
      task_id: "probe_probe_session_001",
      probe_session_id: "probe_session_001",
    });
    const pendingAssignmentSql = queryCalls.find((call) => (
      call.sql.includes("FROM student_learning_task_assignments")
      && call.sql.includes("status = 'pending'")
    ))?.sql ?? "";
    expect(pendingAssignmentSql).toMatch(/task_id\s+NOT\s+LIKE\s+'probe_/iu);
  });

  it("rejects activation of a probe task without creating a regular assignment", async () => {
    let connectCalled = false;
    const pool = {
      async query(sql: string) {
        if (sql.includes("FROM course_reading_progress progress") || sql.includes("FROM practice_attempts attempt")) {
          return result([]);
        }
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("FROM student_learning_probe_sessions")) {
          return result([{
            probe_session_id: "probe_session_001",
            status: "offered",
            course_id: "course_408_co",
            concept_id: "co_c01",
            concept_title: "计算机系统层次",
            source_attempt_id: "attempt_co_001",
            created_at: "2026-08-12T07:30:00.000Z",
          }]);
        }
        if (sql.includes("course_catalog_entries catalog")) {
          return result([
            { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
            { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
            { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
            { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
          ]);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async connect() {
        connectCalled = true;
        throw new Error("Probe tasks must not open an assignment transaction.");
      },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      {
        async getLearningRecord() { return learningRecord(); },
        async listMistakes() { return { items: [] }; },
      } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    await expect(service.activateTask(userId, "probe_probe_session_001"))
      .rejects.toMatchObject({ code: "LEARNING_TASK_NOT_FOUND", statusCode: 404 });
    expect(connectCalled).toBe(false);
  });

  it("rejects completion of a probe task without creating a regular assignment", async () => {
    let queryCalled = false;
    let connectCalled = false;
    const pool = {
      async query() {
        queryCalled = true;
        throw new Error("Probe completion must not read assignment state.");
      },
      async connect() {
        connectCalled = true;
        throw new Error("Probe completion must not open an assignment transaction.");
      },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { throw new Error("Probe completion must not read onboarding state."); } } as unknown as StudentOnboardingService,
      {
        async getLearningRecord() { throw new Error("Probe completion must not read learning records."); },
        async listMistakes() { throw new Error("Probe completion must not read mistakes."); },
      } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    await expect(service.completeTask(userId, "probe_probe_session_001"))
      .rejects.toMatchObject({ code: "LEARNING_TASK_NOT_FOUND", statusCode: 404 });
    expect(queryCalled).toBe(false);
    expect(connectCalled).toBe(false);
  });

  it("activates a task in a transaction and locks the student's pending assignment", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(sql);
        if (sql.includes("FROM student_learning_task_assignments")) {
          return result([]);
        }
        if (sql.includes("INSERT INTO student_learning_task_assignments")) {
          return result([{ assignment_id: "assignment_1", activated_at: now }]);
        }
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query(sql: string) {
        if (sql.includes("course_reading_progress progress") || sql.includes("practice_attempts attempt")) return result([]);
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("course_catalog_entries catalog")) return result([
          { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
          { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
          { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
          { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
        ]);
        return result([]);
      },
      async connect() { return client; },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      { async getLearningRecord() { return learningRecord(); }, async listMistakes() { return { items: [] }; } } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    const activation = await service.activateTask(userId, "live_course_course_408_co");
    expect(activation).toMatchObject({ task_id: "live_course_course_408_co", idempotent: false });
    expect(statements[0]).toBe("BEGIN");
    const advisoryLockIndex = statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const assignmentLookupIndex = statements.findIndex((sql) => (
      sql.includes("FROM student_learning_task_assignments") && sql.includes("FOR UPDATE")
    ));
    expect(advisoryLockIndex).toBeGreaterThan(0);
    expect(advisoryLockIndex).toBeLessThan(assignmentLookupIndex);
    expect(statements.some((sql) => /FOR UPDATE/iu.test(sql))).toBe(true);
    expect(statements.some((sql) => sql.includes("INSERT INTO student_learning_task_assignments"))).toBe(true);
    const insertIndex = statements.findIndex((sql) => sql.includes("INSERT INTO student_learning_task_assignments"));
    const commitIndex = statements.lastIndexOf("COMMIT");
    expect(insertIndex).toBeGreaterThan(-1);
    expect(commitIndex).toBeGreaterThan(insertIndex);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("rejects completion when no post-activation evidence exists", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("task_id = $2")) {
          return result([{
            assignment_id: "assignment_1", task_id: "live_practice_ds_c01",
            task_type: "choice_practice", status: "pending", activated_at: "2026-08-13T08:00:00.000Z",
            course_id: "course_408_ds", concept_id: "ds_c01", mistake_id: null,
          }]);
        }
        if (sql.includes("FROM learning_evidence")) return result([]);
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query(sql: string) {
        if (sql.includes("course_reading_progress progress") || sql.includes("practice_attempts attempt")) return result([]);
        if (sql.includes("student_learning_task_assignments")) return result([]);
        if (sql.includes("course_catalog_entries catalog")) return result([
          { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
          { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
          { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
          { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
        ]);
        return result([]);
      },
      async connect() { return client; },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      { async getLearningRecord() { return learningRecord(); }, async listMistakes() { return { items: [] }; } } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    await expect(service.completeTask(userId, "live_practice_ds_c01"))
      .rejects.toMatchObject({ code: "LEARNING_TASK_EVIDENCE_MISSING", statusCode: 409 });
    expect(statements.some((sql) => /UPDATE\s+student_learning_task_assignments/iu.test(sql))).toBe(false);
    expect(statements.at(-1)).toBe("ROLLBACK");
  });

  it("completes a choice task once and only updates a pending assignment", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(sql);
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("task_id = $2")) {
          return result([{
            assignment_id: "assignment_1", task_id: "live_practice_ds_c01",
            task_type: "choice_practice", status: "pending", activated_at: "2026-08-13T08:00:00.000Z",
            course_id: "course_408_ds", concept_id: "ds_c01", mistake_id: null,
          }]);
        }
        if (sql.includes("FROM learning_evidence")) return result([{
          evidence_id: "evidence_1", attempt_id: "attempt_1", evaluation_id: "eval_1",
          question_id: "question_1", created_at: "2026-08-13T08:03:00.000Z", outcome: "correct",
        }]);
        if (sql.includes("completion_settlement =")) {
          return result([{ completion_settlement: JSON.parse(String(parameters?.[2])) }]);
        }
        if (sql.includes("UPDATE student_learning_task_assignments")) return result([{ completed_at: "2026-08-13T08:04:00.000Z" }]);
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("status = 'pending'")) return result([{ task_id: "live_read_co_c01" }]);
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query(sql: string) {
        if (sql.includes("course_reading_progress progress") || sql.includes("practice_attempts attempt")) return result([]);
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("status = 'pending'")) {
          return result([{
            task_id: "live_read_co_c01",
            task_type: "course_reading",
            status: "pending",
            activated_at: "2026-08-13T08:05:00.000Z",
            course_id: "course_408_co",
            concept_id: "co_c01",
            mistake_id: null,
          }]);
        }
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("course_catalog_entries catalog")) return result([
          { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
          { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
          { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
          { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
        ]);
        return result([]);
      },
      async connect() { return client; },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      { async getLearningRecord() { return learningRecord(); }, async listMistakes() { return { items: [] }; } } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );
    const completion = await service.completeTask(userId, "live_practice_ds_c01");
    expect(completion).toMatchObject({ task_id: "live_practice_ds_c01", idempotent: false, next_task_id: "live_read_co_c01" });
    expect(completion.settlement).toMatchObject({
      version: "challenge_settlement_v1",
      outcome: "correct",
      result_detail: "本次选择题已完成判分。",
      evidence_update: { added_count: 1, summary: "新增 1 次选择题作答。" },
      profile_update: { kind: "practice_correct" },
      review_update: { status: "not_required" },
      next_task: { task_id: "live_read_co_c01" },
    });
    const update = statements.find((sql) => sql.includes("UPDATE student_learning_task_assignments")) ?? "";
    expect(update).toContain("WHERE assignment_id = $1 AND user_id = $2 AND status = 'pending'");
    expect(statements.some((sql) => sql.includes("UPDATE student_learning_plan_tasks"))).toBe(true);
    expect(statements.some((sql) => sql.includes("completion_settlement"))).toBe(true);
    expect(statements.lastIndexOf("COMMIT")).toBe(statements.length - 1);
  });

  it("creates a needs-review settlement when the first completed choice evidence is incorrect", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(sql);
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("task_id = $2")) {
          return result([{
            assignment_id: "assignment_incorrect_1",
            task_id: "live_practice_os_c01",
            task_type: "choice_practice",
            status: "pending",
            activated_at: "2026-08-13T08:00:00.000Z",
            course_id: "course_408_os",
            concept_id: "os_c01",
            mistake_id: null,
          }]);
        }
        if (sql.includes("FROM learning_evidence")) {
          return result([{
            evidence_id: "evidence_incorrect_1",
            attempt_id: "attempt_incorrect_1",
            evaluation_id: "evaluation_incorrect_1",
            question_id: "question_os_1",
            created_at: "2026-08-13T08:03:00.000Z",
            outcome: "incorrect",
          }]);
        }
        if (sql.includes("completion_settlement =")) {
          return result([{ completion_settlement: JSON.parse(String(parameters?.[2])) }]);
        }
        if (sql.includes("UPDATE student_learning_task_assignments")) {
          return result([{ completed_at: "2026-08-13T08:04:00.000Z" }]);
        }
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query(sql: string) {
        if (sql.includes("course_reading_progress progress") || sql.includes("practice_attempts attempt")) return result([]);
        if (sql.includes("FROM practice_mistakes mistake")) {
          return result([{
            mistake_id: "mistake_os_1",
            status: "needs_review",
            wrong_count: 1,
            next_review_at: "2026-08-14T08:03:00.000Z",
            consecutive_success_count: 0,
          }]);
        }
        if (sql.includes("FROM courses course")) {
          return result([{
            course_title: "操作系统",
            concept_title: "操作系统的作用",
          }]);
        }
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("status = 'pending'")) {
          return result([{
            task_id: "live_read_os_c01",
            task_type: "course_reading",
            status: "pending",
            activated_at: "2026-08-13T08:05:00.000Z",
            course_id: "course_408_os",
            concept_id: "os_c01",
            mistake_id: null,
          }]);
        }
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("course_catalog_entries catalog")) {
          return result([
            { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
            { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
            { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
            { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
          ]);
        }
        return result([]);
      },
      async connect() { return client; },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      { async getLearningRecord() { return learningRecord(); }, async listMistakes() { return { items: [] }; } } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    const completion = await service.completeTask(userId, "live_practice_os_c01");

    expect(completion).toMatchObject({
      task_id: "live_practice_os_c01",
      idempotent: false,
      next_task_id: "live_read_os_c01",
      settlement: {
        outcome: "incorrect",
        profile_update: {
          kind: "practice_review",
          title: "操作系统的作用进入待复习队列",
        },
        review_update: {
          status: "needs_review",
          mistake_id: "mistake_os_1",
          next_review_at: "2026-08-14T08:03:00.000Z",
          summary: "已加入错题复习，累计答错 1 次。",
        },
        next_task: { task_id: "live_read_os_c01" },
      },
    });
    expect(statements.some((sql) => sql.includes("completion_settlement"))).toBe(true);
    expect(statements.lastIndexOf("COMMIT")).toBe(statements.length - 1);
  });

  it("completes one due mistake-review cycle without requiring final mastery", async () => {
    const taskId = `review_mistake_ds_001_${Date.parse("2026-08-13T08:00:00.000Z")}`;
    const statements: string[] = [];
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(sql);
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("task_id = $2")) {
          return result([{
            assignment_id: "assignment_review_1",
            task_id: taskId,
            task_type: "mistake_review",
            status: "pending",
            activated_at: "2026-08-13T08:00:00.000Z",
            course_id: "course_408_ds",
            concept_id: "ds_c01",
            mistake_id: "mistake_ds_001",
          }]);
        }
        if (sql.includes("FROM learning_evidence evidence")) {
          return result([{
            evidence_id: "evidence_review_1",
            attempt_id: "attempt_review_1",
            evaluation_id: "evaluation_review_1",
            question_id: "question_ds_1",
            created_at: "2026-08-13T08:03:00.000Z",
            outcome: "correct",
          }]);
        }
        if (sql.includes("completion_settlement =")) {
          return result([{ completion_settlement: JSON.parse(String(parameters?.[2])) }]);
        }
        if (sql.includes("UPDATE student_learning_task_assignments")) {
          return result([{ completed_at: "2026-08-13T08:04:00.000Z" }]);
        }
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query(sql: string) {
        if (sql.includes("course_reading_progress progress") || sql.includes("practice_attempts attempt")) return result([]);
        if (sql.includes("FROM courses course")) {
          return result([{ course_title: "数据结构", concept_title: "算法复杂度" }]);
        }
        if (sql.includes("FROM practice_mistakes mistake")) {
          return result([{
            mistake_id: "mistake_ds_001",
            status: "needs_review",
            wrong_count: 1,
            next_review_at: "2026-08-16T08:03:00.000Z",
            consecutive_success_count: 1,
          }]);
        }
        if (sql.includes("FROM student_learning_task_assignments")) return result([]);
        if (sql.includes("course_catalog_entries catalog")) return result([
          { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
          { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
          { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
          { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
        ]);
        return result([]);
      },
      async connect() { return client; },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      {
        async getLearningRecord() { return learningRecord(); },
        async listMistakes() { return { items: [] }; },
      } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    const completion = await service.completeTask(userId, taskId);

    expect(completion).toMatchObject({
      task_id: taskId,
      idempotent: false,
      settlement: {
        outcome: "completed",
        profile_update: { kind: "review_progress" },
        review_update: {
          status: "in_progress",
          mistake_id: "mistake_ds_001",
          next_review_at: "2026-08-16T08:03:00.000Z",
        },
      },
    });
    const evidenceStatement = statements.find((sql) => sql.includes("FROM learning_evidence evidence")) ?? "";
    expect(evidenceStatement).toContain("review.last_processed_attempt_id = evidence.attempt_id");
    expect(evidenceStatement).not.toContain("status = 'mastered'");
  });

  it("returns the persisted settlement unchanged for an idempotent completion", async () => {
    const persistedSettlement = {
      version: "challenge_settlement_v1",
      task_type: "choice_practice",
      course_id: "course_408_ds",
      course_title: "数据结构",
      concept_id: "ds_c01",
      concept_title: "算法复杂度",
      outcome: "incorrect",
      result_title: "本关已完成",
      result_detail: "本次选择题已完成判分。",
      evidence_update: {
        added_count: 1,
        objective_total: 2,
        summary: "新增 1 次选择题作答。",
      },
      profile_update: {
        kind: "practice_review",
        title: "算法复杂度进入待复习队列",
        detail: "本次错误作答已形成复习信号，后续任务会优先安排相关复习。",
      },
      review_update: {
        status: "needs_review",
        mistake_id: "mistake_001",
        next_review_at: "2026-08-14T08:03:00.000Z",
        summary: "已加入错题复习，累计答错 1 次。",
      },
      plan_progress: {
        tracked: false,
        completed_task_count: 0,
        total_task_count: 0,
        completion_percent: 0,
      },
      next_task: null,
    } as const;
    const statements: string[] = [];
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(sql);
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("task_id = $2")) {
          return result([{
            assignment_id: "assignment_1",
            task_id: "live_practice_ds_c01",
            task_type: "choice_practice",
            status: "completed",
            activated_at: "2026-08-13T08:00:00.000Z",
            completed_at: "2026-08-13T08:04:00.000Z",
            course_id: "course_408_ds",
            concept_id: "ds_c01",
            mistake_id: null,
            completion_evidence_refs: ["evidence:evidence_1", "attempt:attempt_1", "evaluation:eval_1"],
            completion_settlement: persistedSettlement,
          }]);
        }
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query() { throw new Error("persisted settlements must not be recomputed"); },
      async connect() { return client; },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { throw new Error("not used"); } } as unknown as StudentOnboardingService,
      { async getLearningRecord() { throw new Error("not used"); } } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    const completion = await service.completeTask(userId, "live_practice_ds_c01");

    expect(completion).toMatchObject({
      task_id: "live_practice_ds_c01",
      idempotent: true,
      next_task_id: null,
      settlement: persistedSettlement,
    });
    expect(statements).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
  });

  it("allows a course-wide fallback practice task to use evidence without a concept link", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(sql);
        if (sql.includes("FROM student_learning_task_assignments") && sql.includes("task_id = $2")) {
          return result([{
            assignment_id: "assignment_fallback_1", task_id: "live_practice_os_c01_01",
            task_type: "choice_practice", status: "pending", activated_at: "2026-08-13T08:00:00.000Z",
            course_id: "course_408_os", concept_id: "os_c01_01", mistake_id: null,
          }]);
        }
        if (sql.includes("FROM learning_evidence")) return result([{
          evidence_id: "evidence_fallback_1", attempt_id: "attempt_fallback_1", evaluation_id: "evaluation_fallback_1",
          question_id: "question_fallback_1", outcome: "correct", created_at: "2026-08-13T08:03:00.000Z",
          attributed_concept_id: null, has_concept_links: false,
        }]);
        if (sql.includes("completion_settlement =")) {
          return result([{ completion_settlement: JSON.parse(String(parameters?.[2])) }]);
        }
        if (sql.includes("UPDATE student_learning_task_assignments")) return result([{ completed_at: "2026-08-13T08:04:00.000Z" }]);
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query(sql: string) {
        if (sql.includes("course_reading_progress progress") || sql.includes("practice_attempts attempt")) return result([]);
        if (sql.includes("FROM courses course")) {
          return result([{ course_title: "操作系统", concept_title: "进程与线程" }]);
        }
        if (sql.includes("student_learning_task_assignments") && sql.includes("status = 'pending'")) return result([]);
        if (sql.includes("student_learning_task_assignments")) return result([]);
        if (sql.includes("course_catalog_entries catalog")) return result([
          { course_id: "course_408_ds", course_title: "数据结构", course_slug: "data-structures", question_subject: "数据结构" },
          { course_id: "course_408_co", course_title: "计算机组成原理", course_slug: "computer-organization", question_subject: "组成原理" },
          { course_id: "course_408_os", course_title: "操作系统", course_slug: "operating-systems", question_subject: "操作系统" },
          { course_id: "course_408_cn", course_title: "计算机网络", course_slug: "computer-networks", question_subject: "计算机网络" },
        ]);
        return result([]);
      },
      async connect() { return client; },
    } as SqlQueryablePool;
    const service = new PostgresStudentLearningOrchestration(
      pool,
      { async getState() { return onboardingState(); } } as unknown as StudentOnboardingService,
      { async getLearningRecord() { return learningRecord(); }, async listMistakes() { return { items: [] }; } } as unknown as ReliableLearningLoopService,
      { now: () => now },
    );

    const completion = await service.completeTask(userId, "live_practice_os_c01_01");
    expect(completion).toMatchObject({
      task_id: "live_practice_os_c01_01",
      idempotent: false,
      settlement: {
        concept_id: null,
        concept_title: null,
        profile_update: {
          kind: "practice_correct",
          title: "操作系统新增一次正确作答",
        },
      },
    });
    const evidenceQuery = statements.find((sql) => sql.includes("FROM learning_evidence")) ?? "";
    expect(evidenceQuery).toContain("NOT EXISTS");
  });
});
