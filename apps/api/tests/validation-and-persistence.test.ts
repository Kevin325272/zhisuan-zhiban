import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { createDemoState } from "../src/domain/demo-state.js";
import { createDemoFlow } from "../src/services/demo-flow.js";
import { MockBfsCodeEvaluator } from "../src/services/evaluator/mock-bfs-evaluator.js";
import {
  applyPersistedState,
  buildPersistedState,
  loadPersistedState,
} from "../src/services/state-persistence.js";

const fixedBfsSource = "// mock: visited-on-enqueue";

async function submitFixed(app: FastifyInstance, key: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/tasks/task_bfs_bug_001/submissions",
    headers: { "idempotency-key": key },
    payload: {
      task_version: 1,
      answer: null,
      code: { language: "cpp", source: fixedBfsSource },
      custom_input: null,
      client_draft_version: 1,
      hint_usage_ids: [],
    },
  });
}

describe("write route request validation", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("rejects a submission without a code payload as 400 instead of 500", async () => {
    app = buildApp({ answerModel: null, enableLegacyAgentRoutes: true, enableLegacyDemoRoutes: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: { "idempotency-key": "invalid-body" },
      payload: { task_version: "not-a-number" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(response.json().error.details.issues.length).toBeGreaterThan(0);
  });

  it("rejects a validation attempt without code as 400", async () => {
    app = buildApp({ answerModel: null, enableLegacyDemoRoutes: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/validations/task_bfs_transfer_001/attempts",
      headers: { "idempotency-key": "invalid-validation" },
      payload: { task_version: 1, expected_learning_state_version: 7, answer: null },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects malformed learning-session and message bodies as 400", async () => {
    app = buildApp({ answerModel: null, enableLegacyAgentRoutes: true });
    const badSession = await app.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
      payload: { mode: "guided_learning" },
    });
    expect(badSession.statusCode).toBe(400);

    const session = await app.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
      payload: {
        course_id: "course_ds_001",
        learning_node_id: "node_bfs_001",
        task_id: "task_bfs_bug_001",
        mode: "guided_learning",
      },
    });
    const sessionId = session.json().data.session_id;
    const badMessage = await app.inject({
      method: "POST",
      url: `/api/v1/learning-sessions/${sessionId}/messages`,
      payload: { requested_action: "question_answer" },
    });
    expect(badMessage.statusCode).toBe(400);
    expect(badMessage.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("ignores client mock scenarios when they are disabled", async () => {
    app = buildApp({
      answerModel: null,
      allowMockScenarios: false,
      enableLegacyAgentRoutes: true,
    });
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
      payload: {
        course_id: "course_ds_001",
        learning_node_id: "node_bfs_001",
        task_id: "task_bfs_bug_001",
        mode: "guided_learning",
      },
    });
    const sessionId = session.json().data.session_id;
    const message = await app.inject({
      method: "POST",
      url: `/api/v1/learning-sessions/${sessionId}/messages`,
      payload: {
        content: "BFS 为什么能求无权图最短路？",
        submission_id: null,
        requested_action: "question_answer",
        mock_scenario: "agent_timeout",
      },
    });
    const events = await app.inject({
      method: "GET",
      url: message.json().data.event_url,
    });
    expect(events.body).not.toContain("AGENT_TIMEOUT");
    expect(events.body).toContain("run.completed");
  });

  it("keeps client mock scenarios disabled unless the app explicitly opts in", async () => {
    app = buildApp({ answerModel: null, enableLegacyAgentRoutes: true });
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
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
      payload: {
        content: "BFS 为什么能求无权图最短路？",
        submission_id: null,
        requested_action: "question_answer",
        mock_scenario: "agent_timeout",
      },
    });
    const events = await app.inject({
      method: "GET",
      url: message.json().data.event_url,
    });

    expect(events.body).not.toContain("AGENT_TIMEOUT");
    expect(events.body).toContain("run.completed");
  });
});

describe("true streaming behaviour", () => {
  it("forwards each model delta as its own SSE event", async () => {
    const app = buildApp({
      answerModel: {
        model: "gpt-5.6-terra",
        async answer(_request, options = {}) {
          options.onDelta?.("第一段。");
          options.onDelta?.("第二段。");
          return {
            text: "第一段。第二段。",
            requestedModel: "gpt-5.6-terra",
            providerModel: "gpt-5.6-terra",
          };
        },
      },
      enableLegacyAgentRoutes: true,
    });
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
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
      payload: {
        content: "BFS 为什么能求无权图最短路？",
        submission_id: null,
        requested_action: "question_answer",
      },
    });
    const events = await app.inject({
      method: "GET",
      url: message.json().data.event_url,
    });
    const deltaFrames = events.body
      .split("\n\n")
      .filter((frame) => frame.includes("event: assistant.delta"));
    expect(deltaFrames).toHaveLength(2);
    expect(deltaFrames[0]).toContain("第一段。");
    expect(deltaFrames[1]).toContain("第二段。");
    expect(events.body).toContain("run.completed");
    await app.close();
  });
});

describe("state persistence", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "xuetu-state-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("round-trips mutable learning state through a snapshot", async () => {
    const state = createDemoState();
    const flow = createDemoFlow(state, new MockBfsCodeEvaluator());
    await flow.submitTask(
      "task_bfs_bug_001",
      {
        task_version: 1,
        answer: null,
        code: { language: "cpp", source: fixedBfsSource },
        custom_input: null,
        client_draft_version: 1,
        hint_usage_ids: [],
      },
      "persist-key",
    );
    const snapshot = buildPersistedState(state, flow);

    const restoredState = createDemoState();
    const restoredFlow = createDemoFlow(restoredState, new MockBfsCodeEvaluator());
    applyPersistedState(restoredState, restoredFlow, snapshot);

    expect(restoredState.learning_state_version).toBe(state.learning_state_version);
    expect(
      restoredState.nodes.find((node) => node.learning_node_id === "node_bfs_001")?.status,
    ).toBe("validation_ready");
    expect(restoredFlow.listSubmissions("task_bfs_bug_001")).toHaveLength(1);
  });

  it("ignores corrupt snapshot files and keeps starting", () => {
    const filePath = join(directory, "corrupt.json");
    writeFileSync(filePath, "{not json", "utf8");
    expect(loadPersistedState(filePath)).toBeNull();
  });

  it("rejects structurally invalid JSON snapshots instead of crashing during restore", () => {
    const filePath = join(directory, "invalid-shape.json");
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, flow: {}, nodes: [] }),
      "utf8",
    );

    expect(loadPersistedState(filePath)).toBeNull();
  });

  it("restores submissions after an app restart when persistPath is set", async () => {
    const filePath = join(directory, "runtime-state.json");
    const first = buildApp({ answerModel: null, persistPath: filePath, enableLegacyDemoRoutes: true });
    const submitted = await submitFixed(first, "restart-key");
    expect(submitted.statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await first.close();
    expect(readFileSync(filePath, "utf8")).toContain("sub_001");

    const second = buildApp({ answerModel: null, persistPath: filePath, enableLegacyDemoRoutes: true });
    const history = await second.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
    });
    expect(history.json().data.items).toHaveLength(1);
    const plan = await second.inject({ method: "GET", url: "/api/v1/learning-plan" });
    expect(plan.json().data.learning_state_version).toBe(8);
    await second.close();
  });

  it("flushes a pending snapshot before the app closes", async () => {
    const filePath = join(directory, "close-flush.json");
    const app = buildApp({ answerModel: null, persistPath: filePath, enableLegacyDemoRoutes: true });
    const submitted = await submitFixed(app, "close-flush-key");
    expect(submitted.statusCode).toBe(201);

    await app.close();

    expect(readFileSync(filePath, "utf8")).toContain("sub_001");
  });
});
