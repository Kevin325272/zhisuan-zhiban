import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  STUDENT_CARE_CRISIS_GUIDANCE,
  aiWorkflowCapabilitySchema,
  aiWorkflowInvocationSchema,
  aiWorkflowRequestSchema,
  studentCareCrisisSignalPresent,
  type AiWorkflowCapability,
  type AiWorkflowResponse,
  type AiWorkflowRuntimeStatus,
} from "@xuetu/contracts";

import type { AiWorkflowGateway } from "../services/ai-workflow/ai-workflow-gateway.js";
import {
  WorkflowContextIncompleteError,
  type WorkflowContextRepository,
} from "../services/ai-workflow/workflow-context.js";
import type { PlatformAccessService } from "../services/platform-access.js";
import type { LocalAuthenticationService } from "../services/auth/authentication.js";
import { resolveRequestIdentity } from "../services/auth/request-identity.js";
import type { PerUserAiRequestLimiter } from "../services/ai-request-limiter.js";
import type { CareConversationStore } from "../services/ai-workflow/care-conversation-store.js";
import type { StudentAiPreferencesStore } from "../services/student-ai-preferences.js";

function success<T extends AiWorkflowResponse | AiWorkflowRuntimeStatus>(requestId: string, data: T) {
  return { contract_version: "0.2", request_id: requestId, data };
}

function failure(
  requestId: string,
  code: string,
  message: string,
  retryable = false,
  details: Record<string, unknown> = {},
) {
  return {
    contract_version: "0.2",
    request_id: requestId,
    error: { code, message, retryable, details },
  };
}

export async function localActorId(
  request: FastifyRequest,
  dependencies: { allowLocalDevAuth: boolean; authentication?: LocalAuthenticationService | null; platformAccess: PlatformAccessService | null },
) {
  const identity = await resolveRequestIdentity(request, {
    authentication: dependencies.authentication ?? null,
    platformAccess: dependencies.platformAccess,
    allowLocalDevAuth: dependencies.allowLocalDevAuth,
  });
  if (identity) return { ok: true as const, userId: identity.userId };
  if (!dependencies.authentication && dependencies.allowLocalDevAuth) {
    const raw = request.headers["x-dev-user-id"];
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (userId && userId.length <= 200) return { ok: true as const, userId };
  }
  if (dependencies.authentication) {
    return {
      ok: false as const,
      status: 401 as const,
      body: failure(request.id, "AUTHENTICATION_REQUIRED", "请先登录学生账户。"),
    };
  }
  if (!dependencies.allowLocalDevAuth) {
    return {
      ok: false as const,
      status: 503 as const,
      body: failure(
        request.id,
        "AUTHENTICATION_NOT_CONFIGURED",
        "生产认证尚未接入；AI工作流仅可在显式本地开发模式下验证。",
      ),
    };
  }
  return {
    ok: false as const,
    status: 401 as const,
    body: failure(
      request.id,
      "AUTHENTICATION_REQUIRED",
      "本地开发模式需要 X-Dev-User-Id；该请求头不是生产认证。",
    ),
  };
}

function incompleteResponse(
  requestId: string,
  capability: AiWorkflowCapability,
): AiWorkflowResponse {
  const fallbackByCapability: Record<AiWorkflowCapability, string> = {
    plan: "课程目录与非AI学习路径仍可使用。",
    explain: "当前教材讲解仍可继续阅读。",
    coach: "导入的课程案例仍可查看。",
    diagnose: "确定性评测结果仍可查看，并可继续下一题。",
    care: "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。",
  };
  return {
    contract_version: "0.2",
    request_id: requestId,
    capability,
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY[capability],
    status: "insufficient_context",
    display_blocks: [],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure: {
      code: "CONTEXT_INCOMPLETE",
      message: "当前学习上下文不足以运行该AI模块。",
      retryable: false,
      fallback_message: fallbackByCapability[capability],
    },
  };
}

function careCrisisResponse(requestId: string): AiWorkflowResponse {
  return {
    contract_version: "0.2",
    request_id: requestId,
    capability: "care",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.care,
    status: "ready",
    display_blocks: [{
      block_id: `${requestId}_safety_notice`,
      kind: "notice",
      title: "先确保你的安全",
      content: STUDENT_CARE_CRISIS_GUIDANCE,
    }],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure: null,
  };
}

const statusQuerySchema = z.object({
  capability: aiWorkflowCapabilitySchema.default("plan"),
}).strip();

export function registerAiWorkflowRoutes(
  app: FastifyInstance,
  dependencies: {
    workflowContext: WorkflowContextRepository;
    aiWorkflowGateway: AiWorkflowGateway;
    platformAccess: PlatformAccessService | null;
    allowLocalDevAuth: boolean;
    authentication?: LocalAuthenticationService | null;
    aiRequestLimiter: PerUserAiRequestLimiter;
    careConversationStore: CareConversationStore;
    studentAiPreferences?: StudentAiPreferencesStore | null;
  },
) {
  app.get<{ Querystring: unknown }>(
    "/api/v1/student/ai-workflows/status",
    async (request, reply) => {
      const actor = await localActorId(request, dependencies);
      if (!actor.ok) return reply.code(actor.status).send(actor.body);
      if (!dependencies.platformAccess) {
        return reply.code(503).send(
          failure(
            request.id,
            "IDENTITY_STORE_NOT_CONFIGURED",
            "用户与课程授权存储尚未配置。",
          ),
        );
      }
      const platformActor = await dependencies.platformAccess.getActor(actor.userId);
      if (!platformActor) {
        return reply.code(401).send(
          failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
        );
      }
      if (!platformActor.roles.includes("student")) {
        return reply.code(403).send(
          failure(request.id, "STUDENT_ACCESS_REQUIRED", "当前入口仅供学生访问。"),
        );
      }
      const query = statusQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send(failure(
          request.id,
          "AI_WORKFLOW_CAPABILITY_INVALID",
          "AI工作流能力标识无效。",
          false,
          { issues: query.error.issues },
        ));
      }
      return success(
        request.id,
        dependencies.aiWorkflowGateway.status(query.data.capability),
      );
    },
  );

  app.post<{ Params: { capability: string }; Body: unknown }>(
    "/api/v1/student/ai-workflows/:capability",
    async (request, reply) => {
      const actor = await localActorId(request, dependencies);
      if (!actor.ok) return reply.code(actor.status).send(actor.body);

      const capability = aiWorkflowCapabilitySchema.safeParse(
        request.params.capability,
      );
      if (!capability.success) {
        return reply.code(400).send(
          failure(
            request.id,
            "AI_WORKFLOW_CAPABILITY_INVALID",
            "AI工作流能力标识无效。",
            false,
            { issues: capability.error.issues },
          ),
        );
      }
      const invocation = aiWorkflowInvocationSchema.safeParse(request.body);
      if (
        !invocation.success
        || invocation.data.capability !== capability.data
      ) {
        return reply.code(400).send(
          failure(
            request.id,
            "AI_WORKFLOW_INVOCATION_INVALID",
            "AI工作流请求不符合接口契约。",
            false,
            {
              issues: invocation.success
                ? [{ path: ["capability"], message: "Path and body capability differ." }]
                : invocation.error.issues,
            },
          ),
        );
      }
      if (!dependencies.platformAccess) {
        return reply.code(503).send(
          failure(
            request.id,
            "IDENTITY_STORE_NOT_CONFIGURED",
            "用户与课程授权存储尚未配置。",
          ),
        );
      }
      const platformActor = await dependencies.platformAccess.getActor(actor.userId);
      if (!platformActor) {
        return reply.code(401).send(
          failure(request.id, "ACTOR_NOT_FOUND", "用户不存在或已停用。"),
        );
      }
      const courseAssigned = await dependencies.platformAccess.isCourseAssigned(
        actor.userId,
        invocation.data.course_id,
        "student",
      );
      if (!platformActor.roles.includes("student") || !courseAssigned) {
        return reply.code(403).send(
          failure(
            request.id,
            "COURSE_ACCESS_DENIED",
            "只有已加入当前课程的学生可以使用该学习模块。",
          ),
        );
      }

      const workflowRequestId = `workflow_${request.id}`;
      if (
        invocation.data.capability === "care"
        && studentCareCrisisSignalPresent(invocation.data.user_message)
      ) {
        return success(request.id, careCrisisResponse(workflowRequestId));
      }
      const preferences = await dependencies.studentAiPreferences?.get(actor.userId);
      if (preferences?.collaboration_enabled === false) {
        return reply.code(409).send(failure(request.id, "AI_COLLABORATION_DISABLED", "AI 多智能体协作已关闭，可在账户设置中开启。"));
      }
      const lease = dependencies.aiRequestLimiter.acquire(actor.userId);
      if (!lease.allowed) {
        return reply
          .header("Retry-After", String(lease.retryAfterSeconds))
          .code(429)
          .send(failure(
            request.id,
            "AI_REQUEST_LIMITED",
            "AI 学习请求较多，请稍后再试。",
            true,
          ));
      }
      try {
        let workflowRequest = await dependencies.workflowContext.build({
          requestId: workflowRequestId,
          userId: actor.userId,
          invocation: invocation.data,
        });
        workflowRequest = {
          ...workflowRequest,
          visual_explanations: preferences?.visual_explanations_enabled ?? false,
        };
        const conversationId = invocation.data.capability === "care"
          ? invocation.data.conversation_id ?? null
          : null;
        if (conversationId) {
          const careCheckIn = workflowRequest.context.care_check_in;
          if (!careCheckIn || careCheckIn.conversation_id !== conversationId) {
            throw new WorkflowContextIncompleteError("care_consent");
          }
          workflowRequest = aiWorkflowRequestSchema.parse({
            ...workflowRequest,
            context: {
              ...workflowRequest.context,
              care_check_in: {
                ...careCheckIn,
                recent_turns: dependencies.careConversationStore.read(
                  actor.userId,
                  conversationId,
                ),
              },
            },
          });
        }
        const result = { ...await dependencies.aiWorkflowGateway.run(workflowRequest) };
        // Apply the saved preference even when an alternate gateway returns a diagram.
        if (!workflowRequest.visual_explanations) delete result.diagram;
        if (
          conversationId
          && (result.status === "ready" || result.status === "degraded")
        ) {
          const assistantMessage = result.display_blocks
            .map((block) => block.content)
            .join("\n\n")
            .trim();
          if (assistantMessage && invocation.data.user_message) {
            dependencies.careConversationStore.appendExchange(
              actor.userId,
              conversationId,
              invocation.data.user_message,
              assistantMessage,
            );
          }
        }
        return success(request.id, result);
      } catch (error) {
        if (error instanceof WorkflowContextIncompleteError) {
          return success(
            request.id,
            incompleteResponse(workflowRequestId, capability.data),
          );
        }
        throw error;
      } finally {
        lease.release();
      }
    },
  );
}
