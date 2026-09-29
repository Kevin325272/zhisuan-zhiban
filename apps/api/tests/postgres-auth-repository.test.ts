import { describe, expect, it } from "vitest";

import type { SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { PostgresAuthRepository } from "../src/services/auth/postgres-auth-repository.js";

function result(rows: Record<string, unknown>[] = []): SqlQueryResult {
  return { rows, rowCount: rows.length };
}

const accountRow = {
  user_id: "user_student_001",
  username: "student_001",
  display_name: "本地学生",
  account_status: "active",
  auth_source: "local_development",
  account_origin: "registered",
  must_change_password: false,
  password_hash: "new-hash",
  created_at: "2026-08-02T00:00:00.000Z",
  updated_at: "2026-08-19T08:00:00.000Z",
  last_login_at: null,
  roles: ["student"],
};

describe("PostgresAuthRepository atomic account mutations", () => {
  it("creates a pending teacher application without granting a course membership", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const pendingTeacherRow = {
      ...accountRow,
      user_id: "user_teacher_pending",
      username: "teacher_apply_01",
      display_name: "申请教师",
      account_status: "pending_approval",
      roles: ["teacher"],
    };
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(parameters === undefined ? { sql } : { sql, parameters });
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(parameters === undefined ? { sql } : { sql, parameters });
        return result([pendingTeacherRow]);
      },
      async connect() { return client; },
    } as SqlQueryablePool;
    const repository = new PostgresAuthRepository(pool);

    const created = await repository.createTeacherApplication({
      username: "teacher_apply_01",
      displayName: "申请教师",
      passwordHash: "hash",
      mustChangePassword: true,
    });

    expect(created.account_status).toBe("pending_approval");
    const userInsert = statements.find((statement) => statement.sql.includes("INSERT INTO users"));
    expect(userInsert?.sql).toContain("'pending_approval'");
    expect(userInsert?.parameters).toContain(true);
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO course_memberships"))).toBe(false);
  });

  it("approves a teacher profile, course, and class scope in one transaction", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const approvedTeacherRow = {
      ...accountRow,
      user_id: "user_teacher_pending",
      username: "teacher_apply_01",
      display_name: "申请教师",
      account_status: "active",
      roles: ["teacher"],
    };
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(parameters === undefined ? { sql } : { sql, parameters });
        if (sql.includes("FOR UPDATE")) {
          return result([{ user_id: "user_teacher_pending", account_status: "pending_approval", is_teacher: true }]);
        }
        if (sql.includes("FROM courses") && sql.includes("ANY")) return result([{ count: "1" }]);
        if (sql.includes("FROM academic_classes")) return result([{ count: "1" }]);
        if (sql.includes("FROM users u")) return result([approvedTeacherRow]);
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query() { throw new Error("teacher approval must not use pool.query"); },
      async connect() { return client; },
    } as SqlQueryablePool;
    const repository = new PostgresAuthRepository(pool);

    const outcome = await repository.approveTeacher({
      userId: "user_teacher_pending",
      teacherNumber: "T2026001",
      department: "计算机科学与技术学院",
      professionalTitle: "讲师",
      courseId: "course_408_ds",
      classIds: ["class_cs_2302"],
      updatedAt: "2026-08-25T00:00:00.000Z",
    });

    expect(outcome).toMatchObject({ status: "approved", account: { account_status: "active" } });
    expect(statements[0]?.sql).toBe("BEGIN");
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO teacher_academic_profiles"))).toBe(true);
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO course_memberships"))).toBe(true);
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO teacher_course_class_assignments"))).toBe(true);
    expect(statements.some((statement) => statement.sql.includes("SET account_status = 'active'"))).toBe(true);
    expect(statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("reactivates a disabled teacher only through the scoped approval transaction", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const reactivatedTeacherRow = {
      ...accountRow,
      user_id: "user_teacher_disabled",
      username: "teacher_disabled",
      display_name: "停用教师",
      account_status: "active",
      roles: ["teacher"],
    };
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(parameters === undefined ? { sql } : { sql, parameters });
        if (sql.includes("FOR UPDATE")) {
          return result([{ user_id: "user_teacher_disabled", account_status: "disabled", is_teacher: true }]);
        }
        if (sql.includes("FROM courses") && sql.includes("ANY")) return result([{ count: "1" }]);
        if (sql.includes("FROM academic_classes")) return result([{ count: "1" }]);
        if (sql.includes("FROM users u")) return result([reactivatedTeacherRow]);
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query() { throw new Error("teacher approval must not use pool.query"); },
      async connect() { return client; },
    } as SqlQueryablePool;
    const repository = new PostgresAuthRepository(pool);

    const outcome = await repository.approveTeacher({
      userId: "user_teacher_disabled",
      teacherNumber: "T2026009",
      department: "计算机科学与技术学院",
      professionalTitle: "讲师",
      courseId: "course_408_ds",
      classIds: ["class_cs_2302"],
      updatedAt: "2026-08-25T00:00:00.000Z",
    });

    expect(outcome).toMatchObject({ status: "approved", account: { account_status: "active" } });
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO teacher_academic_profiles"))).toBe(true);
    expect(statements.some((statement) => statement.sql.includes("INSERT INTO teacher_course_class_assignments"))).toBe(true);
    expect(statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("writes only the explicitly selected student courses and never the aggregate 408 container", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(parameters === undefined ? { sql } : { sql, parameters });
        if (sql.includes("INSERT INTO course_memberships")) {
          return { rows: [], rowCount: 1 };
        }
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(parameters === undefined ? { sql } : { sql, parameters });
        return result([accountRow]);
      },
      async connect() { return client; },
    } as SqlQueryablePool;
    const repository = new PostgresAuthRepository(pool);

    await repository.createStudent({
      username: "student_cn_001",
      displayName: "受控学生",
      passwordHash: "hash",
      courseIds: ["course_408_cn"],
    });

    const membership = statements.find((statement) => statement.sql.includes("INSERT INTO course_memberships"));
    expect(membership?.sql).toContain("ANY($3::text[])");
    expect(membership?.sql).toContain("'student'");
    expect(membership?.parameters?.[2]).toEqual(["course_408_cn"]);
    expect(membership?.parameters?.[2]).not.toContain("course_408_001");
  });

  it("rolls back account creation when not every requested student course is bound", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes("INSERT INTO course_memberships")) {
          return { rows: [], rowCount: 1 };
        }
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query() { return result([accountRow]); },
      async connect() { return client; },
    } as SqlQueryablePool;
    const repository = new PostgresAuthRepository(pool);

    await expect(repository.createStudent({
      username: "student_partial_scope",
      displayName: "课程权限不完整",
      passwordHash: "hash",
      courseIds: ["course_408_ds", "course_408_co"],
    })).rejects.toThrow("Student course membership creation was incomplete.");

    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });

  it("deletes expired sessions and only long-revoked sessions", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const pool = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push(parameters === undefined ? { sql } : { sql, parameters });
        return { rows: [], rowCount: 7 };
      },
      async connect() { throw new Error("session cleanup must not open a transaction"); },
    } as SqlQueryablePool;
    const repository = new PostgresAuthRepository(pool);

    const deleted = await repository.cleanupStaleSessions({
      now: "2026-08-20T00:00:00.000Z",
      revokedBefore: "2026-08-13T00:00:00.000Z",
    });

    expect(deleted).toBe(7);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toMatch(/DELETE FROM account_sessions/u);
    expect(statements[0]?.sql).toMatch(/expires_at <= \$1/u);
    expect(statements[0]?.sql).toMatch(/revoked_at <= \$2/u);
    expect(statements[0]?.parameters).toEqual([
      "2026-08-20T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
    ]);
  });

  it("updates a password and revokes every session in one transaction", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes("FROM users u")) return result([accountRow]);
        if (sql.includes("UPDATE users")) return result([{ user_id: accountRow.user_id }]);
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query() { throw new Error("atomic mutation must not use pool.query"); },
      async connect() { return client; },
    } as SqlQueryablePool;
    const repository = new PostgresAuthRepository(pool);

    const updated = await repository.replacePasswordAndRevokeSessions(
      accountRow.user_id,
      "new-hash",
      false,
      "2026-08-19T08:00:00.000Z",
      "old-hash",
    );

    const passwordIndex = statements.findIndex((sql) => sql.includes("UPDATE users"));
    const revokeIndex = statements.findIndex((sql) => sql.includes("UPDATE account_sessions"));
    expect(statements[0]).toBe("BEGIN");
    expect(passwordIndex).toBeGreaterThan(0);
    expect(revokeIndex).toBeGreaterThan(passwordIndex);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(updated).toMatchObject({ user_id: accountRow.user_id, must_change_password: false });
  });

  it("serializes the last-admin check and refuses the disabling update", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes("AS is_admin")) {
          return result([{ user_id: "user_admin_001", is_admin: true }]);
        }
        if (sql.includes("COUNT(*)")) return result([{ count: "1" }]);
        return result([]);
      },
      release() {},
    };
    const pool = {
      async query() { throw new Error("admin governance must not use pool.query"); },
      async connect() { return client; },
    } as SqlQueryablePool;
    const repository = new PostgresAuthRepository(pool);

    const outcome = await repository.updateAccountStatusAndRevokeSessions(
      "user_admin_001",
      "disabled",
      "2026-08-19T08:00:00.000Z",
    );

    const lockIndex = statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const countIndex = statements.findIndex((sql) => sql.includes("COUNT(*)"));
    expect(lockIndex).toBeGreaterThan(0);
    expect(countIndex).toBeGreaterThan(lockIndex);
    expect(outcome).toEqual({ status: "last_admin_protected" });
    expect(statements.some((sql) => sql.includes("UPDATE users"))).toBe(false);
    expect(statements.at(-1)).toBe("COMMIT");
  });
});
