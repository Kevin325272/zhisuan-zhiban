import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import { ClassEnrollmentError } from "../src/services/class-enrollment/class-enrollment.js";
import { PostgresClassEnrollment } from "../src/services/class-enrollment/postgres-class-enrollment.js";

const now = "2026-08-26T08:00:00.000Z";
const expiresAt = "2026-09-25T08:00:00.000Z";
const courseId = "course_408_ds";
const classId = "class_se_2301";
const studentId = "user_student_new";
const teacherId = "user_teacher_001";

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length): SqlQueryResult {
  return { rows, rowCount };
}

function createPool(
  handler: (
    sql: string,
    parameters: readonly unknown[] | undefined,
    source: "pool" | "client",
  ) => Promise<SqlQueryResult> | SqlQueryResult,
) {
  const statements: Array<{
    sql: string;
    parameters?: readonly unknown[];
    source: "pool" | "client";
  }> = [];
  const query = async (
    sql: string,
    parameters: readonly unknown[] | undefined,
    source: "pool" | "client",
  ) => {
    statements.push(parameters === undefined ? { sql, source } : { sql, parameters, source });
    return handler(sql, parameters, source);
  };
  const client = {
    query: (sql: string, parameters?: readonly unknown[]) => query(sql, parameters, "client"),
    release() {},
  };
  const pool = {
    query: (sql: string, parameters?: readonly unknown[]) => query(sql, parameters, "pool"),
    async connect() { return client; },
  } as SqlQueryablePool;
  return { pool, statements };
}

function service(pool: SqlQueryablePool) {
  return new PostgresClassEnrollment(pool, {
    now: () => new Date(now),
    createId: (prefix) => `${prefix}_fixed`,
    createInvitationCode: () => "ABCD-7K9M",
  });
}

const invitationRow = {
  invitation_id: "class_invitation_fixed",
  class_id: classId,
  class_name: "软件工程2301班",
  course_id: courseId,
  course_title: "数据结构",
  code_suffix: "7K9M",
  expires_at: expiresAt,
};

const requestRow = {
  request_id: "enrollment_request_fixed",
  user_id: studentId,
  invitation_id: "class_invitation_fixed",
  status: "pending",
  student_number: "2315929354",
  class_id: classId,
  class_name: "软件工程2301班",
  course_id: courseId,
  course_title: "数据结构",
  created_at: now,
  reviewed_at: null,
};

describe("PostgresClassEnrollment", () => {
  it("loads the student's current membership and latest request", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM student_academic_profiles")) {
        return result([{
          class_id: classId,
          class_name: "软件工程2301班",
          cohort_year: 2023,
          major: "软件工程",
          student_number: "2315929354",
          course_id: courseId,
          course_title: "数据结构",
          joined_at: now,
        }]);
      }
      if (sql.includes("FROM class_enrollment_requests")) return result([requestRow]);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const status = await service(pool).getStudentStatus(studentId);

    expect(status.membership).toMatchObject({ class_name: "软件工程2301班", course_title: "数据结构" });
    expect(status.request).toMatchObject({ request_id: "enrollment_request_fixed", status: "pending" });
  });

  it("hashes the invitation and creates a pending request without storing the raw code", async () => {
    const { pool, statements } = createPool((sql) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM users") && sql.includes("FOR UPDATE")) return result([{ user_id: studentId }]);
      if (sql.includes("FROM class_invitation_codes") && sql.includes("code_hash")) return result([invitationRow]);
      if (sql.includes("FROM student_academic_profiles") && sql.includes("user_id = $1")) return result();
      if (sql.includes("FROM class_enrollment_requests") && sql.includes("status = 'pending'")) return result();
      if (sql.includes("student_number = $1") && sql.includes("student_academic_profiles")) return result();
      if (sql.includes("INSERT INTO class_enrollment_requests")) return result([requestRow], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const status = await service(pool).submitStudentRequest(studentId, {
      invite_code: "ABCD-7K9M",
      student_number: "2315929354",
    });

    expect(status.membership).toBeNull();
    expect(status.request?.status).toBe("pending");
    const rawParameters = statements.flatMap((statement) => statement.parameters ?? []);
    expect(rawParameters).not.toContain("ABCD-7K9M");
    expect(rawParameters).toContain(createHash("sha256").update("ABCD7K9M").digest("hex"));
    expect(statements.at(0)?.sql).toBe("BEGIN");
    expect(statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("rejects an invalid or expired invitation before any request insert", async () => {
    const { pool, statements } = createPool((sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM users") && sql.includes("FOR UPDATE")) return result([{ user_id: studentId }]);
      if (sql.includes("FROM class_invitation_codes")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service(pool).submitStudentRequest(studentId, {
      invite_code: "ZZZZ-9999",
      student_number: "2315929354",
    })).rejects.toMatchObject({ code: "CLASS_INVITATION_INVALID", statusCode: 404 });
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO class_enrollment_requests"))).toBe(false);
    expect(statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("creates a teacher-owned class only inside an authorized course", async () => {
    const { pool, statements } = createPool((sql) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM course_memberships") && sql.includes("membership_role = 'teacher'")) return result([{ authorized: true }]);
      if (sql.includes("INSERT INTO academic_classes")) return result([{
        class_id: classId,
        class_name: "软件工程2301班",
        cohort_year: 2023,
        major: "软件工程",
      }], 1);
      if (sql.includes("INSERT INTO teacher_course_class_assignments")) return result([], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const created = await service(pool).createClass(
      courseId,
      { viewerUserId: teacherId, viewerRole: "teacher" },
      { class_name: "软件工程2301班", cohort_year: 2023, major: "软件工程" },
    );

    expect(created).toMatchObject({ class_id: classId, member_count: 0, pending_request_count: 0 });
    expect(statements.some((statement) => statement.sql.includes("teacher_course_class_assignments"))).toBe(true);
    expect(statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("revokes the previous code and stores only the new invitation hash", async () => {
    const { pool, statements } = createPool((sql) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM teacher_course_class_assignments")) return result([{ authorized: true }]);
      if (sql.includes("UPDATE class_invitation_codes") && sql.includes("revoked_at")) return result([], 1);
      if (sql.includes("INSERT INTO class_invitation_codes")) return result([{
        class_id: classId,
        code_suffix: "7K9M",
        expires_at: expiresAt,
      }], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const invitation = await service(pool).createInvitation(
      courseId,
      classId,
      { viewerUserId: teacherId, viewerRole: "teacher" },
    );

    expect(invitation).toEqual({
      class_id: classId,
      invite_code: "ABCD-7K9M",
      code_hint: "****-7K9M",
      expires_at: expiresAt,
    });
    expect(statements.flatMap((statement) => statement.parameters ?? [])).not.toContain("ABCD-7K9M");
  });

  it("approves a pending request atomically and creates only class profile and course membership", async () => {
    const { pool, statements } = createPool((sql) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM teacher_course_class_assignments")) return result([{ authorized: true }]);
      if (sql.includes("FROM class_enrollment_requests") && sql.includes("FOR UPDATE")) return result([requestRow]);
      if (sql.includes("FROM student_academic_profiles") && sql.includes("FOR UPDATE")) return result();
      if (sql.includes("INSERT INTO student_academic_profiles")) return result([], 1);
      if (sql.includes("INSERT INTO course_memberships")) return result([], 1);
      if (sql.includes("UPDATE class_enrollment_requests")) {
        return result([{ ...requestRow, status: "approved", reviewed_at: now }], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const approved = await service(pool).decideRequest(
      courseId,
      classId,
      "enrollment_request_fixed",
      { viewerUserId: teacherId, viewerRole: "teacher" },
      { decision: "approved" },
    );

    expect(approved.status).toBe("approved");
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO student_academic_profiles"))).toBe(true);
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO course_memberships"))).toBe(true);
    expect(statements.at(0)?.sql).toBe("BEGIN");
    expect(statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("rejects a cross-class teacher and a second decision without partial writes", async () => {
    const denied = createPool((sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM teacher_course_class_assignments")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(service(denied.pool).decideRequest(
      courseId,
      classId,
      "enrollment_request_fixed",
      { viewerUserId: teacherId, viewerRole: "teacher" },
      { decision: "approved" },
    )).rejects.toMatchObject({ code: "CLASS_ACCESS_DENIED", statusCode: 403 });
    expect(denied.statements.some((statement) => statement.sql.includes("INSERT INTO student_academic_profiles"))).toBe(false);

    const alreadyReviewed = createPool((sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM teacher_course_class_assignments")) return result([{ authorized: true }]);
      if (sql.includes("FROM class_enrollment_requests") && sql.includes("FOR UPDATE")) {
        return result([{ ...requestRow, status: "approved", reviewed_at: now }]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(service(alreadyReviewed.pool).decideRequest(
      courseId,
      classId,
      "enrollment_request_fixed",
      { viewerUserId: teacherId, viewerRole: "teacher" },
      { decision: "rejected" },
    )).rejects.toMatchObject({ code: "CLASS_ENROLLMENT_ALREADY_REVIEWED", statusCode: 409 });
    expect(alreadyReviewed.statements.some((statement) => statement.sql.includes("INSERT INTO student_academic_profiles"))).toBe(false);
  });

  it("rejects an application without creating a profile or course membership", async () => {
    const { pool, statements } = createPool((sql) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM teacher_course_class_assignments")) return result([{ authorized: true }]);
      if (sql.includes("FROM class_enrollment_requests") && sql.includes("FOR UPDATE")) return result([requestRow]);
      if (sql.includes("UPDATE class_enrollment_requests")) {
        return result([{ ...requestRow, status: "rejected", reviewed_at: now }], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const rejected = await service(pool).decideRequest(
      courseId,
      classId,
      "enrollment_request_fixed",
      { viewerUserId: teacherId, viewerRole: "teacher" },
      { decision: "rejected" },
    );

    expect(rejected.status).toBe("rejected");
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO student_academic_profiles"))).toBe(false);
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO course_memberships"))).toBe(false);
  });

  it("removes only the class profile and preserves account, course and learning records", async () => {
    const { pool, statements } = createPool((sql) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
      if (sql.includes("FROM teacher_course_class_assignments")) return result([{ authorized: true }]);
      if (sql.includes("DELETE FROM student_academic_profiles")) return result([{ user_id: studentId }], 1);
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(service(pool).removeMember(
      courseId,
      classId,
      "P7F3A1C20",
      { viewerUserId: teacherId, viewerRole: "teacher" },
    )).resolves.toEqual({ removed: true });

    const mutationSql = statements
      .map((statement) => statement.sql)
      .filter((sql) => /\b(DELETE|UPDATE|INSERT)\b/iu.test(sql))
      .join("\n");
    expect(mutationSql).toContain("DELETE FROM student_academic_profiles");
    expect(mutationSql).not.toMatch(/(?:DELETE|UPDATE)\s+(?:FROM\s+)?(?:users|course_memberships|practice_attempts|learning_evidence|student_initial_profile_versions)/iu);
  });

  it("uses typed operational errors instead of leaking database details", () => {
    const error = new ClassEnrollmentError("CLASS_NAME_EXISTS", "班级名称已存在。", 409);
    expect(error).toMatchObject({ code: "CLASS_NAME_EXISTS", statusCode: 409 });
  });
});
