import type {
  AiWorkflowResponse,
  StudentCareResponseResult,
  StudentCareStatus,
} from "@xuetu/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly retryable: boolean,
      readonly details: Record<string, unknown>,
    ) {
      super(message);
    }
  },
  getStudentCareStatus: vi.fn(),
  invokeAiWorkflow: vi.fn(),
  respondToStudentCare: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { StudentCarePanel } from "./student-care-panel";

const invitation: StudentCareStatus = {
  kind: "invitation",
  preference_enabled: true,
  interaction_id: "care_001",
  signal_code: "rhythm_drop",
  greeting: "最近的学习节奏慢了一些。今天照常继续，还是先完成一个轻一点的步骤？",
  reason_summary: "最近一周完成学习任务的天数比你此前的节奏少。",
  actions: ["continue", "lighten", "talk", "dismiss", "disable"],
  presented_at: "2026-08-21T08:00:00.000Z",
  expires_at: "2026-08-22T08:00:00.000Z",
};

const currentTask = {
  title: "复习：顺序表的存储表示",
  href: "/student/mistakes?course_id=course_408_ds",
};

const talkFallbackStep = {
  task_id: "task_ds_read",
  task_type: "course_reading" as const,
  course_id: "course_408_ds",
  course_title: "数据结构",
  title: "回到上次阅读位置",
  detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
  estimated_minutes: 10,
  href: "/student/courses/data-structures",
};

function response(
  action: StudentCareResponseResult["action"],
  overrides: Partial<StudentCareResponseResult> = {},
): StudentCareResponseResult {
  return {
    action,
    idempotent: false,
    status: { kind: "none", preference_enabled: action !== "disable" },
    talk: action === "talk" ? {
      capability: "care",
      course_id: "course_408_ds",
      conversation_id: "care_001",
      fallback_step: talkFallbackStep,
    } : null,
    ...overrides,
  } as StudentCareResponseResult;
}

describe("StudentCarePanel", () => {
  beforeEach(() => {
    apiMocks.getStudentCareStatus.mockReset();
    apiMocks.invokeAiWorkflow.mockReset();
    apiMocks.respondToStudentCare.mockReset();
    apiMocks.getStudentCareStatus.mockResolvedValue(invitation);
  });

  it("stays absent for no signal or a failed care request", async () => {
    apiMocks.getStudentCareStatus.mockResolvedValueOnce({
      kind: "none",
      preference_enabled: true,
    });
    const first = render(
      <MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>,
    );
    await waitFor(() => expect(apiMocks.getStudentCareStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "学习关怀" })).not.toBeInTheDocument();
    first.unmount();

    apiMocks.getStudentCareStatus.mockRejectedValueOnce(new Error("offline"));
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);
    await waitFor(() => expect(apiMocks.getStudentCareStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog", { name: "学习关怀" })).not.toBeInTheDocument();
  });

  it("shows an enabled-state launcher when no real signal is ready", async () => {
    apiMocks.getStudentCareStatus.mockResolvedValueOnce({
      kind: "none",
      preference_enabled: true,
    });
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const launcher = await screen.findByRole("status", { name: "关怀模式状态" });
    expect(within(launcher).getByText("关怀模式已开启")).toBeInTheDocument();
    expect(within(launcher).queryByText("学习节奏明显变化时会提醒你")).not.toBeInTheDocument();
    expect(within(launcher).queryByText(/真实提醒|学习证据/u)).not.toBeInTheDocument();
    expect(within(launcher).getByRole("link", { name: "体验关怀互动" })).toHaveAttribute(
      "href",
      "/student/home?care_preview=1",
    );
    expect(screen.queryByRole("dialog", { name: "学习关怀" })).not.toBeInTheDocument();
  });

  it("offers a clearly labeled local preview without creating a real care interaction", async () => {
    render(
      <MemoryRouter>
        <StudentCarePanel currentTask={currentTask} mode="preview" />
      </MemoryRouter>,
    );

    const panel = await screen.findByRole("dialog", { name: "学习关怀互动" });
    expect(within(panel).queryByText(/不会写入|不会保存|外部 AI/u)).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "今天轻一点" }));
    expect(await within(panel).findByRole("heading", { name: "先完成一个轻量步骤" }))
      .toBeInTheDocument();
    expect(apiMocks.respondToStudentCare).not.toHaveBeenCalled();
  });

  it("uses warm, choice-preserving supportive copy in the local talk preview", async () => {
    render(
      <MemoryRouter>
        <StudentCarePanel currentTask={currentTask} mode="preview" />
      </MemoryRouter>,
    );

    const panel = await screen.findByRole("dialog", { name: "学习关怀互动" });
    fireEvent.click(within(panel).getByRole("button", { name: "和学伴聊聊" }));
    expect(within(panel).getByText("可以输入一句话，和学伴聊聊。"))
      .toBeInTheDocument();
    expect(within(panel).queryByText(/不会写入|不会保存|外部 AI/u)).not.toBeInTheDocument();
    const textbox = await within(panel).findByRole("textbox", { name: "想和学伴说什么" });
    fireEvent.change(textbox, { target: { value: "我今天很难开始。" } });
    fireEvent.click(within(panel).getByRole("button", { name: "发送给学伴" }));

    expect(await within(panel).findByText(/谢谢你愿意说出来/)).toBeInTheDocument();
    expect(within(panel).getByText(/先不用要求自己一下子解决全部问题/)).toBeInTheDocument();
    expect(within(panel).getByText(/可以继续聊一会儿，也可以把今天的学习放轻一点/))
      .toBeInTheDocument();
    expect(within(panel).getByText(/现在只做一步/)).toBeInTheDocument();
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
  });

  it("shows fixed crisis guidance in preview without calling the AI workflow", async () => {
    render(
      <MemoryRouter>
        <StudentCarePanel currentTask={currentTask} mode="preview" />
      </MemoryRouter>,
    );

    const panel = await screen.findByRole("dialog", { name: "学习关怀互动" });
    fireEvent.click(within(panel).getByRole("button", { name: "和学伴聊聊" }));
    const textbox = await within(panel).findByRole("textbox", { name: "想和学伴说什么" });
    fireEvent.change(textbox, { target: { value: "我今天很难开始。" } });
    fireEvent.click(within(panel).getByRole("button", { name: "发送给学伴" }));
    expect(await within(panel).findByText(/谢谢你愿意说出来/)).toBeInTheDocument();

    fireEvent.change(textbox, { target: { value: "我真的不想活了" } });
    fireEvent.click(within(panel).getByRole("button", { name: "发送给学伴" }));

    expect(await within(panel).findByText("先确保你的安全")).toBeInTheDocument();
    expect(within(panel).getByText(/立即联系一位身边可信任的人/)).toBeInTheDocument();
    expect(within(panel).getByText(/120 或 110/)).toBeInTheDocument();
    expect(within(panel).queryByText(/现在只做一步/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/谢谢你愿意说出来/)).not.toBeInTheDocument();
    expect(within(panel).queryByRole("textbox", { name: "想和学伴说什么" }))
      .not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "发送给学伴" }))
      .not.toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: "继续原任务" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: "开始轻量步骤" })).not.toBeInTheDocument();
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
  });

  it("shows three immediate choices and keeps dismiss or disable inside the reason disclosure", async () => {
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    expect(panel).toHaveAttribute("aria-modal", "false");
    expect(panel).toHaveAttribute("aria-labelledby", "student-care-title");
    expect(within(panel).getByRole("button", { name: "关闭本次关怀" })).toBeEnabled();
    expect(within(panel).getByText(invitation.greeting)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "照常学习" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "今天轻一点" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "和学伴聊聊" })).toBeEnabled();
    expect(within(panel).queryByRole("button", { name: "暂不需要" })).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByText("为什么看到这个提示"));
    expect(within(panel).getByText(invitation.reason_summary)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "暂不需要" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "关闭关怀提醒" })).toBeEnabled();
    expect(panel.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it("dismisses a pending invitation from the popover close button", async () => {
    apiMocks.respondToStudentCare.mockResolvedValue(response("dismiss"));
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    fireEvent.click(within(panel).getByRole("button", { name: "关闭本次关怀" }));

    await waitFor(() => expect(apiMocks.respondToStudentCare).toHaveBeenCalledWith("care_001", "dismiss"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "学习关怀" }))
      .not.toBeInTheDocument());
  });

  it("dismisses a pending invitation with Escape while focus is inside the popover", async () => {
    apiMocks.respondToStudentCare.mockResolvedValue(response("dismiss"));
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    const normalChoice = within(panel).getByRole("button", { name: "照常学习" });
    normalChoice.focus();
    fireEvent.keyDown(normalChoice, { code: "Escape", key: "Escape" });

    await waitFor(() => expect(apiMocks.respondToStudentCare).toHaveBeenCalledWith("care_001", "dismiss"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "学习关怀" }))
      .not.toBeInTheDocument());
  });

  it("renders a server-owned light step without marking the original task complete", async () => {
    apiMocks.respondToStudentCare.mockResolvedValue(response("lighten", {
      status: {
        kind: "light_session",
        preference_enabled: true,
        interaction_id: "care_001",
        signal_code: "rhythm_drop",
        message: "今天先完成一个更轻的步骤，原任务和学习路径都不会被改写。",
        step: {
          task_id: "task_ds_read",
          task_type: "course_reading",
          course_id: "course_408_ds",
          course_title: "数据结构",
          title: "回到上次阅读位置",
          detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
          estimated_minutes: 10,
          href: "/student/courses/data-structures",
        },
        expires_at: "2026-08-21T15:59:59.999Z",
      },
      talk: null,
    }));
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    fireEvent.click(within(panel).getByRole("button", { name: "今天轻一点" }));

    expect(await within(panel).findByRole("heading", { name: "回到上次阅读位置" })).toBeInTheDocument();
    expect(within(panel).getByText(/原任务和学习路径都不会被改写/)).toBeInTheDocument();
    expect(within(panel).getByText("10 分钟")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "开始轻量步骤" }))
      .toHaveAttribute("href", "/student/courses/data-structures");
    expect(panel.querySelector(".student-care-live"))
      .toHaveTextContent("已切换到今天的轻量步骤：回到上次阅读位置。");
    expect(apiMocks.respondToStudentCare).toHaveBeenCalledWith("care_001", "lighten");
  });

  it("refreshes an invitation that expired or was handled by another request", async () => {
    apiMocks.getStudentCareStatus
      .mockResolvedValueOnce(invitation)
      .mockResolvedValueOnce({ kind: "none", preference_enabled: true });
    apiMocks.respondToStudentCare.mockRejectedValueOnce(
      new apiMocks.ApiError(
        "这条关怀提示已过期，请刷新当前状态。",
        "CARE_INTERACTION_EXPIRED",
        false,
        {},
      ),
    );
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    fireEvent.click(within(panel).getByRole("button", { name: "照常学习" }));

    await waitFor(() => expect(apiMocks.getStudentCareStatus).toHaveBeenCalledTimes(2));
    expect(within(panel).queryByText(invitation.greeting)).not.toBeInTheDocument();
    expect(panel.querySelector(".student-care-notice"))
      .toHaveTextContent("这条关怀提示的状态已变化，已为你刷新。");
    expect(panel.querySelector(".student-care-live"))
      .toHaveTextContent("这条关怀提示的状态已变化，已为你刷新。");
  });

  it("hides a stale invitation without claiming a refresh when status is offline", async () => {
    apiMocks.getStudentCareStatus
      .mockResolvedValueOnce(invitation)
      .mockRejectedValueOnce(new Error("offline"));
    apiMocks.respondToStudentCare.mockRejectedValueOnce(
      new apiMocks.ApiError(
        "这条关怀提示已经按另一项选择处理。",
        "CARE_INTERACTION_ALREADY_RESPONDED",
        false,
        {},
      ),
    );
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    fireEvent.click(within(panel).getByRole("button", { name: "照常学习" }));

    await waitFor(() => expect(apiMocks.getStudentCareStatus).toHaveBeenCalledTimes(2));
    expect(within(panel).queryByText(invitation.greeting)).not.toBeInTheDocument();
    expect(panel.querySelector(".student-care-notice"))
      .toHaveTextContent("这条关怀提示的状态已变化，旧提示已收起，请稍后刷新页面确认。");
    expect(panel.querySelector(".student-care-live"))
      .toHaveTextContent("这条关怀提示的状态已变化，旧提示已收起，请稍后刷新页面确认。");
  });

  it("opens text care only after talk consent and keeps the original task when AI is offline", async () => {
    apiMocks.respondToStudentCare.mockResolvedValue(response("talk"));
    const offline: AiWorkflowResponse = {
      contract_version: "0.2",
      request_id: "workflow_care_001",
      capability: "care",
      slot: "supportive_check_in",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "AI 学伴暂时不可用。",
        retryable: true,
        fallback_message: "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。",
      },
    };
    apiMocks.invokeAiWorkflow.mockResolvedValue(offline);
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "和学伴聊聊" }));
    const textbox = await within(panel).findByRole("textbox", { name: "想和学伴说什么" });
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();

    fireEvent.change(textbox, { target: { value: "我今天总觉得很难开始。" } });
    fireEvent.click(within(panel).getByRole("button", { name: "发送给学伴" }));

    await waitFor(() => expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledWith({
      contract_version: "0.2",
      capability: "care",
      course_id: "course_408_ds",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      conversation_id: "care_001",
      user_message: "我今天总觉得很难开始。",
    }));
    await waitFor(() => expect(panel.querySelector(".student-care-fallback"))
      .toHaveTextContent(offline.failure!.fallback_message));
    expect(within(panel).getByRole("link", { name: "继续原任务" }))
      .toHaveAttribute("href", currentTask.href);
    expect(within(panel).getByRole("link", { name: "开始轻量步骤" }))
      .toHaveAttribute("href", talkFallbackStep.href);
    expect(within(panel).getByText(talkFallbackStep.title)).toBeInTheDocument();
  });

  it("keeps a visible multi-turn thread while sending only the stable conversation id", async () => {
    apiMocks.respondToStudentCare.mockResolvedValue(response("talk"));
    const ready = (requestId: string, content: string): AiWorkflowResponse => ({
      contract_version: "0.2",
      request_id: requestId,
      capability: "care",
      slot: "supportive_check_in",
      status: "ready",
      display_blocks: [{
        block_id: `${requestId}_summary`,
        kind: "summary",
        title: "学伴交流",
        content,
      }],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: null,
    });
    apiMocks.invokeAiWorkflow
      .mockResolvedValueOnce(ready("workflow_care_001", "先选一个十分钟内能完成的步骤。"))
      .mockResolvedValueOnce(ready("workflow_care_002", "可以，接着从刚才的轻量起点开始。"));
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    fireEvent.click(within(panel).getByRole("button", { name: "和学伴聊聊" }));
    const textbox = await within(panel).findByRole("textbox", { name: "想和学伴说什么" });

    fireEvent.change(textbox, { target: { value: "我今天很难开始。" } });
    fireEvent.click(within(panel).getByRole("button", { name: "发送给学伴" }));
    expect(await within(panel).findByText("先选一个十分钟内能完成的步骤。")).toBeInTheDocument();

    fireEvent.change(textbox, { target: { value: "那我先做哪一步？" } });
    fireEvent.click(within(panel).getByRole("button", { name: "发送给学伴" }));
    expect(await within(panel).findByText("可以，接着从刚才的轻量起点开始。")).toBeInTheDocument();

    expect(within(panel).getByText("我今天很难开始。")).toBeInTheDocument();
    expect(within(panel).getByText("先选一个十分钟内能完成的步骤。")).toBeInTheDocument();
    expect(within(panel).getByText("那我先做哪一步？")).toBeInTheDocument();
    expect(apiMocks.invokeAiWorkflow).toHaveBeenNthCalledWith(2, {
      contract_version: "0.2",
      capability: "care",
      course_id: "course_408_ds",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      conversation_id: "care_001",
      user_message: "那我先做哪一步？",
    });
    expect(JSON.stringify(apiMocks.invokeAiWorkflow.mock.calls)).not.toContain("recent_turns");
  });

  it("announces disabling without leaving a stale invitation active", async () => {
    apiMocks.respondToStudentCare.mockResolvedValue(response("disable"));
    render(<MemoryRouter><StudentCarePanel currentTask={currentTask} /></MemoryRouter>);

    const panel = await screen.findByRole("dialog", { name: "学习关怀" });
    fireEvent.click(within(panel).getByText("为什么看到这个提示"));
    fireEvent.click(within(panel).getByRole("button", { name: "关闭关怀提醒" }));

    await waitFor(() => expect(panel.querySelector(".student-care-notice"))
      .toHaveTextContent("关怀提醒已关闭，可在“我的学习”中重新开启。"));
    expect(within(panel).queryByText(invitation.greeting)).not.toBeInTheDocument();
  });
});
