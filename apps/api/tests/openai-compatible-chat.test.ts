import { describe, expect, it, vi } from "vitest";

import { readLlmConfig } from "../src/config/llm.js";
import {
  ModelProviderError,
  buildCourseAnswerMessages,
  createOpenAiCompatibleChat,
} from "../src/services/openai-compatible-chat.js";
import type { RetrievedTestChunk } from "../src/services/test-knowledge-base.js";

const apiKey = "unit-test-secret";

function config(overrides: Partial<NonNullable<ReturnType<typeof readLlmConfig>>> = {}) {
  return {
    baseUrl: "http://127.0.0.1:8317/v1",
    apiKey,
    model: "gpt-5.6-terra",
    timeoutMs: 100,
    ...overrides,
  };
}

function chunk(sourceId: string, text = "BFS 使用队列按层扩展顶点。"): RetrievedTestChunk {
  return {
    sourceId,
    documentId: `doc_${sourceId}`,
    title: `来源 ${sourceId}`,
    author: "测试作者",
    url: "https://example.com/source",
    text,
    relevance: 0.9,
  };
}

describe("LLM configuration", () => {
  it("reads and validates explicit provider protocol and generation settings", () => {
    const environment = {
      LLM_API_KEY: apiKey,
      LLM_API_FORMAT: "chat_completions",
      LLM_REASONING_EFFORT: "low",
      LLM_MAX_OUTPUT_TOKENS: "4096",
    };
    expect(readLlmConfig(environment)).toMatchObject({
      apiFormat: "chat_completions",
      reasoningEffort: "low",
      maxOutputTokens: 4096,
    });
    expect(() => readLlmConfig({ ...environment, LLM_API_FORMAT: "unknown" })).toThrow();
    expect(() => readLlmConfig({ ...environment, LLM_REASONING_EFFORT: "unknown" })).toThrow();
    expect(() => readLlmConfig({ ...environment, LLM_MAX_OUTPUT_TOKENS: "0" })).toThrow();
  });
  it("defaults to the local CPA gateway and gpt-5.6-terra", () => {
    expect(readLlmConfig({ LLM_API_KEY: apiKey })).toEqual({
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey,
      model: "gpt-5.6-terra",
      timeoutMs: 30_000,
    });
  });

  it("returns null when the API key is not configured", () => {
    expect(readLlmConfig({})).toBeNull();
  });

  it("accepts HTTPS and loopback HTTP while rejecting other plain HTTP hosts", () => {
    expect(
      readLlmConfig({ LLM_API_KEY: apiKey, LLM_BASE_URL: "https://api.example.com/v1/" }),
    ).toMatchObject({ baseUrl: "https://api.example.com/v1" });
    expect(
      readLlmConfig({ LLM_API_KEY: apiKey, LLM_BASE_URL: "http://localhost:8317/v1" }),
    ).toMatchObject({ baseUrl: "http://localhost:8317/v1" });
    expect(() =>
      readLlmConfig({ LLM_API_KEY: apiKey, LLM_BASE_URL: "http://192.168.1.8:8317/v1" }),
    ).toThrow(/回环|HTTPS/u);
  });
});

describe("OpenAI-compatible chat adapter", () => {
  it("passes explicit reasoning and output budget to normal chat", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      model: "ZHIPU/GLM-5.3-Flash", choices: [{ message: { content: "按层访问。" } }],
    })));
    const model = createOpenAiCompatibleChat(config({
      model: "ZHIPU/GLM-5.3-Flash", reasoningEffort: "low", maxOutputTokens: 4096,
    }), { fetchFn });
    await model.answer({ question: "解释 BFS", confidenceLevel: "high", chunks: [chunk("source_1")] });
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "ZHIPU/GLM-5.3-Flash", reasoning_effort: "low", max_tokens: 4096,
    });
  });
  it("sends the minimal CPA chat request and separates requested and returned model names", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          model: "provider-reported-terra",
          choices: [{ message: { content: "BFS 会按层访问顶点。" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const model = createOpenAiCompatibleChat(config(), { fetchFn });

    const result = await model.answer({
      question: "为什么 BFS 能求无权图最短路？",
      confidenceLevel: "high",
      chunks: [chunk("source_1")],
    });

    expect(result).toEqual({
      text: "BFS 会按层访问顶点。",
      requestedModel: "gpt-5.6-terra",
      providerModel: "provider-reported-terra",
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:8317/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });
    expect(Object.keys(JSON.parse(String(init?.body))).sort()).toEqual([
      "messages",
      "model",
      "stream",
    ]);
  });

  it("limits and marks retrieved corpus text as untrusted", () => {
    const messages = buildCourseAnswerMessages({
      question: "这个说法可靠吗？",
      confidenceLevel: "low",
      chunks: [
        chunk("source_1", "甲".repeat(3_000)),
        chunk("source_2", "乙".repeat(3_000)),
        chunk("source_3", "丙".repeat(3_000)),
      ],
    });
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("不可信测试语料");
    expect(serialized).toContain("测试来源匹配度较低");
    expect(serialized).toContain("source_1");
    expect(serialized).toContain("source_2");
    expect(serialized).not.toContain("source_3");
    expect(serialized.length).toBeLessThan(5_000);
  });

  it("builds a natural tutoring prompt when retrieval has no matching chunks", () => {
    const messages = buildCourseAnswerMessages({
      question: "TCP 三次握手为什么不能只握手两次？",
      confidenceLevel: "low",
      chunks: [],
    });
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("基于通用知识直接回答");
    expect(serialized).toContain("不要向学生报告知识库是否命中");
    expect(serialized).toContain("只有单个数字");
    expect(serialized).toContain("结合学习画像");
    expect(serialized).toContain("不得伪造课程来源");
    expect(serialized).toContain("408 四门课程");
    expect(serialized).not.toContain("超出数据结构或 BFS 范围");
    expect(serialized).not.toContain("当前问题未命中测试知识库");
    expect(serialized).not.toContain("不可信测试语料");
  });

  it("keeps recent conversation and applies the selected hint policy to workspace context", () => {
    const messages = buildCourseAnswerMessages({
      question: "那应该改哪一段？",
      confidenceLevel: "high",
      chunks: [chunk("source_1")],
      conversationHistory: [
        { role: "user", content: "菱形图为什么失败？" },
        { role: "assistant", content: "先观察 visited 的更新时间。" },
      ],
      hintLevel: "clue",
      workspaceContext: {
        active_view: "tests",
        language: "cpp",
        task_title: "修复 BFS 重复入队问题",
        task_id: "task_bfs_bug_001",
        learning_node_id: "node_bfs_001",
        submission_id: "submission_001",
        code_excerpt: "visited[current] = true;",
        test_summary: "菱形汇聚图输出了重复节点 4",
        trace_summary: "第 5 步节点 4 重复入队",
        error_line: 14,
        selected_test_case_id: "case_diamond",
        failed_test_cases: ["菱形汇聚图", "双汇聚图"],
        execution_mode: "sandbox",
        evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
        runtime_summary: ["菱形汇聚图：5 ms / 1880 KB"],
        evaluator_error: "实际输出包含重复节点 4",
        trace_variant: "visited-on-dequeue",
        learner_weak_points: ["BFS visited 标记时机"],
      },
    });
    const serialized = JSON.stringify(messages);

    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(serialized).toContain("关键线索");
    expect(serialized).toContain("菱形汇聚图输出了重复节点 4");
    expect(serialized).toContain("第 5 步节点 4 重复入队");
    expect(serialized).toContain("task_bfs_bug_001");
    expect(serialized).toContain("submission_001");
    expect(serialized).toContain("case_diamond");
    expect(serialized).toContain("双汇聚图");
    expect(serialized).toContain("隔离沙箱");
    expect(serialized).toContain("Judge0 · C++ (GCC 14.1.0)");
    expect(serialized).toContain("菱形汇聚图：5 ms / 1880 KB");
    expect(serialized).toContain("实际输出包含重复节点 4");
    expect(serialized).toContain("visited-on-dequeue");
    expect(serialized).toContain("BFS visited 标记时机");
    expect(serialized).toContain("先观察 visited 的更新时间");
  });

  it("adds action-specific boundaries for an evidence-grounded diagnosis", () => {
    const messages = buildCourseAnswerMessages({
      question: "请根据本次评测证据定位问题，并给出下一步提示。",
      requestedAction: "diagnosis",
      confidenceLevel: "high",
      chunks: [chunk("source_1")],
      workspaceContext: {
        active_view: "evidence",
        language: "cpp",
        task_title: "修复 BFS 重复入队问题",
        task_id: "task_bfs_bug_001",
        learning_node_id: "node_bfs_001",
        submission_id: "sub_001",
        code_excerpt: "visited[current] = true;",
        test_summary: "2/4 个用例通过",
        trace_summary: "节点 4 重复入队",
        error_line: 14,
        selected_test_case_id: "case_diamond",
        failed_test_cases: ["菱形汇聚图失败"],
        execution_mode: "sandbox",
        evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
        runtime_summary: ["菱形汇聚图：6 ms / 1720 KB"],
        evaluator_error: null,
        trace_variant: "visited-on-dequeue",
        learner_weak_points: ["BFS visited 标记时机"],
      },
    });
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("诊断任务");
    expect(serialized).toContain("客观证据");
    expect(serialized).toContain("不得声称已经运行代码");
    expect(serialized).toContain("不要修改学习掌握状态");
  });

  it.each([401, 429, 500])("turns HTTP %s into a safe provider error", async (status) => {
    const fetchFn = vi.fn(async () => new Response("provider-secret-body", { status }));
    const model = createOpenAiCompatibleChat(config(), { fetchFn });

    let thrown: unknown;
    try {
      await model.answer({
        question: "问题",
        confidenceLevel: "high",
        chunks: [chunk("source_1")],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ModelProviderError);
    expect(thrown).toMatchObject({ code: "MODEL_UPSTREAM_HTTP" });
    expect(String(thrown)).toContain(String(status));
    expect(String(thrown)).not.toContain(apiKey);
    expect(String(thrown)).not.toContain("provider-secret-body");
  });

  it("returns a stable timeout error", async () => {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    );
    const model = createOpenAiCompatibleChat(config({ timeoutMs: 5 }), { fetchFn });

    await expect(
      model.answer({
        question: "问题",
        confidenceLevel: "high",
        chunks: [chunk("source_1")],
      }),
    ).rejects.toMatchObject({ code: "MODEL_TIMEOUT", retryable: true });
  });

  it("rejects an empty answer as an invalid provider response", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ model: "gpt-5.6-terra", choices: [{ message: { content: " " } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const model = createOpenAiCompatibleChat(config(), { fetchFn });

    await expect(
      model.answer({
        question: "问题",
        confidenceLevel: "high",
        chunks: [chunk("source_1")],
      }),
    ).rejects.toMatchObject({ code: "MODEL_INVALID_RESPONSE", retryable: true });
  });
});
