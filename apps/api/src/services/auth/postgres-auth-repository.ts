import { randomUUID } from "node:crypto";

import type { AcademicClassOption, PlatformRole } from "@xuetu/contracts";

import { withTransaction, type SqlQueryablePool } from "../../database/client.js";
import type {
  AccountStatus,
  AuthRepository,
  StoredAccount,
  StoredSession,
} from "./authentication.js";

interface AccountRow {
  user_id: string;
  username: string;
  display_name: string;
  account_status: AccountStatus;
  auth_source: "local_development" | "external_identity";
  account_origin: "legacy_demo" | "registered" | "seeded_admin";
  must_change_password: boolean;
  password_hash: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
  roles: unknown;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  token_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
}

function iso(value: Date | string | null) {
  return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseRoles(value: unknown): PlatformRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter((role): role is PlatformRole => role === "student" || role === "teacher" || role === "admin");
}

function mapAccount(row: AccountRow): StoredAccount {
  return {
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    account_status: row.account_status,
    auth_source: row.auth_source,
    account_origin: row.account_origin,
    must_change_password: row.must_change_password,
    password_hash: row.password_hash,
    roles: parseRoles(row.roles),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
    last_login_at: iso(row.last_login_at),
  };
}

const accountSelect = `
  SELECT u.user_id,
         COALESCE(u.username, u.user_id) AS username,
         u.display_name,
         u.account_status,
         u.auth_source,
         u.account_origin,
         u.must_change_password,
         u.password_hash,
         u.created_at,
         u.updated_at,
         u.last_login_at,
         COALESCE(array_agg(ur.role_key ORDER BY ur.role_key) FILTER (WHERE ur.role_key IS NOT NULL), '{}') AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.user_id
`;

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: SqlQueryablePool) {}

  async findByUsername(username: string) {
    const result = await this.pool.query<AccountRow>(
      `${accountSelect} WHERE lower(u.username) = lower($1) GROUP BY u.user_id`,
      [username],
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async findById(userId: string) {
    const result = await this.pool.query<AccountRow>(
      `${accountSelect} WHERE u.user_id = $1 GROUP BY u.user_id`,
      [userId],
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async createStudent(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    courseIds?: readonly string[];
  }) {
    return this.createAccount({ ...input, role: "student", mustChangePassword: false });
  }

  async createTeacherApplication(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    mustChangePassword: boolean;
  }) {
    const userId = `user_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO users(
           user_id, username, display_name, account_status, auth_source,
           account_origin, password_hash, must_change_password, created_at, updated_at
         ) VALUES ($1,$2,$3,'pending_approval','local_development','registered',$4,$5,$6,$6)`,
        [userId, input.username, input.displayName, input.passwordHash, input.mustChangePassword, timestamp],
      );
      await client.query(
        `INSERT INTO user_roles(user_id, role_key, granted_by, granted_at)
         VALUES ($1,'teacher',NULL,$2)`,
        [userId, timestamp],
      );
    });
    const created = await this.findById(userId);
    if (!created) throw new Error("Created teacher application could not be loaded.");
    return created;
  }

  async createAccount(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: Exclude<PlatformRole, "teacher">;
    courseIds?: readonly string[];
    mustChangePassword: boolean;
  }) {
    const userId = `user_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const studentCourseIds = [...new Set(input.courseIds ?? [])];
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO users(
           user_id, username, display_name, account_status, auth_source,
           account_origin, password_hash, must_change_password, created_at, updated_at
         ) VALUES ($1,$2,$3,'active','local_development','registered',$4,$5,$6,$6)`,
        [userId, input.username, input.displayName, input.passwordHash, input.mustChangePassword, timestamp],
      );
      await client.query(
        `INSERT INTO user_roles(user_id, role_key, granted_by, granted_at)
         VALUES ($1,$2,NULL,$3)`,
        [userId, input.role, timestamp],
      );
      if (input.role === "student" && studentCourseIds.length > 0) {
        const membershipResult = await client.query(
          `INSERT INTO course_memberships(course_id, user_id, membership_role, status, created_at)
           SELECT course_id, $1, 'student', 'active', $2
           FROM courses
           WHERE status = 'active' AND course_id = ANY($3::text[])`,
          [userId, timestamp, studentCourseIds],
        );
        if (membershipResult.rowCount !== studentCourseIds.length) {
          throw new Error("Student course membership creation was incomplete.");
        }
      }
    });
    const created = await this.findById(userId);
    if (!created) throw new Error("Created account could not be loaded.");
    return created;
  }

  async createSession(input: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    createdAt: string;
    expiresAt: string;
  }) {
    await this.pool.query(
      `INSERT INTO account_sessions(session_id, user_id, token_hash, created_at, expires_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$4)`,
      [input.sessionId, input.userId, input.tokenHash, input.createdAt, input.expiresAt],
    );
  }

  async cleanupStaleSessions(input: { now: string; revokedBefore: string }) {
    const result = await this.pool.query(
      `DELETE FROM account_sessions
        WHERE expires_at <= $1
           OR (revoked_at IS NOT NULL AND revoked_at <= $2)`,
      [input.now, input.revokedBefore],
    );
    return result.rowCount ?? 0;
  }

  async findSession(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT session_id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at
         FROM account_sessions
        WHERE token_hash = $1
        LIMIT 1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    const account = await this.findById(row.user_id);
    if (!account) return null;
    return {
      session_id: row.session_id,
      user_id: row.user_id,
      token_hash: row.token_hash,
      created_at: iso(row.created_at)!,
      expires_at: iso(row.expires_at)!,
      last_seen_at: iso(row.last_seen_at)!,
      revoked_at: iso(row.revoked_at),
      account,
    };
  }

  async touchSession(sessionId: string, lastSeenAt: string) {
    await this.pool.query(
      `UPDATE account_sessions SET last_seen_at = $2 WHERE session_id = $1 AND revoked_at IS NULL`,
      [sessionId, lastSeenAt],
    );
  }

  async revokeSession(tokenHash: string, revokedAt: string) {
    await this.pool.query(
      `UPDATE account_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE token_hash = $1`,
      [tokenHash, revokedAt],
    );
  }

  async revokeAllSessions(userId: string, revokedAt: string) {
    await this.pool.query(
      `UPDATE account_sessions SET revoked_at = COALESCE(revoked_at, $2)
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, revokedAt],
    );
  }

  async updateLastLogin(userId: string, lastLoginAt: string) {
    await this.pool.query(`UPDATE users SET last_login_at = $2, updated_at = $2 WHERE user_id = $1`, [userId, lastLoginAt]);
  }

  async updatePassword(userId: string, passwordHash: string, mustChangePassword: boolean, updatedAt: string) {
    await this.pool.query(
      `UPDATE users
          SET password_hash = $2, must_change_password = $3, updated_at = $4
        WHERE user_id = $1`,
      [userId, passwordHash, mustChangePassword, updatedAt],
    );
    const account = await this.findById(userId);
    if (!account) throw new Error("Account not found after password update.");
    return account;
  }

  async replacePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
    updatedAt: string,
    expectedPasswordHash: string | null,
  ) {
    return withTransaction(this.pool, async (client) => {
      const updated = await client.query<{ user_id: string }>(
        `UPDATE users
            SET password_hash = $2, must_change_password = $3, updated_at = $4
          WHERE user_id = $1
            AND ($5::text IS NULL OR password_hash = $5)
          RETURNING user_id`,
        [userId, passwordHash, mustChangePassword, updatedAt, expectedPasswordHash],
      );
      if ((updated.rowCount ?? 0) === 0) return null;
      await client.query(
        `UPDATE account_sessions
            SET revoked_at = COALESCE(revoked_at, $2)
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, updatedAt],
      );
      const account = await client.query<AccountRow>(
        `${accountSelect} WHERE u.user_id = $1 GROUP BY u.user_id`,
        [userId],
      );
      return account.rows[0] ? mapAccount(account.rows[0]) : null;
    });
  }

  async listAccounts() {
    const result = await this.pool.query<AccountRow>(
      `${accountSelect} GROUP BY u.user_id ORDER BY u.created_at DESC, u.user_id`,
    );
    return result.rows.map(mapAccount);
  }

  async listAcademicClasses(): Promise<AcademicClassOption[]> {
    const result = await this.pool.query<{
      class_id: string;
      cohort_year: number;
      major: string;
      class_name: string;
    }>(
      `SELECT class_id, cohort_year, major, class_name
         FROM academic_classes
        ORDER BY cohort_year DESC, major, class_name`,
    );
    return result.rows.map((row) => ({
      class_id: row.class_id,
      cohort_year: Number(row.cohort_year),
      major: row.major,
      class_name: row.class_name,
    }));
  }

  async approveTeacher(input: {
    userId: string;
    teacherNumber: string;
    department: string;
    professionalTitle: string;
    courseId: string;
    classIds: readonly string[];
    updatedAt: string;
  }) {
    return withTransaction(this.pool, async (client) => {
      const target = await client.query<{
        user_id: string;
        account_status: AccountStatus;
        is_teacher: boolean;
      }>(
        `SELECT u.user_id,
                u.account_status,
                EXISTS (
                  SELECT 1 FROM user_roles role
                  WHERE role.user_id = u.user_id AND role.role_key = 'teacher'
                ) AS is_teacher
           FROM users u
          WHERE u.user_id = $1
          FOR UPDATE`,
        [input.userId],
      );
      const targetRow = target.rows[0];
      if (!targetRow) return { status: "not_found" as const };
      if (!targetRow.is_teacher || targetRow.account_status === "active") {
        return { status: "not_approvable_teacher" as const };
      }

      const course = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM courses
          WHERE status = 'active' AND course_id = ANY($1::text[])`,
        [[input.courseId]],
      );
      const classes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM academic_classes
          WHERE class_id = ANY($1::text[])`,
        [input.classIds],
      );
      if (Number(course.rows[0]?.count ?? 0) !== 1
        || Number(classes.rows[0]?.count ?? 0) !== input.classIds.length) {
        return { status: "invalid_scope" as const };
      }

      await client.query(
        `INSERT INTO teacher_academic_profiles(
           user_id, teacher_number, department, professional_title,
           data_provenance, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'user_provided',$5,$5)
         ON CONFLICT (user_id) DO UPDATE
         SET teacher_number = EXCLUDED.teacher_number,
             department = EXCLUDED.department,
             professional_title = EXCLUDED.professional_title,
             data_provenance = EXCLUDED.data_provenance,
             updated_at = EXCLUDED.updated_at`,
        [input.userId, input.teacherNumber, input.department, input.professionalTitle, input.updatedAt],
      );
      await client.query(
        `UPDATE course_memberships
            SET status = 'inactive'
          WHERE user_id = $1 AND membership_role = 'teacher'`,
        [input.userId],
      );
      await client.query(
        `INSERT INTO course_memberships(course_id, user_id, membership_role, status, created_at)
         VALUES ($1,$2,'teacher','active',$3)
         ON CONFLICT (course_id, user_id) DO UPDATE SET status = 'active'`,
        [input.courseId, input.userId, input.updatedAt],
      );
      await client.query(
        `DELETE FROM teacher_course_class_assignments WHERE teacher_user_id = $1`,
        [input.userId],
      );
      await client.query(
        `INSERT INTO teacher_course_class_assignments(
           teacher_user_id, course_id, class_id, data_provenance, created_at
         )
         SELECT $1, $2, class_id, 'user_provided', $4
           FROM academic_classes
          WHERE class_id = ANY($3::text[])`,
        [input.userId, input.courseId, input.classIds, input.updatedAt],
      );
      await client.query(
        `UPDATE users
            SET account_status = 'active', updated_at = $2
          WHERE user_id = $1`,
        [input.userId, input.updatedAt],
      );
      const account = await client.query<AccountRow>(
        `${accountSelect} WHERE u.user_id = $1 GROUP BY u.user_id`,
        [input.userId],
      );
      const row = account.rows[0];
      return row
        ? { status: "approved" as const, account: mapAccount(row) }
        : { status: "not_found" as const };
    });
  }

  async updateAccountStatus(userId: string, status: AccountStatus, updatedAt: string) {
    await this.pool.query(
      `UPDATE users SET account_status = $2, updated_at = $3 WHERE user_id = $1`,
      [userId, status, updatedAt],
    );
    return this.findById(userId);
  }

  async updateAccountStatusAndRevokeSessions(
    userId: string,
    status: AccountStatus,
    updatedAt: string,
  ) {
    return withTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('xuetu:active-admin-governance'))",
      );
      const target = await client.query<{ user_id: string; is_admin: boolean }>(
        `SELECT u.user_id,
                EXISTS (
                  SELECT 1 FROM user_roles role
                  WHERE role.user_id = u.user_id AND role.role_key = 'admin'
                ) AS is_admin
           FROM users u
          WHERE u.user_id = $1
          FOR UPDATE`,
        [userId],
      );
      const targetRow = target.rows[0];
      if (!targetRow) return { status: "not_found" as const };
      if (status === "disabled" && targetRow.is_admin) {
        const activeAdmins = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM users u
             JOIN user_roles role ON role.user_id = u.user_id AND role.role_key = 'admin'
            WHERE u.account_status = 'active'`,
        );
        if (Number(activeAdmins.rows[0]?.count ?? 0) <= 1) {
          return { status: "last_admin_protected" as const };
        }
      }
      const updated = await client.query<{ user_id: string }>(
        `UPDATE users
            SET account_status = $2, updated_at = $3
          WHERE user_id = $1
          RETURNING user_id`,
        [userId, status, updatedAt],
      );
      if ((updated.rowCount ?? 0) === 0) return { status: "not_found" as const };
      if (status === "disabled") {
        await client.query(
          `UPDATE account_sessions
              SET revoked_at = COALESCE(revoked_at, $2)
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId, updatedAt],
        );
      }
      const account = await client.query<AccountRow>(
        `${accountSelect} WHERE u.user_id = $1 GROUP BY u.user_id`,
        [userId],
      );
      const row = account.rows[0];
      return row
        ? { status: "updated" as const, account: mapAccount(row) }
        : { status: "not_found" as const };
    });
  }

  async countActiveAdmins() {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.user_id AND ur.role_key = 'admin'
        WHERE u.account_status = 'active'`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
