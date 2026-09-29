import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const agentReplyMocks = vi.hoisted(() => ({
  mockReplyFor: vi.fn(),
  streamMockReply: vi.fn(),
}));

const agentLiveMocks = vi.hoisted(() => ({
  // 默认：真实智能体不可用 → 组件退回本地演示回复路径。
  streamAgentReply: vi.fn().mockResolvedValue(null),
}));

vi.mock("./agent-mock-replies", () => agentReplyMocks);
vi.mock("./agent-live-chat", () => agentLiveMocks);

import { GlobalAgentFab, OPEN_AGENT_EVENT } from "./global-agent-fab";
import { QUICK_PROMPTS } from "./agent-quick-prompts";

const scrollIntoViewMock = vi.fn();
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function renderFab(path = "/student/home") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalAgentFab />
    </MemoryRouter>,
  );
}

async function finishThinkingDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
}

describe("GlobalAgentFab", () => {
  beforeEach(() => {
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    agentReplyMocks.mockReplyFor.mockReset().mockImplementation(
      (_context: string, userText: string) => `关于「${userText}」的回复要点。`,
    );
    agentReplyMocks.streamMockReply.mockReset().mockImplementation(
      async (fullText: string, onDelta: (chunk: string) => void) => {
        onDelta(fullText);
      },
    );
    agentLiveMocks.streamAgentReply.mockReset().mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it.each([
    ["/student/home", "study"],
    ["/student/courses", "study"],
    ["/student/course-map", "study"],
    ["/student/programming-experiments", "lab"],
    ["/teacher", "teacher"],
  ] as const)("offers the %s quick prompts on %s", (path, context) => {
    renderFab(path);
    fireEvent.click(screen.getByRole("button", { name: "打开 408 专家 Agent" }));

    const prompts = screen.getByRole("navigation", { name: "快捷提问" });
    for (const prompt of QUICK_PROMPTS[context]) {
      expect(within(prompts).getByRole("button", { name: prompt })).toBeInTheDocument();
    }
    expect(within(prompts).getAllByRole("button")).toHaveLength(2);
  });

  it("labels the offline demonstration separately from AI content", async () => {
    vi.useFakeTimers();
    try {
      renderFab("/student/home");
      fireEvent.click(screen.getByRole("button", { name: "打开 408 专家 Agent" }));

      expect(screen.getByText("计算机考研智能体 · 支持本地演示")).toBeInTheDocument();
      expect(screen.getByText("智能体回复仅供学习参考；演示回复会单独标注")).toBeInTheDocument();

      fireEvent.change(screen.getByRole("textbox", { name: "向 408 专家 Agent 提问" }), {
        target: { value: "TCP 传输层与网络层有什么区别？" },
      });
      fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

      expect(screen.getByText("你")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("正在思考…");
      expect(screen.queryByRole("navigation", { name: "快捷提问" })).not.toBeInTheDocument();

      await finishThinkingDelay();

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(agentReplyMocks.mockReplyFor).toHaveBeenCalledWith(
        "study",
        "TCP 传输层与网络层有什么区别？",
      );
      expect(screen.getByText("关于「TCP 传输层与网络层有什么区别？」的回复要点。"))
        .toBeInTheDocument();
      expect(screen.getByText("[本地演示回复·未连接智能体]")).toBeInTheDocument();
      expect(screen.getByText("演示学伴")).toBeInTheDocument();
      expect(screen.queryByText("[AI 生成内容]")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a lab quick prompt directly and hides the prompts after the first turn", async () => {
    vi.useFakeTimers();
    try {
      renderFab("/student/programming-experiments");
      fireEvent.click(screen.getByRole("button", { name: "打开 408 专家 Agent" }));

      fireEvent.click(screen.getByRole(
        "button",
        { name: "默认网关 192.168.10.99 为什么会导致 ARP 失败？" },
      ));

      expect(screen.getByText("默认网关 192.168.10.99 为什么会导致 ARP 失败？"))
        .toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "快捷提问" })).not.toBeInTheDocument();

      await finishThinkingDelay();

      expect(agentReplyMocks.mockReplyFor).toHaveBeenCalledWith(
        "lab",
        "默认网关 192.168.10.99 为什么会导致 ARP 失败？",
      );
      expect(screen.getByText("关于「默认网关 192.168.10.99 为什么会导致 ARP 失败？」的回复要点。"))
        .toBeInTheDocument();
      expect(screen.getByText("[本地演示回复·未连接智能体]")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the live reply from the real agent stream without touching the local mocks", async () => {
    agentLiveMocks.streamAgentReply.mockImplementation(
      async (
        context: string,
        _message: string,
        onDelta: (chunk: string) => void,
      ) => {
        onDelta(`【真实回复·${context}】`);
        return `【真实回复·${context}】`;
      },
    );
    renderFab("/student/home");
    fireEvent.click(screen.getByRole("button", { name: "打开 408 专家 Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "向 408 专家 Agent 提问" }), {
      target: { value: "TCP 三次握手为什么是三次？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    // 流式中间态与最终 turn 是两次提交，用 waitFor 重查最终态。
    await waitFor(() => {
      expect(screen.getByText("【真实回复·study】")).toBeInTheDocument();
    });
    expect(agentLiveMocks.streamAgentReply).toHaveBeenCalledWith(
      "study",
      "TCP 三次握手为什么是三次？",
      expect.any(Function),
      expect.any(Object),
    );
    expect(agentReplyMocks.mockReplyFor).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByText("[AI 生成内容]")).toHaveLength(1);
    expect(screen.queryByText("[本地演示回复·未连接智能体]")).not.toBeInTheDocument();
  });

  it("opens the drawer through the global open event", () => {
    renderFab("/student/courses");
    expect(screen.queryByRole("complementary", { name: "408 专家 Agent" })).not.toBeInTheDocument();

    fireEvent(window, new CustomEvent(OPEN_AGENT_EVENT));

    expect(screen.getByRole("complementary", { name: "408 专家 Agent" })).toBeInTheDocument();
  });

  it("closes the drawer with Escape and restores the trigger", () => {
    renderFab();
    fireEvent.click(screen.getByRole("button", { name: "打开 408 专家 Agent" }));
    expect(screen.getByRole("complementary", { name: "408 专家 Agent" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("complementary", { name: "408 专家 Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开 408 专家 Agent" })).toBeInTheDocument();
  });

  it("stays off the screen on focused coding tasks", () => {
    render(
      <MemoryRouter initialEntries={["/student/tasks/task_bfs_bug_001"]}>
        <GlobalAgentFab hidden />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "打开 408 专家 Agent" })).not.toBeInTheDocument();
  });
});
