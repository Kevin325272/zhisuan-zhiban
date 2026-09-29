import {
  platformRoleSchema,
  platformUserSchema,
  type PlatformRole,
  type PlatformUser,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../database/client.js";

export interface PlatformActor {
  user: PlatformUser;
  roles: PlatformRole[];
}

export interface AssignedCourse {
  course_id: string;
  course_code: string;
  title: string;
}

export interface PlatformAccessService {
  getActor(userId: string): Promise<PlatformActor | null>;
  isCourseAssigned(
    userId: string,
    courseId: string,
    membershipRole: "student" | "teacher",
  ): Promise<boolean>;
  listAssignedCourses?(
    userId: string,
    membershipRole: "student" | "teacher",
  ): Promise<AssignedCourse[]>;
}

interface ActorRow {
  user_id: string;
  display_name: string;
  account_status: "active" | "disabled";
  auth_source: "local_development" | "external_identity";
  created_at: Date | string;
  updated_at: Date | string;
  roles: unknown;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresPlatformAccess implements PlatformAccessService {
  constructor(private readonly pool: SqlQueryablePool) {}

  async getActor(userId: string): Promise<PlatformActor | null> {
    const result = await this.pool.query<ActorRow>(
      `SELECT u.user_id, u.display_name, u.account_status, u.auth_source,
              u.created_at, u.updated_at,
              COALESCE(array_agg(ur.role_key) FILTER (WHERE ur.role_key IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       WHERE u.user_id = $1 AND u.account_status = 'active'
       GROUP BY u.user_id`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const roles = Array.isArray(row.roles)
      ? row.roles.map((role) => platformRoleSchema.parse(role))
      : [];
    return {
      user: platformUserSchema.parse({
        user_id: row.user_id,
        display_name: row.display_name,
        account_status: row.account_status,
        auth_source: row.auth_source,
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
      }),
      roles,
    };
  }

  async isCourseAssigned(
    userId: string,
    courseId: string,
    membershipRole: "student" | "teacher",
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM course_memberships
       WHERE user_id = $1 AND course_id = $2
         AND membership_role = $3 AND status = 'active'
       LIMIT 1`,
      [userId, courseId, membershipRole],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listAssignedCourses(
    userId: string,
    membershipRole: "student" | "teacher",
  ): Promise<AssignedCourse[]> {
    const result = await this.pool.query<AssignedCourse>(
      `SELECT c.course_id, c.course_code, c.title
         FROM course_memberships cm
         JOIN courses c ON c.course_id = cm.course_id
         JOIN course_catalog_entries catalog ON catalog.course_id = c.course_id
        WHERE cm.user_id = $1
          AND cm.membership_role = $2
          AND cm.status = 'active'
          AND c.status = 'active'
        ORDER BY c.course_id`,
      [userId, membershipRole],
    );
    return result.rows;
  }
}
