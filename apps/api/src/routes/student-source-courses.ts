import type { FastifyInstance, FastifyRequest } from "fastify";

import { resolve408CourseId } from "../config/408-courses.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import type {
  SourceFigureArchive,
  StudentSourceCourseService,
} from "../services/course-source-layer/student-source-courses.js";

function success(requestId: string, data: unknown) {
  return { contract_version: "0.2", request_id: requestId, data };
}

function failure(requestId: string, code: string, message: string, retryable = false) {
  return {
    contract_version: "0.2",
    request_id: requestId,
    error: { code, message, retryable, details: {} },
  };
}

function localUserId(
  request: FastifyRequest,
  queryUserId?: string,
) {
  const header = request.headers["x-dev-user-id"];
  return (Array.isArray(header) ? header[0] : header) ?? queryUserId;
}

async function requireStudent(
  request: FastifyRequest,
  options: {
    allowLocalDevAuth: boolean;
    platformAccess: PlatformAccessService | null;
    authentication?: LocalAuthenticationService | null;
  },
  courseSlug: string,
  queryUserId?: string,
) {
  const identity = await resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
  let userId = identity?.userId ?? null;
  if (!userId && !options.authentication && options.allowLocalDevAuth) {
    userId = localUserId(request, queryUserId) ?? null;
  }
  if (!userId) {
    if (options.authentication) {
      return { status: 401 as const, body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。") };
    }
    if (!options.allowLocalDevAuth) {
    return {
      status: 503 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_NOT_CONFIGURED",
        "生产认证尚未接入；课程结构仅可在显式本地开发模式下访问。",
      ),
    };
    }
    return {
      status: 401 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_REQUIRED",
        "本地开发模式需要学生演示身份；该身份不是生产认证。",
      ),
    };
  }
  if (!options.platformAccess) {
    return {
      status: 503 as const,
      body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "身份存储尚未配置。"),
    };
  }
  const actor = await options.platformAccess.getActor(userId);
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
  const courseId = resolve408CourseId(courseSlug);
  if (!courseId) {
    return {
      status: 404 as const,
      body: failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"),
    };
  }
  const assigned = await options.platformAccess.isCourseAssigned(userId, courseId, "student");
  if (!assigned) {
    return {
      status: 403 as const,
      body: failure(request.id, "COURSE_ACCESS_DENIED", "你没有当前课程的学习权限。"),
    };
  }
  return null;
}

function validRouteId(value: string) {
  return /^[a-zA-Z0-9_-]+$/u.test(value);
}

export function registerStudentSourceCourseRoutes(
  app: FastifyInstance,
  studentSourceCourses: StudentSourceCourseService,
  sourceFigureArchive: SourceFigureArchive,
  options: {
    allowLocalDevAuth: boolean;
    platformAccess: PlatformAccessService | null;
    authentication?: LocalAuthenticationService | null;
  },
) {
  app.get<{ Params: { courseSlug: string } }>(
    "/api/v1/408/courses/:courseSlug/source-outline",
    async (request, reply) => {
      const denied = await requireStudent(request, options, request.params.courseSlug);
      if (denied && "status" in denied) return reply.code(denied.status).send(denied.body);
      const outline = await studentSourceCourses.getCourseOutline(request.params.courseSlug);
      if (!outline) {
        return reply.code(404).send(
          failure(request.id, "SOURCE_COURSE_NOT_FOUND", "课程来源结构尚未接入。"),
        );
      }
      return success(request.id, outline);
    },
  );

  app.get<{
    Params: { courseSlug: string; figureAssetId: string };
    Querystring: { dev_user_id?: string };
  }>(
    "/api/v1/408/courses/:courseSlug/source-figures/:figureAssetId",
    async (request, reply) => {
      const denied = await requireStudent(
        request,
        options,
        request.params.courseSlug,
        request.query.dev_user_id,
      );
      if (denied && "status" in denied) return reply.code(denied.status).send(denied.body);
      if (!validRouteId(request.params.figureAssetId)) {
        return reply.code(400).send(
          failure(request.id, "SOURCE_FIGURE_ID_INVALID", "图示标识无效。"),
        );
      }
      const asset = await studentSourceCourses.getFigureAsset(
        request.params.courseSlug,
        request.params.figureAssetId,
      );
      if (!asset) {
        return reply.code(404).send(
          failure(request.id, "SOURCE_FIGURE_NOT_FOUND", "该图示尚未通过学生端显示条件。"),
        );
      }
      try {
        const opened = await sourceFigureArchive.open(asset);
        return reply
          .header("Content-Type", asset.mime_type)
          .header("Content-Length", String(opened.content_length))
          .header("Cache-Control", "private, max-age=3600")
          .send(opened.stream);
      } catch {
        return reply.code(503).send(
          failure(
            request.id,
            "SOURCE_FIGURE_UNAVAILABLE",
            "图示源文件暂时无法读取，课程结构仍可继续使用。",
            true,
          ),
        );
      }
    },
  );
}
