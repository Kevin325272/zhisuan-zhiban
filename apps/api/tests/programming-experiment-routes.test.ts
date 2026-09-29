import type {
  CodeRunResult,
  ProgrammingExperimentAttemptRecord,
  ProgrammingExperimentHistory,
} from "@xuetu/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { LocalAuthenticationService, PublicAccount } from "../src/services/auth/authentication.js";
import type { CodeEvaluator } from "../src/services/evaluator/code-evaluator.js";
import type {
  ProgrammingExperimentRepository,
  SaveProgrammingExperimentAttempt,
} from "../src/services/programming-experiments/postgres-programming-experiment.js";

const student: PublicAccount = {
  user_id: "user_student_session",
  username: "student_session",
  display_name: "会话学生",
  account_status: "active",
  roles: ["student"],
  auth_source: "local_development",
  account_origin: "registered",
  data_boundary: "local_account",
  must_change_password: false,
  created_at: "2026-08-02T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
  last_login_at: null,
};

const admin: PublicAccount = {
  ...student,
  user_id: "user_admin_session",
  username: "admin_session",
  display_name: "会话管理员",
  roles: ["admin"],
};

const sandboxResult: CodeRunResult = {
  run_id: "sandbox_run_001",
  task_id: "task_bfs_bug_001",
  status: "failed",
  execution_mode: "sandbox",
  evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
  degraded_reason: null,
  language: "cpp",
  detected_variant: "visited-on-dequeue",
  passed_count: 2,
  total_count: 4,
  duration_ms: 18,
  memory_kb: 3_456,
  stdout: "运行完成：2/4 个用例通过。",
  stderr: "visited 标记发生在出队后。",
  error_line: 15,
  trace_available: true,
  trace_variant: "visited-on-dequeue",
  test_cases: [],
};

function authentication() {
  return {
    async resolveSession(token: string) {
      if (token === "student-session") return { account: student };
      if (token === "admin-session") return { account: admin };
      return null;
    },
  } as unknown as LocalAuthenticationService;
}

function platformAccess() {
  return {
    async getActor(userId: string) {
      const account = userId.includes("admin") ? admin : student;
      return {
        user: {
          user_id: account.user_id,
          display_name: account.display_name,
          account_status: "active" as const,
          auth_source: "local_development" as const,
          created_at: account.created_at,
          updated_at: account.updated_at,
        },
        roles: account.roles,
      };
    },
    async isCourseAssigned() { return true; },
  };
}

function memoryRepository() {
  const byOwner = new Map<string, Array<{ key: string; record: ProgrammingExperimentAttemptRecord }>>();
  const ownerKey = (userId: string, experimentId: string) => `${userId}:${experimentId}`;
  const repository: ProgrammingExperimentRepository = {
    async listAttempts(userId, experimentId, limit): Promise<ProgrammingExperimentHistory> {
      const records = byOwner.get(ownerKey(userId, experimentId)) ?? [];
      return { items: records.slice(0, limit).map((item) => item.record), total: records.length };
    },
    async findIdempotent(userId, experimentId, idempotencyKey) {
      return byOwner.get(ownerKey(userId, experimentId))
        ?.find((item) => item.key === idempotencyKey)?.record ?? null;
    },
    async saveAttempt(input: SaveProgrammingExperimentAttempt) {
      const key = ownerKey(input.userId, input.record.experiment_id);
      const records = byOwner.get(key) ?? [];
      records.unshift({ key: input.idempotencyKey, record: input.record });
      byOwner.set(key, records);
      return input.record;
    },
  };
  return { repository, byOwner };
}

function evaluator(result: CodeRunResult = sandboxResult) {
  return {
    evaluate: vi.fn(async () => result),
    health: vi.fn(async () => ({ status: "sandbox" as const, label: result.evaluator_label, detail: null })),
  } satisfies CodeEvaluator;
}

describe("student programming experiment routes", () => {
  let app: ReturnType<typeof buildApp>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("lists the available experiments with only the current student's status", async () => {
    const { repository, byOwner } = memoryRepository();
    byOwner.set("user_student_session:ds-bfs-visited-v1", [{
      key: "existing-attempt",
      record: {
        attempt_id: "prog_attempt_existing",
        experiment_id: "ds-bfs-visited-v1",
        course_id: "course_408_ds",
        concept_id: "ds_c06_03",
        task_id: "task_bfs_bug_001",
        language: "cpp",
        source: "vector<int> bfs() { return {}; }",
        result: {
          ...sandboxResult,
          status: "passed",
          execution_mode: "sandbox",
          degraded_reason: null,
          passed_count: 4,
        },
        diagnosis: {
          status: "passed",
          title: "实验通过",
          summary: "4/4 个固定用例全部通过。",
          evidence: [],
          correction_goal: "返回关联知识点复习。",
          next_action: "review_concept",
        },
        created_at: "2026-08-15T08:00:00.000Z",
      },
    }]);
    app = buildApp({
      authentication: authentication(),
      platformAccess: platformAccess(),
      programmingExperiments: repository,
      codeEvaluator: evaluator(),
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/programming-experiments",
      headers: { cookie: "xuetu_session=student-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      items: [{
        definition: { experiment_id: "ds-bfs-visited-v1", concept_id: "ds_c06_03" },
        latest_attempt: { attempt_id: "prog_attempt_existing", result: { passed_count: 4 } },
        attempt_count: 1,
      }],
    });
    expect(JSON.stringify(response.json())).not.toContain("user_student_session");
  });

  it("loads the fixed experiment and only the current student's history", async () => {
    const { repository } = memoryRepository();
    app = buildApp({
      authentication: authentication(),
      platformAccess: platformAccess(),
      programmingExperiments: repository,
      codeEvaluator: evaluator(),
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/programming-experiments/ds-bfs-visited-v1",
      headers: { cookie: "xuetu_session=student-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      definition: { concept_id: "ds_c06_03", language: "cpp" },
      latest_attempt: null,
      attempt_count: 0,
    });
    expect(JSON.stringify(response.json())).not.toContain("user_id");
  });

  it("runs code through the injected sandbox without persisting a formal attempt", async () => {
    const { repository, byOwner } = memoryRepository();
    const codeEvaluator = evaluator();
    app = buildApp({
      authentication: authentication(),
      platformAccess: platformAccess(),
      programmingExperiments: repository,
      codeEvaluator,
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/programming-experiments/ds-bfs-visited-v1/runs",
      headers: { cookie: "xuetu_session=student-session" },
      payload: { language: "cpp", source: "vector<int> bfs() { return {}; }", custom_input: null },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ execution_mode: "sandbox", passed_count: 2 });
    expect(codeEvaluator.evaluate).toHaveBeenCalledWith("task_bfs_bug_001", expect.objectContaining({ language: "cpp" }));
    expect(byOwner.size).toBe(0);
  });

  it("persists one account-owned formal attempt and replays its idempotency key", async () => {
    const { repository } = memoryRepository();
    const codeEvaluator = evaluator();
    app = buildApp({
      authentication: authentication(),
      platformAccess: platformAccess(),
      programmingExperiments: repository,
      codeEvaluator,
    } as never);
    const request = {
      method: "POST" as const,
      url: "/api/v1/student/programming-experiments/ds-bfs-visited-v1/attempts",
      headers: { cookie: "xuetu_session=student-session", "idempotency-key": "attempt-001" },
      payload: { language: "cpp", source: "vector<int> bfs() { return {}; }", custom_input: null },
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({
      experiment_id: "ds-bfs-visited-v1",
      result: { execution_mode: "sandbox" },
      diagnosis: { status: "needs_revision", next_action: "retry" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json().data.attempt_id).toBe(first.json().data.attempt_id);
    expect(codeEvaluator.evaluate).toHaveBeenCalledOnce();
  });

  it("refuses to persist mock or fallback output as a real experiment", async () => {
    const { repository, byOwner } = memoryRepository();
    app = buildApp({
      authentication: authentication(),
      platformAccess: platformAccess(),
      programmingExperiments: repository,
      codeEvaluator: evaluator({
        ...sandboxResult,
        execution_mode: "mock_fallback",
        evaluator_label: "演示降级评测",
        degraded_reason: "Judge0 unavailable",
      }),
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/programming-experiments/ds-bfs-visited-v1/attempts",
      headers: { cookie: "xuetu_session=student-session", "idempotency-key": "attempt-002" },
      payload: { language: "cpp", source: "vector<int> bfs() { return {}; }", custom_input: null },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("EXPERIMENT_REQUIRES_SANDBOX");
    expect(byOwner.size).toBe(0);
  });

  it("rejects anonymous and administrator access before reading student history", async () => {
    const { repository } = memoryRepository();
    app = buildApp({
      authentication: authentication(),
      platformAccess: platformAccess(),
      programmingExperiments: repository,
      codeEvaluator: evaluator(),
    } as never);

    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/student/programming-experiments/ds-bfs-visited-v1",
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/student/programming-experiments/ds-bfs-visited-v1",
      headers: { cookie: "xuetu_session=admin-session" },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
  });
});
