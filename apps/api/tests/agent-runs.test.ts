import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { CourseAnswerModel } from "../src/services/openai-compatible-chat.js";
import type { AiWorkflowGateway } from "../src/services/ai-workflow/ai-workflow-gateway.js";

interface ParsedEvent {
  id: number;
  type: string;
  data: {
    run_id: string;
    sequence: number;
    payload: Record<string, unknown>;
  };
}

function parseSse(body: string): ParsedEvent[] {
  return body
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const id = Number(lines.find((line) => line.startsWith("id: "))?.slice(4));
      const type = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
      const rawData = lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "{}";
      return { id, type, data: JSON.parse(rawData) };
    });
}

describe("deterministic agent event stream", () => {
  let app: FastifyInstance;
  const answerMock = vi.fn<CourseAnswerModel["answer"]>();
  const answerModel: CourseAnswerModel = {
    model: "gpt-5.6-terra",
    answer: answerMock,
  };

  beforeEach(() => {
    answerMock.mockReset();
    answerMock.mockResolvedValue({
      text: "这是由测试模型生成的 BFS 回答。",
      requestedModel: "gpt-5.6-terra",
      providerModel: "gpt-5.6-terra",
    });
    app = buildApp({
      answerModel,
      allowMockScenarios: true,
      enableLegacyAgentRoutes: true,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("does not register legacy learning sessions without an explicit local switch", async () => {
    const productionSurface = buildApp({ answerModel: null });
    const response = await productionSurface.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
      payload: {
        course_id: "course_ds_001",
        learning_node_id: "node_bfs_001",
        task_id: "task_bfs_bug_001",
        mode: "guided_learning",
      },
    });
    await productionSurface.close();

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  async function createRun(
    mockScenario: "normal" | "rag_empty" | "rag_low_confidence" | "agent_timeout" = "normal",
  ) {
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
        content: "为什么这个顶点会被重复加入队列？",
        submission_id: "sub_001",
        requested_action: "diagnosis",
        mock_scenario: mockScenario,
      },
    });
    expect(message.statusCode).toBe(201);
    return message.json().data;
  }

  async function createQuestionRun(
    content = "BFS 为什么能求无权图最短路？",
    mockScenario?: "auto" | "normal" | "rag_empty" | "rag_low_confidence" | "agent_timeout",
  ) {
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
        content,
        submission_id: null,
        requested_action: "question_answer",
        ...(mockScenario ? { mock_scenario: mockScenario } : {}),
      },
    });
    expect(message.statusCode).toBe(201);
    return message.json().data;
  }

  it("streams the normal diagnosis stages in a stable order", async () => {
    const run = await createRun();
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "stage.started",
      "retrieval.completed",
      "assistant.delta",
      "diagnosis.completed",
      "run.completed",
    ]);
    expect(events.map((event) => event.data.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("uses the live model for diagnosis while forwarding objective workspace evidence", async () => {
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
        content: "请根据本次评测证据定位问题，并给出下一步提示。",
        submission_id: "sub_001",
        requested_action: "diagnosis",
        mock_scenario: "normal",
        hint_level: "clue",
        workspace_context: {
          active_view: "evidence",
          language: "cpp",
          task_title: "修复 BFS 重复入队问题",
          task_id: "task_bfs_bug_001",
          learning_node_id: "node_bfs_001",
          submission_id: "sub_001",
          code_excerpt: "visited[current] = true;",
          test_summary: "2/4 个用例通过",
          trace_summary: "节点 4 在汇聚边后重复入队",
          error_line: 14,
          selected_test_case_id: "case_diamond",
          failed_test_cases: ["菱形汇聚图：实际输出包含重复节点 4"],
          trace_variant: "visited-on-dequeue",
          learner_weak_points: ["BFS visited 标记时机"],
        },
      },
    });
    const run = message.json().data;
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);
    const answer = events.find((event) => event.type === "assistant.delta");

    expect(answerMock).toHaveBeenCalledOnce();
    expect(answerMock.mock.calls[0]?.[0]).toMatchObject({
      requestedAction: "diagnosis",
      hintLevel: "clue",
      workspaceContext: {
        active_view: "evidence",
        submission_id: "sub_001",
        test_summary: "2/4 个用例通过",
        failed_test_cases: ["菱形汇聚图：实际输出包含重复节点 4"],
        error_line: 14,
      },
    });
    expect(answer?.data.payload).toMatchObject({
      generated_by: "model",
      answer_mode: "rag",
    });
    const completed = events.find((event) => event.type === "run.completed");
    expect(completed?.data.payload).toMatchObject({
      requested_model: "gpt-5.6-terra",
      provider_model: "gpt-5.6-terra",
    });
    expect(String(answer?.data.payload.delta)).toContain("测试模型生成");
  });

  it("resumes strictly after Last-Event-ID", async () => {
    const run = await createRun();
    const response = await app.inject({
      method: "GET",
      url: run.event_url,
      headers: { "last-event-id": "3" },
    });
    const events = parseSse(response.body);

    expect(events.map((event) => event.id)).toEqual([4, 5, 6]);
  });

  it("returns an explicit no-source result without fabricating citations", async () => {
    const run = await createRun("rag_empty");
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);
    const retrieval = events.find((event) => event.type === "retrieval.completed");

    expect(retrieval?.data.payload).toMatchObject({
      citation_ids: [],
      confidence_level: "low",
      degraded: true,
    });
    expect(response.body).not.toContain("source_ds_book_143");
    expect(events.at(-1)?.type).toBe("run.completed");
  });

  it("keeps real citations while marking a low-confidence retrieval", async () => {
    const run = await createRun("rag_low_confidence");
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);
    const retrieval = events.find((event) => event.type === "retrieval.completed");

    expect(retrieval?.data.payload).toMatchObject({
      citation_ids: ["csdn_149521023_chunk_0008", "csdn_131792829_chunk_0002"],
      confidence_level: "low",
      degraded: true,
    });
    expect(events.at(-1)?.type).toBe("run.completed");
  });

  it("surfaces a retryable timeout while preserving the completed stages", async () => {
    const run = await createRun("agent_timeout");
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "stage.started",
      "run.failed",
    ]);
    expect(events.at(-1)?.data.payload).toMatchObject({
      error: { code: "AGENT_TIMEOUT", retryable: true },
      fallback_action: "show_evidence",
    });
  });

  it("automatically retrieves fixture sources and streams the model answer", async () => {
    const run = await createQuestionRun();
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);
    const retrieval = events.find((item) => item.type === "retrieval.completed");

    expect(response.body).toContain("这是由测试模型生成的 BFS 回答");
    expect(retrieval?.data.payload).toMatchObject({
      citation_ids: ["csdn_131792829_chunk_0002", "csdn_136340070_chunk_0005"],
      confidence_level: "high",
      degraded: false,
    });
    expect(response.body).toContain('\"action_type\":\"question_answer\"');
    expect(answerMock).toHaveBeenCalledOnce();
    expect(answerMock.mock.calls[0]?.[0].chunks).toHaveLength(2);
    expect(answerMock.mock.calls[0]?.[0]).toMatchObject({
      learnerContext: {
        major: "计算机科学与技术",
        course: "数据结构",
        currentTopic: "广度优先遍历",
        weakPoints: expect.arrayContaining([expect.stringContaining("visited 标记时机")]),
      },
    });
  });

  it("keeps conversation history inside one session and forwards live workspace context", async () => {
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

    for (const [content, hintLevel] of [
      ["菱形图为什么失败？", "direction"],
      ["那应该改哪一段？", "clue"],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/learning-sessions/${sessionId}/messages`,
        payload: {
          content,
          submission_id: null,
          requested_action: "question_answer",
          hint_level: hintLevel,
          workspace_context: {
            active_view: "tests",
            language: "cpp",
            task_title: "修复 BFS 重复入队问题",
            code_excerpt: "visited[current] = true;",
            test_summary: "菱形汇聚图失败",
            trace_summary: null,
            error_line: 14,
          },
        },
      });
      expect(response.statusCode).toBe(201);
      const run = response.json().data;
      await app.inject({ method: "GET", url: run.event_url });
    }

    expect(answerMock).toHaveBeenCalledTimes(2);
    expect(answerMock.mock.calls[0]?.[0].conversationHistory).toEqual([]);
    expect(answerMock.mock.calls[1]?.[0]).toMatchObject({
      hintLevel: "clue",
      workspaceContext: {
        active_view: "tests",
        error_line: 14,
      },
      conversationHistory: [
        { role: "user", content: "菱形图为什么失败？" },
        { role: "assistant", content: "这是由测试模型生成的 BFS 回答。" },
      ],
    });
  });

  it("turns a low-information message into a profile-aware learning prompt", async () => {
    const run = await createQuestionRun("1");
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);
    const answer = events.find((item) => item.type === "assistant.delta");

    expect(answerMock).not.toHaveBeenCalled();
    expect(events.some((item) => item.type === "retrieval.completed")).toBe(false);
    expect(answer?.data.payload).toMatchObject({
      answer_mode: "guided",
      generated_by: "assistant_policy",
      profile_context_used: true,
    });
    expect(String(answer?.data.payload.delta)).toContain("你刚才发的是“1”");
    expect(String(answer?.data.payload.delta)).toContain("visited 标记时机");
    expect(String(answer?.data.payload.delta)).toContain("我可以帮你");
    expect(response.body).not.toContain("未命中测试知识库");
  });

  it("answers a general question naturally when retrieval has no sources", async () => {
    answerMock.mockResolvedValueOnce({
      text: "TCP 采用三次握手是为了让双方确认彼此的收发能力。",
      requestedModel: "gpt-5.6-terra",
      providerModel: "gpt-5.6-terra",
    });
    const run = await createQuestionRun("TCP 三次握手为什么不能只握手两次？");
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);
    const retrieval = events.find((item) => item.type === "retrieval.completed");

    expect(retrieval?.data.payload).toMatchObject({
      citation_ids: [],
      confidence_level: "low",
      degraded: true,
    });
    expect(answerMock).toHaveBeenCalledOnce();
    expect(answerMock.mock.calls[0]?.[0]).toMatchObject({
      question: "TCP 三次握手为什么不能只握手两次？",
      confidenceLevel: "low",
      chunks: [],
      learnerContext: {
        major: "计算机科学与技术",
        course: "数据结构",
        currentTopic: "广度优先遍历",
      },
    });
    expect(response.body).toContain("TCP 采用三次握手");
    expect(response.body).not.toContain("未命中测试知识库");
    expect(events.at(-1)?.data.payload).toMatchObject({
      finished_reason: "completed_without_sources",
    });
  });

  it("keeps a general 408 companion session free from the fixed BFS learner profile", async () => {
    const session = await app.inject({
      method: "POST",
      url: "/api/v1/learning-sessions",
      payload: {
        course_id: "course_408_001",
        learning_node_id: "node_408_ai_companion",
        task_id: "task_408_open_question",
        mode: "guided_learning",
      },
    });
    const message = await app.inject({
      method: "POST",
      url: `/api/v1/learning-sessions/${session.json().data.session_id}/messages`,
      payload: {
        content: "虚拟内存的主要作用是什么？",
        submission_id: null,
        requested_action: "question_answer",
        mock_scenario: "rag_empty",
      },
    });

    await app.inject({ method: "GET", url: message.json().data.event_url });

    expect(answerMock).toHaveBeenCalledOnce();
    expect(answerMock.mock.calls[0]?.[0].learnerContext).toEqual({
      major: "计算机科学与技术",
      course: "408 课程群",
      currentTopic: "本轮主动提问",
      weakPoints: [],
      nextRecommendation: "根据本轮问题进入对应课程知识点，并用课程训练验证理解。",
    });
  });

  it("adds an explicit warning to a low-confidence model answer", async () => {
    const run = await createQuestionRun(
      "普通 BFS 能直接求任意带权图最短路吗？",
      "rag_low_confidence",
    );
    const response = await app.inject({ method: "GET", url: run.event_url });

    expect(response.body).toContain("测试来源匹配度较低");
    expect(response.body).toContain("这是由测试模型生成的 BFS 回答");
    expect(answerMock).toHaveBeenCalledOnce();
  });

  it("converts a provider failure to a safe retryable stream event", async () => {
    answerMock.mockRejectedValueOnce(new Error("provider-secret-body"));
    const run = await createQuestionRun();
    const response = await app.inject({ method: "GET", url: run.event_url });
    const events = parseSse(response.body);

    expect(events.at(-1)?.type).toBe("run.failed");
    expect(events.at(-1)?.data.payload).toMatchObject({
      error: {
        code: "MODEL_UPSTREAM_ERROR",
        retryable: true,
      },
      fallback_action: "retry_question",
    });
    expect(response.body).not.toContain("provider-secret-body");
  });

  it("exposes only readiness on the unauthenticated system status route", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/system-status" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ status: "ready" });
    expect(response.body).not.toMatch(/evaluator|agent|rag|model|workflow|profile|apiKey/iu);
  });

  it("does not probe or expose configured workflow topology through public status", async () => {
    const statusProbe = vi.fn<AiWorkflowGateway["status"]>();
    const aiWorkflowGateway: AiWorkflowGateway = {
      status(capability) {
        statusProbe(capability);
        if (capability === "diagnose") {
          return {
            state: "available",
            label: "AI 学伴可用",
            detail: null,
            checked_at: "2026-08-21T00:00:00.000Z",
          };
        }
        return {
          state: "configured",
          label: "AI 服务已配置，尚未验证",
          detail: "等待对应能力完成一次成功调用。",
          checked_at: null,
        };
      },
      async run() {
        throw new Error("not used by status probe");
      },
    };
    const statusApp = buildApp({ answerModel: null, aiWorkflowGateway });

    const response = await statusApp.inject({ method: "GET", url: "/api/v1/system-status" });
    await statusApp.close();

    expect(response.json().data).toEqual({ status: "ready" });
    expect(statusProbe).not.toHaveBeenCalled();
  });
});
