import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

const now = "2026-08-26T08:00:00.000Z";
const studentId = "user_student_new";
const teacherId = "user_teacher_001";
const courseId = "course_408_ds";
const classId = "class_se_2301";

function actor(userId: string, roles: Array<"student" | "teacher" | "admin">) {
  return {
    user: {
      user_id: userId,
      display_name: roles.includes("teacher") ? "陈明远" : "许泽宇",
      account_status: "active" as const,
      auth_source: "local_development" as const,
      created_at: now,
      updated_at: now,
    },
    roles,
  };
}

const studentStatus = {
  membership: null,
  request: {
    request_id: "enrollment_request_1",
    status: "pending" as const,
    student_number: "2315929354",
    class_id: classId,
    class_name: "软件工程2301班",
    course_id: courseId,
    course_title: "数据结构",
    submitted_at: now,
    reviewed_at: null,
  },
};

const management = {
  course_id: courseId,
  classes: [{
    class_id: classId,
    class_name: "软件工程2301班",
    cohort_year: 2023,
    major: "软件工程",
    member_count: 1,
    pending_request_count: 1,
    invitation: { status: "active" as const, code_hint: "****-7K9M", expires_at: "2026-09-25T08:00:00.000Z" },
  }],
  pending_requests: [{
    request_id: "enrollment_request_1",
    class_id: classId,
    class_name: "软件工程2301班",
    student_code: "P7F3A1C20",
    display_name: "许泽宇",
    student_number: "2315929354",
    status: "pending" as const,
    submitted_at: now,
  }],
  members: [],
};

describe("class enrollment routes", () => {
  let app: FastifyInstance;
  let rolesByUser: Record<string, Array<"student" | "teacher" | "admin">>;
  let teacherAssigned: boolean;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    rolesByUser = { [studentId]: ["student"], [teacherId]: ["teacher"] };
    teacherAssigned = true;
    const access: PlatformAccessService = {
      async getActor(userId) {
        const roles = rolesByUser[userId];
        return roles ? actor(userId, roles) : null;
      },
      async isCourseAssigned(userId, requestedCourseId, membershipRole) {
        return userId === teacherId
          && requestedCourseId === courseId
          && membershipRole === "teacher"
          && teacherAssigned;
      },
    };
    service = {
      getStudentStatus: vi.fn().mockResolvedValue(studentStatus),
      submitStudentRequest: vi.fn().mockResolvedValue(studentStatus),
      cancelStudentRequest: vi.fn().mockResolvedValue({ cancelled: true }),
      listTeacherClasses: vi.fn().mockResolvedValue(management),
      createClass: vi.fn().mockResolvedValue(management.classes[0]),
      createInvitation: vi.fn().mockResolvedValue({
        class_id: classId,
        invite_code: "ABCD-7K9M",
        code_hint: "****-7K9M",
        expires_at: "2026-09-25T08:00:00.000Z",
      }),
      revokeInvitation: vi.fn().mockResolvedValue({ revoked: true }),
      decideRequest: vi.fn().mockResolvedValue({ ...studentStatus.request, status: "approved", reviewed_at: now }),
      removeMember: vi.fn().mockResolvedValue({ removed: true }),
    };
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: access,
      classEnrollment: service,
    } as never);
  });

  afterEach(async () => {
    await app.close();
  });

  it("lets a student read, submit and cancel only their own enrollment request", async () => {
    const headers = { "x-dev-user-id": studentId };
    const read = await app.inject({ method: "GET", url: "/api/v1/student/class-enrollment", headers });
    const submit = await app.inject({
      method: "POST",
      url: "/api/v1/student/class-enrollment/requests",
      headers,
      payload: { invite_code: "abcd7k9m", student_number: "2315929354" },
    });
    const cancel = await app.inject({
      method: "DELETE",
      url: "/api/v1/student/class-enrollment/requests/current",
      headers,
    });

    expect(read.statusCode).toBe(200);
    expect(submit.statusCode).toBe(201);
    expect(cancel.statusCode).toBe(200);
    expect(service.getStudentStatus).toHaveBeenCalledWith(studentId);
    expect(service.submitStudentRequest).toHaveBeenCalledWith(studentId, {
      invite_code: "ABCD-7K9M",
      student_number: "2315929354",
    });
    expect(service.cancelStudentRequest).toHaveBeenCalledWith(studentId);
  });

  it("validates a student application before calling the service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/class-enrollment/requests",
      headers: { "x-dev-user-id": studentId },
      payload: { invite_code: "bad", student_number: "123" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CLASS_ENROLLMENT_REQUEST_INVALID");
    expect(service.submitStudentRequest).not.toHaveBeenCalled();
  });

  it("keeps teacher operations within the assigned course and class path", async () => {
    const headers = { "x-dev-user-id": teacherId };
    const list = await app.inject({ method: "GET", url: `/api/v1/manage/courses/${courseId}/classes`, headers });
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/manage/courses/${courseId}/classes`,
      headers,
      payload: { class_name: "软件工程2301班", cohort_year: 2023, major: "软件工程" },
    });
    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/manage/courses/${courseId}/classes/${classId}/invitation`,
      headers,
    });
    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/v1/manage/courses/${courseId}/classes/${classId}/invitation`,
      headers,
    });
    const decide = await app.inject({
      method: "POST",
      url: `/api/v1/manage/courses/${courseId}/classes/${classId}/requests/enrollment_request_1/decision`,
      headers,
      payload: { decision: "approved" },
    });
    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/manage/courses/${courseId}/classes/${classId}/members/P7F3A1C20`,
      headers,
    });

    expect(list.statusCode).toBe(200);
    expect(create.statusCode).toBe(201);
    expect(invite.statusCode).toBe(201);
    expect(revoke.statusCode).toBe(200);
    expect(decide.statusCode).toBe(200);
    expect(remove.statusCode).toBe(200);
    expect(service.listTeacherClasses).toHaveBeenCalledWith(courseId, { viewerUserId: teacherId, viewerRole: "teacher" });
    expect(service.createClass).toHaveBeenCalledWith(courseId, { viewerUserId: teacherId, viewerRole: "teacher" }, {
      class_name: "软件工程2301班",
      cohort_year: 2023,
      major: "软件工程",
    });
    expect(service.createInvitation).toHaveBeenCalledWith(courseId, classId, { viewerUserId: teacherId, viewerRole: "teacher" });
    expect(service.decideRequest).toHaveBeenCalledWith(courseId, classId, "enrollment_request_1", { viewerUserId: teacherId, viewerRole: "teacher" }, { decision: "approved" });
    expect(service.removeMember).toHaveBeenCalledWith(courseId, classId, "P7F3A1C20", { viewerUserId: teacherId, viewerRole: "teacher" });
  });

  it("rejects an unassigned teacher before the class service is called", async () => {
    teacherAssigned = false;
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/manage/courses/${courseId}/classes`,
      headers: { "x-dev-user-id": teacherId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("COURSE_ACCESS_DENIED");
    expect(service.listTeacherClasses).not.toHaveBeenCalled();
  });

  it("does not let a teacher call student enrollment endpoints", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/class-enrollment",
      headers: { "x-dev-user-id": teacherId },
    });

    expect(response.statusCode).toBe(403);
    expect(service.getStudentStatus).not.toHaveBeenCalled();
  });
});
