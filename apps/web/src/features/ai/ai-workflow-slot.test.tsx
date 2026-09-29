import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiWorkflowResponse } from "@xuetu/contracts";

const apiMocks = vi.hoisted(() => ({
  invokeAiWorkflow: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { AiWorkflowSlot } from "./ai-workflow-slot";

const invocation = {
  contract_version: "0.2" as const,
  capability: "explain" as const,
  course_id: "course_408_co",
  concept_id: "co_c01_01",
  qa_id: null,
  attempt_id: null,
  user_message: null,
};

describe("AiWorkflowSlot", () => {
  beforeEach(() => {
    apiMocks.invokeAiWorkflow.mockReset();
  });

  it("renders nothing when no learning context is available", () => {
    const { container } = render(
      <AiWorkflowSlot
        slot="practice_reflection"
        title="评测诊断"
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
  });

  it("does not run a manual workflow until the student explicitly requests it", async () => {
    apiMocks.invokeAiWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "workflow_manual_001",
      capability: "explain",
      slot: "contextual_explanation",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "AI 服务暂时不可用。",
        retryable: true,
        fallback_message: "当前课程内容仍可正常学习。",
      },
    });

    render(
      <StrictMode>
        <AiWorkflowSlot
          invocation={invocation}
          manual
          slot="contextual_explanation"
          title="上下文讲解"
        />
      </StrictMode>,
    );

    expect(screen.getByRole("button", { name: "生成学习解读" })).toBeInTheDocument();
    expect(screen.queryByText(/工作流|共享上下文|最小课程片段|AI 辅助/iu)).not.toBeInTheDocument();
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "生成学习解读" }));

    await waitFor(() => expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("暂时无法生成，请稍后重试。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新生成学习解读" }));
    await waitFor(() => expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledTimes(2));
  });

  it("keeps the slot visible with feedback while a manual explanation is loading", async () => {
    const pending = new Promise<AiWorkflowResponse>(() => undefined);
    apiMocks.invokeAiWorkflow.mockReturnValue(pending);

    render(
      <AiWorkflowSlot
        invocation={invocation}
        manual
        slot="contextual_explanation"
        title="上下文讲解"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成学习解读" }));

    expect(await screen.findByRole("note")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在生成学习解读");
    expect(screen.getByRole("button", { name: "正在生成学习解读" })).toBeDisabled();
  });

  it("shows useful feedback when a manual workflow has insufficient course context", async () => {
    apiMocks.invokeAiWorkflow.mockResolvedValue({
      contract_version: "0.2", request_id: "insufficient", capability: "explain", slot: "contextual_explanation",
      status: "insufficient_context", display_blocks: [], citations: [], evidence_refs: [], next_actions: [],
      failure: { code: "CONTEXT_INCOMPLETE", message: "缺少课程材料", retryable: false, fallback_message: "继续阅读课程" },
    });
    render(<AiWorkflowSlot invocation={invocation} manual slot="contextual_explanation" title="讲解" />);
    fireEvent.click(screen.getByRole("button", { name: "生成学习解读" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("当前资料还不足以生成讲解，请先继续阅读课程内容。"));
    expect(screen.queryByRole("button", { name: "重新生成学习解读" })).not.toBeInTheDocument();
  });

  it("hides an automatic unavailable response instead of showing an operations placeholder", async () => {
    apiMocks.invokeAiWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "workflow_test_001",
      capability: "explain",
      slot: "contextual_explanation",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "WORKFLOW_NOT_CONNECTED",
        message: "AI workflow service is not configured.",
        retryable: true,
        fallback_message: "AI 服务待连接，当前课程内容仍可正常学习。",
      },
    });

    render(
      <AiWorkflowSlot
        invocation={invocation}
        slot="contextual_explanation"
        title="上下文讲解"
      />,
    );

    await waitFor(() => expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledWith(invocation));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 服务|工作流|这是答案/iu)).not.toBeInTheDocument();
  });

  it("renders only validated display blocks, citations, evidence and next actions when ready", async () => {
    apiMocks.invokeAiWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "workflow_test_002",
      capability: "explain",
      slot: "contextual_explanation",
      status: "ready",
      display_blocks: [{
        block_id: "block_001",
        kind: "summary",
        title: "理解要点",
        content: "硬件与软件共同构成计算机系统。",
      }],
      citations: [{
        citation_id: "citation_001",
        source_chunk_id: "co_k_1",
        label: "课程资料：计算机系统概论",
        locator: "第1章",
      }],
      evidence_refs: [{
        evidence_id: "evidence_001",
        label: "最近阅读",
        summary: "已阅读当前知识点前两段。",
      }],
      next_actions: [{
        action_id: "action_001",
        kind: "continue_learning",
        label: "继续阅读本节",
        target: "#lesson-source-original",
      }],
      failure: null,
    });

    render(
      <AiWorkflowSlot
        invocation={invocation}
        slot="contextual_explanation"
        title="上下文讲解"
      />,
    );

    expect(screen.queryByText("由学习助手生成")).not.toBeInTheDocument();
    expect(await screen.findByText("上下文讲解")).toBeInTheDocument();
    expect(screen.queryByText(/AI 学伴已就绪|工作流/iu)).not.toBeInTheDocument();
    expect(screen.getByText("理解要点")).toBeInTheDocument();
    expect(screen.getByText("硬件与软件共同构成计算机系统。")).toBeInTheDocument();
    expect(screen.getByText(/课程资料：计算机系统概论/)).toBeInTheDocument();
    expect(screen.getByText(/最近阅读/)).toBeInTheDocument();
    expect(screen.getByText("继续阅读本节")).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledTimes(1));
  });
});
