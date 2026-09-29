import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type {
  LocalAuthenticationService,
  PublicAccount,
} from "../src/services/auth/authentication.js";
import type { CourseAnswerModel } from "../src/services/openai-compatible-chat.js";

function account(userId: string): PublicAccount {
  return {
    user_id: userId,
    username: userId,
    display_name: userId,
    account_status: "active",
    roles: ["student"],
    auth_source: "local_development",
    account_origin: "registered",
    data_boundary: "local_account",
    must_change_password: false,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    last_login_at: null,
  };
}

function twoStudentAuthentication() {
  const accounts = new Map([
    ["token-a", account("student_a")],
    ["token-b", account("student_b")],
  ]);
  return {
    async resolveSession(token: string) {
      const resolved = accounts.get(token);
      return resolved ? { account: resolved } : null;
    },
  } as unknown as LocalAuthenticationService;
}

function cookie(token: "token-a" | "token-b") {
  return { cookie: `xuetu_session=${token}` };
}

describe("authenticated in-memory learning isolation", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("keeps legacy BFS submissions and mistakes inside the owning student account", async () => {
    app = buildApp({
      authentication: twoStudentAuthentication(),
      answerModel: null,
      enableLegacyAgentRoutes: true,
      enableLegacyDemoRoutes: true,
    });

    const submission = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: { ...cookie("token-a"), "idempotency-key": "student-a-failed-bfs" },
      payload: {
        task_version: 1,
        answer: null,
        code: { language: "cpp", source: "// mock: visited-on-dequeue" },
        client_draft_version: 1,
        hint_usage_ids: [],
        mock_answer_variant: "visited-on-dequeue",
      },
    });
    expect(submission.statusCode).toBe(201);
    const submissionId = submission.json().data.submission_id as string;

    const ownerHistory = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: cookie("token-a"),
    });
    const otherHistory = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: cookie("token-b"),
    });
    const otherDirectRead = await app.inject({
      method: "GET",
      url: `/api/v1/submissions/${submissionId}`,
      headers: cookie("token-b"),
    });
    const ownerMistakes = await app.inject({
      method: "GET",
      url: "/api/v1/mistakes",
      headers: cookie("token-a"),
    });
    const otherMistakes = await app.inject({
      method: "GET",
      url: "/api/v1/mistakes",
      headers: cookie("token-b"),
    });

    expect(ownerHistory.json().data.items).toHaveLength(1);
    expect(otherHistory.json().data.items).toEqual([]);
    expect(otherDirectRead.statusCode).toBe(404);
    expect(ownerMistakes.json().data.items).toHaveLength(1);
    expect(otherMistakes.json().data.items).toEqual([]);
  });

  it("prevents another student from appending to a learner session or reading its run", async () => {
    app = buildApp({
      authentication: twoStudentAuthentication(),
      answerModel: null,
      enableLegacyAgentRoutes: true,
    });
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
      headers: cookie("token-a"),
      payload: {
        course_id: "course_ds_001",
        learning_node_id: "node_bfs_001",
        task_id: "task_bfs_bug_001",
        mode: "guided_learning",
      },
    });
    const sessionId = session.json().data.session_id as string;

    const foreignMessage = await app.inject({
      method: "POST",
      url: `/api/v1/learning-sessions/${sessionId}/messages`,
      headers: cookie("token-b"),
      payload: {
        content: "读取别人的会话",
        submission_id: null,
        requested_action: "question_answer",
      },
    });
    expect(foreignMessage.statusCode).toBe(404);

    const ownerMessage = await app.inject({
      method: "POST",
      url: `/api/v1/learning-sessions/${sessionId}/messages`,
      headers: cookie("token-a"),
      payload: {
        content: "BFS 为什么需要队列？",
        submission_id: null,
        requested_action: "question_answer",
      },
    });
    expect(ownerMessage.statusCode).toBe(201);

    const foreignEvents = await app.inject({
      method: "GET",
      url: ownerMessage.json().data.event_url,
      headers: cookie("token-b"),
    });
    const ownerEvents = await app.inject({
      method: "GET",
      url: ownerMessage.json().data.event_url,
      headers: cookie("token-a"),
    });
    expect(foreignEvents.statusCode).toBe(404);
    expect(ownerEvents.statusCode).toBe(200);
    expect(ownerEvents.body).toContain("run.completed");
  });

  it("waits for an in-flight learner run before completing a reconnect replay", async () => {
    let releaseModel!: () => void;
    let markModelStarted!: () => void;
    const modelStarted = new Promise<void>((resolve) => {
      markModelStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const answer = vi.fn<CourseAnswerModel["answer"]>(async () => {
      markModelStarted();
      await release;
      return {
        text: "完整回答",
        requestedModel: "gpt-5.6-terra",
        providerModel: "gpt-5.6-terra",
      };
    });
    app = buildApp({
      authentication: twoStudentAuthentication(),
      answerModel: { model: "gpt-5.6-terra", answer },
      enableLegacyAgentRoutes: true,
    });
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
      headers: cookie("token-a"),
      payload: {
        course_id: "course_ds_001",
        learning_node_id: "node_bfs_001",
        task_id: "task_bfs_bug_001",
        mode: "guided_learning",
      },
    });
    const message = await app.inject({
      method: "POST",
      url: `/api/v1/learning-sessions/${session.json().data.session_id}/messages`,
      headers: cookie("token-a"),
      payload: {
        content: "BFS 为什么能求无权图最短路？",
        submission_id: null,
        requested_action: "question_answer",
      },
    });

    const firstStream = app.inject({
      method: "GET",
      url: message.json().data.event_url,
      headers: cookie("token-a"),
    });
    await modelStarted;
    const reconnect = app.inject({
      method: "GET",
      url: message.json().data.event_url,
      headers: { ...cookie("token-a"), "last-event-id": "0" },
    });
    const reconnectSettledBeforeRun = await Promise.race([
      reconnect.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    releaseModel();

    const [firstResponse, reconnectResponse] = await Promise.all([firstStream, reconnect]);
    expect(reconnectSettledBeforeRun).toBe(false);
    expect(firstResponse.body).toContain("run.completed");
    expect(reconnectResponse.body).toContain("run.completed");
    expect(reconnectResponse.body).toContain("完整回答");
  });
});
