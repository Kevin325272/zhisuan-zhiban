import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  classEnrollmentDecisionRequestSchema,
  studentClassEnrollmentRequestCreateSchema,
  teacherClassCreateRequestSchema,
} from "@xuetu/contracts";

import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import { hasPlatformCapability } from "../services/access-control.js";
import {
  ClassEnrollmentError,
  type ClassEnrollmentService,
  type ClassEnrollmentViewer,
} from "../services/class-enrollment/class-enrollment.js";
import type { PlatformAccessService } from "../services/platform-access.js";

interface Options {
  allowLocalDevAuth: boolean;
  platformAccess: PlatformAccessService;
  authentication?: LocalAuthenticationService | null;
}

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(
  requestId: string,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: { code, message, retryable: false, details },
  };
}

async function identityFor(request: FastifyRequest, options: Options) {
  return resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
}

async function requireStudent(
  request: FastifyRequest,
  options: Options,
): Promise<{ userId: string } | { status: 401 | 403; body: unknown }> {
  const identity = await identityFor(request, options);
  if (!identity) {
    return {
      status: 401,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。"),
    };
  }
  const actor = await options.platformAccess.getActor(identity.userId);
  if (!actor) {
    return {
      status: 401,
      body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
    };
  }
  if (!actor.roles.includes("student")) {
    return {
      status: 403,
      body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前接口仅供学生访问。"),
    };
  }
  return { userId: identity.userId };
}

async function requireTeacherCourse(
  request: FastifyRequest,
  courseId: string,
  options: Options,
): Promise<ClassEnrollmentViewer | { status: 401 | 403; body: unknown }> {
  const identity = await identityFor(request, options);
  if (!identity) {
    return {
      status: 401,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录教师账户。"),
    };
  }
  const actor = await options.platformAccess.getActor(identity.userId);
  if (!actor) {
    return {
      status: 401,
      body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
    };
  }
  const courseAssigned = await options.platformAccess.isCourseAssigned(
    identity.userId,
    courseId,
    "teacher",
  );
  if (!hasPlatformCapability(actor.roles, "class:manage", { courseAssigned })) {
    return {
      status: 403,
      body: failure(request.id, "COURSE_ACCESS_DENIED", "教师只能管理已授权课程中的班级。"),
    };
  }
  return {
    viewerUserId: identity.userId,
    viewerRole: actor.roles.includes("admin") ? "admin" : "teacher",
  };
}

function sendServiceError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (!(error instanceof ClassEnrollmentError)) throw error;
  return reply.code(error.statusCode).send(
    failure(request.id, error.code, error.message),
  );
}

export function registerClassEnrollmentRoutes(
  app: FastifyInstance,
  service: ClassEnrollmentService,
  options: Options,
) {
  app.get("/api/v1/student/class-enrollment", async (request, reply) => {
    const actor = await requireStudent(request, options);
    if ("status" in actor) return reply.code(actor.status).send(actor.body);
    try {
      return success(request.id, await service.getStudentStatus(actor.userId));
    } catch (error) {
      return sendServiceError(error, request, reply);
    }
  });

  app.post<{ Body: unknown }>(
    "/api/v1/student/class-enrollment/requests",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      const parsed = studentClassEnrollmentRequestCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "CLASS_ENROLLMENT_REQUEST_INVALID",
          "邀请码或学号格式不正确。",
          { issues: parsed.error.issues },
        ));
      }
      try {
        return reply.code(201).send(success(
          request.id,
          await service.submitStudentRequest(actor.userId, parsed.data),
        ));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.delete(
    "/api/v1/student/class-enrollment/requests/current",
    async (request, reply) => {
      const actor = await requireStudent(request, options);
      if ("status" in actor) return reply.code(actor.status).send(actor.body);
      try {
        return success(request.id, await service.cancelStudentRequest(actor.userId));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.get<{ Params: { courseId: string } }>(
    "/api/v1/manage/courses/:courseId/classes",
    async (request, reply) => {
      const viewer = await requireTeacherCourse(request, request.params.courseId, options);
      if ("status" in viewer) return reply.code(viewer.status).send(viewer.body);
      try {
        return success(request.id, await service.listTeacherClasses(request.params.courseId, viewer));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Params: { courseId: string }; Body: unknown }>(
    "/api/v1/manage/courses/:courseId/classes",
    async (request, reply) => {
      const viewer = await requireTeacherCourse(request, request.params.courseId, options);
      if ("status" in viewer) return reply.code(viewer.status).send(viewer.body);
      const parsed = teacherClassCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "CLASS_CREATE_INVALID",
          "班级名称、年级或专业格式不正确。",
          { issues: parsed.error.issues },
        ));
      }
      try {
        return reply.code(201).send(success(
          request.id,
          await service.createClass(request.params.courseId, viewer, parsed.data),
        ));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{ Params: { courseId: string; classId: string } }>(
    "/api/v1/manage/courses/:courseId/classes/:classId/invitation",
    async (request, reply) => {
      const viewer = await requireTeacherCourse(request, request.params.courseId, options);
      if ("status" in viewer) return reply.code(viewer.status).send(viewer.body);
      try {
        return reply.code(201).send(success(
          request.id,
          await service.createInvitation(
            request.params.courseId,
            request.params.classId,
            viewer,
          ),
        ));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.delete<{ Params: { courseId: string; classId: string } }>(
    "/api/v1/manage/courses/:courseId/classes/:classId/invitation",
    async (request, reply) => {
      const viewer = await requireTeacherCourse(request, request.params.courseId, options);
      if ("status" in viewer) return reply.code(viewer.status).send(viewer.body);
      try {
        return success(request.id, await service.revokeInvitation(
          request.params.courseId,
          request.params.classId,
          viewer,
        ));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.post<{
    Params: { courseId: string; classId: string; requestId: string };
    Body: unknown;
  }>(
    "/api/v1/manage/courses/:courseId/classes/:classId/requests/:requestId/decision",
    async (request, reply) => {
      const viewer = await requireTeacherCourse(request, request.params.courseId, options);
      if ("status" in viewer) return reply.code(viewer.status).send(viewer.body);
      const parsed = classEnrollmentDecisionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "CLASS_ENROLLMENT_DECISION_INVALID",
          "审核操作无效。",
          { issues: parsed.error.issues },
        ));
      }
      try {
        return success(request.id, await service.decideRequest(
          request.params.courseId,
          request.params.classId,
          request.params.requestId,
          viewer,
          parsed.data,
        ));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );

  app.delete<{
    Params: { courseId: string; classId: string; studentCode: string };
  }>(
    "/api/v1/manage/courses/:courseId/classes/:classId/members/:studentCode",
    async (request, reply) => {
      const viewer = await requireTeacherCourse(request, request.params.courseId, options);
      if ("status" in viewer) return reply.code(viewer.status).send(viewer.body);
      try {
        return success(request.id, await service.removeMember(
          request.params.courseId,
          request.params.classId,
          request.params.studentCode,
          viewer,
        ));
      } catch (error) {
        return sendServiceError(error, request, reply);
      }
    },
  );
}
