import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  courseContentPageQuerySchema,
  courseReadingProgressUpdateSchema,
} from "@xuetu/contracts";

import { resolve408CourseId } from "../config/408-courses.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import type { CourseSourcePages } from "../services/course-content/course-source-pages.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  CourseContentNotFoundError,
  CourseReadingPositionError,
  type CourseContentService,
} from "../services/course-content/course-content.js";

interface PageQuery {
  chapter?: string;
  limit?: string;
  offset?: string;
}

function success(requestId: string, data: unknown) {
  return { contract_version: "0.2", request_id: requestId, data };
}

function failure(requestId: string, code: string, message: string, details = {}) {
  return {
    contract_version: "0.2",
    request_id: requestId,
    error: { code, message, retryable: false, details },
  };
}

async function requireStudent(
  request: FastifyRequest,
  allowLocalDevAuth: boolean,
  platformAccess: PlatformAccessService | null,
  authentication: LocalAuthenticationService | null = null,
  courseSlug?: string,
) {
  const identity = await resolveRequestIdentity(request, {
    authentication,
    platformAccess,
    allowLocalDevAuth,
  });
  if (!identity && !authentication && allowLocalDevAuth) {
    const raw = request.headers["x-dev-user-id"];
    const headerUserId = Array.isArray(raw) ? raw[0] : raw;
    if (headerUserId && headerUserId.length <= 200) {
      return await checkStudentActor(request, platformAccess, headerUserId, courseSlug);
    }
  }
  if (!identity) {
    if (authentication) {
      return {
        status: 401 as const,
        body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。"),
      };
    }
    if (!allowLocalDevAuth) {
    return {
      status: 503 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_NOT_CONFIGURED",
        "生产认证尚未接入；课程内容仅可在显式本地开发模式下访问。",
      ),
    };
    }
    return {
      status: 401 as const,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "本地开发模式需要 X-Dev-User-Id；该请求头不是生产认证。"),
    };
  }
  return await checkStudentActor(request, platformAccess, identity.userId, courseSlug);
}

async function checkStudentActor(
  request: FastifyRequest,
  platformAccess: PlatformAccessService | null,
  userId: string,
  courseSlug?: string,
) {
  if (userId.length > 200) {
    return {
      status: 401 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_REQUIRED",
        "本地开发模式需要 X-Dev-User-Id；该请求头不是生产认证。",
      ),
    };
  }
  if (!platformAccess) {
    return {
      status: 503 as const,
      body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "身份存储尚未配置。"),
    };
  }
  const actor = await platformAccess.getActor(userId);
  if (!actor) {
    return {
      status: 401 as const,
      body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
    };
  }
  if (!actor.roles.includes("student")) {
    return {
      status: 403 as const,
      body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前入口仅供学生访问。"),
    };
  }
  if (courseSlug) {
    const courseId = resolve408CourseId(courseSlug);
    if (!courseId) {
      return {
        status: 404 as const,
        body: failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"),
      };
    }
    const assigned = await platformAccess.isCourseAssigned(userId, courseId, "student");
    if (!assigned) {
      return {
        status: 403 as const,
        body: failure(request.id, "COURSE_ACCESS_DENIED", "你没有当前课程的学习权限。"),
      };
    }
  }
  return { userId };
}

function parsePageQuery(query: PageQuery) {
  return courseContentPageQuerySchema.safeParse({
    chapter: query.chapter,
    limit: query.limit === undefined ? undefined : Number(query.limit),
    offset: query.offset === undefined ? undefined : Number(query.offset),
  });
}

export function registerCourseContentRoutes(
  app: FastifyInstance,
  courseContent: CourseContentService,
  options: { allowLocalDevAuth: boolean; platformAccess: PlatformAccessService | null; authentication?: LocalAuthenticationService | null; sourcePages?: CourseSourcePages | null },
) {
  app.get<{ Params: { courseSlug: string; pageId: string } }>(
    "/api/v1/408/courses/:courseSlug/source-pages/:pageId",
    async (request, reply) => {
      const denied = await requireStudent(request, options.allowLocalDevAuth, options.platformAccess,
        options.authentication ?? null, request.params.courseSlug);
      if ("status" in denied) return reply.code(denied.status).send(denied.body);
      try {
        const bytes = await options.sourcePages?.open(request.params.courseSlug, request.params.pageId);
        if (!bytes) return reply.code(404).send(failure(request.id, "SOURCE_PAGE_NOT_FOUND", "原文页不存在。"));
        return reply.type("image/webp").header("Cache-Control", "private, max-age=3600")
          .header("X-Content-Type-Options", "nosniff").send(bytes);
      } catch {
        return reply.code(503).send(failure(request.id, "SOURCE_PAGE_UNAVAILABLE", "原文页暂时无法读取，请重新加载。"));
      }
    },
  );
  app.get("/api/v1/408/courses", async (request, reply) => {
    const denied = await requireStudent(
      request,
      options.allowLocalDevAuth,
      options.platformAccess,
      options.authentication ?? null,
    );
    if ("status" in denied) return reply.code(denied.status).send(denied.body);
    return success(request.id, await courseContent.listCourses());
  });

  app.get<{ Params: { courseSlug: string } }>(
    "/api/v1/408/courses/:courseSlug/chapters",
    async (request, reply) => {
      const denied = await requireStudent(
        request,
        options.allowLocalDevAuth,
        options.platformAccess,
        options.authentication ?? null,
        request.params.courseSlug,
      );
      if ("status" in denied) return reply.code(denied.status).send(denied.body);
      try {
        return success(request.id, await courseContent.listChapters(request.params.courseSlug));
      } catch (error) {
        if (error instanceof CourseContentNotFoundError) {
          return reply.code(404).send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { courseSlug: string } }>(
    "/api/v1/408/courses/:courseSlug/curriculum-map",
    async (request, reply) => {
      const denied = await requireStudent(
        request,
        options.allowLocalDevAuth,
        options.platformAccess,
        options.authentication ?? null,
        request.params.courseSlug,
      );
      if ("status" in denied) return reply.code(denied.status).send(denied.body);
      try {
        return success(
          request.id,
          await courseContent.getCurriculumMap(request.params.courseSlug),
        );
      } catch (error) {
        if (error instanceof CourseContentNotFoundError) {
          return reply.code(404).send(
            failure(request.id, "CURRICULUM_MAP_NOT_FOUND", "课程知识地图尚未接入。"),
          );
        }
        throw error;
      }
    },
  );

  for (const route of ["knowledge", "qa-examples"] as const) {
    app.get<{ Params: { courseSlug: string }; Querystring: PageQuery }>(
      `/api/v1/408/courses/:courseSlug/${route}`,
      async (request, reply) => {
        const denied = await requireStudent(
          request,
          options.allowLocalDevAuth,
          options.platformAccess,
          options.authentication ?? null,
          request.params.courseSlug,
        );
        if ("status" in denied) return reply.code(denied.status).send(denied.body);
        const parsed = parsePageQuery(request.query);
        if (!parsed.success) {
          return reply.code(400).send(failure(
            request.id,
            "COURSE_CONTENT_QUERY_INVALID",
            "课程内容查询参数无效。",
            { issues: parsed.error.issues },
          ));
        }
        try {
          const data = route === "knowledge"
            ? await courseContent.listKnowledge(request.params.courseSlug, parsed.data)
            : await courseContent.listQaExamples(request.params.courseSlug, parsed.data);
          if (route === "knowledge" && options.sourcePages) {
            // Enrich the display contract only; keep original OCR and retrieval records intact.
            const archive = options.sourcePages;
            const items = await Promise.all(data.items.map(async (item) => ({
              ...item, source_page: await archive.describe(request.params.courseSlug, item.source_item_id),
            })));
            return success(request.id, { ...data, items });
          }
          return success(request.id, data);
        } catch (error) {
          if (error instanceof CourseContentNotFoundError) {
            return reply.code(404).send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
          }
          throw error;
        }
      },
    );
  }

  app.get<{ Params: { courseSlug: string } }>(
    "/api/v1/408/courses/:courseSlug/reading-progress",
    async (request, reply) => {
      const denied = await requireStudent(
        request,
        options.allowLocalDevAuth,
        options.platformAccess,
        options.authentication ?? null,
        request.params.courseSlug,
      );
      if ("status" in denied) return reply.code(denied.status).send(denied.body);
      try {
        return success(
          request.id,
          await courseContent.getReadingProgress(
            denied.userId,
            request.params.courseSlug,
          ),
        );
      } catch (error) {
        if (error instanceof CourseContentNotFoundError) {
          return reply.code(404).send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        throw error;
      }
    },
  );

  app.put<{ Params: { courseSlug: string }; Body: unknown }>(
    "/api/v1/408/courses/:courseSlug/reading-progress",
    async (request, reply) => {
      const denied = await requireStudent(
        request,
        options.allowLocalDevAuth,
        options.platformAccess,
        options.authentication ?? null,
        request.params.courseSlug,
      );
      if ("status" in denied) return reply.code(denied.status).send(denied.body);
      const parsed = courseReadingProgressUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "READING_PROGRESS_INVALID",
          "阅读位置无效。",
          { issues: parsed.error.issues },
        ));
      }
      try {
        return success(
          request.id,
          await courseContent.saveReadingProgress(
            denied.userId,
            request.params.courseSlug,
            parsed.data,
          ),
        );
      } catch (error) {
        if (error instanceof CourseReadingPositionError) {
          return reply.code(400).send(failure(
            request.id,
            "READING_POSITION_INVALID",
            "知识块不属于当前课程或章节。",
          ));
        }
        if (error instanceof CourseContentNotFoundError) {
          return reply.code(404).send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        throw error;
      }
    },
  );
}
