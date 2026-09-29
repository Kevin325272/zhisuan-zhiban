import { studentAiPreferencesPatchSchema } from "@xuetu/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveRequestIdentity, type RequestIdentityOptions } from "../services/auth/request-identity.js";
import type { StudentAiPreferencesStore } from "../services/student-ai-preferences.js";

export function registerStudentAiPreferencesRoutes(app: FastifyInstance, store: StudentAiPreferencesStore, options: RequestIdentityOptions) {
  const failure = (request: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string) =>
    reply.code(status).send({ contract_version: "0.2", request_id: request.id, error: { code, message, retryable: status >= 500, details: {} } });
  const handle = async (request: FastifyRequest, reply: FastifyReply, write: boolean) => {
    const actor = await resolveRequestIdentity(request, options);
    if (!actor) return failure(request, reply, 401, "AUTHENTICATION_REQUIRED", "请先登录学生账户。");
    if (!actor.roles.includes("student")) return failure(request, reply, 403, "STUDENT_ACCESS_REQUIRED", "当前设置仅供学生使用。");
    if (Object.keys(request.query as object ?? {}).length) return failure(request, reply, 400, "AI_PREFERENCES_INVALID", "设置参数无效。");
    const patch = write ? studentAiPreferencesPatchSchema.safeParse(request.body) : null;
    if (patch && !patch.success) return failure(request, reply, 400, "AI_PREFERENCES_INVALID", "请选择要更新的学习偏好。");
    try {
      const data = patch?.success ? await store.update(actor.userId, patch.data) : await store.get(actor.userId);
      return { contract_version: "0.2", request_id: request.id, data };
    } catch (error) {
      request.log.error(error);
      return failure(request, reply, 503, "AI_PREFERENCES_UNAVAILABLE", "学习偏好暂时无法保存或读取，请重试。");
    }
  };
  app.get("/api/v1/student/ai-preferences", (request, reply) => handle(request, reply, false));
  app.patch("/api/v1/student/ai-preferences", (request, reply) => handle(request, reply, true));
}
