import type {
  AiWorkflowResponse,
  StudentLearningOrchestration,
} from "@xuetu/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getStudentLearningOrchestration: vi.fn(),
  invokeAiWorkflow: vi.fn(),
}));

vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  ...apiMocks,
}));

import {
  buildStudyAgentInvocation,
  STUDY_AGENT_EVIDENCE_UPDATED,
  safeStudentAgentHref,
  studyAgentResponseText,
  type StudyAgentTurn,
  useStudyAgent,
} from "./study-agent-controller";

const snapshot = {
  current_task: {
    task_id: "task_review_ds",
    course_id: "course_408_ds",
    course_title: "数据结构",
    title: "复习：顺序表的存储表示",
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

function workflowResponse(
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
      block_id: "block_1",
      kind: "summary",
      title: null,
      content,
    }] : [],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure: status === "ready" ? null : {
      code: status === "insufficient_context" ? "CONTEXT_INCOMPLETE" : "UPSTREAM_UNAVAILABLE",
      message: "暂时无法生成。",
      retryable: true,
      fallback_message: "先按当前任务继续学习。",
    },
  };
}

describe("study agent controller helpers", () => {
  it("allows only internal student workspace routes", () => {
    expect(safeStudentAgentHref("/student/practice?x=1")).toBe("/student/practice?x=1");
    expect(safeStudentAgentHref("https://example.com")).toBeNull();
    expect(safeStudentAgentHref("/teacher/dashboard")).toBeNull();
    expect(safeStudentAgentHref("//example.com/student/home")).toBeNull();
    expect(safeStudentAgentHref("/student/../teacher/dashboard")).toBeNull();
    expect(safeStudentAgentHref("/student/%2e%2e/admin")).toBeNull();
  });

  it("builds a bounded plan request from the current deterministic task and recent turns", () => {
    const oldTurns: StudyAgentTurn[] = Array.from({ length: 10 }, (_, index) => ({
      id: `turn_${index}`,
      role: index % 2 === 0 ? "student" : "agent",
      text: `${index} ${"很长的历史内容".repeat(180)}`,
    }));

    const invocation = buildStudyAgentInvocation(snapshot, "为什么先学这个？", oldTurns);

    expect(invocation.capability).toBe("plan");
    expect(invocation.course_id).toBe(snapshot.current_task.course_id);
    expect(invocation.user_message).toContain("为什么先学这个");
    expect(invocation.user_message).toContain("最近对话");
    expect(invocation.user_message).not.toContain("0 很长的历史内容");
    expect(invocation.user_message!.length).toBeLessThanOrEqual(4_000);
  });

  it("keeps AI failures visible and actionable instead of returning an empty panel", () => {
    expect(studyAgentResponseText(workflowResponse("ready"))).toBe(
      "先复习顺序表，再完成一道关联题。",
    );
    expect(studyAgentResponseText(workflowResponse("insufficient_context"))).toMatch(
      /学习记录还不够|先按当前任务/,
    );
    expect(studyAgentResponseText(workflowResponse("unavailable"))).toMatch(
      /暂时没有生成|当前任务/,
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("useStudyAgent", () => {
  beforeEach(() => {
    apiMocks.getStudentLearningOrchestration.mockReset();
    apiMocks.invokeAiWorkflow.mockReset();
  });

  it("exposes the deterministic task before the first AI explanation resolves", async () => {
    const pending = deferred<AiWorkflowResponse>();
    apiMocks.getStudentLearningOrchestration.mockResolvedValue(snapshot);
    apiMocks.invokeAiWorkflow.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useStudyAgent(true));

    await waitFor(() => expect(result.current.snapshot).toBe(snapshot));
    expect(result.current.aiLoading).toBe(true);
    expect(result.current.explanation).toBeNull();

    await act(async () => pending.resolve(workflowResponse("ready")));

    await waitFor(() => expect(result.current.explanation).toContain("先复习顺序表"));
    expect(result.current.aiLoading).toBe(false);
  });

  it("uses recent turns for a follow-up and bounds visible conversation history", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue(snapshot);
    apiMocks.invokeAiWorkflow.mockResolvedValueOnce(workflowResponse("ready", "先完成当前错题复习。"));
    for (let index = 0; index < 4; index += 1) {
      apiMocks.invokeAiWorkflow.mockResolvedValueOnce(
        workflowResponse("ready", `第 ${index + 1} 轮回答`),
      );
    }

    const { result } = renderHook(() => useStudyAgent(true));
    await waitFor(() => expect(result.current.explanation).toBe("先完成当前错题复习。"));

    for (let index = 0; index < 4; index += 1) {
      await act(async () => result.current.submitQuestion(`第 ${index + 1} 个问题`));
    }

    const lastInvocation = apiMocks.invokeAiWorkflow.mock.calls.at(-1)?.[0];
    expect(lastInvocation.user_message).toContain("第 4 个问题");
    expect(lastInvocation.user_message).toContain("最近对话");
    expect(result.current.turns.length).toBeLessThanOrEqual(6);
  });

  it("reloads after new learning evidence and ignores an older AI response", async () => {
    const first = deferred<AiWorkflowResponse>();
    const secondSnapshot = {
      ...snapshot,
      generated_at: "2026-08-26T05:00:00.000Z",
      current_task: {
        ...snapshot.current_task,
        task_id: "task_network",
        course_id: "course_408_cn",
        course_title: "计算机网络",
        title: "复习：TCP 可靠传输",
      },
    } as StudentLearningOrchestration;
    apiMocks.getStudentLearningOrchestration
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(secondSnapshot);
    apiMocks.invokeAiWorkflow
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(workflowResponse("ready", "新的网络任务判断。"));

    const { result } = renderHook(() => useStudyAgent(true));
    await waitFor(() => expect(result.current.snapshot).toBe(snapshot));

    act(() => window.dispatchEvent(new Event(STUDY_AGENT_EVIDENCE_UPDATED)));

    await waitFor(() => expect(result.current.snapshot).toBe(secondSnapshot));
    await waitFor(() => expect(result.current.explanation).toBe("新的网络任务判断。"));
    expect(result.current.refreshedNotice).toMatch(/刚才的学习记录/);

    await act(async () => first.resolve(workflowResponse("ready", "过期的数据结构判断。")));
    expect(result.current.explanation).toBe("新的网络任务判断。");
  });

  it("does not load private learning context while disabled", () => {
    const { result } = renderHook(() => useStudyAgent(false));

    expect(result.current.snapshot).toBeNull();
    expect(apiMocks.getStudentLearningOrchestration).not.toHaveBeenCalled();
  });
});
