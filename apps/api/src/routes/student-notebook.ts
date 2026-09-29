import { notebookIdSchema, notebookQuerySchema, notebookWriteSchema } from "@xuetu/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveRequestIdentity, type RequestIdentityOptions } from "../services/auth/request-identity.js";
import { NotebookError, type StudentNotebook } from "../services/student-notebook.js";

const success = (request: FastifyRequest, data: unknown) => ({ contract_version: "0.1", request_id: request.id, data });
function failure(request: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ contract_version: "0.1", request_id: request.id, error: { code, message, retryable: status >= 500, details: {} } });
}
export function registerStudentNotebookRoutes(app: FastifyInstance, notebook: StudentNotebook, options: RequestIdentityOptions) {
  const run = async (request: FastifyRequest, reply: FastifyReply, action: (userId: string) => Promise<unknown>) => {
    try {
      const actor = await resolveRequestIdentity(request, options);
      if (!actor) return failure(request, reply, 401, "AUTHENTICATION_REQUIRED", "请先登录学生账户。");
      if (!actor.roles.includes("student")) return failure(request, reply, 403, "STUDENT_ACCESS_REQUIRED", "当前入口仅供学生使用。");
      return success(request, await action(actor.userId));
    } catch (error) {
      if (error instanceof NotebookError) return failure(request, reply, error.status, error.code, error.message);
      request.log.error(error);
      return failure(request, reply, 500, "NOTEBOOK_UNAVAILABLE", "笔记暂时无法保存或读取，请稍后重试。");
    }
  };
  app.get<{ Querystring: unknown }>("/api/v1/student/notebook", async (request, reply) => run(request, reply, async (userId) => {
    const query = notebookQuerySchema.safeParse(request.query);
    if (!query.success) throw new NotebookError("NOTEBOOK_INPUT_INVALID", "笔记筛选条件无效。", 400);
    return notebook.list(userId, query.data);
  }));
  app.get<{ Params: { id: string } }>("/api/v1/student/notebook/:id", async (request, reply) => run(request, reply, async (userId) => {
    const id = notebookIdSchema.safeParse(request.params.id);
    if (!id.success) throw new NotebookError("NOTEBOOK_INPUT_INVALID", "笔记编号无效。", 400);
    return { entry: await notebook.get(userId, id.data) };
  }));
  app.put<{ Params: { id: string }; Body: unknown }>("/api/v1/student/notebook/:id", async (request, reply) => run(request, reply, async (userId) => {
    const id = notebookIdSchema.safeParse(request.params.id);
    const input = notebookWriteSchema.safeParse(request.body);
    if (!id.success || !input.success) throw new NotebookError("NOTEBOOK_INPUT_INVALID", "请填写笔记标题，正文最多20000字。", 400);
    return { entry: await notebook.save(userId, id.data, input.data) };
  }));
  app.delete<{ Params: { id: string }; Querystring: { version?: string } }>("/api/v1/student/notebook/:id", async (request, reply) => run(request, reply, async (userId) => {
    const id = notebookIdSchema.safeParse(request.params.id);
    const version = Number(request.query.version);
    if (!id.success || !Number.isSafeInteger(version) || version < 1) throw new NotebookError("NOTEBOOK_INPUT_INVALID", "请重新读取笔记后再移除。", 400);
    await notebook.remove(userId, id.data, version);
    return { removed: true };
  }));
}
