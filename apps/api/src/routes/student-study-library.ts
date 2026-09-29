import {
  memoryCardWriteSchema,
  memoryReviewSchema,
  notebookIdSchema,
  studyCollectionWriteSchema,
  studyMapQuerySchema,
} from "@xuetu/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  resolveRequestIdentity,
  type RequestIdentityOptions,
} from "../services/auth/request-identity.js";
import {
  StudyLibraryError,
  type StudentStudyLibrary,
} from "../services/study-library/student-study-library.js";

export function registerStudentStudyLibraryRoutes(
  app: FastifyInstance,
  library: StudentStudyLibrary,
  options: RequestIdentityOptions,
) {
  async function run(
    request: FastifyRequest,
    reply: FastifyReply,
    action: (userId: string) => Promise<unknown>,
  ) {
    try {
      const actor = await resolveRequestIdentity(request, options);
      if (!actor)
        throw new StudyLibraryError(
          "AUTHENTICATION_REQUIRED",
          "请先登录学生账户。",
          401,
        );
      if (!actor.roles.includes("student"))
        throw new StudyLibraryError(
          "STUDENT_ACCESS_REQUIRED",
          "当前入口仅供学生使用。",
          403,
        );
      return {
        contract_version: "0.1",
        request_id: request.id,
        data: await action(actor.userId),
      };
    } catch (error) {
      const known = error instanceof StudyLibraryError,
        invalid = error instanceof z.ZodError;
      const status = known ? error.status : invalid ? 400 : 500;
      if (status === 500) request.log.error(error);
      return reply.code(status).send({
        contract_version: "0.1",
        request_id: request.id,
        error: {
          code: known
            ? error.code
            : invalid
              ? "STUDY_INPUT_INVALID"
              : "STUDY_UNAVAILABLE",
          message: known
            ? error.message
            : invalid
              ? "请检查填写内容后重试。"
              : "暂时无法读取或保存，请稍后重试。",
          retryable: status >= 500,
          details: {},
        },
      });
    }
  }
  const base = "/api/v1/student/study-library";
  const id = (r: FastifyRequest) =>
    notebookIdSchema.parse((r.params as { id: string }).id);
  const version = (r: FastifyRequest) =>
    z.coerce
      .number()
      .int()
      .positive()
      .parse((r.query as { version?: string }).version);
  app.get(`${base}/map`, (r, p) =>
    run(r, p, (u) => library.map(u, studyMapQuerySchema.parse(r.query))),
  );
  app.get(`${base}/collections`, (r, p) =>
    run(r, p, async (u) => ({ items: await library.collections(u) })),
  );
  app.get(`${base}/collections/:id`, (r, p) =>
    run(r, p, (u) => library.collection(u, id(r))),
  );
  app.put(`${base}/collections/:id`, (r, p) =>
    run(r, p, async (u) => ({
      collection: await library.saveCollection(
        u,
        id(r),
        studyCollectionWriteSchema.parse(r.body),
      ),
    })),
  );
  app.delete(`${base}/collections/:id`, (r, p) =>
    run(r, p, async (u) => {
      await library.removeCollection(u, id(r), version(r));
      return { removed: true };
    }),
  );
  app.get(`${base}/questions/:id/collections`, (r, p) =>
    run(r, p, async (u) => ({ ids: await library.memberships(u, id(r)) })),
  );
  for (const method of ["PUT", "DELETE"] as const)
    app.route({
      method,
      url: `${base}/collections/:id/questions/:qid`,
      handler: (r, p) =>
        run(r, p, async (u) => {
          await library.setMembership(
            u,
            id(r),
            notebookIdSchema.parse((r.params as { qid: string }).qid),
            method === "PUT",
          );
          return { saved: true };
        }),
    });
  app.get(`${base}/cards`, (r, p) =>
    run(r, p, async (u) => ({ items: await library.cards(u) })),
  );
  app.get(`${base}/card-seeds`, (r, p) =>
    run(r, p, async (u) => ({ items: await library.cardSeeds(u) })),
  );
  app.put(`${base}/cards/:id`, (r, p) =>
    run(r, p, async (u) => ({
      card: await library.saveCard(
        u,
        id(r),
        memoryCardWriteSchema.parse(r.body),
      ),
    })),
  );
  app.delete(`${base}/cards/:id`, (r, p) =>
    run(r, p, async (u) => {
      await library.removeCard(u, id(r), version(r));
      return { removed: true };
    }),
  );
  app.get(`${base}/today`, (r, p) => run(r, p, (u) => library.today(u)));
  app.post(`${base}/today`, (r, p) => run(r, p, (u) => library.startDay(u)));
  app.post(`${base}/reviews`, (r, p) =>
    run(r, p, (u) => library.review(u, memoryReviewSchema.parse(r.body))),
  );
}
