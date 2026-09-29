import { describe, expect, it, vi } from "vitest";

import {
  AgentChatError,
  type AgentChatGatewayOptions,
} from "../src/services/agent-chat/agent-chat-gateway.js";
import { DifyAgentChatGateway } from "../src/services/agent-chat/dify-agent-chat-gateway.js";

const ENDPOINT = "https://api.dify.ai/v1/workflows/run";

function options(overrides: Partial<AgentChatGatewayOptions> = {}): AgentChatGatewayOptions {
  return {
    requestId: "agentchat_req_001",
    userId: "user_student_001",
    context: "study",
    message: "TCP 传输层与网络层有什么区别？",
    ...overrides,
  };
}

function sseFrame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function workflowFinished(outputs: Record<string, unknown>) {
  return sseFrame("workflow_finished", {
    task_id: "task_001",
    data: { id: "run_001", workflow_id: "wf_001", status: "succeeded", outputs },
  });
}

describe("DifyAgentChatGateway", () => {
  it("posts the streaming workflow request and extracts the answer text from the SSE stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      sseFrame("workflow_started", { task_id: "task_001", data: { id: "run_001" } })
      + workflowFinished({
        answer: JSON.stringify({
          status: "success",
          display_blocks: [
            { kind: "explanation", content: "网络层管「送到哪台机器」。" },
            { kind: "explanation", content: "传输层管「交给哪个进程」。" },
          ],
        }),
      }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const deltas: string[] = [];

    const text = await gateway.streamReply(options(), (chunk) => deltas.push(chunk));

    expect(text).toBe("网络层管「送到哪台机器」。\n\n传输层管「交给哪个进程」。");
    expect(deltas).toEqual([text]);
    expect(fetchMock).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer app-secret",
          Accept: "text/event-stream",
        }),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      inputs: Record<string, string>;
      response_mode: string;
      user: string;
    };
    expect(body.inputs.user_text).toBe("TCP 传输层与网络层有什么区别？");
    expect(body.inputs.capability).toBe("explain");
    expect(body.inputs.textbook_snippets).toContain("cn_k0001");
    expect(body.inputs.textbook_snippets).toContain("cn_k0401");
    expect(body.response_mode).toBe("streaming");
    expect(body.user).toBe("user_student_001");
  });

  it("maps lab and teacher contexts to the workflow capability branches that pass the upstream gate", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(sseResponse(
      workflowFinished({ answer: JSON.stringify({ status: "success", display_blocks: [{ kind: "explanation", content: "分支回复。" }] }) }),
    )));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await gateway.streamReply(options({ context: "lab" }), () => {});
    await gateway.streamReply(options({ context: "teacher" }), () => {});

    const labBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      inputs: Record<string, string>;
    };
    const teacherBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as {
      inputs: Record<string, string>;
    };
    expect(labBody.inputs.capability).toBe("plan");
    expect(teacherBody.inputs.capability).toBe("coach");
  });

  it("parses Dify's actual streaming format with ping frames and embedded event names", async () => {
    const difyStyleBody = [
      "event: ping",
      "",
      `data: {"event":"workflow_started","workflow_run_id":"run_001","task_id":"task_001","data":{"id":"run_001","workflow_id":"wf_001","created_at":1,"reason":"initial"}}`,
      "",
      `data: {"event":"workflow_finished","workflow_run_id":"run_001","task_id":"task_001","data":{"id":"run_001","workflow_id":"wf_001","status":"succeeded","outputs":{"answer":"工作流真实回复。"},"error":null}}`,
      "",
      "",
    ].join("\n");
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(difyStyleBody));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).resolves.toBe("工作流真实回复。");
  });

  it("accepts CRLF-separated SSE frames", async () => {
    const crlfBody = [
      "event: workflow_started\r\ndata: {\"task_id\":\"task_001\",\"data\":{\"id\":\"run_001\"}}\r\n\r\n",
      "event: workflow_finished\r\n",
      `data: ${JSON.stringify({ task_id: "task_001", data: { id: "run_001", status: "succeeded", outputs: { answer: "CRLF 正文。" } } })}\r\n\r\n`,
    ].join("");
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(crlfBody));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).resolves.toBe("CRLF 正文。");
  });

  it("strips the upstream reasoning block and extracts the embedded gate JSON answer", async () => {
    const gated = [
      "<think>",
      "<!--dify-deepseek-reasoning-->需要审查草稿并封装 JSON。",
      "</think>",
      JSON.stringify({
        status: "success",
        answer: "门禁校验后的正式回复。",
        evidence_refs: ["cn_k0001"],
        uncertainties: [],
      }),
    ].join("");
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      workflowFinished({
        answer: JSON.stringify({
          status: "success",
          display_blocks: [{ kind: "explanation", content: gated }],
        }),
      }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).resolves.toBe("门禁校验后的正式回复。");
  });

  it("rejects when the embedded gate verdict is failed", async () => {
    const gated = [
      "<think>",
      "<!--dify-deepseek-reasoning-->草稿包含依据之外的断言。",
      "</think>",
      JSON.stringify({ status: "failed", answer: "", uncertainties: ["hallucination_detected"] }),
    ].join("");
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      workflowFinished({
        answer: JSON.stringify({
          status: "success",
          display_blocks: [{ kind: "explanation", content: gated }],
        }),
      }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
      retryable: false,
      message: "hallucination_detected",
    });
  });

  it("rejects a gated block whose reasoning never closes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      workflowFinished({
        answer: JSON.stringify({
          status: "success",
          display_blocks: [{ kind: "explanation", content: "<think>\n只有推理没有结论" }],
        }),
      }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
      retryable: false,
      message: "智能体未生成有效回复。",
    });
  });

  it("extracts a plan-style answer whose inner answer is a JSON-string display_blocks array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      workflowFinished({
        answer: JSON.stringify({
          status: "success",
          display_blocks: [{
            kind: "explanation",
            content: JSON.stringify([
              { kind: "explanation", content: "先按片段知识点给错题归类。" },
              { kind: "explanation", content: "再设计变式与出口卡环节。" },
            ]),
          }],
        }),
      }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {}))
      .resolves.toBe("先按片段知识点给错题归类。\n\n再设计变式与出口卡环节。");
  });

  it("accepts a plain text answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      workflowFinished({ answer: "直接回答的正文。" }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).resolves.toBe("直接回答的正文。");
  });

  it("accepts a JSON answer with a nested content field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      workflowFinished({ answer: JSON.stringify({ content: "嵌套正文内容。" }) }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).resolves.toBe("嵌套正文内容。");
  });

  it("rejects an answer marked as failed with its failure reasons", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      workflowFinished({
        answer: JSON.stringify({ status: "failed", failure_reasons: ["内容越界，已拦截。"] }),
      }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      name: "AgentChatError",
      code: "UPSTREAM_REJECTED",
      retryable: false,
      message: "内容越界，已拦截。",
    });
  });

  it("rejects an empty answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      workflowFinished({ answer: JSON.stringify({ status: "success", display_blocks: [] }) }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      code: "AGENT_ANSWER_INVALID",
      retryable: false,
    });
  });

  it("maps an upstream SSE error event to a non-retryable rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      sseFrame("error", { task_id: "task_001", message: "缺少必填字段 user_text", status: 400 }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
      retryable: false,
      message: "缺少必填字段 user_text",
    });
  });

  it("maps HTTP 400 with a Dify error body to a non-retryable rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "bad_request", message: "请求无法解析。", status: 400 }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
      retryable: false,
      message: "请求无法解析。",
    });
  });

  it("maps HTTP 500 to a retryable rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("upstream error", { status: 502 }));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });

  it("rejects retryably when the stream ends without a workflow_finished event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(
      sseFrame("workflow_started", { task_id: "task_001", data: { id: "run_001" } }),
    ));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      code: "UPSTREAM_STREAM_INTERRUPTED",
      retryable: true,
    });
  });

  it("aborts the upstream request on timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")));
        }));
      const gateway = new DifyAgentChatGateway({
        endpoint: ENDPOINT,
        secret: "app-secret",
        timeoutMs: 60_000,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const pending = gateway.streamReply(options(), () => {});
      const expectation = expect(pending).rejects.toMatchObject({
        code: "UPSTREAM_TIMEOUT",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates the client abort signal as an upstream abort", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")));
      }));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const client = new AbortController();

    const pending = gateway.streamReply(options({ signal: client.signal }), () => {});
    const expectation = expect(pending).rejects.toBeInstanceOf(AgentChatError);
    client.abort();
    await expectation;
  });

  it("rejects retryably when the network request itself fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const gateway = new DifyAgentChatGateway({
      endpoint: ENDPOINT,
      secret: "app-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(gateway.streamReply(options(), () => {})).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });
});
