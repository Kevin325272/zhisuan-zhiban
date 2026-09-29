import type {
  AgentEvent,
  AlgorithmTraceStep,
  Citation,
  CodeRunResult,
  Diagnosis,
} from "@xuetu/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  askCourseQuestion: vi.fn(),
  getSource: vi.fn(),
}));

vi.mock("../api/client", () => ({
  askCourseQuestion: apiMocks.askCourseQuestion,
  getSource: apiMocks.getSource,
}));

import type { SubmissionData, TutorWorkspaceContext } from "../api/client";
import { AiLearningCoach, deriveCoachPhase } from "./ai-learning-coach";

const context: TutorWorkspaceContext = {
  active_view: "code",
  language: "cpp",
  task_title: "修复 BFS 重复入队问题",
  task_id: "task_bfs_bug_001",
  learning_node_id: "node_bfs_001",
  submission_id: null,
  code_excerpt: "queue<int> pending;",
  test_summary: null,
  trace_summary: null,
  error_line: null,
  selected_test_case_id: null,
  failed_test_cases: [],
  trace_variant: "visited-on-dequeue",
  learner_weak_points: ["BFS visited 标记时机"],
};

const completedEvents: AgentEvent[] = [
  {
    run_id: "run_001",
    sequence: 1,
    type: "run.started",
    created_at: "2026-07-25T10:00:00.000Z",
    payload: {},
  },
  {
    run_id: "run_001",
    sequence: 2,
    type: "run.completed",
    created_at: "2026-07-25T10:00:01.000Z",
    payload: {},
  },
];

const failedEvents: AgentEvent[] = [
  {
    run_id: "run_002",
    sequence: 1,
    type: "run.failed",
    created_at: "2026-07-25T10:00:00.000Z",
    payload: { error: { message: "服务超时" } },
  },
];

const diagnosis: Diagnosis = {
  diagnosis_id: "diag_001",
  run_id: "run_001",
  submission_id: "submission_001",
  concept_id: "concept_bfs_visited",
  observations: [
    {
      text: "两个汇聚图用例都出现节点重复入队。",
      evidence_ids: ["evidence_001"],
    },
  ],
  primary_hypothesis: {
    code: "visited_marked_too_late",
    summary: "visited 在节点出队后才更新，汇聚边会重复加入同一节点。",
    confidence: 0.93,
    confidence_level: "high",
    evidence_ids: ["evidence_001"],
  },
  alternative_hypotheses: [],
  citation_ids: ["source_ds_book_143"],
  next_action: {
    type: "hint",
    hint_level: 1,
    label: "先观察节点首次入队时 visited 的值。",
  },
  agent_version: "test-agent-v1",
  created_at: "2026-07-25T10:00:00.000Z",
};

const source: Citation = {
  source_id: "source_ds_book_143",
  document_id: "document_ds_book",
  title: "数据结构（C++版）",
  source_type: "course_material",
  section: "6.2.1 广度优先遍历",
  page: 143,
  paragraph: "顶点首次入队时标记",
  snippet: "顶点首次进入待访问队列时即完成访问标记。",
  relevance: 0.93,
  knowledge_base_version: "kb_ds_v1",
  viewer_url: "/student/sources/source_ds_book_143",
};

const traceStep: AlgorithmTraceStep = {
  step_index: 5,
  code_line: 14,
  action: "扫描节点 3 的邻接边",
  explanation: "节点 4 尚未标记，第二次进入队列。",
  guiding_question: "visited 应该在入队还是出队时更新？",
  current_node_id: "3",
  queue: ["4", "4"],
  visited: ["1", "2", "3"],
  output: ["1", "2", "3"],
  newly_enqueued: ["4"],
  source_ids: ["source_ds_book_143"],
  conflict: {
    code: "duplicate_enqueue",
    message: "节点 4 已在队列中，但又被重复加入。",
  },
  prediction: null,
};

function phaseInput(
  overrides: Partial<Parameters<typeof deriveCoachPhase>[0]> = {},
): Parameters<typeof deriveCoachPhase>[0] {
  return {
    running: false,
    submitting: false,
    runResult: null,
    submission: null,
    diagnosis: null,
    events: [],
    ...overrides,
  };
}

function renderCoach(
  overrides: Partial<ComponentProps<typeof AiLearningCoach>> = {},
) {
  const props: ComponentProps<typeof AiLearningCoach> = {
    collapsed: false,
    context,
    diagnosis: null,
    events: [],
    onLocateError: vi.fn(),
    onOpenTests: vi.fn(),
    onOpenTrace: vi.fn(),
    onRetry: vi.fn(),
    onToggleCollapsed: vi.fn(),
    runResult: null,
    running: false,
    sources: [],
    submission: null,
    submitting: false,
    traceStep: null,
    traceVariant: "visited-on-dequeue",
    ...overrides,
  };
  render(
    <AiLearningCoach {...props} />,
  );
}

describe("AiLearningCoach", () => {
  beforeEach(() => {
    apiMocks.askCourseQuestion.mockReset();
    apiMocks.getSource.mockReset();
  });

  it("derives a stable phase from real workbench state", () => {
    expect(deriveCoachPhase(phaseInput())).toBe("context_ready");
    expect(deriveCoachPhase(phaseInput({ running: true }))).toBe("evaluating");
    expect(
      deriveCoachPhase(
        phaseInput({ runResult: {} as CodeRunResult }),
      ),
    ).toBe("evidence_ready");
    expect(
      deriveCoachPhase(
        phaseInput({
          runResult: {} as CodeRunResult,
          submission: {} as SubmissionData,
          submitting: true,
        }),
      ),
    ).toBe("diagnosing");
    expect(
      deriveCoachPhase(
        phaseInput({
          runResult: {} as CodeRunResult,
          submission: {} as SubmissionData,
          diagnosis: {} as Diagnosis,
          events: completedEvents,
        }),
      ),
    ).toBe("coaching");
    expect(
      deriveCoachPhase(
        phaseInput({
          submission: { validation_id: "validation_001" } as SubmissionData,
          diagnosis: {} as Diagnosis,
          events: completedEvents,
        }),
      ),
    ).toBe("verification_ready");
    expect(
      deriveCoachPhase(phaseInput({ events: failedEvents })),
    ).toBe("degraded");
  });

  it("renders a persistent coach and its evidence-grounded stages", () => {
    renderCoach();

    expect(
      screen.getByRole("complementary", { name: "AI 学习教练" }),
    ).toBeInTheDocument();
    expect(screen.getByText("已同步当前任务")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "折叠 AI 学习教练" }),
    ).toBeInTheDocument();
    expect(screen.getByText("代码讲解与诊断")).toBeInTheDocument();
    expect(screen.queryByText("AI LEARNING COACH")).not.toBeInTheDocument();
    expect(screen.getByText("检查代码与运行结果")).toBeInTheDocument();
    expect(screen.getByText("对照课程知识")).toBeInTheDocument();
    expect(screen.getByText("定位错误原因")).toBeInTheDocument();
    expect(screen.getByText("给出下一步")).toBeInTheDocument();
  });

  it("keeps an accessible coach landmark while collapsed", () => {
    renderCoach({ collapsed: true });

    expect(
      screen.getByRole("complementary", { name: "AI 学习教练" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "展开 AI 学习教练" }),
    ).toBeInTheDocument();
  });

  it("shows an evidence-grounded diagnosis with honest provenance", () => {
    renderCoach({
      diagnosis,
      events: [
        {
          run_id: "run_001",
          sequence: 1,
          type: "retrieval.completed",
          created_at: "2026-07-25T10:00:00.000Z",
          payload: {
            citation_ids: ["source_ds_book_143"],
            confidence_level: "high",
            degraded: false,
          },
        },
        {
          run_id: "run_001",
          sequence: 2,
          type: "assistant.delta",
          created_at: "2026-07-25T10:00:01.000Z",
          payload: {
            delta: "先观察 visited 更新位置。",
            generated_by: "assistant_policy",
          },
        },
        ...completedEvents,
      ],
      sources: [source],
      submission: { submission_id: "submission_001" } as SubmissionData,
    });

    expect(screen.getByText("观察事实")).toBeInTheDocument();
    expect(
      screen.getByText("两个汇聚图用例都出现节点重复入队。"),
    ).toBeInTheDocument();
    expect(screen.getByText("可能原因")).toBeInTheDocument();
    expect(screen.queryByText(/置信度：/u)).not.toBeInTheDocument();
    expect(screen.queryByText("RAG 引用")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "相关课程" })).toBeInTheDocument();
    expect(screen.getByText("数据结构（C++版）")).toBeInTheDocument();
    expect(screen.queryByText("助学策略")).not.toBeInTheDocument();
  });

  it("keeps trace evidence inside the same AI coach", () => {
    renderCoach({
      context: {
        ...context,
        active_view: "trace",
        trace_summary: "第 6 步 Queue=[4,4]",
      },
      traceStep,
    });

    expect(
      screen.getByRole("complementary", { name: "AI 学习教练" }),
    ).toBeInTheDocument();
    expect(screen.getByText("运行结果")).toBeInTheDocument();
    expect(screen.queryByText("执行证据")).not.toBeInTheDocument();
    expect(screen.getByText("代码第 14 行")).toBeInTheDocument();
    expect(screen.getByText("Queue [4, 4]")).toBeInTheDocument();
    expect(
      screen.getByText("节点 4 已在队列中，但又被重复加入。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("visited 应该在入队还是出队时更新？"),
    ).toBeInTheDocument();
  });

  it("keeps a real conversation, clears the composer, and exposes contextual actions", async () => {
    apiMocks.askCourseQuestion.mockResolvedValue([
      {
        run_id: "run_chat_001",
        sequence: 0,
        type: "retrieval.completed",
        created_at: "2026-07-25T09:59:59.000Z",
        payload: {
          citation_ids: ["source_ds_book_143"],
          confidence_level: "high",
          degraded: false,
        },
      },
      {
        run_id: "run_chat_001",
        sequence: 1,
        type: "assistant.delta",
        created_at: "2026-07-25T10:00:00.000Z",
        payload: {
          delta: "先观察节点 4 第二次入队之前，visited[4] 的值。",
          generated_by: "model",
        },
      },
      {
        run_id: "run_chat_001",
        sequence: 2,
        type: "run.completed",
        created_at: "2026-07-25T10:00:01.000Z",
        payload: {},
      },
    ]);
    apiMocks.getSource.mockResolvedValue(source);
    const onLocateError = vi.fn();
    const onOpenTests = vi.fn();
    const onOpenTrace = vi.fn();
    renderCoach({
      context: { ...context, error_line: 14 },
      onLocateError,
      onOpenTests,
      onOpenTrace,
    });

    fireEvent.change(screen.getByRole("textbox", { name: "向学习教练提问" }), {
      target: { value: "我下一步先看哪里？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给学习教练" }));

    expect(screen.getByRole("textbox", { name: "向学习教练提问" })).toHaveValue("");
    expect(screen.getByText("我下一步先看哪里？")).toBeInTheDocument();
    expect(
      await screen.findByText("先观察节点 4 第二次入队之前，visited[4] 的值。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("AI 生成")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /数据结构（C\+\+版）/ })).toHaveAttribute(
      "href",
      "/student/sources/source_ds_book_143",
    );
    await waitFor(() => {
      expect(apiMocks.askCourseQuestion).toHaveBeenCalledWith(
        "我下一步先看哪里？",
        "auto",
        expect.objectContaining({
          hintLevel: "clue",
          workspaceContext: expect.objectContaining({
            task_id: "task_bfs_bug_001",
            error_line: 14,
          }),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "定位第 14 行" }));
    fireEvent.click(screen.getByRole("button", { name: "查看测试结果" }));
    fireEvent.click(screen.getByRole("button", { name: "打开运行轨迹" }));
    expect(onLocateError).toHaveBeenCalledOnce();
    expect(onOpenTests).toHaveBeenCalledOnce();
    expect(onOpenTrace).toHaveBeenCalledOnce();
  });
});
