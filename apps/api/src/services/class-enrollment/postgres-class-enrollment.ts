import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  classEnrollmentCancellationSchema,
  classInvitationRevocationSchema,
  classMemberRemovalSchema,
  studentClassEnrollmentRequestSchema,
  studentClassEnrollmentStatusSchema,
  teacherClassInvitationCreatedSchema,
  teacherClassManagementSchema,
  teacherManagedClassSchema,
  type ClassEnrollmentDecisionRequest,
  type ClassEnrollmentRequestStatus,
  type StudentClassEnrollmentRequest,
  type StudentClassEnrollmentRequestCreate,
  type StudentClassMembership,
  type TeacherClassCreateRequest,
  type TeacherClassEnrollmentRequest,
  type TeacherClassMember,
  type TeacherManagedClass,
} from "@xuetu/contracts";

import {
  withTransaction,
  type SqlClient,
  type SqlQueryablePool,
} from "../../database/client.js";
import {
  ClassEnrollmentError,
  type ClassEnrollmentService,
  type ClassEnrollmentViewer,
} from "./class-enrollment.js";

interface Options {
  now?: () => Date;
  createId?: (prefix: string) => string;
  createInvitationCode?: () => string;
}

type SqlExecutor = Pick<SqlClient, "query"> | Pick<SqlQueryablePool, "query">;

interface StudentMembershipRow {
  class_id: string;
  class_name: string;
  cohort_year: number | string;
  major: string;
  student_number: string;
  course_id: string;
  course_title: string;
  joined_at: Date | string;
}

interface EnrollmentRequestRow {
  request_id: string;
  user_id?: string;
  invitation_id?: string;
  status: ClassEnrollmentRequestStatus;
  student_number: string;
  class_id: string;
  class_name: string;
  course_id: string;
  course_title: string;
  created_at: Date | string;
  reviewed_at: Date | string | null;
}

interface InvitationLookupRow {
  invitation_id: string;
  class_id: string;
  class_name: string;
  course_id: string;
  course_title: string;
  code_suffix: string;
  expires_at: Date | string;
}

interface ManagedClassRow {
  class_id: string;
  class_name: string;
  cohort_year: number | string;
  major: string;
  member_count: number | string;
  pending_request_count: number | string;
  invitation_status: "none" | "active";
  code_suffix: string | null;
  expires_at: Date | string | null;
}

interface TeacherRequestRow {
  request_id: string;
  class_id: string;
  class_name: string;
  student_code: string;
  display_name: string;
  student_number: string;
  status: "pending";
  submitted_at: Date | string;
}

interface TeacherMemberRow {
  class_id: string;
  class_name: string;
  student_code: string;
  display_name: string;
  student_number: string;
  joined_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoNullable(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function normalizedInvitationCode(value: string): string {
  return value.replace(/[\s-]/gu, "").toUpperCase();
}

function invitationHash(value: string): string {
  return createHash("sha256").update(normalizedInvitationCode(value)).digest("hex");
}

function defaultInvitationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let compact = "";
  for (const byte of bytes) compact += alphabet[byte % alphabet.length];
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function mapStudentRequest(row: EnrollmentRequestRow): StudentClassEnrollmentRequest {
  return studentClassEnrollmentRequestSchema.parse({
    request_id: row.request_id,
    status: row.status,
    student_number: row.student_number,
    class_id: row.class_id,
    class_name: row.class_name,
    course_id: row.course_id,
    course_title: row.course_title,
    submitted_at: iso(row.created_at),
    reviewed_at: isoNullable(row.reviewed_at),
  });
}

function mapMembership(row: StudentMembershipRow): StudentClassMembership {
  return {
    class_id: row.class_id,
    class_name: row.class_name,
    cohort_year: Number(row.cohort_year),
    major: row.major,
    student_number: row.student_number,
    course_id: row.course_id,
    course_title: row.course_title,
    joined_at: iso(row.joined_at),
  };
}

function postgresConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { code?: unknown; constraint?: unknown };
  return value.code === "23505" && typeof value.constraint === "string"
    ? value.constraint
    : null;
}

export class PostgresClassEnrollment implements ClassEnrollmentService {
  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly options: Options = {},
  ) {}

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private createId(prefix: string): string {
    return (this.options.createId ?? ((value) => `${value}_${randomUUID()}`))(prefix);
  }

  private createCode(): string {
    return (this.options.createInvitationCode ?? defaultInvitationCode)();
  }

  private async assertCourseCreationScope(
    executor: SqlExecutor,
    courseId: string,
    viewer: ClassEnrollmentViewer,
  ): Promise<void> {
    const result = await executor.query(
      `SELECT 1 AS authorized
         WHERE (
           $3 = 'admin'
           AND EXISTS (SELECT 1 FROM courses course WHERE course.course_id = $1 AND course.status = 'active')
         ) OR EXISTS (
           SELECT 1
             FROM course_memberships membership
             JOIN courses course ON course.course_id = membership.course_id
            WHERE membership.course_id = $1
              AND membership.user_id = $2
              AND membership.membership_role = 'teacher'
              AND membership.status = 'active'
              AND course.status = 'active'
         )`,
      [courseId, viewer.viewerUserId, viewer.viewerRole],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new ClassEnrollmentError(
        "COURSE_ACCESS_DENIED",
        "当前教师没有该课程的班级管理权限。",
        403,
      );
    }
  }

  private async assertClassScope(
    executor: SqlExecutor,
    courseId: string,
    classId: string,
    viewer: ClassEnrollmentViewer,
  ): Promise<void> {
    const result = await executor.query(
      `SELECT 1 AS authorized
         FROM teacher_course_class_assignments assignment
        WHERE assignment.course_id = $1
          AND assignment.class_id = $2
          AND ($4 = 'admin' OR assignment.teacher_user_id = $3)
        LIMIT 1`,
      [courseId, classId, viewer.viewerUserId, viewer.viewerRole],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new ClassEnrollmentError(
        "CLASS_ACCESS_DENIED",
        "当前教师不能管理这个班级。",
        403,
      );
    }
  }

  async getStudentStatus(userId: string) {
    const membershipResult = await this.pool.query<StudentMembershipRow>(
      `SELECT profile.class_id,
              class.class_name,
              class.cohort_year,
              class.major,
              profile.student_number,
              assignment.course_id,
              course.title AS course_title,
              profile.created_at AS joined_at
         FROM student_academic_profiles profile
         JOIN academic_classes class ON class.class_id = profile.class_id
         JOIN LATERAL (
           SELECT scoped.course_id
             FROM teacher_course_class_assignments scoped
             LEFT JOIN class_enrollment_requests approved
               ON approved.user_id = profile.user_id
              AND approved.class_id = profile.class_id
              AND approved.course_id = scoped.course_id
              AND approved.status = 'approved'
            WHERE scoped.class_id = profile.class_id
            ORDER BY (approved.request_id IS NOT NULL) DESC, scoped.created_at ASC
            LIMIT 1
         ) assignment ON true
         JOIN courses course ON course.course_id = assignment.course_id
        WHERE profile.user_id = $1
        LIMIT 1`,
      [userId],
    );
    const requestResult = await this.pool.query<EnrollmentRequestRow>(
      `SELECT request.request_id,
              request.status,
              request.student_number,
              request.class_id,
              class.class_name,
              request.course_id,
              course.title AS course_title,
              request.created_at,
              request.reviewed_at
         FROM class_enrollment_requests request
         JOIN academic_classes class ON class.class_id = request.class_id
         JOIN courses course ON course.course_id = request.course_id
        WHERE request.user_id = $1
        ORDER BY request.created_at DESC
        LIMIT 1`,
      [userId],
    );
    return studentClassEnrollmentStatusSchema.parse({
      membership: membershipResult.rows[0] ? mapMembership(membershipResult.rows[0]) : null,
      request: requestResult.rows[0] ? mapStudentRequest(requestResult.rows[0]) : null,
    });
  }

  async submitStudentRequest(userId: string, input: StudentClassEnrollmentRequestCreate) {
    try {
      return await withTransaction(this.pool, async (client) => {
        const user = await client.query<{ user_id: string }>(
          "SELECT user_id FROM users WHERE user_id = $1 AND account_status = 'active' FOR UPDATE",
          [userId],
        );
        if (!user.rows[0]) {
          throw new ClassEnrollmentError("ACTOR_NOT_FOUND", "学生账户不存在或已停用。", 404);
        }

        const invitation = await client.query<InvitationLookupRow>(
          `SELECT invitation.invitation_id,
                  invitation.class_id,
                  class.class_name,
                  invitation.course_id,
                  course.title AS course_title,
                  invitation.code_suffix,
                  invitation.expires_at
             FROM class_invitation_codes invitation
             JOIN academic_classes class ON class.class_id = invitation.class_id
             JOIN courses course ON course.course_id = invitation.course_id
            WHERE invitation.code_hash = $1
              AND invitation.revoked_at IS NULL
              AND invitation.expires_at > $2
              AND course.status = 'active'
            LIMIT 1`,
          [invitationHash(input.invite_code), this.now().toISOString()],
        );
        const target = invitation.rows[0];
        if (!target) {
          throw new ClassEnrollmentError(
            "CLASS_INVITATION_INVALID",
            "邀请码无效或已停用，请向老师确认后重试。",
            404,
          );
        }

        const existingProfile = await client.query(
          `SELECT user_id
             FROM student_academic_profiles
            WHERE user_id = $1
            LIMIT 1`,
          [userId],
        );
        if ((existingProfile.rowCount ?? 0) > 0) {
          throw new ClassEnrollmentError(
            "CLASS_MEMBERSHIP_EXISTS",
            "你已经加入一个班级，不能重复申请。",
            409,
          );
        }

        const pendingRequest = await client.query(
          `SELECT request_id
             FROM class_enrollment_requests
            WHERE user_id = $1 AND status = 'pending'
            LIMIT 1`,
          [userId],
        );
        if ((pendingRequest.rowCount ?? 0) > 0) {
          throw new ClassEnrollmentError(
            "CLASS_ENROLLMENT_PENDING",
            "你已有一条等待老师确认的入班申请。",
            409,
          );
        }

        const occupiedNumber = await client.query(
          `SELECT student_number
             FROM student_academic_profiles
            WHERE student_number = $1
           UNION ALL
           SELECT student_number
             FROM class_enrollment_requests
            WHERE student_number = $1 AND status = 'pending'
            LIMIT 1`,
          [input.student_number],
        );
        if ((occupiedNumber.rowCount ?? 0) > 0) {
          throw new ClassEnrollmentError(
            "STUDENT_NUMBER_IN_USE",
            "该学号已被其他账户使用或正在审核。",
            409,
          );
        }

        const createdAt = this.now().toISOString();
        const created = await client.query<EnrollmentRequestRow>(
          `INSERT INTO class_enrollment_requests(
             request_id, user_id, invitation_id, class_id, course_id,
             student_number, status, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$7)
           RETURNING request_id, user_id, invitation_id, class_id, course_id,
                     student_number, status, created_at, reviewed_at`,
          [
            this.createId("enrollment_request"),
            userId,
            target.invitation_id,
            target.class_id,
            target.course_id,
            input.student_number,
            createdAt,
          ],
        );
        const row = created.rows[0];
        if (!row) throw new Error("Enrollment request insert returned no row.");
        return studentClassEnrollmentStatusSchema.parse({
          membership: null,
          request: mapStudentRequest({
            ...row,
            class_name: row.class_name ?? target.class_name,
            course_title: row.course_title ?? target.course_title,
          }),
        });
      });
    } catch (error) {
      if (error instanceof ClassEnrollmentError) throw error;
      const constraint = postgresConstraint(error);
      if (constraint?.includes("pending_user")) {
        throw new ClassEnrollmentError(
          "CLASS_ENROLLMENT_PENDING",
          "你已有一条等待老师确认的入班申请。",
          409,
        );
      }
      if (constraint?.includes("pending_number")) {
        throw new ClassEnrollmentError(
          "STUDENT_NUMBER_IN_USE",
          "该学号已被其他账户使用或正在审核。",
          409,
        );
      }
      throw error;
    }
  }

  async cancelStudentRequest(userId: string) {
    const updated = await this.pool.query(
      `UPDATE class_enrollment_requests
          SET status = 'cancelled', updated_at = $2
        WHERE user_id = $1 AND status = 'pending'`,
      [userId, this.now().toISOString()],
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new ClassEnrollmentError(
        "CLASS_ENROLLMENT_PENDING_NOT_FOUND",
        "当前没有可取消的入班申请。",
        404,
      );
    }
    return classEnrollmentCancellationSchema.parse({ cancelled: true });
  }

  async listTeacherClasses(courseId: string, viewer: ClassEnrollmentViewer) {
    const classes = await this.pool.query<ManagedClassRow>(
      `SELECT class.class_id,
              class.class_name,
              class.cohort_year,
              class.major,
              COUNT(DISTINCT profile.user_id)::int AS member_count,
              COUNT(DISTINCT request.request_id)
                FILTER (WHERE request.status = 'pending')::int AS pending_request_count,
              CASE WHEN invitation.invitation_id IS NULL THEN 'none' ELSE 'active' END
                AS invitation_status,
              invitation.code_suffix,
              invitation.expires_at
         FROM teacher_course_class_assignments assignment
         JOIN academic_classes class ON class.class_id = assignment.class_id
         LEFT JOIN student_academic_profiles profile ON profile.class_id = class.class_id
         LEFT JOIN class_enrollment_requests request
           ON request.class_id = class.class_id AND request.course_id = assignment.course_id
         LEFT JOIN LATERAL (
           SELECT active.invitation_id, active.code_suffix, active.expires_at
             FROM class_invitation_codes active
            WHERE active.class_id = class.class_id
              AND active.course_id = assignment.course_id
              AND active.revoked_at IS NULL
              AND active.expires_at > $4
            ORDER BY active.created_at DESC
            LIMIT 1
         ) invitation ON true
        WHERE assignment.course_id = $1
          AND ($3 = 'admin' OR assignment.teacher_user_id = $2)
        GROUP BY class.class_id, invitation.invitation_id,
                 invitation.code_suffix, invitation.expires_at
        ORDER BY class.cohort_year DESC, class.class_name`,
      [courseId, viewer.viewerUserId, viewer.viewerRole, this.now().toISOString()],
    );
    const pending = await this.pool.query<TeacherRequestRow>(
      `SELECT request.request_id,
              request.class_id,
              class.class_name,
              'P' || upper(substr(md5(request.user_id), 1, 8)) AS student_code,
              student.display_name,
              request.student_number,
              request.status,
              request.created_at AS submitted_at
         FROM class_enrollment_requests request
         JOIN academic_classes class ON class.class_id = request.class_id
         JOIN users student ON student.user_id = request.user_id
         JOIN teacher_course_class_assignments assignment
           ON assignment.class_id = request.class_id
          AND assignment.course_id = request.course_id
        WHERE request.course_id = $1
          AND request.status = 'pending'
          AND ($3 = 'admin' OR assignment.teacher_user_id = $2)
        ORDER BY request.created_at ASC`,
      [courseId, viewer.viewerUserId, viewer.viewerRole],
    );
    const members = await this.pool.query<TeacherMemberRow>(
      `SELECT profile.class_id,
              class.class_name,
              'P' || upper(substr(md5(profile.user_id), 1, 8)) AS student_code,
              student.display_name,
              profile.student_number,
              profile.created_at AS joined_at
         FROM student_academic_profiles profile
         JOIN academic_classes class ON class.class_id = profile.class_id
         JOIN users student ON student.user_id = profile.user_id
         JOIN teacher_course_class_assignments assignment
           ON assignment.class_id = profile.class_id
        WHERE assignment.course_id = $1
          AND ($3 = 'admin' OR assignment.teacher_user_id = $2)
        ORDER BY class.class_name, profile.student_number`,
      [courseId, viewer.viewerUserId, viewer.viewerRole],
    );

    return teacherClassManagementSchema.parse({
      course_id: courseId,
      classes: classes.rows.map((row): TeacherManagedClass => ({
        class_id: row.class_id,
        class_name: row.class_name,
        cohort_year: Number(row.cohort_year),
        major: row.major,
        member_count: Number(row.member_count),
        pending_request_count: Number(row.pending_request_count),
        invitation: row.invitation_status === "active"
          ? {
              status: "active",
              code_hint: `****-${row.code_suffix}`,
              expires_at: iso(row.expires_at!),
            }
          : { status: "none", code_hint: null, expires_at: null },
      })),
      pending_requests: pending.rows.map((row): TeacherClassEnrollmentRequest => ({
        ...row,
        submitted_at: iso(row.submitted_at),
      })),
      members: members.rows.map((row): TeacherClassMember => ({
        ...row,
        joined_at: iso(row.joined_at),
      })),
    });
  }

  async createClass(
    courseId: string,
    viewer: ClassEnrollmentViewer,
    input: TeacherClassCreateRequest,
  ) {
    try {
      return await withTransaction(this.pool, async (client) => {
        await this.assertCourseCreationScope(client, courseId, viewer);
        const createdAt = this.now().toISOString();
        const created = await client.query<{
          class_id: string;
          class_name: string;
          cohort_year: number | string;
          major: string;
        }>(
          `INSERT INTO academic_classes(
             class_id, cohort_year, major, class_name, data_provenance,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,'user_provided',$5,$5)
           RETURNING class_id, class_name, cohort_year, major`,
          [
            this.createId("class"),
            input.cohort_year,
            input.major,
            input.class_name,
            createdAt,
          ],
        );
        const row = created.rows[0];
        if (!row) throw new Error("Class insert returned no row.");
        await client.query(
          `INSERT INTO teacher_course_class_assignments(
             teacher_user_id, course_id, class_id, data_provenance, created_at
           ) VALUES ($1,$2,$3,'user_provided',$4)`,
          [viewer.viewerUserId, courseId, row.class_id, createdAt],
        );
        return teacherManagedClassSchema.parse({
          class_id: row.class_id,
          class_name: row.class_name,
          cohort_year: Number(row.cohort_year),
          major: row.major,
          member_count: 0,
          pending_request_count: 0,
          invitation: { status: "none", code_hint: null, expires_at: null },
        });
      });
    } catch (error) {
      if (error instanceof ClassEnrollmentError) throw error;
      if (postgresConstraint(error)?.includes("academic_classes_class_name")) {
        throw new ClassEnrollmentError("CLASS_NAME_EXISTS", "班级名称已存在。", 409);
      }
      throw error;
    }
  }

  async createInvitation(
    courseId: string,
    classId: string,
    viewer: ClassEnrollmentViewer,
  ) {
    return withTransaction(this.pool, async (client) => {
      await this.assertClassScope(client, courseId, classId, viewer);
      const createdAt = this.now();
      const expires = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const rawCode = this.createCode();
      const compactCode = normalizedInvitationCode(rawCode);
      const suffix = compactCode.slice(-4);
      await client.query(
        `UPDATE class_invitation_codes
            SET revoked_at = $3
          WHERE course_id = $1 AND class_id = $2 AND revoked_at IS NULL`,
        [courseId, classId, createdAt.toISOString()],
      );
      const inserted = await client.query<{
        class_id: string;
        code_suffix: string;
        expires_at: Date | string;
      }>(
        `INSERT INTO class_invitation_codes(
           invitation_id, class_id, course_id, created_by,
           code_hash, code_suffix, expires_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING class_id, code_suffix, expires_at`,
        [
          this.createId("class_invitation"),
          classId,
          courseId,
          viewer.viewerUserId,
          invitationHash(rawCode),
          suffix,
          expires.toISOString(),
          createdAt.toISOString(),
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Invitation insert returned no row.");
      return teacherClassInvitationCreatedSchema.parse({
        class_id: row.class_id,
        invite_code: `${compactCode.slice(0, 4)}-${compactCode.slice(4)}`,
        code_hint: `****-${row.code_suffix}`,
        expires_at: iso(row.expires_at),
      });
    });
  }

  async revokeInvitation(
    courseId: string,
    classId: string,
    viewer: ClassEnrollmentViewer,
  ) {
    return withTransaction(this.pool, async (client) => {
      await this.assertClassScope(client, courseId, classId, viewer);
      await client.query(
        `UPDATE class_invitation_codes
            SET revoked_at = $3
          WHERE course_id = $1 AND class_id = $2 AND revoked_at IS NULL`,
        [courseId, classId, this.now().toISOString()],
      );
      return classInvitationRevocationSchema.parse({ revoked: true });
    });
  }

  async decideRequest(
    courseId: string,
    classId: string,
    requestId: string,
    viewer: ClassEnrollmentViewer,
    input: ClassEnrollmentDecisionRequest,
  ) {
    try {
      return await withTransaction(this.pool, async (client) => {
        await this.assertClassScope(client, courseId, classId, viewer);
        const requestResult = await client.query<EnrollmentRequestRow>(
          `SELECT request.request_id,
                  request.user_id,
                  request.invitation_id,
                  request.status,
                  request.student_number,
                  request.class_id,
                  class.class_name,
                  request.course_id,
                  course.title AS course_title,
                  request.created_at,
                  request.reviewed_at
             FROM class_enrollment_requests request
             JOIN academic_classes class ON class.class_id = request.class_id
             JOIN courses course ON course.course_id = request.course_id
            WHERE request.request_id = $1
              AND request.course_id = $2
              AND request.class_id = $3
            FOR UPDATE`,
          [requestId, courseId, classId],
        );
        const request = requestResult.rows[0];
        if (!request) {
          throw new ClassEnrollmentError(
            "CLASS_ENROLLMENT_REQUEST_NOT_FOUND",
            "入班申请不存在。",
            404,
          );
        }
        if (request.status !== "pending") {
          throw new ClassEnrollmentError(
            "CLASS_ENROLLMENT_ALREADY_REVIEWED",
            "这条申请已经处理，不能重复审核。",
            409,
          );
        }
        if (!request.user_id) throw new Error("Enrollment request is missing user_id.");

        if (input.decision === "approved") {
          const occupied = await client.query<{
            user_id: string;
            class_id: string;
            student_number: string;
          }>(
            `SELECT user_id, class_id, student_number
               FROM student_academic_profiles
              WHERE user_id = $1 OR student_number = $2
              FOR UPDATE`,
            [request.user_id, request.student_number],
          );
          if (occupied.rows.length > 0) {
            throw new ClassEnrollmentError(
              "CLASS_MEMBERSHIP_CONFLICT",
              "该学生或学号已经归属其他班级。",
              409,
            );
          }
          const reviewedAt = this.now().toISOString();
          await client.query(
            `INSERT INTO student_academic_profiles(
               user_id, student_number, class_id, data_provenance,
               created_at, updated_at
             ) VALUES ($1,$2,$3,'user_provided',$4,$4)`,
            [request.user_id, request.student_number, classId, reviewedAt],
          );
          const membership = await client.query(
            `INSERT INTO course_memberships(
               course_id, user_id, membership_role, status, created_at
             ) VALUES ($1,$2,'student','active',$3)
             ON CONFLICT (course_id, user_id) DO UPDATE
             SET status = 'active'
             WHERE course_memberships.membership_role = 'student'
             RETURNING user_id`,
            [courseId, request.user_id, reviewedAt],
          );
          if ((membership.rowCount ?? 0) === 0) {
            throw new ClassEnrollmentError(
              "CLASS_MEMBERSHIP_ROLE_CONFLICT",
              "该账户在课程中已有不兼容的身份。",
              409,
            );
          }
        }

        const reviewedAt = this.now().toISOString();
        const updated = await client.query<EnrollmentRequestRow>(
          `UPDATE class_enrollment_requests request
              SET status = $2,
                  reviewed_by = $3,
                  reviewed_at = $4,
                  updated_at = $4
             FROM academic_classes class, courses course
            WHERE request.request_id = $1
              AND class.class_id = request.class_id
              AND course.course_id = request.course_id
            RETURNING request.request_id,
                      request.user_id,
                      request.invitation_id,
                      request.status,
                      request.student_number,
                      request.class_id,
                      class.class_name,
                      request.course_id,
                      course.title AS course_title,
                      request.created_at,
                      request.reviewed_at`,
          [requestId, input.decision, viewer.viewerUserId, reviewedAt],
        );
        const row = updated.rows[0];
        if (!row) throw new Error("Enrollment decision returned no row.");
        return mapStudentRequest(row);
      });
    } catch (error) {
      if (error instanceof ClassEnrollmentError) throw error;
      if (postgresConstraint(error)?.includes("student_academic_profiles_student_number")) {
        throw new ClassEnrollmentError(
          "CLASS_MEMBERSHIP_CONFLICT",
          "该学生或学号已经归属其他班级。",
          409,
        );
      }
      throw error;
    }
  }

  async removeMember(
    courseId: string,
    classId: string,
    studentCode: string,
    viewer: ClassEnrollmentViewer,
  ) {
    if (!/^P[A-Z0-9]{8}$/u.test(studentCode)) {
      throw new ClassEnrollmentError("CLASS_MEMBER_INVALID", "学生编号格式无效。", 400);
    }
    return withTransaction(this.pool, async (client) => {
      await this.assertClassScope(client, courseId, classId, viewer);
      const removed = await client.query<{ user_id: string }>(
        `DELETE FROM student_academic_profiles profile
         USING users student
         WHERE profile.user_id = student.user_id
           AND profile.class_id = $1
           AND 'P' || upper(substr(md5(profile.user_id), 1, 8)) = $2
         RETURNING profile.user_id`,
        [classId, studentCode],
      );
      if ((removed.rowCount ?? 0) === 0) {
        throw new ClassEnrollmentError("CLASS_MEMBER_NOT_FOUND", "班级中没有这名学生。", 404);
      }
      return classMemberRemovalSchema.parse({ removed: true });
    });
  }
}
