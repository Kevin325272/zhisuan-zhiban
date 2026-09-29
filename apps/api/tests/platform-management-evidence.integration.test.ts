import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type { SqlQueryablePool } from "../src/database/client.js";
import { PostgresManagementService } from "../src/services/platform-management.js";

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim() ?? "";
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres("PostgresManagementService course evidence SQL", () => {
  const postgresPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: "xuetu-management-evidence-integration",
  });

  afterAll(async () => {
    await postgresPool.end();
  });

  it("lets PostgreSQL plan the weak-concept aggregation query", async () => {
    let plannedWeakConceptQuery = false;
    const pool = {
      async connect() {
        throw new Error("getCourseEvidence uses the queryable pool directly");
      },
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters: readonly unknown[] = [],
      ) {
        if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
          return {
            rowCount: 1,
            rows: [{ active_student_count: 0, includes_synthetic_demo: false }] as Row[],
          };
        }
        if (sql.includes("WITH snapshot_policy")) {
          await postgresPool.query(`EXPLAIN ${sql}`, [...parameters]);
          plannedWeakConceptQuery = true;
          return { rowCount: 0, rows: [] as Row[] };
        }
        if (sql.includes("FROM teacher_interventions")) {
          return { rowCount: 0, rows: [] as Row[] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as SqlQueryablePool;

    await expect(
      new PostgresManagementService(pool).getCourseEvidence("course_408_ds", {
        viewerUserId: "user_admin_001",
        viewerRole: "admin",
      }),
    ).resolves.toMatchObject({ course_id: "course_408_ds" });
    expect(plannedWeakConceptQuery).toBe(true);
  });

  it("executes the complete course-evidence aggregation against PostgreSQL", async () => {
    const [adminResult, courseResult] = await Promise.all([
      postgresPool.query<{ user_id: string }>(
        "SELECT user_id FROM user_roles WHERE role_key = 'admin' ORDER BY user_id LIMIT 1",
      ),
      postgresPool.query<{ course_id: string }>(
        "SELECT course_id FROM courses WHERE course_code = 'CS408-DS' ORDER BY course_id LIMIT 1",
      ),
    ]);
    const adminUserId = adminResult.rows[0]?.user_id;
    const courseId = courseResult.rows[0]?.course_id;
    if (!adminUserId || !courseId) throw new Error("Integration database lacks an admin or CS408-DS course.");

    const evidence = await new PostgresManagementService(postgresPool).getCourseEvidence(courseId, {
      viewerUserId: adminUserId,
      viewerRole: "admin",
    });

    expect(evidence.course_id).toBe(courseId);
    expect(evidence.sample?.minimum_students).toBe(5);
    expect(evidence.source_breakdown).toBeDefined();
    for (const metric of Object.values(evidence.source_breakdown ?? {})) {
      expect(metric.incorrect_count).toBeLessThanOrEqual(metric.valid_attempt_count);
    }
  });

  it("lets PostgreSQL plan the intervention completion evidence query", async () => {
    const [adminResult, conceptResult] = await Promise.all([
      postgresPool.query<{ user_id: string }>(
        "SELECT user_id FROM user_roles WHERE role_key = 'admin' ORDER BY user_id LIMIT 1",
      ),
      postgresPool.query<{ course_id: string; concept_id: string; title: string }>(
        `SELECT concept.course_id, concept.concept_id, concept.title
           FROM course_core_concepts concept
           JOIN courses course ON course.course_id = concept.course_id
          WHERE course.course_code = 'CS408-DS'
          ORDER BY concept.concept_id
          LIMIT 1`,
      ),
    ]);
    const adminUserId = adminResult.rows[0]?.user_id;
    const concept = conceptResult.rows[0];
    if (!adminUserId || !concept) {
      throw new Error("Integration database lacks an admin or a CS408-DS concept.");
    }

    let plannedCompletionQuery = false;
    const completedAt = "2026-08-29T03:00:00.000Z";
    const pool = {
      async connect() {
        return {
          async query<Row = Record<string, unknown>>(
            sql: string,
            parameters: readonly unknown[] = [],
          ) {
            if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
              return { rowCount: 0, rows: [] as Row[] };
            }
            if (sql.includes("FROM teacher_interventions") && sql.includes("FOR UPDATE")) {
              return {
                rowCount: 1,
                rows: [{
                  intervention_id: "integration_intervention",
                  course_id: concept.course_id,
                  concept_id: concept.concept_id,
                  concept_title: concept.title,
                  actor_user_id: adminUserId,
                  target_type: "concept",
                  target_class_id: null,
                  target_user_id: null,
                  material_ref: null,
                  due_at: null,
                  status: "sent",
                  delivered_at: "2026-08-01T00:00:00.000Z",
                  completed_at: null,
                  evidence_snapshot: null,
                  action: "assign_review",
                  note: "集成查询规划验证",
                  created_at: "2026-08-01T00:00:00.000Z",
                }] as Row[],
              };
            }
            if (sql.includes("WITH scoped_evidence") && sql.includes("valid_evidence_count")) {
              await postgresPool.query(`EXPLAIN ${sql}`, [...parameters]);
              plannedCompletionQuery = true;
              return {
                rowCount: 1,
                rows: [{
                  valid_evidence_count: 1,
                  correct_count: 1,
                  incorrect_count: 0,
                  real_trial_count: 1,
                  synthetic_verification_count: 0,
                  local_demo_count: 0,
                  last_evidence_at: "2026-08-29T02:59:00.000Z",
                }] as Row[],
              };
            }
            if (sql.includes("UPDATE teacher_interventions")) {
              return {
                rowCount: 1,
                rows: [{
                  intervention_id: "integration_intervention",
                  course_id: concept.course_id,
                  concept_id: concept.concept_id,
                  target_type: "concept",
                  target_class_id: null,
                  target_user_id: null,
                  material_ref: null,
                  due_at: null,
                  status: "completed",
                  delivered_at: "2026-08-01T00:00:00.000Z",
                  completed_at: completedAt,
                  evidence_snapshot: JSON.parse(String(parameters[5])),
                  action: "assign_review",
                  note: "集成查询规划验证",
                  created_at: "2026-08-01T00:00:00.000Z",
                }] as Row[],
              };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          },
          release() {},
        };
      },
      async query() {
        throw new Error("intervention lifecycle uses a transaction client");
      },
    } as unknown as SqlQueryablePool;

    const updated = await new PostgresManagementService(
      pool,
      () => new Date(completedAt),
    ).updateTeacherInterventionStatus(
      concept.course_id,
      "integration_intervention",
      { viewerUserId: adminUserId, viewerRole: "admin" },
      { status: "completed" },
    );

    expect(plannedCompletionQuery).toBe(true);
    expect(updated.evidence_snapshot).toMatchObject({
      source_breakdown: {
        real_trial: 1,
        synthetic_verification: 0,
        local_demo: 0,
      },
    });
  });

  it("completes and snapshots a temporary intervention from real stored evidence", async () => {
    const [adminResult, candidateResult] = await Promise.all([
      postgresPool.query<{ user_id: string }>(
        "SELECT user_id FROM user_roles WHERE role_key = 'admin' ORDER BY user_id LIMIT 1",
      ),
      postgresPool.query<{
        user_id: string;
        course_id: string;
        concept_id: string;
        evidence_at: Date;
      }>(
        `SELECT evidence.user_id, concept.course_id, evidence.concept_id,
                evidence.created_at AS evidence_at
           FROM learning_evidence evidence
           JOIN evaluations evaluation ON evaluation.evaluation_id = evidence.evaluation_id
           JOIN practice_attempts attempt ON attempt.attempt_id = evaluation.attempt_id
           JOIN questions question ON question.question_id = evidence.question_id
           JOIN users account
             ON account.user_id = evidence.user_id
            AND account.account_status = 'active'
           JOIN course_memberships membership
             ON membership.user_id = evidence.user_id
            AND membership.membership_role = 'student'
            AND membership.status = 'active'
           JOIN course_core_concepts concept
             ON concept.concept_id = evidence.concept_id
            AND concept.course_id = membership.course_id
           JOIN course_concept_question_links concept_link
             ON concept_link.concept_id = evidence.concept_id
            AND concept_link.question_id = evidence.question_id
            AND concept_link.status = 'active'
          WHERE evidence.attempt_id = attempt.attempt_id
            AND evidence.user_id = attempt.user_id
            AND evidence.question_id = attempt.question_id
            AND attempt.concept_id = evidence.concept_id
            AND evaluation.grading_mode = 'deterministic_choice'
            AND evidence.grading_mode = 'deterministic_choice'
            AND evidence.eligible_for_learning_state_update = true
            AND evaluation.status IN ('correct', 'incorrect')
            AND evidence.outcome = evaluation.status
            AND (
              attempt.course_id = concept.course_id
              OR (
                attempt.course_id = 'course_408_001'
                AND EXISTS (
                  SELECT 1
                    FROM course_catalog_entries catalog
                   WHERE catalog.course_id = concept.course_id
                     AND catalog.question_subject = question.subject
                )
              )
            )
          ORDER BY evidence.created_at DESC
          LIMIT 1`,
      ),
    ]);
    const adminUserId = adminResult.rows[0]?.user_id;
    const candidate = candidateResult.rows[0];
    if (!adminUserId || !candidate) {
      throw new Error("Integration database lacks an admin or eligible deterministic evidence.");
    }

    const interventionId = `integration_intervention_${randomUUID()}`;
    const deliveredAt = new Date(candidate.evidence_at.getTime() - 1_000);
    const completedAt = new Date(candidate.evidence_at.getTime() + 1_000);
    try {
      await postgresPool.query(
        `INSERT INTO teacher_interventions(
           intervention_id, course_id, concept_id, actor_user_id, action, note,
           target_type, target_class_id, target_user_id, material_ref, due_at,
           status, delivered_at, completed_at, evidence_snapshot, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'assign_review',$5,'student',NULL,$6,NULL,NULL,
                   'sent',$7,NULL,NULL,$7,$7)`,
        [
          interventionId,
          candidate.course_id,
          candidate.concept_id,
          adminUserId,
          "真实 PostgreSQL 干预完成集成验证",
          candidate.user_id,
          deliveredAt,
        ],
      );

      const updated = await new PostgresManagementService(
        postgresPool,
        () => completedAt,
      ).updateTeacherInterventionStatus(
        candidate.course_id,
        interventionId,
        { viewerUserId: adminUserId, viewerRole: "admin" },
        { status: "completed" },
      );

      expect(updated.status).toBe("completed");
      const snapshot = updated.evidence_snapshot ?? {};
      expect(Number(snapshot.valid_evidence_count)).toBeGreaterThan(0);
      const sources = snapshot.source_breakdown as {
        real_trial: number;
        synthetic_verification: number;
        local_demo: number;
      };
      expect(sources.real_trial + sources.synthetic_verification + sources.local_demo)
        .toBe(snapshot.valid_evidence_count);

      const persisted = await postgresPool.query<{
        status: string;
        evidence_snapshot: Record<string, unknown>;
      }>(
        `SELECT status, evidence_snapshot
           FROM teacher_interventions
          WHERE intervention_id = $1`,
        [interventionId],
      );
      expect(persisted.rows[0]).toMatchObject({
        status: "completed",
        evidence_snapshot: snapshot,
      });
    } finally {
      await postgresPool.query(
        "DELETE FROM teacher_interventions WHERE intervention_id = $1",
        [interventionId],
      );
    }
  });
});
