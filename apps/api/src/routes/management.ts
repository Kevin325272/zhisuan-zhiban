import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  managedCourseEvidenceQuerySchema,
  teacherInterventionCreateRequestSchema,
  teacherInterventionStatusUpdateRequestSchema,
  managedCourseStudentListSchema,
  managedCourseStudentListQuerySchema,
  materialCreateRequestSchema,
  questionReviewUpdateSchema,
  reviewStatusSchema,
} from "@xuetu/contracts";

import { hasPlatformCapability, type PlatformCapabilityRequest } from "../services/access-control.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  ManagementAccessDeniedError,
  ManagementConflictError,
  ManagementInterventionEvidenceRequiredError,
  ManagementInterventionTargetNotFoundError,
  ManagementResourceNotFoundError,
  type ManagementService,
} from "../services/platform-management.js";
import type { SourceLayerSummaryService } from "../services/course-source-layer/source-layer.js";

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

function devUserId(request: FastifyRequest, allowLocalDevAuth: boolean): string | null {
  if (!allowLocalDevAuth) return null;
  const raw = request.headers["x-dev-user-id"];
  return Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
}

async function authorizeCourse(
  request: FastifyRequest,
  courseId: string,
  capability: PlatformCapabilityRequest,
  access: PlatformAccessService,
  allowLocalDevAuth: boolean,
  authentication: LocalAuthenticationService | null = null,
) {
  const identity = await resolveRequestIdentity(request, {
    authentication,
    platformAccess: access,
    allowLocalDevAuth,
  });
  let userId = identity?.userId ?? null;
  if (!userId && !authentication && allowLocalDevAuth) {
    const raw = request.headers["x-dev-user-id"];
    userId = (Array.isArray(raw) ? raw[0] : raw) ?? null;
  }
  if (!userId) {
    if (authentication) {
      return { allowed: false as const, status: 401 as const, body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录管理员账户。") };
    }
    if (!allowLocalDevAuth) {
    return {
      allowed: false as const,
      status: 503 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_NOT_CONFIGURED",
        "生产认证尚未接入；管理接口仅支持显式本地开发身份。",
      ),
    };
    }
    return {
      allowed: false as const,
      status: 401 as const,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "缺少本地开发身份。"),
    };
  }
  const actor = await access.getActor(userId);
  if (!actor) {
    return {
      allowed: false as const,
      status: 401 as const,
      body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
    };
  }
  const courseAssigned = await access.isCourseAssigned(userId, courseId, "teacher");
  if (!hasPlatformCapability(actor.roles, capability, { courseAssigned })) {
    return {
      allowed: false as const,
      status: 403 as const,
      body: failure(
        request.id,
        "COURSE_ACCESS_DENIED",
        "教师只能管理已分配课程；管理员具有全局管理权限。",
      ),
    };
  }
  return {
    allowed: true as const,
    userId,
    viewerRole: actor.roles.includes("admin") ? "admin" as const : "teacher" as const,
  };
}

export function registerManagementRoutes(
  app: FastifyInstance,
  access: PlatformAccessService,
  management: ManagementService,
  options: {
    allowLocalDevAuth: boolean;
    sourceLayer?: SourceLayerSummaryService | null;
    authentication?: LocalAuthenticationService | null;
  },
) {
  app.get<{
    Params: { courseId: string };
    Querystring: { review_status?: string };
  }>("/api/v1/manage/courses/:courseId/questions", async (request, reply) => {
    const authorized = await authorizeCourse(
      request,
      request.params.courseId,
      "question:manage",
      access,
      options.allowLocalDevAuth,
      options.authentication ?? null,
    );
    if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
    const status = request.query.review_status
      ? reviewStatusSchema.safeParse(request.query.review_status)
      : null;
    if (status && !status.success) {
      return reply
        .code(400)
        .send(failure(request.id, "REVIEW_STATUS_INVALID", "审核状态无效。"));
    }
    const items = await management.listQuestions(
      request.params.courseId,
      status?.success ? status.data : undefined,
    );
    return success(request.id, { items });
  });

  app.patch<{ Params: { questionId: string }; Body: unknown }>(
    "/api/v1/manage/questions/:questionId/review",
    async (request, reply) => {
      const courseId = await management.getQuestionCourseId(request.params.questionId);
      if (!courseId) {
        return reply
          .code(404)
          .send(failure(request.id, "QUESTION_NOT_FOUND", "题目不存在。"));
      }
      const authorized = await authorizeCourse(
        request,
        courseId,
        "question:manage",
        access,
        options.allowLocalDevAuth,
        options.authentication ?? null,
      );
      if (!authorized.allowed) {
        if (authorized.status === 403) {
          return reply
            .code(404)
            .send(failure(request.id, "QUESTION_NOT_FOUND", "题目不存在。"));
        }
        return reply.code(authorized.status).send(authorized.body);
      }
      const parsed = questionReviewUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "QUESTION_REVIEW_INVALID", "题目审核参数无效。", {
            issues: parsed.error.issues,
          }),
        );
      }
      const updated = await management.reviewQuestion(
        request.params.questionId,
        authorized.userId,
        parsed.data,
      );
      if (!updated) {
        return reply
          .code(404)
          .send(failure(request.id, "QUESTION_NOT_FOUND", "题目不存在。"));
      }
      return success(request.id, updated);
    },
  );

  app.get<{ Params: { courseId: string } }>(
    "/api/v1/manage/courses/:courseId/materials",
    async (request, reply) => {
      const authorized = await authorizeCourse(
        request,
        request.params.courseId,
        "material:manage",
        access,
        options.allowLocalDevAuth,
        options.authentication ?? null,
      );
      if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
      return success(request.id, {
        items: await management.listMaterials(request.params.courseId),
      });
    },
  );

  app.post<{ Params: { courseId: string }; Body: unknown }>(
    "/api/v1/manage/courses/:courseId/materials",
    async (request, reply) => {
      const authorized = await authorizeCourse(
        request,
        request.params.courseId,
        "material:manage",
        access,
        options.allowLocalDevAuth,
        options.authentication ?? null,
      );
      if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
      const parsed = materialCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "MATERIAL_INPUT_INVALID", "课程资料参数无效。", {
            issues: parsed.error.issues,
          }),
        );
      }
      const created = await management.createMaterial(
        request.params.courseId,
        authorized.userId,
        parsed.data,
      );
      return reply.code(201).send(success(request.id, created));
    },
  );

  app.get<{ Params: { courseId: string } }>(
    "/api/v1/manage/courses/:courseId/learning-summary",
    async (request, reply) => {
      const authorized = await authorizeCourse(
        request,
        request.params.courseId,
        "learning_summary:read",
        access,
        options.allowLocalDevAuth,
        options.authentication ?? null,
      );
      if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
      try {
        return success(
          request.id,
          await management.getLearningSummary(request.params.courseId, {
            viewerUserId: authorized.userId,
            viewerRole: authorized.viewerRole,
          }),
        );
      } catch (error) {
        if (error instanceof ManagementResourceNotFoundError) {
          return reply
            .code(404)
            .send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { courseId: string }; Querystring: Record<string, unknown> }>(
    "/api/v1/manage/courses/:courseId/students",
    async (request, reply) => {
      const authorized = await authorizeCourse(
        request,
        request.params.courseId,
        "learning_summary:read",
        access,
        options.allowLocalDevAuth,
        options.authentication ?? null,
      );
      if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
      const parsedQuery = managedCourseStudentListQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send(
          failure(request.id, "MANAGED_STUDENT_QUERY_INVALID", "学生名单筛选参数无效。", {
            issues: parsedQuery.error.issues,
          }),
        );
      }
      try {
        const viewer = {
          viewerUserId: authorized.userId,
          viewerRole: authorized.viewerRole,
        };
        const roster = await management.listCourseStudents(
          request.params.courseId,
          viewer,
          parsedQuery.data,
        );
        const teachers = management.listCourseTeachers
          ? await management.listCourseTeachers(request.params.courseId, viewer)
          : [];
        const includesSynthetic = roster.includesSyntheticDemo
          || teachers.some((item) => item.data_provenance === "synthetic_demo");
        const payload = managedCourseStudentListSchema.parse({
          course_id: request.params.courseId,
          items: roster.items,
          teachers,
          generated_at: new Date().toISOString(),
          data_scope: includesSynthetic ? "includes_synthetic_demo" : "stored_records_only",
          pagination: {
            page: parsedQuery.data.page,
            page_size: parsedQuery.data.page_size,
            total_items: roster.totalItems,
            total_pages: Math.ceil(roster.totalItems / parsedQuery.data.page_size),
          },
          filters: {
            class_name: parsedQuery.data.class_name,
            learning_status: parsedQuery.data.learning_status,
            available_classes: roster.availableClasses,
          },
          summary: roster.summary,
        });
        return success(request.id, payload);
      } catch (error) {
        if (error instanceof ManagementResourceNotFoundError) {
          return reply
            .code(404)
            .send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { courseId: string }; Querystring: Record<string, unknown> }>(
    "/api/v1/manage/courses/:courseId/evidence",
    async (request, reply) => {
      const authorized = await authorizeCourse(
        request,
        request.params.courseId,
        "learning_summary:read",
        access,
        options.allowLocalDevAuth,
        options.authentication ?? null,
      );
      if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
      const hasQuery = Object.keys(request.query).length > 0;
      const parsedQuery = hasQuery
        ? managedCourseEvidenceQuerySchema.safeParse(request.query)
        : null;
      if (parsedQuery && !parsedQuery.success) {
        return reply.code(400).send(
          failure(request.id, "MANAGED_EVIDENCE_QUERY_INVALID", "学情统计筛选参数无效。", {
            issues: parsedQuery.error.issues,
          }),
        );
      }
      try {
        return success(
          request.id,
          await management.getCourseEvidence(request.params.courseId, {
            viewerUserId: authorized.userId,
            viewerRole: authorized.viewerRole,
          }, parsedQuery?.success ? parsedQuery.data : undefined),
        );
      } catch (error) {
        if (error instanceof ManagementResourceNotFoundError) {
          return reply
            .code(404)
            .send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        if (error instanceof ManagementConflictError) {
          return reply
            .code(409)
            .send(failure(request.id, "MANAGED_EVIDENCE_CONFLICT", error.message));
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { courseId: string }; Body: unknown }>(
    "/api/v1/manage/courses/:courseId/interventions",
    async (request, reply) => {
      const authorized = await authorizeCourse(
        request,
        request.params.courseId,
        "learning_intervention:write",
        access,
        options.allowLocalDevAuth,
        options.authentication ?? null,
      );
      if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
      const parsed = teacherInterventionCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "TEACHER_INTERVENTION_INVALID", "教师干预参数无效。", {
            issues: parsed.error.issues,
          }),
        );
      }
      try {
        const created = await management.recordTeacherIntervention(
          request.params.courseId,
          {
            viewerUserId: authorized.userId,
            viewerRole: authorized.viewerRole,
          },
          parsed.data,
        );
        return reply.code(201).send(success(request.id, created));
      } catch (error) {
        if (error instanceof ManagementAccessDeniedError) {
          return reply.code(403).send(
            failure(
              request.id,
              "TEACHER_CLASS_ASSIGNMENT_REQUIRED",
              "当前教师尚未分配负责班级，不能创建教学安排。",
            ),
          );
        }
        if (error instanceof ManagementInterventionTargetNotFoundError) {
          return reply.code(404).send(
            failure(
              request.id,
              "TEACHER_INTERVENTION_TARGET_NOT_FOUND",
              error.message,
            ),
          );
        }
        if (error instanceof ManagementResourceNotFoundError) {
          return reply
            .code(404)
            .send(failure(request.id, "CONCEPT_NOT_FOUND", "该知识点不属于当前课程。"));
        }
        throw error;
      }
    },
  );

  app.patch<{
    Params: { courseId: string; interventionId: string };
    Body: unknown;
  }>(
    "/api/v1/manage/courses/:courseId/interventions/:interventionId/status",
    async (request, reply) => {
      const authorized = await authorizeCourse(
        request,
        request.params.courseId,
        "learning_intervention:write",
        access,
        options.allowLocalDevAuth,
        options.authentication ?? null,
      );
      if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
      const parsed = teacherInterventionStatusUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "TEACHER_INTERVENTION_STATUS_INVALID", "教师干预状态参数无效。", {
            issues: parsed.error.issues,
          }),
        );
      }
      try {
        const updated = await management.updateTeacherInterventionStatus(
          request.params.courseId,
          request.params.interventionId,
          {
            viewerUserId: authorized.userId,
            viewerRole: authorized.viewerRole,
          },
          parsed.data,
        );
        return success(request.id, updated);
      } catch (error) {
        if (error instanceof ManagementInterventionEvidenceRequiredError) {
          return reply.code(409).send(
            failure(
              request.id,
              "TEACHER_INTERVENTION_EVIDENCE_REQUIRED",
              error.message,
            ),
          );
        }
        if (error instanceof ManagementConflictError) {
          return reply.code(409).send(
            failure(request.id, "TEACHER_INTERVENTION_CONFLICT", error.message),
          );
        }
        if (error instanceof ManagementResourceNotFoundError) {
          return reply.code(404).send(
            failure(request.id, "TEACHER_INTERVENTION_NOT_FOUND", "教师干预不存在。"),
          );
        }
        throw error;
      }
    },
  );

  if (options.sourceLayer) {
    app.get<{ Params: { courseId: string } }>(
      "/api/v1/manage/courses/:courseId/source-layer",
      async (request, reply) => {
        const authorized = await authorizeCourse(
          request,
          request.params.courseId,
          "material:manage",
          access,
          options.allowLocalDevAuth,
          options.authentication ?? null,
        );
        if (!authorized.allowed) return reply.code(authorized.status).send(authorized.body);
        const summary = await options.sourceLayer!.getCourseSummary(request.params.courseId);
        if (!summary) {
          return reply
            .code(404)
            .send(failure(request.id, "SOURCE_LAYER_NOT_FOUND", "该课程尚未导入源层数据。"));
        }
        return success(request.id, summary);
      },
    );
  }
}
