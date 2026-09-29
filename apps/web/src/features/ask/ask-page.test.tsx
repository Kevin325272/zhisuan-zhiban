import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  askCourseQuestion: vi.fn(),
  getSystemStatus: vi.fn(),
  getSource: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { AskPage } from "./ask-page";

describe("AskPage", () => {
  beforeEach(() => {
    apiMocks.askCourseQuestion.mockReset();
    apiMocks.getSystemStatus.mockReset();
    apiMocks.getSource.mockReset();
    apiMocks.getSystemStatus.mockResolvedValue({
      business: "available",
      evaluator: "mock",
      agent: "live",
      rag: "test_fixture",
      model: "gpt-5.6-terra",
    });
    apiMocks.askCourseQuestion.mockResolvedValue([
      {
        run_id: "run_001",
        sequence: 1,
        type: "retrieval.completed",
        created_at: "2026-07-22T09:32:01.000Z",
        payload: {
          citation_ids: ["csdn_131792829_chunk_0002"],
          confidence_level: "high",
          degraded: false,
        },
      },
      {
        run_id: "run_001",
        sequence: 2,
        type: "assistant.delta",
        created_at: "2026-07-22T09:32:02.000Z",
        payload: { delta: "BFS 按与起点的边数分层扩展顶点。" },
      },
      {
        run_id: "run_001",
        sequence: 3,
        type: "run.completed",
        created_at: "2026-07-22T09:32:03.000Z",
        payload: { finished_reason: "completed" },
      },
    ]);
    apiMocks.getSource.mockResolvedValue({
      source_id: "csdn_131792829_chunk_0002",
      document_id: "csdn_131792829",
      title: "数据结构：BFS 广度优先搜索",
      author: "测试作者",
      source_type: "test_fixture",
      section: "测试来源 · 图与广度优先遍历",
      page: null,
      paragraph: null,
      snippet: "广度优先遍历按照距离起点由近到远访问顶点。",
      relevance: 0.96,
      knowledge_base_version: "test_ds_bfs_v1",
      viewer_url: "https://blog.csdn.net/example/article/details/131792829",
    });
  });

  it("prefills a homepage question without sending it automatically", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/student/ask?q=%E4%B8%BA%E4%BB%80%E4%B9%88%20BFS%20%E4%BD%BF%E7%94%A8%E9%98%9F%E5%88%97%EF%BC%9F",
        ]}
      >
        <AskPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("textbox", { name: "输入课程问题" })).toHaveValue(
      "为什么 BFS 使用队列？",
    );
    expect(apiMocks.askCourseQuestion).not.toHaveBeenCalled();
  });

  it("answers a course-scoped question with a traceable source", async () => {
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "BFS 讲解助手" })).toBeInTheDocument();
    const context = screen.getByRole("region", { name: "当前学习上下文" });
    expect(context).toHaveTextContent("数据结构");
    expect(context).toHaveTextContent("BFS 课程资料");
    expect(context).toHaveTextContent("BFS 专题");
    expect(context).toHaveTextContent("当前仅支持 BFS 专题");
    expect(screen.getByRole("link", { name: "返回数据结构课程" })).toHaveAttribute(
      "href",
      "/student/courses/data-structures",
    );
    expect(screen.getByRole("link", { name: "查看学习记录" })).toHaveAttribute(
      "href",
      "/student/profile",
    );
    expect(screen.getByText("数据结构 · BFS")).toBeInTheDocument();
    expect(screen.getByText("visited 应该在入队还是出队时标记？")).toBeInTheDocument();
    expect(screen.queryByText(/408 课程群|Cache 与主存|TCP 三次握手/u)).not.toBeInTheDocument();
    expect(await screen.findByText("课程讲解")).toBeInTheDocument();
    expect(screen.getByText("BFS 专题讲解")).toBeInTheDocument();
    expect(screen.queryByText("gpt-5.6-terra")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "输入课程问题" }), {
      target: { value: "为什么 BFS 可以求无权图最短路？" },
    });
    const sendButton = screen.getByRole("button", { name: "发送问题" });
    expect(sendButton).toHaveClass("gradient-button", "gradient-button-variant");
    fireEvent.click(sendButton);

    expect(await screen.findByText("BFS 按与起点的边数分层扩展顶点。")).toBeInTheDocument();
    expect(screen.getByText("已附 1 条参考资料，可在右侧查看。")).toBeInTheDocument();
    expect(screen.getByText("课程资料 01")).toBeInTheDocument();
    expect(screen.getByText("数据结构：BFS 广度优先搜索")).toBeInTheDocument();
    expect(screen.getByText(/示例资料.*测试作者/u)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看原文/u })).toHaveAttribute(
      "href",
      "https://blog.csdn.net/example/article/details/131792829",
    );
    expect(screen.getByRole("link", { name: /查看原文/u })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(apiMocks.askCourseQuestion).toHaveBeenCalledWith(
      "为什么 BFS 可以求无权图最短路？",
      "auto",
      { hintLevel: "clue", onEvent: expect.any(Function) },
    );
  });

  it("does not expose test scenario controls or claim a real profile/RAG context", async () => {
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("combobox", { name: "回答场景" })).not.toBeInTheDocument();
    expect(screen.queryByText("学习画像已载入")).not.toBeInTheDocument();
    expect(screen.queryByText("课程知识增强")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/RAG|联调|接口演示|学习画像|本地测试知识库/u);
    expect(screen.getByRole("region", { name: "课程问答对话" })).toHaveTextContent("BFS 专题讲解");
    expect(apiMocks.getSystemStatus).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "输入课程问题" }), {
      target: { value: "为什么 BFS 使用队列？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await waitFor(() => expect(apiMocks.askCourseQuestion).toHaveBeenCalled());
    expect(apiMocks.askCourseQuestion.mock.calls[0]?.[1]).toBe("auto");
  });

  it("lets the student choose how much guidance the tutor should reveal", async () => {
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "分步讲解" }));
    fireEvent.change(screen.getByRole("textbox", { name: "输入课程问题" }), {
      target: { value: "带我分析 BFS 重复入队" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    await screen.findByText("BFS 按与起点的边数分层扩展顶点。");
    expect(apiMocks.askCourseQuestion).toHaveBeenCalledWith(
      "带我分析 BFS 重复入队",
      "auto",
      { hintLevel: "steps", onEvent: expect.any(Function) },
    );
  });

  it("moves a submitted question into the conversation before the model replies", async () => {
    let resolveQuestion: ((events: unknown[]) => void) | undefined;
    apiMocks.askCourseQuestion.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveQuestion = resolve;
      }),
    );
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    const input = screen.getByRole("textbox", { name: "输入课程问题" });
    fireEvent.change(input, { target: { value: "为什么 BFS 使用队列？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    expect(input).toHaveValue("");
    expect(screen.getByText("为什么 BFS 使用队列？")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "助学助手正在回答" })).toHaveTextContent(
      "正在理解问题并组织回答",
    );

    resolveQuestion?.([
      {
        run_id: "run_pending",
        sequence: 1,
        type: "retrieval.completed",
        created_at: "2026-07-24T07:00:00.000Z",
        payload: { citation_ids: [], confidence_level: "low", degraded: true },
      },
      {
        run_id: "run_pending",
        sequence: 2,
        type: "assistant.delta",
        created_at: "2026-07-24T07:00:01.000Z",
        payload: { delta: "队列保证 BFS 按层扩展。", generated_by: "model" },
      },
    ]);
    expect(await screen.findByText("队列保证 BFS 按层扩展。")).toBeInTheDocument();
  });

  it("keeps earlier turns visible when the student asks a follow-up", async () => {
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    const input = screen.getByRole("textbox", { name: "输入课程问题" });
    fireEvent.change(input, { target: { value: "第一问：BFS 为什么分层？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    await screen.findByText("BFS 按与起点的边数分层扩展顶点。");

    fireEvent.change(input, { target: { value: "第二问：队列起什么作用？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    await waitFor(() => {
      expect(
        screen.getAllByText("BFS 按与起点的边数分层扩展顶点。"),
      ).toHaveLength(2);
    });
    expect(screen.getByText("第一问：BFS 为什么分层？")).toBeInTheDocument();
    expect(screen.getByText("第二问：队列起什么作用？")).toBeInTheDocument();
  });

  it("shows a natural general answer without a retrieval warning", async () => {
    apiMocks.askCourseQuestion.mockResolvedValueOnce([
      {
        run_id: "run_empty",
        sequence: 1,
        type: "retrieval.completed",
        created_at: "2026-07-24T07:00:00.000Z",
        payload: { citation_ids: [], confidence_level: "low", degraded: true },
      },
      {
        run_id: "run_empty",
        sequence: 2,
        type: "assistant.delta",
        created_at: "2026-07-24T07:00:01.000Z",
        payload: {
          delta: "TCP 通过三次握手确认双方的收发能力。",
          generated_by: "model",
          answer_mode: "general",
        },
      },
    ]);
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "输入课程问题" }), {
      target: { value: "TCP 三次握手为什么不能两次？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    expect(await screen.findByText("TCP 通过三次握手确认双方的收发能力。")).toBeInTheDocument();
    expect(screen.getByText("智能回答")).toBeInTheDocument();
    expect(screen.getByText("本轮无需课程引用")).toBeInTheDocument();
    expect(screen.queryByText(/未命中测试知识库/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/已切换为通用模型回答/u)).not.toBeInTheDocument();
    expect(apiMocks.getSource).not.toHaveBeenCalled();
  });

  it("renders a profile-aware learning prompt as a normal assistant turn", async () => {
    apiMocks.askCourseQuestion.mockResolvedValueOnce([
      {
        run_id: "run_guided",
        sequence: 1,
        type: "assistant.delta",
        created_at: "2026-07-24T07:00:01.000Z",
        payload: {
          delta: "我在。你刚才发的是“1”，暂时还看不出具体问题。\n\n从最近的学习记录看，你在 visited 标记时机上还不够稳定。我可以帮你讲知识点、看代码或安排练习。",
          generated_by: "assistant_policy",
          answer_mode: "guided",
          profile_context_used: true,
        },
      },
    ]);
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "输入课程问题" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    expect(await screen.findByText(/你刚才发的是“1”/u)).toBeInTheDocument();
    expect(screen.getByText("学习引导")).toBeInTheDocument();
    expect(screen.getByText("已结合当前问题")).toBeInTheDocument();
    expect(screen.queryByText(/未命中/u)).not.toBeInTheDocument();
    expect(screen.queryByText("回答生成过程")).not.toBeInTheDocument();
  });

  it("shows a retryable model failure without exposing provider details", async () => {
    apiMocks.askCourseQuestion.mockResolvedValueOnce([
      {
        run_id: "run_failed",
        sequence: 1,
        type: "run.failed",
        created_at: "2026-07-24T07:00:00.000Z",
        payload: {
          error: { message: "模型服务暂时不可用，请稍后重试。", retryable: true },
        },
      },
    ]);
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "输入课程问题" }), {
      target: { value: "为什么 BFS 使用队列？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    expect(
      await screen.findByRole("alert", { name: "" }),
    ).toHaveTextContent("模型服务暂时不可用，请稍后重试。");
  });

  it("renders model Markdown as structured answer content", async () => {
    apiMocks.askCourseQuestion.mockResolvedValueOnce([
      {
        run_id: "run_markdown",
        sequence: 1,
        type: "retrieval.completed",
        created_at: "2026-07-24T07:00:00.000Z",
        payload: { citation_ids: [], confidence_level: "high", degraded: false },
      },
      {
        run_id: "run_markdown",
        sequence: 2,
        type: "assistant.delta",
        created_at: "2026-07-24T07:00:01.000Z",
        payload: {
          delta: "**结论：**BFS 能求无权图最短路。\n\n**BFS 结论**\n\n- 按距离分层访问\n- 第一次到达即为最少边数\n\n`dist[v] = dist[u] + 1`",
        },
      },
    ]);
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "输入课程问题" }), {
      target: { value: "解释 BFS 最短路径" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    const conclusion = await screen.findByText("BFS 结论");
    expect(conclusion.tagName).toBe("STRONG");
    expect(screen.getByText("结论：").tagName).toBe("STRONG");
    expect(screen.getByText("dist[v] = dist[u] + 1").tagName).toBe("CODE");
    expect(screen.queryByText(/\*\*BFS 结论\*\*/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/\*\*结论：\*\*/u)).not.toBeInTheDocument();
  });
});
