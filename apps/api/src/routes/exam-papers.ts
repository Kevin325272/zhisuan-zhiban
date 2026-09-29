import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  examPaperFilterSchema,
  reviewStatusSchema,
} from "@xuetu/contracts";

import {
  hasPlatformCapability,
  type PlatformCapabilityRequest,
} from "../services/access-control.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import type { ExamPaperLibrary } from "../services/exam-papers/exam-paper-library.js";

interface ExamPaperQuery {
  university?: string;
  year?: string;
  subject?: string;
  paper_type?: string;
  limit?: string;
  offset?: string;
}

interface ManagementQuery extends ExamPaperQuery {
  review_status?: string;
}

function success(requestId: string, data: unknown) {
  return { contract_version: "0.1", request_id: requestId, data };
}

function failure(
  requestId: string,
  code: string,
  message: string,
  retryable = false,
  details: Record<string, unknown> = {},
) {
  return {
    contract_version: "0.1",
    request_id: requestId,
    error: { code, message, retryable, details },
  };
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name];
  return Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
}

async function requireStudent(
  request: FastifyRequest,
  options: {
    allowLocalDevAuth: boolean;
    platformAccess: PlatformAccessService | null;
    courseId: string;
    authentication?: LocalAuthenticationService | null;
  },
) {
  const identity = await resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
  let userId = identity?.userId ?? null;
  if (!userId && !options.authentication && options.allowLocalDevAuth) {
    userId = headerValue(request, "x-dev-user-id");
  }
  if (!userId) {
    if (options.authentication) {
      return {
        allowed: false as const,
        status: 401 as const,
        body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。"),
      };
    }
    if (!options.allowLocalDevAuth) {
    return {
      allowed: false as const,
      status: 503 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_NOT_CONFIGURED",
        "生产认证尚未接入；整卷资料仅可在显式本地开发模式下访问。",
      ),
    };
    }
    return {
      allowed: false as const,
      status: 401 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_REQUIRED",
        "本地开发模式需要 X-Dev-User-Id；该请求头不是生产认证。",
      ),
    };
  }
  if (!options.platformAccess) {
    return {
      allowed: false as const,
      status: 503 as const,
      body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "身份存储尚未配置。"),
    };
  }
  const actor = await options.platformAccess.getActor(userId);
  if (!actor) {
    return {
      allowed: false as const,
      status: 401 as const,
      body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
    };
  }
  if (!actor.roles.includes("student")) {
    return {
      allowed: false as const,
      status: 403 as const,
      body: failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前入口仅供学生访问。"),
    };
  }
  const assigned = await options.platformAccess.isCourseAssigned(
    userId,
    options.courseId,
    "student",
  );
  if (!assigned) {
    return {
      allowed: false as const,
      status: 403 as const,
      body: failure(request.id, "COURSE_ACCESS_DENIED", "当前学生未加入该课程。"),
    };
  }
  return { allowed: true as const, userId };
}

async function requireManager(
  request: FastifyRequest,
  options: {
    allowLocalDevAuth: boolean;
    platformAccess: PlatformAccessService | null;
    courseId: string;
    authentication?: LocalAuthenticationService | null;
  },
) {
  const identity = await resolveRequestIdentity(request, {
    authentication: options.authentication ?? null,
    platformAccess: options.platformAccess,
    allowLocalDevAuth: options.allowLocalDevAuth,
  });
  let userId = identity?.userId ?? null;
  if (!userId && !options.authentication && options.allowLocalDevAuth) {
    userId = headerValue(request, "x-dev-user-id");
  }
  if (!userId) {
    if (options.authentication) {
      return { allowed: false as const, status: 401 as const, body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录管理员账户。") };
    }
    if (!options.allowLocalDevAuth) {
    return {
      allowed: false as const,
      status: 503 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_NOT_CONFIGURED",
        "生产认证尚未接入；管理接口仅可在显式本地开发模式下访问。",
      ),
    };
    }
    return {
      allowed: false as const,
      status: 401 as const,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "缺少本地开发身份。"),
    };
  }
  if (!options.platformAccess) {
    return {
      allowed: false as const,
      status: 503 as const,
      body: failure(request.id, "IDENTITY_STORE_NOT_CONFIGURED", "身份存储尚未配置。"),
    };
  }
  const actor = await options.platformAccess.getActor(userId);
  if (!actor) {
    return {
      allowed: false as const,
      status: 401 as const,
      body: failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
    };
  }
  const capability: PlatformCapabilityRequest = "material:manage";
  const assigned = await options.platformAccess.isCourseAssigned(
    userId,
    options.courseId,
    "teacher",
  );
  if (!hasPlatformCapability(actor.roles, capability, { courseAssigned: assigned })) {
    return {
      allowed: false as const,
      status: 403 as const,
      body: failure(
        request.id,
        "MANAGEMENT_ACCESS_DENIED",
        "只有管理员或已分配课程的教师可以查看来源治理记录。",
      ),
    };
  }
  return { allowed: true as const, userId };
}

function parseFilter(query: ExamPaperQuery) {
  return examPaperFilterSchema.safeParse({
    university: query.university,
    year: query.year === undefined ? undefined : Number(query.year),
    subject: query.subject,
    paper_type: query.paper_type,
    limit: query.limit === undefined ? undefined : Number(query.limit),
    offset: query.offset === undefined ? undefined : Number(query.offset),
  });
}

function studentLibraryClosed(request: FastifyRequest) {
  return failure(
    request.id,
    "EXAM_PAPERS_NOT_OPEN",
    "资料暂未开放训练。",
  );
}

export function registerExamPaperRoutes(
  app: FastifyInstance,
  library: ExamPaperLibrary,
  options: {
    allowLocalDevAuth: boolean;
    platformAccess: PlatformAccessService | null;
    courseId: string;
    authentication?: LocalAuthenticationService | null;
  },
) {
  app.get<{ Querystring: ExamPaperQuery }>(
    "/api/v1/exam-papers",
    async (request, reply) => {
      const denied = await requireStudent(request, options);
      if (!denied.allowed) return reply.code(denied.status).send(denied.body);
      return reply.code(403).send(studentLibraryClosed(request));
    },
  );

  app.get<{ Params: { examPaperId: string } }>(
    "/api/v1/exam-papers/:examPaperId",
    async (request, reply) => {
      const denied = await requireStudent(request, options);
      if (!denied.allowed) return reply.code(denied.status).send(denied.body);
      return reply.code(403).send(studentLibraryClosed(request));
    },
  );

  app.get<{ Params: { examPaperId: string } }>(
    "/api/v1/exam-papers/:examPaperId/file",
    async (request, reply) => {
      const denied = await requireStudent(request, options);
      if (!denied.allowed) return reply.code(denied.status).send(denied.body);
      return reply.code(403).send(studentLibraryClosed(request));
    },
  );

  app.get<{ Querystring: ManagementQuery }>(
    "/api/v1/manage/exam-papers",
    async (request, reply) => {
      const denied = await requireManager(request, options);
      if (!denied.allowed) return reply.code(denied.status).send(denied.body);
      const parsed = parseFilter(request.query);
      if (!parsed.success) {
        return reply.code(400).send(
          failure(request.id, "EXAM_PAPER_FILTER_INVALID", "整卷筛选参数无效。", false, {
            issues: parsed.error.issues,
          }),
        );
      }
      const reviewStatus = request.query.review_status
        ? reviewStatusSchema.safeParse(request.query.review_status)
        : null;
      if (reviewStatus && !reviewStatus.success) {
        return reply
          .code(400)
          .send(failure(request.id, "REVIEW_STATUS_INVALID", "审核状态无效。"));
      }
      const managementFilter = {
        courseId: options.courseId,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        ...(reviewStatus?.success ? { reviewStatus: reviewStatus.data } : {}),
      };
      return success(request.id, await library.listManagement(managementFilter));
    },
  );
}
