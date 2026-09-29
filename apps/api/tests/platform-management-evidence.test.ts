import { describe, expect, it } from "vitest";

import type { SqlQueryablePool } from "../src/database/client.js";
import {
  ManagementConflictError,
  ManagementResourceNotFoundError,
  PostgresManagementService,
} from "../src/services/platform-management.js";

function poolFor(
  handler: (sql: string, parameters: readonly unknown[]) => { rows: unknown[]; rowCount: number },
  transactional = false,
) {
  return {
    async connect() {
      if (!transactional) throw new Error("management evidence uses the queryable pool directly");
      return {
        query: async <Row = Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) =>
          handler(sql, parameters) as { rows: Row[]; rowCount: number },
        release() {},
      };
    },
    async query<Row = Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) {
      return handler(sql, parameters) as { rows: Row[]; rowCount: number };
    },
  } as unknown as SqlQueryablePool;
}

describe("PostgresManagementService course evidence", () => {
  it("applies a bounded window and exposes denominators and source groups", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = poolFor((sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{
            active_student_count: "6",
            valid_attempt_student_count: "5",
            includes_synthetic_demo: false,
            real_trial_student_count: "5",
            synthetic_verification_student_count: "0",
            local_demo_student_count: "0",
          }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) {
        return {
          rowCount: 1,
          rows: [{
            concept_id: "co_c01_01",
            concept_title: "指令执行流程",
            attempt_count: "8",
            valid_attempt_count: "8",
            incorrect_count: "4",
            incorrect_student_count: "3",
            error_rate: "50",
            pending_review_count: "1",
            probe_participant_count: "2",
            probe_correct_count: "1",
            probe_incorrect_count: "1",
            student_count: "5",
            last_activity_at: new Date("2026-08-24T09:00:00.000Z"),
          }],
        };
      }
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const evidence = await (new PostgresManagementService(pool).getCourseEvidence as unknown as Function)(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      {
        days: 7,
        start_at: "2026-08-18T00:00:00.000Z",
        end_at: "2026-08-25T00:00:00.000Z",
      },
    );

    expect(evidence.window).toEqual({
      start_at: "2026-08-18T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
      days: 7,
    });
    expect(evidence.sample).toMatchObject({
      minimum_students: 5,
      active_student_count: 6,
      valid_attempt_student_count: 5,
      sufficient: true,
    });
    expect(evidence.source_breakdown.real_trial.student_count).toBe(5);
    expect(evidence.top_weak_concepts[0]).toMatchObject({
      valid_attempt_count: 8,
      incorrect_student_count: 3,
      error_rate: 50,
      probe_participant_count: 2,
    });
    const courseCall = calls.find((call) => call.sql.includes("COUNT(DISTINCT cm.user_id)"));
    expect(courseCall?.parameters).toContain("2026-08-18T00:00:00.000Z");
    expect(courseCall?.parameters).toContain("2026-08-25T00:00:00.000Z");
    expect(courseCall?.sql).toContain("submitted_at >= $5");
    expect(courseCall?.sql).toContain("submitted_at < $6");
    expect(courseCall?.sql).toContain("WHERE EXISTS (SELECT 1 FROM courses");
  });

  it("derives the displayed day count from explicit window boundaries", async () => {
    const pool = poolFor((sql, parameters) => {
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{ active_student_count: "0", valid_attempt_student_count: "0" }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const evidence = await (new PostgresManagementService(pool).getCourseEvidence as unknown as Function)(
      "course_408_co",
      { viewerUserId: "user_admin_001", viewerRole: "admin" },
      {
        start_at: "2026-08-18T00:00:00.000Z",
        end_at: "2026-08-25T00:00:00.000Z",
      },
    );

    expect(evidence.window.days).toBe(7);
  });

  it("rejects an evidence window longer than 90 days even when only start_at is supplied", async () => {
    const pool = poolFor((sql) => {
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{ active_student_count: "0", valid_attempt_student_count: "0" }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresManagementService(
      pool,
      () => new Date("2026-08-25T00:00:00.000Z"),
    );

    await expect((service.getCourseEvidence as unknown as Function)(
      "course_408_co",
      { viewerUserId: "user_admin_001", viewerRole: "admin" },
      { start_at: "2026-01-01T00:00:00.000Z" },
    )).rejects.toBeInstanceOf(ManagementConflictError);
  });

  it("uses the exact reported default window in PostgreSQL instead of the database clock", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = poolFor((sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{ active_student_count: "0", valid_attempt_student_count: "0" }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresManagementService(
      pool,
      () => new Date("2026-08-25T00:00:00.000Z"),
    );

    const evidence = await service.getCourseEvidence("course_408_co", {
      viewerUserId: "user_admin_001",
      viewerRole: "admin",
    });
    const aggregateCall = calls.find((call) => call.sql.includes("COUNT(DISTINCT cm.user_id)"));

    expect(evidence.window).toMatchObject({
      start_at: "2026-08-11T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
      days: 14,
    });
    expect(aggregateCall?.parameters).toContain("2026-08-11T00:00:00.000Z");
    expect(aggregateCall?.parameters).toContain("2026-08-25T00:00:00.000Z");
    expect(aggregateCall?.sql).not.toContain("CURRENT_TIMESTAMP");
  });

  it("hides common weak concepts when the valid student sample is below k=5", async () => {
    const pool = poolFor((sql) => {
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{
            active_student_count: "4",
            valid_attempt_student_count: "4",
            includes_synthetic_demo: false,
          }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) {
        return {
          rowCount: 1,
          rows: [{
            concept_id: "co_c01_01",
            concept_title: "指令执行流程",
            attempt_count: "8",
            incorrect_count: "8",
            pending_review_count: "0",
            student_count: "4",
            last_activity_at: new Date("2026-08-24T09:00:00.000Z"),
          }],
        };
      }
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const evidence = await new PostgresManagementService(pool).getCourseEvidence(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
    );

    expect(evidence.top_weak_concepts).toEqual([]);
    expect(evidence.evidence_status).toBe("insufficient_sample");
    expect(evidence.sample?.sufficient).toBe(false);
  });

  it("does not bypass the sample gate when the denominator is absent", async () => {
    const pool = poolFor((sql) => {
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return { rowCount: 1, rows: [{ active_student_count: "8" }] };
      }
      if (sql.includes("WITH snapshot_policy")) {
        return {
          rowCount: 1,
          rows: [{
            concept_id: "co_c01_01",
            concept_title: "指令执行流程",
            attempt_count: "8",
            incorrect_count: "5",
            pending_review_count: "0",
            student_count: "8",
            last_activity_at: new Date("2026-08-24T09:00:00.000Z"),
          }],
        };
      }
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const evidence = await new PostgresManagementService(pool).getCourseEvidence(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
    );

    expect(evidence.top_weak_concepts).toEqual([]);
    expect(evidence.evidence_status).toBe("no_valid_evidence");
  });

  it("does not expose a concept supported by fewer than five participating students", async () => {
    const pool = poolFor((sql) => {
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{ active_student_count: "8", valid_attempt_student_count: "5" }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) {
        return {
          rowCount: 1,
          rows: [{
            concept_id: "co_c01_01",
            concept_title: "指令执行流程",
            attempt_count: "8",
            incorrect_count: "5",
            pending_review_count: "0",
            student_count: "4",
            last_activity_at: new Date("2026-08-24T09:00:00.000Z"),
          }],
        };
      }
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const evidence = await new PostgresManagementService(pool).getCourseEvidence(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
    );

    expect(evidence.sample?.sufficient).toBe(true);
    expect(evidence.top_weak_concepts).toEqual([]);
  });

  it("applies real-trial scope to active-window counts as well as valid attempts", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = poolFor((sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{ active_student_count: "5", valid_attempt_student_count: "0" }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresManagementService(pool).getCourseEvidence(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      { days: 14, source_scope: "real_trial_only" },
    );

    const aggregateSql = calls.find((call) => call.sql.includes("COUNT(DISTINCT cm.user_id)"))?.sql ?? "";
    expect(aggregateSql).toContain("SELECT user_id, activity_at, data_origin FROM live_rows");
    expect(aggregateSql).toMatch(
      /COUNT\(DISTINCT user_id\)::int FROM activity_rows[\s\S]*activity_at < \$6[\s\S]*data_origin = 'real_trial'/u,
    );
  });

  it("requires eligible deterministic evidence and source tags in the weak-concept query", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{
            active_student_count: "5",
            valid_attempt_student_count: "5",
            includes_synthetic_demo: false,
          }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresManagementService(pool).getCourseEvidence("course_408_co", {
      viewerUserId: "user_teacher_001",
      viewerRole: "teacher",
    });

    const weakSql = statements.find((sql) => sql.includes("WITH snapshot_policy")) ?? "";
    expect(weakSql).toContain("eligible_for_learning_state_update = true");
    expect(weakSql).toContain("participant_kind");
    expect(weakSql).toContain("data_origin");
  });

  it("scopes learning-summary attempts to active students in the requested course", async () => {
    let summarySql = "";
    let summaryParameters: readonly unknown[] = [];
    const pool = poolFor((sql, parameters) => {
      summarySql = sql;
      summaryParameters = parameters;
      return {
        rowCount: 1,
        rows: [{
          course_id: "course_408_ds",
          active_students: "1",
          attempt_count: "2",
          deterministic_correct_count: "1",
          deterministic_incorrect_count: "1",
          pending_review_count: "0",
          evidence_count: "2",
        }],
      };
    });

    await new PostgresManagementService(pool).getLearningSummary("course_408_ds", {
      viewerUserId: "user_teacher_001",
      viewerRole: "teacher",
    });

    expect(summarySql).toMatch(
      /LEFT JOIN course_memberships attempt_member[\s\S]*attempt_member\.user_id = pa\.user_id/u,
    );
    expect(summarySql).toMatch(
      /attempt_member\.membership_role = 'student'[\s\S]*attempt_member\.status = 'active'/u,
    );
    expect(summarySql).toMatch(
      /JOIN users attempt_user[\s\S]*attempt_user\.account_status = 'active'/u,
    );
    expect(summarySql).toContain("teacher_course_class_assignments");
    expect(summarySql).toContain("viewer_assignment.teacher_user_id = $4");
    expect(summaryParameters).toEqual([
      "course_408_ds",
      "course_408_001",
      "teacher",
      "user_teacher_001",
    ]);
  });

  it("aggregates only the requested course and maps weak concepts anonymously", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = poolFor((sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{ active_student_count: "5", valid_attempt_student_count: "5" }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) {
        return {
          rowCount: 1,
          rows: [{
            concept_id: "co_c01_01",
            concept_title: "指令执行流程",
            attempt_count: "6",
            incorrect_count: "4",
            pending_review_count: "3",
            student_count: "5",
            last_activity_at: new Date("2026-08-24T09:00:00.000Z"),
          }],
        };
      }
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const evidence = await new PostgresManagementService(
      pool,
      () => new Date("2026-08-24T10:00:00.000Z"),
    ).getCourseEvidence("course_408_co", {
      viewerUserId: "user_teacher_001",
      viewerRole: "teacher",
    });

    expect(evidence).toMatchObject({
      course_id: "course_408_co",
      active_student_count: 5,
      top_weak_concepts: [{
        concept_id: "co_c01_01",
        incorrect_count: 4,
        pending_review_count: 3,
        student_count: 5,
      }],
      recent_interventions: [],
    });
    expect(calls.every((call) => call.parameters[0] === "course_408_co")).toBe(true);
    const weakConceptSql = calls.find((call) => call.sql.includes("WITH snapshot_policy"))?.sql ?? "";
    expect(weakConceptSql).toMatch(
      /JOIN course_memberships attempt_member[\s\S]*attempt_member\.user_id = pa\.user_id/u,
    );
    expect(weakConceptSql).toMatch(
      /attempt_member\.membership_role = 'student'[\s\S]*attempt_member\.status = 'active'/u,
    );
    expect(weakConceptSql).toMatch(
      /JOIN users attempt_user[\s\S]*attempt_user\.account_status = 'active'/u,
    );
    expect(weakConceptSql).toContain("teacher_course_class_assignments");
    expect(weakConceptSql).toContain("viewer_assignment.teacher_user_id = $4");
    expect(calls.find((call) => call.sql.includes("COUNT(DISTINCT cm.user_id)"))?.parameters)
      .toEqual([
        "course_408_co",
        "teacher",
        "user_teacher_001",
        "course_408_001",
        "2026-08-10T10:00:00.000Z",
        "2026-08-24T10:00:00.000Z",
      ]);
    expect(calls.find((call) => call.sql.includes("WITH snapshot_policy"))?.parameters)
      .toEqual([
        "course_408_co",
        "course_408_001",
        "teacher",
        "user_teacher_001",
        "2026-08-10T10:00:00.000Z",
        "2026-08-24T10:00:00.000Z",
      ]);
    expect(calls.find((call) => call.sql.includes("FROM teacher_interventions"))?.parameters)
      .toEqual(["course_408_co", "teacher", "user_teacher_001"]);
    expect(calls.find((call) => call.sql.includes("FROM teacher_interventions"))?.sql)
      .toContain("intervention.actor_user_id = $3");
    expect(calls.find((call) => call.sql.includes("FROM teacher_interventions"))?.sql)
      .toMatch(/intervention\.actor_user_id = \$3[\s\S]*COALESCE\(intervention\.target_type, 'concept'\) <> 'concept'/u);
    expect(JSON.stringify(evidence)).not.toContain("actor_user_id");
    expect(JSON.stringify(evidence)).not.toContain("answer_key");
  });

  it("maps shared 408 question-bank attempts to a subcourse by subject", async () => {
    const calls: string[] = [];
    const pool = poolFor((sql) => {
      calls.push(sql);
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return { rowCount: 1, rows: [{ active_student_count: "1" }] };
      }
      if (sql.includes("WITH snapshot_policy")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresManagementService(pool).getCourseEvidence("course_408_ds", {
      viewerUserId: "user_admin_001",
      viewerRole: "admin",
    });

    const weakConceptSql = calls.find((sql) => sql.includes("WITH snapshot_policy"));
    expect(weakConceptSql).toContain("question_subject");
    expect(weakConceptSql).toContain("$2");
  });

  it("selects snapshot or live weak evidence atomically for each student", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return { rowCount: 1, rows: [{ active_student_count: "1", includes_synthetic_demo: false }] };
      }
      if (sql.includes("WITH snapshot_policy")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresManagementService(pool).getCourseEvidence("course_408_ds", {
      viewerUserId: "user_admin_001",
      viewerRole: "admin",
    });

    const courseSql = statements.find((sql) => sql.includes("COUNT(DISTINCT cm.user_id)")) ?? "";
    const weakSql = statements.find((sql) => sql.includes("WITH snapshot_policy")) ?? "";
    expect(courseSql).toMatch(
      /newer_attempt\.submitted_at > snapshot\.generated_at[\s\S]*newer_evidence\.created_at > snapshot\.generated_at/u,
    );
    expect(weakSql).toMatch(
      /snapshot_policy AS[\s\S]*newer_attempt\.submitted_at > snapshot\.generated_at[\s\S]*newer_evidence\.created_at > snapshot\.generated_at/u,
    );
    expect(weakSql).toContain("COALESCE(snapshot_policy.use_snapshot, false) = false");
    expect(weakSql).toContain("snapshot_policy.use_snapshot = true");
  });

  it("returns a public class name with intervention history", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return { rowCount: 1, rows: [{ active_student_count: "0", includes_synthetic_demo: false }] };
      }
      if (sql.includes("WITH snapshot_policy")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM teacher_interventions")) {
        return {
          rowCount: 1,
          rows: [{
            intervention_id: "intervention_class_001",
            course_id: "course_408_co",
            concept_id: "co_c01_01",
            concept_title: "指令执行流程",
            action: "classroom_focus",
            note: "给软件工程2301班安排一次补讲。",
            target_type: "class",
            target_class_id: "class_se_2301",
            target_class_name: "软件工程2301班",
            target_user_id: null,
            created_at: new Date("2026-08-24T10:01:00.000Z"),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await new PostgresManagementService(pool).getCourseEvidence(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
    );

    expect(result.recent_interventions[0]).toMatchObject({
      target_type: "class",
      target_class_id: "class_se_2301",
      target_class_name: "软件工程2301班",
    });
    expect(statements.find((sql) => sql.includes("FROM teacher_interventions")))
      .toContain("academic_classes");
  });

  it("rejects a concept from another course before writing an intervention", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      return { rowCount: 0, rows: [] };
    });

    await expect(new PostgresManagementService(pool).recordTeacherIntervention(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      { concept_id: "ds_c01_01", action: "assign_review", note: "补充复习。" },
    )).rejects.toBeInstanceOf(ManagementResourceNotFoundError);
    expect(statements.some((sql) => sql.includes("INSERT INTO teacher_interventions"))).toBe(false);
  });

  it("records a valid intervention without returning the actor identity", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("FROM course_core_concepts")) {
        return { rowCount: 1, rows: [{ concept_id: "co_c01_01", title: "指令执行流程" }] };
      }
      if (sql.includes("INSERT INTO teacher_interventions")) {
        return {
          rowCount: 1,
          rows: [{
            intervention_id: "intervention_001",
            course_id: "course_408_co",
            concept_id: "co_c01_01",
            action: "classroom_focus",
            note: "下次课先讲这个知识点。",
            created_at: new Date("2026-08-24T10:01:00.000Z"),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const intervention = await new PostgresManagementService(
      pool,
      () => new Date("2026-08-24T10:01:00.000Z"),
      () => "intervention_001",
    ).recordTeacherIntervention(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      { concept_id: "co_c01_01", action: "classroom_focus", note: "下次课先讲这个知识点。" },
    );

    expect(intervention).toEqual({
      intervention_id: "intervention_001",
      course_id: "course_408_co",
      concept_id: "co_c01_01",
      concept_title: "指令执行流程",
      action: "classroom_focus",
      note: "下次课先讲这个知识点。",
      created_at: "2026-08-24T10:01:00.000Z",
    });
    expect(statements.some((sql) => sql.includes("actor_user_id"))).toBe(true);
    expect(statements.find((sql) => sql.includes("INSERT INTO teacher_interventions")))
      .toContain("teacher_course_class_assignments");
  });

  it("persists a planned intervention target and lifecycle fields", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("FROM course_core_concepts")) {
        return { rowCount: 1, rows: [{ concept_id: "co_c01_01", title: "指令执行流程" }] };
      }
      if (sql.includes("INSERT INTO teacher_interventions")) {
        return {
          rowCount: 1,
          rows: [{
            intervention_id: "intervention_002",
            course_id: "course_408_co",
            concept_id: "co_c01_01",
            target_type: "class",
            target_class_id: "class_se_2301",
            target_user_id: null,
            material_ref: "pair:co_c01_01:v1",
            due_at: new Date("2026-08-30T10:00:00.000Z"),
            status: "planned",
            delivered_at: null,
            completed_at: null,
            evidence_snapshot: null,
            action: "assign_review",
            note: "下次课完成一题对照练习。",
            created_at: new Date("2026-08-24T10:01:00.000Z"),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const intervention = await new PostgresManagementService(
      pool,
      () => new Date("2026-08-24T10:01:00.000Z"),
      () => "intervention_002",
    ).recordTeacherIntervention(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "下次课完成一题对照练习。",
        target_type: "class",
        target_class_id: "class_se_2301",
        material_ref: "pair:co_c01_01:v1",
        due_at: "2026-08-30T10:00:00.000Z",
      },
    );

    expect(intervention).toMatchObject({
      intervention_id: "intervention_002",
      target_type: "class",
      target_class_id: "class_se_2301",
      status: "planned",
      material_ref: "pair:co_c01_01:v1",
    });
    const insertSql = statements.find((sql) => sql.includes("INSERT INTO teacher_interventions")) ?? "";
    expect(insertSql).toContain("target_class_id");
    expect(insertSql).toContain("evidence_snapshot");
    expect(insertSql).toContain("status");
  });

  it("resolves a public student code inside the teacher course scope without exposing the internal id", async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const pool = poolFor((sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes("FROM course_core_concepts")) {
        return { rowCount: 1, rows: [{ concept_id: "co_c01_01", title: "指令执行流程" }] };
      }
      if (sql.includes("md5(profile.user_id)")) {
        return { rowCount: 1, rows: [{ target_user_id: "student_internal_001" }] };
      }
      if (sql.includes("INSERT INTO teacher_interventions")) {
        return {
          rowCount: 1,
          rows: [{
            intervention_id: "intervention_student_001",
            course_id: "course_408_co",
            concept_id: "co_c01_01",
            target_type: "student",
            target_class_id: null,
            target_user_id: "student_internal_001",
            action: "assign_review",
            note: "给这名同学安排一次复测。",
            created_at: new Date("2026-08-24T10:01:00.000Z"),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const intervention = await new PostgresManagementService(
      pool,
      () => new Date("2026-08-24T10:01:00.000Z"),
      () => "intervention_student_001",
    ).recordTeacherIntervention(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "给这名同学安排一次复测。",
        target_type: "student",
        target_student_code: "P7F3A1C20",
      },
    );

    expect(intervention).toMatchObject({
      target_type: "student",
      target_student_code: "P7F3A1C20",
    });
    expect(intervention).not.toHaveProperty("target_user_id");
    const lookup = calls.find((call) => call.sql.includes("md5(profile.user_id)"));
    expect(lookup?.sql).toContain("course_memberships");
    expect(lookup?.sql).toContain("teacher_course_class_assignments");
    expect(lookup?.parameters).toEqual([
      "course_408_co",
      "P7F3A1C20",
      "teacher",
      "user_teacher_001",
    ]);
    const insert = calls.find((call) => call.sql.includes("INSERT INTO teacher_interventions"));
    expect(insert?.parameters).toContain("student_internal_001");
    expect(insert?.parameters).not.toContain("P7F3A1C20");
  });

  it("rejects an unknown or unauthorized public student code before writing", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("FROM course_core_concepts")) {
        return { rowCount: 1, rows: [{ concept_id: "co_c01_01", title: "指令执行流程" }] };
      }
      if (sql.includes("md5(profile.user_id)")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresManagementService(pool).recordTeacherIntervention(
      "course_408_co",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "不应写入。",
        target_type: "student",
        target_student_code: "P00000000",
      },
    )).rejects.toMatchObject({ name: "ManagementInterventionTargetNotFoundError" });
    expect(statements.some((sql) => sql.includes("INSERT INTO teacher_interventions"))).toBe(false);
  });

  it("requires an administrator class target to belong to the requested course", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("FROM course_core_concepts")) {
        return { rowCount: 1, rows: [{ concept_id: "co_c01_01", title: "指令执行流程" }] };
      }
      if (sql.includes("INSERT INTO teacher_interventions")) {
        return {
          rowCount: 1,
          rows: [{
            intervention_id: "intervention_admin_class",
            course_id: "course_408_co",
            concept_id: "co_c01_01",
            target_type: "class",
            target_class_id: "class_se_2301",
            target_user_id: null,
            action: "classroom_focus",
            note: "只给本课程班级发送。",
            created_at: new Date("2026-08-24T10:01:00.000Z"),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresManagementService(
      pool,
      () => new Date("2026-08-24T10:01:00.000Z"),
      () => "intervention_admin_class",
    ).recordTeacherIntervention(
      "course_408_co",
      { viewerUserId: "user_admin_001", viewerRole: "admin" },
      {
        concept_id: "co_c01_01",
        action: "classroom_focus",
        note: "只给本课程班级发送。",
        target_type: "class",
        target_class_id: "class_se_2301",
      },
    );

    const insertSql = statements.find((sql) => sql.includes("INSERT INTO teacher_interventions")) ?? "";
    expect(insertSql).toMatch(
      /FROM teacher_course_class_assignments target_assignment[\s\S]*target_assignment\.class_id = \$9[\s\S]*target_assignment\.course_id = \$2/u,
    );
  });

  it("does not treat a deterministic attempt without learning evidence as pending review", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("COUNT(DISTINCT cm.user_id)")) {
        return {
          rowCount: 1,
          rows: [{ active_student_count: "5", valid_attempt_student_count: "5" }],
        };
      }
      if (sql.includes("WITH snapshot_policy")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM teacher_interventions")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await new PostgresManagementService(pool).getCourseEvidence("course_408_co", {
      viewerUserId: "user_admin_001",
      viewerRole: "admin",
    });

    const weakSql = statements.find((sql) => sql.includes("WITH snapshot_policy")) ?? "";
    expect(weakSql).toMatch(
      /OR \(le\.evidence_id IS NOT NULL[\s\S]*COALESCE\(le\.eligible_for_learning_state_update, false\) = false\)/u,
    );
  });

  it("supports a status transition endpoint backed by post-answer evidence", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql, parameters) => {
      statements.push(sql);
      if (sql.includes("FROM teacher_interventions") && sql.includes("FOR UPDATE")) {
        return {
          rowCount: 1,
          rows: [{
            intervention_id: "intervention_002",
            course_id: "course_408_co",
            concept_id: "co_c01_01",
            actor_user_id: "user_teacher_001",
            target_type: "student",
            target_class_id: null,
            target_user_id: "student_001",
            material_ref: null,
            due_at: null,
            status: "sent",
            delivered_at: new Date("2026-08-24T10:02:00.000Z"),
            completed_at: null,
            evidence_snapshot: null,
            action: "assign_review",
            note: "请完成对照练习。",
            created_at: new Date("2026-08-24T10:01:00.000Z"),
          }],
        };
      }
      if (sql.includes("valid_evidence_count") && sql.includes("learning_evidence")) {
        return {
          rowCount: 1,
          rows: [{
            valid_evidence_count: "1",
            correct_count: "1",
            incorrect_count: "0",
            real_trial_count: "1",
            synthetic_verification_count: "0",
            local_demo_count: "0",
            last_evidence_at: new Date("2026-08-24T10:10:00.000Z"),
          }],
        };
      }
      if (sql.includes("UPDATE teacher_interventions")) {
        return {
          rowCount: 1,
          rows: [{
            intervention_id: "intervention_002",
            course_id: "course_408_co",
            concept_id: "co_c01_01",
            target_type: "student",
            target_class_id: null,
            target_user_id: "student_001",
            material_ref: null,
            due_at: null,
            status: "completed",
            delivered_at: new Date("2026-08-24T10:02:00.000Z"),
            completed_at: new Date("2026-08-24T10:11:00.000Z"),
            evidence_snapshot: JSON.parse(String(parameters[5])),
            action: "assign_review",
            note: "请完成对照练习。",
            created_at: new Date("2026-08-24T10:01:00.000Z"),
          }],
        };
      }
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }, true);

    const service = new PostgresManagementService(
      pool,
      () => new Date("2026-08-24T10:11:00.000Z"),
    ) as unknown as {
      updateTeacherInterventionStatus: Function;
    };
    const updated = await service.updateTeacherInterventionStatus(
      "course_408_co",
      "intervention_002",
      { viewerUserId: "user_teacher_001", viewerRole: "teacher" },
      { status: "completed" },
    );

    expect(updated.status).toBe("completed");
    expect(updated.evidence_snapshot).toMatchObject({
      valid_evidence_count: 1,
      correct_count: 1,
      incorrect_count: 0,
      source_breakdown: {
        real_trial: 1,
        synthetic_verification: 0,
        local_demo: 0,
      },
    });
    expect(statements.some((sql) => sql.includes("eligible_for_learning_state_update = true"))).toBe(true);
    const completionEvidenceSql = statements.find((sql) => (
      sql.includes("valid_evidence_count") && sql.includes("learning_evidence")
    )) ?? "";
    expect(completionEvidenceSql).not.toContain("student_concept_evidence_events");
    expect(completionEvidenceSql).toContain("JOIN practice_attempts attempt");
    expect(completionEvidenceSql).toContain("evaluation.status AS outcome");
    expect(completionEvidenceSql).toContain("evidence.concept_id = $2");
    expect(completionEvidenceSql).not.toContain("evidence.course_id = $1");
    expect(completionEvidenceSql).toContain("concept.course_id = $1");
    expect(completionEvidenceSql).toContain("membership.course_id = $1");
    expect(completionEvidenceSql).toContain("account.account_status = 'active'");
    expect(completionEvidenceSql).toContain("assignment.teacher_user_id = $7");
    expect(completionEvidenceSql).toContain("actor_role.role_key = 'admin'");
    expect(statements.find((sql) => sql.includes("valid_evidence_count") && sql.includes("learning_evidence")))
      .toBeTruthy();
    expect(completionEvidenceSql).toContain("COUNT(DISTINCT evaluation_id) FILTER");
    const completionEvidenceIndex = statements.findIndex((sql) => sql === completionEvidenceSql);
    expect(completionEvidenceIndex).toBeGreaterThanOrEqual(0);
  });

  it("keeps concept intervention status changes owned by the creating teacher", async () => {
    const statements: string[] = [];
    const pool = poolFor((sql) => {
      statements.push(sql);
      if (sql.includes("FROM teacher_interventions") && sql.includes("FOR UPDATE")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }, true);

    await expect(new PostgresManagementService(pool).updateTeacherInterventionStatus(
      "course_408_co",
      "intervention_owned_by_another_teacher",
      { viewerUserId: "user_teacher_002", viewerRole: "teacher" },
      { status: "sent" },
    )).rejects.toBeInstanceOf(ManagementResourceNotFoundError);

    const ownershipSql = statements.find((sql) => (
      sql.includes("FROM teacher_interventions") && sql.includes("FOR UPDATE")
    )) ?? "";
    expect(ownershipSql).toMatch(
      /intervention\.actor_user_id = \$4[\s\S]*COALESCE\(intervention\.target_type, 'concept'\) <> 'concept'/u,
    );
  });

  it("rejects a teacher intervention when the teacher has no assigned class", async () => {
    const pool = poolFor((sql) => {
      if (sql.includes("FROM course_core_concepts")) {
        return { rowCount: 1, rows: [{ concept_id: "co_c01_01", title: "指令执行流程" }] };
      }
      if (sql.includes("INSERT INTO teacher_interventions")) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(new PostgresManagementService(pool).recordTeacherIntervention(
      "course_408_co",
      { viewerUserId: "user_teacher_without_class", viewerRole: "teacher" },
      { concept_id: "co_c01_01", action: "assign_review", note: "补充复习。" },
    )).rejects.toMatchObject({
      name: "ManagementAccessDeniedError",
    });
  });
});
