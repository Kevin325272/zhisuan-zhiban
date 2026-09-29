import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { readStudentCareConfig } from "../src/config/student-care.js";
import type { SqlQueryablePool } from "../src/database/client.js";
import { loadMigrations, runMigrations } from "../src/database/migrate.js";
import type { StudentLearningOrchestrationService } from "../src/services/orchestration/learning-orchestration-service.js";
import { PostgresStudentCareRepository } from "../src/services/student-care/postgres-student-care.js";
import { DeterministicStudentCareService } from "../src/services/student-care/student-care-service.js";

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim() ?? "";
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const config = readStudentCareConfig({ STUDENT_CARE_ENABLED: "true" });
const schemaName = `xuetu_care_it_${process.pid}_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;

function assertSafeSchemaName(value: string) {
  if (!/^xuetu_care_it_[a-z0-9_]+$/u.test(value)) {
    throw new Error("Unsafe PostgreSQL integration-test schema name.");
  }
}

function orchestration(): StudentLearningOrchestrationService {
  return {
    async getSnapshot() {
      return {
        current_task: {
          task_id: "task_current_reading",
          task_type: "course_reading",
          course_id: "course_408_ds",
          course_title: "数据结构",
          concept_id: null,
          concept_title: null,
          title: "继续数据结构课程阅读",
          estimated_minutes: 20,
          href: "/student/courses/data-structures",
          practice_question_count: 0,
        },
      };
    },
    async activateTask() { throw new Error("not used"); },
    async completeTask() { throw new Error("not used"); },
  } as unknown as StudentLearningOrchestrationService;
}

async function seedStudent(pool: Pool, userId: string) {
  await pool.query(
    `INSERT INTO users(user_id, display_name, account_status, auth_source)
     VALUES ($1, $2, 'active', 'local_development')`,
    [userId, userId],
  );
  await pool.query(
    `INSERT INTO course_memberships(course_id, user_id, membership_role, status)
     VALUES ('course_408_ds', $1, 'student', 'active')`,
    [userId],
  );
  for (const [index, completedAt] of [
    "2026-08-02T04:00:00.000Z",
    "2026-08-03T04:00:00.000Z",
    "2026-08-04T04:00:00.000Z",
    "2026-08-05T04:00:00.000Z",
    "2026-08-06T04:00:00.000Z",
    "2026-08-07T04:00:00.000Z",
  ].entries()) {
    await pool.query(
      `INSERT INTO student_learning_task_assignments(
         assignment_id, user_id, task_id, course_id, task_type, status,
         activated_at, completed_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'course_408_ds', 'course_reading', 'completed',
         $4::timestamptz - interval '30 minutes', $4, $4, $4)`,
      [`assignment_${userId}_${index}`, userId, `completed_task_${index}`, completedAt],
    );
  }
  await pool.query(
    `INSERT INTO student_learning_task_assignments(
       assignment_id, user_id, task_id, course_id, task_type, status, activated_at
     ) VALUES ($1, $2, 'task_current_reading', 'course_408_ds', 'course_reading',
       'pending', '2026-08-20T08:00:00.000Z')`,
    [`assignment_${userId}_pending`, userId],
  );
}

describeWithPostgres("student-care real PostgreSQL lifecycle", () => {
  let adminPool: Pool | null = null;
  let testPool: Pool | null = null;
  let repository: PostgresStudentCareRepository;
  let schemaCreated = false;

  beforeAll(async () => {
    assertSafeSchemaName(schemaName);
    adminPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: "xuetu-care-integration-admin",
    });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    testPool = new Pool({
      connectionString: databaseUrl,
      max: 16,
      application_name: "xuetu-care-integration",
      options: `-c search_path=${schemaName} -c statement_timeout=15000`,
    });
    await runMigrations(testPool as unknown as SqlQueryablePool, loadMigrations());
    await testPool.query(
      `INSERT INTO users(user_id, display_name, account_status, auth_source)
       VALUES ('care_test_admin', 'Care test admin', 'active', 'local_development')`,
    );
    await testPool.query(
      `INSERT INTO courses(course_id, course_code, title, discipline, status, created_by)
       VALUES ('course_408_ds', 'CARE-DS', '数据结构', '计算机科学与技术', 'active', 'care_test_admin')`,
    );
    await seedStudent(testPool, "care_student_concurrent");
    await seedStudent(testPool, "care_student_midnight");
    await seedStudent(testPool, "care_student_expiry");
    repository = new PostgresStudentCareRepository(testPool as unknown as SqlQueryablePool);
  }, 60_000);

  afterAll(async () => {
    await testPool?.end();
    if (adminPool && schemaCreated) {
      assertSafeSchemaName(schemaName);
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    }
    await adminPool?.end();
  }, 30_000);

  it("deduplicates concurrent invitation refreshes and serializes competing responses", async () => {
    const now = new Date("2026-08-21T08:00:00.000Z");
    const service = new DeterministicStudentCareService(
      repository,
      orchestration(),
      config,
      () => now,
    );

    const concurrentStatuses = await Promise.all(
      Array.from({ length: 8 }, () => service.getStatus("care_student_concurrent")),
    );
    expect(concurrentStatuses.every((status) => status.kind === "invitation")).toBe(true);
    const invitationIds = concurrentStatuses.flatMap((status) =>
      status.kind === "invitation" ? [status.interaction_id] : []
    );
    expect(new Set(invitationIds).size).toBe(1);
    const interactionId = invitationIds[0]!;

    await expect(service.getStatus("care_student_concurrent")).resolves.toMatchObject({
      kind: "invitation",
      interaction_id: interactionId,
    });
    const beforeResponse = await testPool!.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM student_care_interactions
       WHERE user_id = $1`,
      ["care_student_concurrent"],
    );
    expect(beforeResponse.rows[0]?.count).toBe("1");

    const competing = await Promise.allSettled([
      service.respond("care_student_concurrent", interactionId, "continue"),
      service.respond("care_student_concurrent", interactionId, "dismiss"),
    ]);
    const winner = competing.find((result) => result.status === "fulfilled");
    const loser = competing.find((result) => result.status === "rejected");
    expect(winner?.status).toBe("fulfilled");
    expect(loser).toMatchObject({
      status: "rejected",
      reason: { code: "CARE_INTERACTION_ALREADY_RESPONDED", statusCode: 409 },
    });
    if (!winner || winner.status !== "fulfilled") throw new Error("Missing winning response.");

    await expect(service.respond(
      "care_student_concurrent",
      interactionId,
      winner.value.action,
    )).resolves.toMatchObject({ idempotent: true, action: winner.value.action });
    await expect(service.getStatus("care_student_concurrent")).resolves.toEqual({
      kind: "none",
      preference_enabled: true,
    });
    const persisted = await testPool!.query<{
      status: string;
      response: string;
      cooldown_until: Date;
    }>(
      `SELECT status, response, cooldown_until
       FROM student_care_interactions
       WHERE interaction_id = $1`,
      [interactionId],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: "responded",
      response: winner.value.action,
      cooldown_until: expect.any(Date),
    });
  }, 30_000);

  it("expires a light session at Shanghai midnight and rejects a 24-hour-late response", async () => {
    let now = new Date("2026-08-20T15:59:58.000Z");
    const midnightService = new DeterministicStudentCareService(
      repository,
      orchestration(),
      config,
      () => now,
    );
    const invitation = await midnightService.getStatus("care_student_midnight");
    if (invitation.kind !== "invitation") throw new Error("Expected a care invitation.");

    await expect(midnightService.respond(
      "care_student_midnight",
      invitation.interaction_id,
      "lighten",
    )).resolves.toMatchObject({
      status: {
        kind: "light_session",
        expires_at: "2026-08-20T15:59:59.999Z",
      },
    });
    await expect(midnightService.getStatus("care_student_midnight")).resolves.toMatchObject({
      kind: "light_session",
      interaction_id: invitation.interaction_id,
    });

    now = new Date("2026-08-20T16:00:00.000Z");
    await expect(midnightService.getStatus("care_student_midnight")).resolves.toEqual({
      kind: "none",
      preference_enabled: true,
    });

    const presentedAt = new Date("2026-08-20T15:59:59.000Z");
    const expiresAt = new Date(presentedAt.getTime() + 24 * 60 * 60 * 1_000);
    const expiring = await repository.createInvitation(
      "care_student_expiry",
      {
        signalCode: "rhythm_drop",
        reasonSummary: "最近一周完成学习任务的天数比你前两周的节奏少。",
        evidenceSummary: { baseline_completed_day_count: 6, recent_completed_day_count: 0 },
      },
      { ruleVersion: "student_care_v1", presentedAt, expiresAt },
    );
    now = expiresAt;
    const expiryService = new DeterministicStudentCareService(
      repository,
      orchestration(),
      config,
      () => now,
    );
    await expect(expiryService.respond(
      "care_student_expiry",
      expiring.interactionId,
      "continue",
    )).rejects.toMatchObject({
      code: "CARE_INTERACTION_EXPIRED",
      statusCode: 409,
    });
    await expect(repository.findInteraction(
      "care_student_expiry",
      expiring.interactionId,
    )).resolves.toMatchObject({ status: "expired", response: null });
  }, 30_000);
});
