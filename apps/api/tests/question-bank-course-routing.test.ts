import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerQuestionBankRoutes } from "../src/routes/question-bank.js";
import type { QuestionBankService } from "../src/services/question-bank/question-bank.js";
import type { QuestionBankDirectory } from "../src/services/question-bank/question-bank-directory.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

function fixture(enrolled = true) {
  const app = Fastify();
  const makeBank = (courseId: string) => ({
    courseId,
    select: vi.fn().mockResolvedValue({ items: [{ question: { id: "co-question", subject: "组成原理" } }], total: 1, limit: 1, offset: 0 }),
    get: vi.fn().mockResolvedValue({ id: "co-question", subject: "组成原理" }),
    openAsset: vi.fn().mockResolvedValue({ role: "question", mimeType: "image/png", byteLength: 4, content: Buffer.from([137,80,78,71]) }),
    evaluate: vi.fn().mockResolvedValue({ attempt: { course_id: courseId } }),
    listPastExamPapers: vi.fn().mockResolvedValue({ items: [] }),
  });
  const shared = makeBank("course_408_001");
  const course = makeBank("course_408_co");
  const directory: QuestionBankDirectory = {
    forSelection: vi.fn(async (selection) => selection.mode === "past_exam" ? shared as QuestionBankService : course as QuestionBankService),
    forQuestion: vi.fn().mockResolvedValue(course),
  };
  const access = {
    getActor: async () => ({ user: { account_status: "active" }, roles: ["student"] }),
    isCourseAssigned: async (_id: string, courseId: string) => courseId === shared.courseId || enrolled,
  } as unknown as PlatformAccessService;
  registerQuestionBankRoutes(app, shared as QuestionBankService, { allowLocalDevAuth: true, platformAccess: access, directory });
  return { app, shared, course };
}
const headers = { "x-dev-user-id": "student-qa" };
const answer = { question_id: "co-question", answer_type: "choice", selected_option_ids: ["A"] };

describe("subject question-bank routing", () => {
  it("includes governed shared imports in a subject concept's practice queue", async () => {
    const { app, shared, course } = fixture();
    course.select.mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 });
    const result = await app.inject({ url: "/api/v1/question-bank/questions?subject=组成原理&concept_id=co-concept", headers });
    expect(result.statusCode).toBe(200);
    expect(result.json().data.total).toBe(1);
    expect(shared.select).toHaveBeenCalledWith("student-qa", expect.objectContaining({ concept_id: "co-concept" }));
    await app.close();
  });
  it("includes shared questions after course questions, including a page crossing the source boundary", async () => {
    const { app, shared, course } = fixture();
    course.select.mockResolvedValue({ items: [{ question: { id: "course-last", subject: "组成原理" } }], total: 2, limit: 2, offset: 1 });
    shared.select.mockResolvedValue({ items: [{ question: { id: "shared-first", subject: "组成原理" } }], total: 3, limit: 1, offset: 0 });
    const result = await app.inject({ url: "/api/v1/question-bank/questions?subject=组成原理&type=choice&offset=1&limit=2", headers });
    expect(result.statusCode).toBe(200);
    expect(result.json().data).toMatchObject({ total: 5, offset: 1, limit: 2, items: [{ question: { id: "course-last" } }, { question: { id: "shared-first" } }] });
    expect(shared.select).toHaveBeenCalledWith("student-qa", expect.objectContaining({ offset: 0, limit: 1 }));
    await app.close();
  });
  it("continues pagination within shared questions when the course has already been exhausted", async () => {
    const { app, shared, course } = fixture();
    course.select.mockResolvedValue({ items: [], total: 2, limit: 1, offset: 3 });
    shared.select.mockResolvedValue({ items: [{ question: { id: "shared-second", subject: "组成原理" } }], total: 3, limit: 1, offset: 1 });
    const result = await app.inject({ url: "/api/v1/question-bank/questions?subject=组成原理&type=choice&offset=3&limit=1", headers });
    expect(result.json().data).toMatchObject({ total: 5, offset: 3, items: [{ question: { id: "shared-second" } }] });
    expect(shared.select).toHaveBeenCalledWith("student-qa", expect.objectContaining({ offset: 1, limit: 1 }));
    await app.close();
  });
  it("selects a subject course and keeps the shared past-exam catalog", async () => {
    const { app, shared, course } = fixture();
    const result = await app.inject({ url: "/api/v1/question-bank/questions?subject=组成原理&type=choice&question_id=co-question", headers });
    expect(result.statusCode).toBe(200); expect(course.select).toHaveBeenCalled(); expect(shared.select).not.toHaveBeenCalled();
    await app.inject({ url: "/api/v1/question-bank/past-exams", headers });
    expect(shared.listPastExamPapers).toHaveBeenCalledWith("student-qa"); await app.close();
  });
  it("routes question detail, assets and grading to the same source course", async () => {
    const { app, course, shared } = fixture();
    expect((await app.inject({ url: "/api/v1/question-bank/questions/co-question", headers })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/v1/question-bank/questions/co-question/assets/diagram", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/question-bank/evaluations", headers: { ...headers, "idempotency-key": "qa-1" }, payload: answer })).statusCode).toBe(201);
    expect(course.get).toHaveBeenCalledWith("co-question");
    expect(course.openAsset).toHaveBeenCalledWith("student-qa", "co-question", "diagram", undefined);
    expect(course.evaluate).toHaveBeenCalledWith("student-qa", answer, "qa-1");
    expect(shared.evaluate).not.toHaveBeenCalled(); await app.close();
  });
  it("keeps older shared practice available when a course has no matching questions", async () => {
    const { app, shared, course } = fixture();
    course.select.mockResolvedValueOnce({ items: [], total: 0, limit: 1, offset: 0 });
    const result = await app.inject({ url: "/api/v1/question-bank/questions?subject=组成原理&type=choice", headers });
    expect(result.statusCode).toBe(200);
    expect(course.select).toHaveBeenCalled(); expect(shared.select).toHaveBeenCalled();
    expect(result.json().data.total).toBe(1); await app.close();
  });
  it.each([
    { url: "/api/v1/question-bank/questions?subject=组成原理&question_id=co-question" },
    { url: "/api/v1/question-bank/questions/co-question" },
    { url: "/api/v1/question-bank/questions/co-question/assets/diagram" },
    { method: "POST" as const, url: "/api/v1/question-bank/evaluations", payload: answer },
  ])("requires source-course membership for $url", async (request) => {
    const { app, course } = fixture(false);
    const result = await app.inject({ ...request, headers: { ...headers, "idempotency-key": "qa-denied" } });
    expect(result.statusCode).toBe(403);
    for (const fn of [course.select, course.get, course.openAsset, course.evaluate]) expect(fn).not.toHaveBeenCalled();
    await app.close();
  });
});
