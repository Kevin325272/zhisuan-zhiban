import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { PerUserAiRequestLimiter } from "../src/services/ai-request-limiter.js";
import type {
  LocalAuthenticationService,
  PublicAccount,
} from "../src/services/auth/authentication.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

const student: PublicAccount = {
  user_id: "student_limited",
  username: "student_limited",
  display_name: "限流学生",
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

const authentication = {
  async resolveSession(token: string) {
    return token === "student-token" ? { account: student } : null;
  },
} as unknown as LocalAuthenticationService;

const platformAccess: PlatformAccessService = {
  async getActor(userId) {
    return {
      user: {
        user_id: userId,
        display_name: "限流学生",
        account_status: "active",
        auth_source: "local_development",
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
      },
      roles: ["student"],
    };
  },
  async isCourseAssigned() {
    return true;
  },
};

const authHeaders = { cookie: "xuetu_session=student-token" };

function workflowResult(request: { request_id: string; capability: string; slot: string }) {
  return {
    contract_version: "0.2",
    request_id: request.request_id,
    capability: request.capability,
    slot: request.slot,
    status: "unavailable",
    display_blocks: [],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure: {
      code: "WORKFLOW_NOT_CONNECTED",
      message: "暂不可用",
      retryable: true,
      fallback_message: "继续非 AI 学习路径。",
    },
  };
}

function buildLimitedApp(overrides: Record<string, unknown> = {}) {
  return buildApp({
    authentication,
    platformAccess,
    answerModel: null,
    enableLegacyAgentRoutes: true,
    enableLegacyDemoRoutes: true,
    workflowContext: {
      async build(input: { requestId: string; userId: string; invocation: { capability: string; course_id: string } }) {
        return {
          contract_version: "0.2",
          request_id: input.requestId,
          capability: input.invocation.capability,
          slot: "learning_orchestration",
          user_id: input.userId,
          course_id: input.invocation.course_id,
          concept_id: null,
          source_chunk_ids: [],
          attempt_id: null,
          learning_evidence: [],
          user_message: null,
          context: {
            student: { user_id: input.userId },
            course: { course_id: input.invocation.course_id, title: "408", discipline: "计算机" },
            concept: null,
            source_chunks: [],
            reading_progress: null,
            qa_case: null,
            attempt: null,
            evaluation: null,
          },
        };
      },
    },
    aiWorkflowGateway: {
      status() {
        return { state: "configured", label: "已配置", detail: null, checked_at: null };
      },
      async run(request: never) {
        return workflowResult(request);
      },
    },
    studentProfileWorkflow: {
      async generate(_userId: string, requestId: string) {
        return {
          contract_version: "0.2",
          request_id: requestId,
          status: "unavailable",
          profile_summary: "确定性画像仍可查看。",
          course_progress: [],
          strengths: [],
          priority_gaps: [],
          evidence_summary: {
            objective_evidence_count: 0,
            subjective_evidence_count: 0,
            reading_progress_count: 0,
            practice_attempt_count: 0,
            needs_review_count: 0,
            explanation: "暂无证据。",
          },
          next_tasks: [],
          failure: {
            code: "WORKFLOW_NOT_CONNECTED",
            message: "暂不可用",
            retryable: true,
            fallback_message: "确定性画像仍可查看。",
          },
        };
      },
    },
    aiRequestLimit: {
      maxRequests: 1,
      windowMs: 60_000,
      maxConcurrent: 1,
      maxTrackedUsers: 100,
    },
    ...overrides,
  } as never);
}

async function runAgent(app: FastifyInstance) {
  const session = await app.inject({
    method: "POST",
    url: "/api/v1/learning-sessions",
    headers: authHeaders,
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
    headers: authHeaders,
    payload: {
      content: "BFS 为什么需要队列？",
      submission_id: null,
      requested_action: "question_answer",
    },
  });
  return app.inject({
    method: "GET",
    url: message.json().data.event_url,
    headers: authHeaders,
  });
}

function invokeWorkflow(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: "/api/v1/student/ai-workflows/plan",
    headers: authHeaders,
    payload: {
      contract_version: "0.2",
      capability: "plan",
      course_id: "course_408_co",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      user_message: null,
    },
  });
}

function invokeProfile(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: "/api/v1/student/profile/ai",
    headers: authHeaders,
    payload: { course_id: "course_408_co" },
  });
}

describe("per-user AI request limits", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it.each([
    ["learner agent", runAgent],
    ["four-capability workflow", invokeWorkflow],
    ["profile workflow", invokeProfile],
  ])("rate limits repeated %s requests without disabling non-AI routes", async (_label, invoke) => {
    app = buildLimitedApp();
    expect((await invoke(app)).statusCode).toBe(200);

    const limited = await invoke(app);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.json().error.code).toBe("AI_REQUEST_LIMITED");

    const course = await app.inject({
      method: "GET",
      url: "/api/v1/courses/course_ds_001/map",
      headers: authHeaders,
    });
    expect(course.statusCode).toBe(200);
  });

  it("rejects a concurrent workflow call for the same student", async () => {
    let releaseGateway!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseGateway = resolve;
    });
    app = buildLimitedApp({
      aiRequestLimit: {
        maxRequests: 10,
        windowMs: 60_000,
        maxConcurrent: 1,
        maxTrackedUsers: 100,
      },
      aiWorkflowGateway: {
        status() {
          return { state: "configured", label: "已配置", detail: null, checked_at: null };
        },
        async run(request: never) {
          markStarted();
          await release;
          return workflowResult(request);
        },
      },
    });

    const first = invokeWorkflow(app);
    await started;
    const second = invokeWorkflow(app);
    const secondSettledBeforeRelease = await Promise.race([
      second.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    releaseGateway();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondSettledBeforeRelease).toBe(true);
    expect(secondResponse.statusCode).toBe(429);
  });

  it("keeps profile interpretation in a separate concurrency lane", async () => {
    let releaseGateway!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseGateway = resolve;
    });
    app = buildLimitedApp({
      aiRequestLimit: {
        maxRequests: 10,
        windowMs: 60_000,
        maxConcurrent: 1,
        maxTrackedUsers: 100,
      },
      aiWorkflowGateway: {
        status() {
          return { state: "configured", label: "已配置", detail: null, checked_at: null };
        },
        async run(request: never) {
          markStarted();
          await release;
          return workflowResult(request);
        },
      },
    });

    const workflow = invokeWorkflow(app);
    await started;
    const profile = await invokeProfile(app);
    releaseGateway();
    await workflow;

    expect(profile.statusCode).toBe(200);
    expect(profile.json().data.status).toBe("unavailable");
  });

  it("keeps aggregate allow, rejection, and concurrency audit counters without user identifiers", () => {
    let now = 0;
    const limiter = new PerUserAiRequestLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      maxConcurrent: 1,
      maxTrackedUsers: 10,
      now: () => now,
    });

    const first = limiter.acquire("student_a");
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error("expected the first lease to be allowed");
    expect(limiter.snapshot()).toMatchObject({
      total_allowed: 1,
      total_rejected: 0,
      rejected_by_reason: { rate: 0, concurrency: 0, capacity: 0 },
      current_concurrent: 1,
      peak_concurrent: 1,
      tracked_users: 1,
    });

    const rateRejected = limiter.acquire("student_a");
    expect(rateRejected).toMatchObject({ allowed: false, reason: "concurrency" });
    first.release();
    const second = limiter.acquire("student_a");
    expect(second).toMatchObject({ allowed: false, reason: "rate" });
    now = 60_001;
    const afterWindow = limiter.acquire("student_a");
    expect(afterWindow.allowed).toBe(true);
    if (!afterWindow.allowed) throw new Error("expected the post-window lease to be allowed");
    afterWindow.release();

    expect(limiter.snapshot()).toMatchObject({
      total_allowed: 2,
      total_rejected: 2,
      rejected_by_reason: { rate: 1, concurrency: 1, capacity: 0 },
      current_concurrent: 0,
      peak_concurrent: 1,
    });
    expect(JSON.stringify(limiter.snapshot())).not.toContain("student_a");
  });
});
