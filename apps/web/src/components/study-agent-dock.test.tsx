import type {
  AiWorkflowResponse,
  StudentLearningOrchestration,
} from "@xuetu/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getStudentLearningOrchestration: vi.fn(),
  invokeAiWorkflow: vi.fn(),
}));

const scrollIntoViewMock = vi.fn();
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  ...apiMocks,
}));

import { StudyAgentDock } from "./study-agent-dock";

const snapshot = {
  generated_at: "2026-08-26T04:00:00.000Z",
  current_task: {
    task_id: "task_review_ds",
    course_id: "course_408_ds",
    course_title: "数据结构",
    title: "复习：顺序表的存储表示",
    reason: "这道题累计答错 2 次，先完成错题复习。",
    estimated_minutes: 20,
    href: "/student/mistakes?course_id=course_408_ds",
  },
  evidence_summary: {
    explanation: "当前判断结合 2 次真实作答与 1 条错题记录。",
  },
  course_priorities: [{
    course_id: "course_408_ds",
    rationale: "顺序表还有 1 道错题没有完成复习。",
  }],
} as unknown as StudentLearningOrchestration;

function response(
  status: AiWorkflowResponse["status"],
  content = "先复习顺序表，再完成一道关联题。",
): AiWorkflowResponse {
  return {
    contract_version: "0.2",
    request_id: `request_${status}`,
    capability: "plan",
    slot: "learning_orchestration",
    status,
    display_blocks: status === "ready" ? [{
      block_id: `block_${status}`,
      kind: "summary",
      title: null,
      content,
    }] : [],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure: status === "ready" ? null : {
      code: status === "insufficient_context" ? "CONTEXT_INCOMPLETE" : "UPSTREAM_UNAVAILABLE",
      message: "解释暂时无法生成。",
      retryable: true,
      fallback_message: "先按当前任务继续。",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function renderDock(props: React.ComponentProps<typeof StudyAgentDock> = {}) {
  return render(
    <MemoryRouter>
      <StudyAgentDock {...props} />
    </MemoryRouter>,
  );
}

describe("StudyAgentDock", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    apiMocks.getStudentLearningOrchestration.mockReset().mockResolvedValue(snapshot);
    apiMocks.invokeAiWorkflow.mockReset().mockResolvedValue(response("ready"));
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

  it("opens proactively on the homepage and shows the deterministic task before AI finishes", async () => {
    const pending = deferred<AiWorkflowResponse>();
    apiMocks.invokeAiWorkflow.mockReturnValue(pending.promise);

    renderDock({ autoOpen: true, userId: "student_001" });

    expect(await screen.findByRole("complementary", { name: "学习管家" })).toBeInTheDocument();
    expect(await screen.findByText(/今天先完成/)).toHaveTextContent(snapshot.current_task.title);
    expect(screen.getByText("顺序表还有 1 道错题没有完成复习。")).toBeInTheDocument();
    expect(screen.getByText("约 20 分钟")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "向学习管家提问" })).toHaveAttribute(
      "name",
      "study-agent-question",
    );
    expect(screen.getByRole("textbox", { name: "向学习管家提问" })).toHaveAttribute(
      "autocomplete",
      "off",
    );
    expect(screen.getByRole("link", { name: /开始这项任务/ })).toHaveAttribute(
      "href",
      snapshot.current_task.href,
    );
    expect(screen.getAllByText(/正在整理/).length).toBeGreaterThan(0);

    await act(async () => pending.resolve(response("ready")));
    expect(await screen.findByText("先复习顺序表，再完成一道关联题。")).toBeInTheDocument();
  });

  it("still opens proactively when the application runs in React strict mode", async () => {
    render(
      <StrictMode>
        <MemoryRouter>
          <StudyAgentDock autoOpen userId="student_strict" />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByRole("complementary", { name: "学习管家" })).toBeInTheDocument();
  });

  it("keeps a bounded follow-up conversation and prevents duplicate submission while loading", async () => {
    const followUp = deferred<AiWorkflowResponse>();
    apiMocks.invokeAiWorkflow
      .mockResolvedValueOnce(response("ready"))
      .mockReturnValueOnce(followUp.promise);
    renderDock();

    fireEvent.click(screen.getByRole("button", { name: "打开学习管家" }));
    await screen.findByText("先复习顺序表，再完成一道关联题。");
    fireEvent.click(screen.getByRole("button", { name: "今天时间不够怎么办？" }));

    expect(within(screen.getByRole("region", { name: "与学习管家的对话" }))
      .getByText("今天时间不够怎么办？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送问题" })).toBeDisabled();
    expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledTimes(2);

    await act(async () => followUp.resolve(response("ready", "先完成 10 分钟错题回看，剩余练习明天继续。")));
    expect(await screen.findByText("先完成 10 分钟错题回看，剩余练习明天继续。")).toBeInTheDocument();
  });

  it("keeps the latest learning-manager reply in view", async () => {
    renderDock();

    fireEvent.click(screen.getByRole("button", { name: "打开学习管家" }));
    await screen.findByText("先复习顺序表，再完成一道关联题。");

    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());
  });

  it("shows insufficient context and lets the student retry without losing the task", async () => {
    apiMocks.invokeAiWorkflow
      .mockResolvedValueOnce(response("insufficient_context"))
      .mockResolvedValueOnce(response("ready", "现在已有足够记录，可以先复习错题。"));
    renderDock();

    fireEvent.click(screen.getByRole("button", { name: "打开学习管家" }));
    expect(await screen.findByText(/当前学习记录还不够完整/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /开始这项任务/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(await screen.findByText("现在已有足够记录，可以先复习错题。")).toBeInTheDocument();
  });

  it("does not automatically reopen after dismissal in the same browser session", async () => {
    const first = renderDock({ autoOpen: true, userId: "student_001" });
    await screen.findByRole("complementary", { name: "学习管家" });
    fireEvent.click(screen.getByRole("button", { name: "关闭学习管家" }));
    first.unmount();

    renderDock({ autoOpen: true, userId: "student_001" });

    expect(screen.queryByRole("complementary", { name: "学习管家" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开学习管家" })).toHaveAttribute(
      "title",
      "打开学习管家",
    );
    expect(screen.queryByText("随时问我下一步")).not.toBeInTheDocument();
  });

  it("never turns an untrusted task target into a navigation link", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue({
      ...snapshot,
      current_task: { ...snapshot.current_task, href: "https://example.com/steal" },
    });
    renderDock();

    fireEvent.click(screen.getByRole("button", { name: "打开学习管家" }));
    await screen.findByText(/今天先完成/);

    expect(screen.queryByRole("link", { name: /开始这项任务/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看学习进度" })).toHaveAttribute(
      "href",
      "/student/profile",
    );
  });

  it("stays inactive and does not load student context when hidden", async () => {
    renderDock({ hidden: true });

    expect(screen.queryByRole("button", { name: "打开学习管家" })).not.toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getStudentLearningOrchestration).not.toHaveBeenCalled());
  });
});
