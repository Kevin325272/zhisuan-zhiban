import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { resolve408CourseId } from "../config/408-courses.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import {
  CourseVideoConceptNotFoundError,
  CourseVideoCourseNotFoundError,
  CourseVideoSeriesNotFoundError,
  type CourseVideoLibrary,
} from "../services/course-videos/course-video-library.js";
import type { PlatformAccessService } from "../services/platform-access.js";

const paramsSchema = z.object({
  courseSlug: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+)*$/u),
  conceptId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/u),
}).strict();

const courseParamsSchema = paramsSchema.pick({ courseSlug: true });

const seriesParamsSchema = courseParamsSchema.extend({
  seriesId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/u),
}).strict();

const seriesQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  kind: z.enum(["all", "teaching", "question_explanation"]).default("all"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  page_size: z.coerce.number().int().min(1).max(20).default(10),
}).strict();

const episodeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(30),
}).strict();

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
  options: {
    allowLocalDevAuth: boolean;
    platformAccess: PlatformAccessService | null;
    authentication: LocalAuthenticationService | null;
  },
) {
  const identity = await resolveRequestIdentity(request, options);
  if (!identity) {
    return {
      status: 401 as const,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。"),
    };
  }
  if (!identity.roles.includes("student")) {
    return {
      status: 403 as const,
      body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前入口仅供学生访问。"),
    };
  }
  return { userId: identity.userId };
}

async function requireCourseMembership(
  request: FastifyRequest,
  platformAccess: PlatformAccessService | null,
  userId: string,
  courseSlug: string,
) {
  const courseId = resolve408CourseId(courseSlug);
  if (!courseId) {
    return {
      status: 404 as const,
      body: failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"),
    };
  }
  if (!platformAccess) {
    return {
      status: 503 as const,
      body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "身份存储尚未配置。"),
    };
  }
  const assigned = await platformAccess.isCourseAssigned(userId, courseId, "student");
  if (!assigned) {
    return {
      status: 403 as const,
      body: failure(request.id, "COURSE_ACCESS_DENIED", "你没有当前课程的学习权限。"),
    };
  }
  return null;
}

export function registerCourseVideoRoutes(
  app: FastifyInstance,
  library: CourseVideoLibrary,
  options: {
    allowLocalDevAuth: boolean;
    platformAccess: PlatformAccessService | null;
    authentication?: LocalAuthenticationService | null;
  },
) {
  app.get<{
    Params: { courseSlug: string };
    Querystring: { q?: string; kind?: string; page?: string; page_size?: string };
  }>(
    "/api/v1/408/courses/:courseSlug/videos",
    async (request, reply) => {
      const denied = await requireStudent(request, {
        allowLocalDevAuth: options.allowLocalDevAuth,
        platformAccess: options.platformAccess,
        authentication: options.authentication ?? null,
      });
      if ("status" in denied) return reply.code(denied.status).send(denied.body);

      const params = courseParamsSchema.safeParse(request.params);
      const query = seriesQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.code(400).send(failure(
          request.id,
          "COURSE_VIDEO_QUERY_INVALID",
          "视频资源查询条件无效。",
          {
            issues: [
              ...(params.success ? [] : params.error.issues),
              ...(query.success ? [] : query.error.issues),
            ],
          },
        ));
      }
      const membershipDenied = await requireCourseMembership(
        request,
        options.platformAccess,
        denied.userId,
        params.data.courseSlug,
      );
      if (membershipDenied) {
        return reply.code(membershipDenied.status).send(membershipDenied.body);
      }

      try {
        return success(
          request.id,
          await library.listCourseVideoSeries(params.data.courseSlug, {
            q: query.data.q,
            kind: query.data.kind,
            page: query.data.page,
            pageSize: query.data.page_size,
          }),
        );
      } catch (error) {
        if (error instanceof CourseVideoCourseNotFoundError) {
          return reply.code(404).send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        throw error;
      }
    },
  );

  app.get<{
    Params: { courseSlug: string; seriesId: string };
    Querystring: { page?: string; page_size?: string };
  }>(
    "/api/v1/408/courses/:courseSlug/videos/:seriesId/episodes",
    async (request, reply) => {
      const denied = await requireStudent(request, {
        allowLocalDevAuth: options.allowLocalDevAuth,
        platformAccess: options.platformAccess,
        authentication: options.authentication ?? null,
      });
      if ("status" in denied) return reply.code(denied.status).send(denied.body);

      const params = seriesParamsSchema.safeParse(request.params);
      const query = episodeQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.code(400).send(failure(
          request.id,
          "COURSE_VIDEO_QUERY_INVALID",
          "视频资源查询条件无效。",
          {
            issues: [
              ...(params.success ? [] : params.error.issues),
              ...(query.success ? [] : query.error.issues),
            ],
          },
        ));
      }
      const membershipDenied = await requireCourseMembership(
        request,
        options.platformAccess,
        denied.userId,
        params.data.courseSlug,
      );
      if (membershipDenied) {
        return reply.code(membershipDenied.status).send(membershipDenied.body);
      }

      try {
        return success(
          request.id,
          await library.listSeriesEpisodes(
            params.data.courseSlug,
            params.data.seriesId,
            { page: query.data.page, pageSize: query.data.page_size },
          ),
        );
      } catch (error) {
        if (error instanceof CourseVideoCourseNotFoundError) {
          return reply.code(404).send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        if (error instanceof CourseVideoSeriesNotFoundError) {
          return reply.code(404).send(failure(
            request.id,
            "COURSE_VIDEO_SERIES_NOT_FOUND",
            "视频系列不存在或不属于当前课程。",
          ));
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { courseSlug: string; conceptId: string } }>(
    "/api/v1/408/courses/:courseSlug/concepts/:conceptId/videos",
    async (request, reply) => {
      const denied = await requireStudent(request, {
        allowLocalDevAuth: options.allowLocalDevAuth,
        platformAccess: options.platformAccess,
        authentication: options.authentication ?? null,
      });
      if ("status" in denied) return reply.code(denied.status).send(denied.body);

      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(failure(
          request.id,
          "COURSE_VIDEO_PARAMS_INVALID",
          "课程或知识点标识无效。",
          { issues: parsed.error.issues },
        ));
      }
      const membershipDenied = await requireCourseMembership(
        request,
        options.platformAccess,
        denied.userId,
        parsed.data.courseSlug,
      );
      if (membershipDenied) {
        return reply.code(membershipDenied.status).send(membershipDenied.body);
      }
      try {
        return success(
          request.id,
          await library.listConceptVideos(parsed.data.courseSlug, parsed.data.conceptId),
        );
      } catch (error) {
        if (error instanceof CourseVideoCourseNotFoundError) {
          return reply.code(404).send(failure(request.id, "COURSE_NOT_FOUND", "课程不存在。"));
        }
        if (error instanceof CourseVideoConceptNotFoundError) {
          return reply.code(404).send(failure(
            request.id,
            "COURSE_CONCEPT_NOT_FOUND",
            "知识点不存在或不属于当前课程。",
          ));
        }
        throw error;
      }
    },
  );
}
