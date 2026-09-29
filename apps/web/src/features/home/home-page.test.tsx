import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getStudentLearningOrchestration: vi.fn(),
  invokeAiWorkflow: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { HomePage } from "./home-page";

const snapshot = {
  generated_at: "2026-08-12T06:49:25.213Z",
  source: "deterministic_evidence_rules" as const,
  ai_status: "unavailable" as const,
  ai_status_message: "今日任务由可验证学习证据确定；AI 学伴只提供解释，不修改任务或学习记录。",
  goal_context: null,
  evidence_summary: {
    basis: "live_evidence" as const,
    confidence: "grounded" as const,
    objective_evidence_count: 14,
    subjective_evidence_count: 0,
    reading_progress_count: 4,
    practice_attempt_count: 10,
    needs_review_count: 2,
    explanation: "当前判断结合 4 条课程阅读位置与 10 次真实作答。",
    evidence_refs: ["attempt:attempt_private_001", "reading:course_408_ds:ds_c02_02"],
  },
  plan_progress: {
    plan_id: null,
    completed_task_count: 0,
    total_task_count: 0,
    completion_percent: 0,
    tasks: [],
  },
  challenge_journey: {
    current_stage_label: "数据结构 · 线性表",
    current_node_id: "journey_live_mistake_001",
    nodes: [
      {
        node_id: "journey_completed_ds_read",
        task_id: "completed_ds_read",
        kind: "course_reading" as const,
        status: "completed" as const,
        course_id: "course_408_ds" as const,
        course_title: "数据结构",
        concept_id: "ds_c02_01",
        title: "线性表的基本概念",
        href: "/student/courses/data-structures?concept_id=ds_c02_01",
      },
      {
        node_id: "journey_live_mistake_001",
        task_id: "live_mistake_001",
        kind: "mistake_review" as const,
        status: "review_due" as const,
        course_id: "course_408_ds" as const,
        course_title: "数据结构",
        concept_id: "ds_c02_02",
        title: "复习：顺序表的存储表示",
        href: "/student/mistakes?course_id=course_408_ds&concept_id=ds_c02_02",
      },
      {
        node_id: "journey_task_os_read",
        task_id: "task_os_read",
        kind: "course_reading" as const,
        status: "available" as const,
        course_id: "course_408_os" as const,
        course_title: "操作系统",
        concept_id: "os_c01",
        title: "操作系统的作用",
        href: "/student/courses/operating-systems?concept_id=os_c01",
      },
    ],
    recent_activity: {
      completed_day_count: 2,
      days: [
        { date: "2026-08-06", completed: false },
        { date: "2026-08-07", completed: false },
        { date: "2026-08-08", completed: true },
        { date: "2026-08-09", completed: false },
        { date: "2026-08-10", completed: false },
        { date: "2026-08-11", completed: true },
        { date: "2026-08-12", completed: false },
      ],
    },
    profile_updates: [{
      update_id: "profile_mistake_1",
      course_id: "course_408_ds" as const,
      course_title: "数据结构",
      kind: "mistake" as const,
      occurred_at: "2026-08-12T06:00:00.000Z",
      title: "顺序表进入待复习队列",
      detail: "选择题累计答错 2 次，因此提高了该知识点的复习优先级。",
    }],
  },
  current_task: {
    task_id: "live_mistake_001",
    source: "mistake" as const,
    task_type: "mistake_review" as const,
    course_id: "course_408_ds" as const,
    course_title: "数据结构",
    concept_id: "ds_c02_02",
    concept_title: "顺序表的存储表示",
    mistake_id: "mistake_private_001",
    title: "复习：顺序表的存储表示",
    reason: "这道选择题累计答错 2 次，先处理未完成的错题复习。",
    completion_criteria: "完成错题重练并在确认掌握后标记为已掌握。",
    estimated_minutes: 20,
    href: "/student/mistakes?course_id=course_408_ds&concept_id=ds_c02_02",
    practice_question_count: 1,
    evidence_refs: ["mistake:mistake_private_001"],
  },
  course_priorities: [
    {
      rank: 1, course_id: "course_408_co" as const, course_title: "计算机组成原理",
      priority: "focus" as const, evidence_level: "grounded" as const,
      rationale: "存在 1 个待复习知识点，优先完成错题闭环。",
      started_concept_count: 3, concept_count: 46, practice_attempt_count: 5,
      needs_review_count: 1, href: "/student/courses/computer-organization",
    },
    {
      rank: 2, course_id: "course_408_ds" as const, course_title: "数据结构",
      priority: "strengthen" as const, evidence_level: "grounded" as const,
      rationale: "存在 1 个待复习知识点，优先完成错题闭环。",
      started_concept_count: 2, concept_count: 50, practice_attempt_count: 2,
      needs_review_count: 1, href: "/student/courses/data-structures",
    },
    {
      rank: 3, course_id: "course_408_os" as const, course_title: "操作系统",
      priority: "maintain" as const, evidence_level: "limited" as const,
      rationale: "已有 1 个知识点开始阅读，保持连续学习。",
      started_concept_count: 1, concept_count: 60, practice_attempt_count: 0,
      needs_review_count: 0, href: "/student/courses/operating-systems",
    },
    {
      rank: 4, course_id: "course_408_cn" as const, course_title: "计算机网络",
      priority: "maintain" as const, evidence_level: "limited" as const,
      rationale: "已有 1 个知识点开始阅读，保持连续学习。",
      started_concept_count: 1, concept_count: 50, practice_attempt_count: 0,
      needs_review_count: 0, href: "/student/courses/computer-networks",
    },
  ],
  boundary_note: "当前结果只描述已存储学习证据，不代表分数、排名、录取概率或提分效果。",
};

describe("HomePage evidence-backed orchestration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    apiMocks.getStudentLearningOrchestration.mockResolvedValue(snapshot);
    apiMocks.invokeAiWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "workflow_home_plan_unavailable",
      capability: "plan",
      slot: "learning_orchestration",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "AI 学习服务暂时不可用。",
        retryable: true,
        fallback_message: "今日任务仍由可验证学习证据确定。",
      },
    });
  });

  it("loads today's task without exposing storage implementation details", () => {
    apiMocks.getStudentLearningOrchestration.mockReturnValue(new Promise(() => undefined));

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByRole("status")).toHaveTextContent("正在整理今天的学习任务");
    expect(screen.getByRole("status")).not.toHaveTextContent(/PostgreSQL|API/iu);
  });

  it("centers the single next task and its completion contract", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { level: 1, name: "复习：顺序表的存储表示" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const overview = screen.getByLabelText("个人备考概况");
    expect(within(overview).getByLabelText("累计练习次数")).toHaveTextContent("10");
    expect(within(overview).getByLabelText("待复习数量")).toHaveTextContent("2");
    const task = screen.getByRole("region", { name: "Tutor-Agent 今日推荐研学任务" });
    expect(within(task).getByRole("heading", { name: "Tutor-Agent 今日推荐研学任务" })).toBeInTheDocument();
    expect(within(task).getByText("Tutor-Agent 推荐 · 约 20 分钟")).toBeInTheDocument();
    expect(within(task).getByText(/累计答错 2 次/)).toBeInTheDocument();
    expect(within(task).getByText(/完成错题重练并在确认掌握后标记为已掌握/)).toBeInTheDocument();
    fireEvent.click(within(task).getByText("任务详情"));
    expect(within(task).getByRole("list", { name: "本次学习流程" })).toBeInTheDocument();
    expect(within(task).getByText("回看错因")).toBeInTheDocument();
    expect(within(task).getByText("完成重练")).toBeInTheDocument();
    expect(within(task).getByText("确认掌握")).toBeInTheDocument();
    expect(within(task).getByText("20 分钟")).toBeInTheDocument();
    expect(task).not.toHaveTextContent(/确定性|可靠关联题|学习证据/iu);
    expect(screen.getAllByRole("link", { name: "开始本关" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "开始本关" })).toHaveAttribute(
      "href",
      "/student/mistakes?course_id=course_408_ds&concept_id=ds_c02_02&orchestration_task_id=live_mistake_001",
    );
  });

  it("routes a pending probe without creating a regular orchestration assignment", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue({
      ...snapshot,
      current_task: {
        ...snapshot.current_task,
        task_id: "probe_probe_session_001",
        source: "probe" as const,
        task_type: "choice_practice" as const,
        mistake_id: null,
        title: "确认一次相关知识点",
        reason: "你之前的一次错答留下了待确认信号，用另一道题再看一次“顺序表的存储表示”。",
        completion_criteria: "完成对照题并查看结果。",
        estimated_minutes: 15,
        href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&probe_session_id=probe_session_001",
        practice_question_count: 1,
        probe_session_id: "probe_session_001",
      },
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    const href = await screen.findByRole("link", { name: "开始本关" }).then((link) => (
      link.getAttribute("href")
    ));
    expect(href).not.toBeNull();
    const params = new URLSearchParams(href!.split("?", 2)[1]);
    expect(params.get("probe_session_id")).toBe("probe_session_001");
    expect(params.has("orchestration_task_id")).toBe(false);
  });

  it("keeps the homepage focused on the agent task and the four-course agent matrix", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByRole("region", { name: "Tutor-Agent 今日推荐研学任务" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "408 四科专家 Agent 矩阵" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "目标院校" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "学习快速入口" })).not.toBeInTheDocument();
    expect(screen.queryByText("为什么推荐给我")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "我的 408 路线" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "最近 7 天学习反馈" })).not.toBeInTheDocument();
    expect(screen.queryByText(snapshot.ai_status_message)).not.toBeInTheDocument();
    expect(screen.queryByText(snapshot.boundary_note)).not.toBeInTheDocument();
  });

  it("gives a new student a real target setup action instead of a dead status", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue({
      ...snapshot,
      goal_context: null,
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    const overview = await screen.findByLabelText("个人备考概况");
    expect(within(overview).getByText("尚未设置")).toBeInTheDocument();
    expect(within(overview).getByRole("link", { name: "设置备考目标" })).toHaveAttribute(
      "href",
      "/student/onboarding",
    );
  });

  it("lets a configured student revise the self-reported starting point without replacing live evidence", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue({
      ...snapshot,
      goal_context: {
        target_exam_year: 2027,
        preparation_stage: "foundation",
        daily_minutes: 60,
        target_school: "中国科学技术大学",
        target_score: 120,
      },
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    const overview = await screen.findByLabelText("个人备考概况");
    expect(within(overview).getByRole("link", { name: "调整学习设置" })).toHaveAttribute(
      "href",
      "/student/onboarding",
    );
    expect(within(overview).getByLabelText("累计练习次数")).toHaveTextContent("10");
  });

  it("keeps goal context compact and removes the recommendation disclosure", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    const home = await screen.findByTestId("student-home-orchestrator");
    const opening = within(home).getByTestId("home-opening");
    expect(within(opening).getByText("学习面板")).toBeInTheDocument();

    const goalRoute = within(home).getByTestId("home-goal-route");
    expect(goalRoute).toHaveAttribute("aria-label", "今日学习");

    const actionWorkspace = within(goalRoute).getByTestId("home-action-workspace");
    expect(within(actionWorkspace).getByRole("region", { name: "Tutor-Agent 今日推荐研学任务" }))
      .toBeInTheDocument();
    expect(within(actionWorkspace).queryByText("为什么推荐给我")).not.toBeInTheDocument();
    expect(within(actionWorkspace).queryByRole("region", { name: "任务判断依据" }))
      .not.toBeInTheDocument();
    expect(within(actionWorkspace).queryByText("AI 学伴 · 下一步说明"))
      .not.toBeInTheDocument();

    const courseRail = within(home).getByTestId("home-course-rail");
    expect(within(courseRail).getByRole("heading", { name: "408 四科专家 Agent 矩阵" }))
      .toBeInTheDocument();
  });

  it("keeps course progress rows focused on action instead of repeating evidence table labels", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    const courseRail = await screen.findByTestId("home-course-rail");
    expect(within(courseRail).queryAllByText("推荐依据")).toHaveLength(0);
    expect(within(courseRail).queryAllByText("真实作答")).toHaveLength(0);
    expect(within(courseRail).getByText("已练 2 次")).toBeInTheDocument();
    expect(within(courseRail).getAllByText("尚未训练")).toHaveLength(2);
    expect(within(courseRail).getAllByText("[Agent 驱动]")).toHaveLength(4);
  });

  it("shows the actual seven-day activity strip", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const activity = await screen.findByRole("region", { name: "学习记录" });
    expect(within(activity).getByLabelText("最近7天完成天数")).toHaveTextContent("2");
    expect(within(activity).getByLabelText("2026-08-08 已完成学习任务")).toBeInTheDocument();
    expect(within(activity).getByLabelText("2026-08-09 暂无完成记录")).toBeInTheDocument();
  });

  it("keeps an empty course denominator and zero evidence readable", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue({
      ...snapshot,
      evidence_summary: { ...snapshot.evidence_summary, practice_attempt_count: 0, needs_review_count: 0 },
      course_priorities: snapshot.course_priorities.map((course) => ({ ...course, started_concept_count: 0, concept_count: 0 })),
    });
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const overview = await screen.findByLabelText("个人备考概况");
    expect(within(overview).getByLabelText("累计练习次数")).toHaveTextContent("0");
    expect(within(overview).getByLabelText("课程阅读覆盖率")).toHaveTextContent("0%");
    expect(overview).not.toHaveTextContent(/NaN|Infinity/);
  });

  it("keeps the task reason readable while hiding implementation evidence fields", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    const task = await screen.findByRole("region", { name: "Tutor-Agent 今日推荐研学任务" });
    expect(within(task).getByText("Agent 推荐理由")).toBeInTheDocument();
    expect(within(task).getByText("完成标准")).toBeInTheDocument();
    expect(screen.queryByText(/attempt_private|mistake_private|evidence_refs/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "任务判断依据" })).not.toBeInTheDocument();
  });

  it("does not call the AI workflow from the focused homepage", async () => {
    apiMocks.invokeAiWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "workflow_home_plan_ready",
      capability: "plan",
      slot: "learning_orchestration",
      status: "ready",
      display_blocks: [{
        block_id: "workflow_home_plan_summary",
        kind: "summary",
        title: "下一步学习安排",
        content: "先处理尚未闭环的顺序表错题，再继续今天的确定性任务。",
      }],
      citations: [],
      evidence_refs: [{
        evidence_id: "workflow_task_private_001",
        label: "当前任务依据",
        summary: "顺序表错题仍处于待复习状态。",
      }],
      next_actions: [{
        action_id: "workflow_home_plan_action",
        kind: "continue_learning",
        label: "继续当前任务",
        target: "course_408_ds",
      }],
      failure: null,
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "复习：顺序表的存储表示" }))
      .toBeInTheDocument();
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
    expect(screen.queryByText("为什么推荐给我")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 学伴 · 下一步说明")).not.toBeInTheDocument();
  });

  it("omits a missing plan and keeps four compact course priorities", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "408 四科专家 Agent 矩阵" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "7 日学习路径" })).not.toBeInTheDocument();
    expect(screen.queryByText("尚未建立 7 日学习路径")).not.toBeInTheDocument();
    const priorities = screen.getByRole("region", { name: "408 四科专家 Agent 矩阵" });
    expect(within(priorities).getAllByRole("listitem")).toHaveLength(4);
    expect(within(priorities).getAllByRole("progressbar")).toHaveLength(4);
    expect(within(priorities).getByRole("link", { name: /计算机组成原理/ })).toHaveAttribute(
      "href", "/student/courses/computer-organization",
    );
    expect(within(priorities).queryByText("存在 1 个待复习知识点，优先完成错题闭环。")).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 学伴|数据边界|数据来源/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 推荐|智能生成|预计提分/)).not.toBeInTheDocument();
  });

  it("drives every course card with an agent and links the network course into the 3D lab", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    const matrix = await screen.findByRole("region", { name: "408 四科专家 Agent 矩阵" });
    expect(within(matrix).getAllByText("[Agent 驱动]")).toHaveLength(4);
    expect(matrix).toHaveTextContent("DS-Agent · 重点巩固");
    expect(matrix).toHaveTextContent("CO-Agent · 优先处理");
    expect(matrix).toHaveTextContent("OS-Agent · 保持进度");
    expect(matrix).toHaveTextContent("CN-Agent · 保持进度");
    expect(within(matrix).getByRole("link", { name: "进入四科中枢" })).toHaveAttribute(
      "href",
      "/student/courses",
    );
    expect(within(matrix).getByRole("link", { name: /进入 3D 仿真/ })).toHaveAttribute(
      "href",
      "/student/programming-experiments",
    );
  });

  it("keeps a low-evidence fallback on the same focused task surface", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue({
      ...snapshot,
      evidence_summary: {
        ...snapshot.evidence_summary,
        basis: "initial_plan",
        confidence: "low",
        objective_evidence_count: 0,
        reading_progress_count: 0,
        practice_attempt_count: 0,
        needs_review_count: 0,
        explanation: "尚无客观学习记录，当前任务只依据注册时保存的目标与自评。",
      },
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByRole("region", { name: "Tutor-Agent 今日推荐研学任务" })).toBeInTheDocument();
    expect(screen.queryByText("当前依据较少")).not.toBeInTheDocument();
    expect(screen.queryByText(/尚无客观学习记录/)).not.toBeInTheDocument();
  });

  it("renders the preparing stage for a newly registered student", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue({
      ...snapshot,
      goal_context: {
        target_exam_year: 2027,
        preparation_stage: "preparing",
        daily_minutes: 60,
        target_school: null,
        target_score: null,
      },
    });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByText("准备阶段")).toBeInTheDocument();
    expect(screen.getByText("2027 考研 · 每日 60 分钟")).toBeInTheDocument();
  });

  it("offers a working retry when orchestration loading fails", async () => {
    apiMocks.getStudentLearningOrchestration
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(snapshot);

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("学习任务加载失败");
    expect(alert).not.toHaveTextContent(/PostgreSQL|API/iu);
    fireEvent.click(within(alert).getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "复习：顺序表的存储表示" })).toBeInTheDocument());
    expect(apiMocks.getStudentLearningOrchestration).toHaveBeenCalledTimes(2);
  });
});
