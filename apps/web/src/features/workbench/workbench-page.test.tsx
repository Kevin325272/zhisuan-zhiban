import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getCourseMap: vi.fn(),
  getTask: vi.fn(),
  getAlgorithmTrace: vi.fn(),
  getTaskSubmissions: vi.fn(),
  runTask: vi.fn(),
  submitTask: vi.fn(),
  getDiagnosis: vi.fn(),
  getSource: vi.fn(),
  runDiagnosis: vi.fn(),
  askCourseQuestion: vi.fn(),
  submitValidation: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { WorkbenchPage } from "./workbench-page";

const task = {
  task_id: "task_bfs_bug_001",
  learning_node_id: "node_bfs_001",
  type: "code",
  title: "修复 BFS 重复入队问题",
  prompt_markdown: "修复代码，使每个顶点只入队一次，并保持正确的广度优先访问顺序。",
  language: "cpp",
  starter_code: "visited[current] = true;",
  code_templates: [
    { language: "c", file_name: "bfs.c", starter_code: "visited[current] = true;", fixed_code: "visited[next] = true;" },
    { language: "cpp", file_name: "bfs.cpp", starter_code: "visited[current] = true;", fixed_code: "visited[next] = true;\npending.push(next);" },
    { language: "java", file_name: "BfsTraversal.java", starter_code: "visited[current] = true;", fixed_code: "visited[next] = true;" },
    { language: "python", file_name: "bfs.py", starter_code: "visited.add(current)\npending.append(next_node)", fixed_code: "visited.add(next_node)\npending.append(next_node)" },
    { language: "javascript", file_name: "bfs.js", starter_code: "visited.add(current);", fixed_code: "visited.add(next);" },
    { language: "typescript", file_name: "bfs.ts", starter_code: "visited.add(current);", fixed_code: "visited.add(next);" },
    { language: "go", file_name: "bfs.go", starter_code: "visited[current] = true", fixed_code: "visited[next] = true" },
    { language: "rust", file_name: "bfs.rs", starter_code: "visited.insert(current);", fixed_code: "visited.insert(next);" },
  ],
  allowed_hint_level: 2,
  is_independent_validation: false,
  version: 1,
};

const validationTask = {
  task_id: "task_bfs_transfer_001",
  learning_node_id: "node_bfs_001",
  type: "transfer_validation",
  title: "校园节点的最少边数",
  prompt_markdown: "在全新的无权图中返回起点到目标点的最少边数，无法到达返回 -1。",
  language: "cpp",
  starter_code: "int shortestPath(const vector<vector<int>>& graph, int start, int target) {\n  // 独立完成\n  return -1;\n}",
  code_templates: [
    {
      language: "cpp",
      file_name: "shortest_path.cpp",
      starter_code: "int shortestPath(const vector<vector<int>>& graph, int start, int target) {\n  // 独立完成\n  return -1;\n}",
    },
    {
      language: "python",
      file_name: "shortest_path.py",
      starter_code: "def shortest_path(graph, start, target):\n    # 独立完成\n    return -1",
    },
  ],
  allowed_hint_level: 0,
  is_independent_validation: true,
  version: 1,
};

const passedValidationResult = {
  passed: true,
  previous_node_status: "validation_ready",
  current_node_status: "mastered",
  next_recommended_node_id: "node_dfs_001",
  learning_state_version: 9,
  state_change_reason: "独立验证任务通过（4/4，来源：演示评测）。",
  evaluation: {
    passed_count: 4,
    total_count: 4,
    execution_mode: "mock",
    evaluator_label: "演示评测",
    test_cases: [
      {
        test_case_id: "val_case_line",
        label: "教学楼直线通道",
        status: "passed",
        duration_ms: 2,
        memory_kb: 1500,
      },
    ],
  },
  created_at: "2026-07-26T10:00:00.000Z",
};

const courseMap = {
  course: { course_id: "course_ds_001", title: "数据结构", progress_percent: 42 },
  recommended_node_id: "node_bfs_001",
  nodes: [
    { learning_node_id: "node_queue_001", title: "队列基础", status: "mastered" },
    { learning_node_id: "node_graph_repr_001", title: "邻接矩阵与邻接表", status: "mastered" },
    { learning_node_id: "node_bfs_001", title: "广度优先遍历", status: "in_progress" },
    { learning_node_id: "node_dfs_001", title: "深度优先遍历", status: "not_started" },
  ],
};

const algorithmTrace = {
  task_id: "task_bfs_bug_001",
  variant: "visited-on-dequeue",
  language: "cpp",
  file_name: "bfs.cpp",
  source_code: "pending.push(start);\npending.push(next);",
  graph: {
    nodes: [
      { node_id: "1", label: "1", position: { x: 20, y: 50 } },
      { node_id: "2", label: "2", position: { x: 72, y: 50 } },
    ],
    edges: [{ from_node_id: "1", to_node_id: "2" }],
  },
  steps: [
    {
      step_index: 0,
      code_line: 1,
      action: "起点 1 入队",
      explanation: "起点进入队列。",
      guiding_question: "节点入队后是否已经被发现？",
      current_node_id: "1",
      queue: ["1"],
      visited: [],
      output: [],
      newly_enqueued: ["1"],
      source_ids: ["source_ds_book_143"],
      conflict: null,
      prediction: {
        question: "下一步 Queue 会变成什么？",
        options: [
          { option_id: "queue-empty", label: "空队列" },
          { option_id: "queue-one", label: "[1]" },
        ],
        correct_option_id: "queue-empty",
        explanation: "节点 1 从队首出队。",
      },
    },
    {
      step_index: 1,
      code_line: 2,
      action: "节点 2 重复入队",
      explanation: "visited 更新太晚。",
      guiding_question: "标记前移会发生什么？",
      current_node_id: "2",
      queue: ["2", "2"],
      visited: ["1"],
      output: ["1", "2"],
      newly_enqueued: ["2"],
      source_ids: ["source_ds_book_143"],
      conflict: { code: "BFS_DUPLICATE_ENQUEUE", message: "节点 2 重复入队。" },
      prediction: null,
    },
  ],
};

const fixedAlgorithmTrace = {
  ...algorithmTrace,
  variant: "visited-on-enqueue",
  source_code: "pending.push(start);\nvisited[start] = true;",
  steps: [
    {
      ...algorithmTrace.steps[0],
      code_line: 2,
      action: "起点 1 入队并标记",
      visited: ["1"],
    },
    {
      ...algorithmTrace.steps[1],
      action: "节点 2 只入队一次",
      queue: ["2"],
      visited: ["1", "2"],
      conflict: null,
    },
  ],
};

const failedSubmission = {
  submission_id: "sub_001",
  evaluation: {
    evaluation_id: "eval_001",
    passed_count: 2,
    total_count: 4,
    test_cases: [
      { test_case_id: "1", label: "图遍历用例 1", status: "passed", summary: "通过", duration_ms: 4 },
      { test_case_id: "2", label: "图遍历用例 2", status: "failed", summary: "检测到重复访问", duration_ms: 7 },
    ],
  },
  evidence: [
    {
      evidence_id: "evidence_test_001",
      type: "test_result",
      label: "重复入队评测失败",
      summary: "测试 2、4 检测到顶点重复入队。",
      source_ref: "eval_001",
    },
  ],
  diagnosis_id: "diag_001",
  learning_node_status: "in_progress",
  learning_state_version: 7,
  validation_id: null,
  learning_update: {
    trigger: "failed_submission",
    title: "本次失败已转化为学习动作",
    ability_changes: [
      {
        key: "debugging_diagnosis",
        label: "调试诊断",
        before: 68,
        after: 70,
        delta: 2,
        reason: "完成了失败用例定位。",
      },
    ],
    plan_changes: [
      {
        label: "新增错因回看",
        detail: "在当前路径中插入 BFS visited 标记时机复盘。",
      },
    ],
    review_changes: [
      {
        id: "submission-review-sub-001",
        title: "BFS visited 标记时机",
        scheduled_for: "2026-07-25",
        minutes: 8,
        reason: "根据本次重复入队失败自动安排。",
      },
    ],
  },
};

const fixedSubmission = {
  ...failedSubmission,
  submission_id: "sub_002",
  evaluation: {
    ...failedSubmission.evaluation,
    evaluation_id: "eval_002",
    passed_count: 4,
    test_cases: [],
  },
  evidence: [],
  diagnosis_id: null,
  learning_node_status: "validation_ready",
  learning_state_version: 8,
  validation_id: "task_bfs_transfer_001",
  learning_update: {
    trigger: "passed_submission",
    title: "修复通过，学习路径已推进",
    ability_changes: [
      {
        key: "code_implementation",
        label: "代码实现",
        before: 61,
        after: 68,
        delta: 7,
        reason: "修复版本通过全部固定用例。",
      },
    ],
    plan_changes: [
      {
        label: "进入独立验证",
        detail: "当前修复任务完成，解锁无提示迁移题。",
      },
    ],
    review_changes: [],
  },
};

const failedRun = {
  run_id: "code_run_001",
  task_id: "task_bfs_bug_001",
  status: "failed",
  execution_mode: "sandbox",
  evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
  degraded_reason: null,
  language: "cpp",
  detected_variant: "visited-on-dequeue",
  passed_count: 2,
  total_count: 4,
  duration_ms: 24,
  memory_kb: 1720,
  stdout: "运行完成：2/4 个用例通过。",
  stderr: "visited 标记发生在出队后。",
  error_line: 2,
  trace_available: true,
  trace_variant: "visited-on-dequeue",
  test_cases: [
    {
      test_case_id: "case_tree",
      label: "基础树形图",
      status: "passed",
      judge_status: "passed",
      input: "start=1\n1 2\n1 3",
      expected_output: "1 2 3",
      actual_output: "1 2 3",
      summary: "访问顺序正确，未发现重复入队。",
      duration_ms: 4,
      memory_kb: 1700,
      stdout: "1 2 3\n",
      stderr: null,
    },
    {
      test_case_id: "case_diamond",
      label: "菱形汇聚图",
      status: "failed",
      judge_status: "failed",
      input: "start=1\n1 2\n1 3\n2 4\n3 4",
      expected_output: "1 2 3 4",
      actual_output: "1 2 3 4 4",
      summary: "顶点 4 被重复访问。",
      duration_ms: 6,
      memory_kb: 1720,
      stdout: "1 2 3 4 4\n",
      stderr: null,
    },
  ],
};

const historyItems = [
  {
    submission_id: "sub_002",
    task_id: "task_bfs_bug_001",
    sequence: 2,
    created_at: "2026-07-22T09:31:02.000Z",
    code: { language: "cpp", source: "visited[next] = true;\npending.push(next);" },
    evaluation: { passed_count: 4, total_count: 4, score: 100 },
    diagnosis_id: null,
  },
  {
    submission_id: "sub_001",
    task_id: "task_bfs_bug_001",
    sequence: 1,
    created_at: "2026-07-22T09:31:01.000Z",
    code: { language: "cpp", source: "visited[current] = true;\npending.push(next);" },
    evaluation: { passed_count: 2, total_count: 4, score: 50 },
    diagnosis_id: "diag_001",
  },
];

describe("WorkbenchPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getTask.mockImplementation((taskId?: string) =>
      Promise.resolve(taskId === "task_bfs_transfer_001" ? validationTask : task),
    );
    apiMocks.getCourseMap.mockResolvedValue(courseMap);
    apiMocks.getAlgorithmTrace.mockImplementation(
      (_taskId: string, _language: string, traceVariant: string) =>
        Promise.resolve(
          traceVariant === "visited-on-enqueue" ? fixedAlgorithmTrace : algorithmTrace,
        ),
    );
    apiMocks.getDiagnosis.mockResolvedValue({
      diagnosis_id: "diag_001",
      observations: [{ text: "测试 2、4 出现重复访问。", evidence_ids: ["evidence_test_001"] }],
      primary_hypothesis: {
        code: "BFS_VISITED_MARK_TOO_LATE",
        summary: "visited 在出队后才更新，邻接顶点可能被多次加入队列。",
        confidence_level: "high",
      },
      citation_ids: ["source_ds_book_143"],
      next_action: { type: "hint", hint_level: 1, label: "观察 visited 标记时机" },
    });
    apiMocks.getSource.mockResolvedValue({
      source_id: "source_ds_book_143",
      title: "数据结构课程教材",
      section: "6.2.1 广度优先遍历",
      snippet: "顶点入队时应立即标记为已访问。",
      viewer_url: "/api/v1/sources/source_ds_book_143",
    });
    apiMocks.runDiagnosis.mockResolvedValue([
      { type: "retrieval.completed", sequence: 3, payload: { citation_ids: ["source_ds_book_143"] } },
      {
        type: "assistant.delta",
        sequence: 4,
        payload: {
          delta: "先观察 visited 的更新时机。",
          generated_by: "assistant_policy",
        },
      },
      { type: "run.completed", sequence: 6, payload: {} },
    ]);
    apiMocks.askCourseQuestion.mockResolvedValue([
      {
        type: "assistant.delta",
        sequence: 1,
        payload: {
          delta: "先看失败用例中重复出现的节点，再对照 visited 的更新时间。",
          answer_mode: "guided",
        },
      },
      { type: "run.completed", sequence: 2, payload: {} },
    ]);
    apiMocks.submitValidation.mockResolvedValue(passedValidationResult);
    apiMocks.runTask.mockResolvedValue(failedRun);
    apiMocks.getTaskSubmissions.mockResolvedValue({
      task_id: "task_bfs_bug_001",
      items: [],
    });
  });

  it("recovers from a missing initial task instead of loading forever", async () => {
    apiMocks.getTask.mockRejectedValueOnce(new Error("请求的资源不存在。"));
    render(<MemoryRouter><WorkbenchPage /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("学习工作台暂时无法打开");
    expect(screen.queryByText("正在打开学习工作台…")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往实验中心" })).toHaveAttribute("href", "/student/programming-experiments");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" })).toBeInTheDocument();
  });

  it("loads the task identified by the routed taskId", async () => {
    const routedTaskId = "task_route_specific_001";

    render(
      <MemoryRouter initialEntries={[`/student/tasks/${routedTaskId}`]}>
        <Routes>
          <Route path="/student/tasks/:taskId" element={<WorkbenchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    expect(apiMocks.getTask).toHaveBeenCalledWith(routedTaskId);
  });

  it("does not expose the internal diagnosis scenario selector", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    expect(screen.queryByRole("combobox", { name: "诊断场景" })).not.toBeInTheDocument();
  });

  it("opens submission history and restores the selected snapshot into the editor", async () => {
    apiMocks.getTaskSubmissions.mockResolvedValueOnce({
      task_id: "task_bfs_bug_001",
      items: historyItems,
    });
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    fireEvent.click(screen.getByRole("button", { name: "提交记录" }));

    expect(await screen.findByRole("heading", { name: "提交记录" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "基线版本" })).toHaveValue("sub_001");
    expect(screen.getByRole("combobox", { name: "目标版本" })).toHaveValue("sub_002");

    fireEvent.click(screen.getByRole("button", { name: "恢复目标版本到编辑器" }));
    expect(screen.getByRole("button", { name: "代码" })).toHaveClass("active");
    expect(screen.getByRole("textbox", { name: "BFS 代码" })).toHaveValue(
      historyItems[0]!.code.source,
    );
    expect(screen.getByText("已载入版本 02，尚未产生新提交")).toBeInTheDocument();
  });

  it("keeps the AI coach visible in focus mode and allows either side context to expand", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    const heading = await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    const page = heading.closest(".workbench-page");
    expect(page).toHaveAttribute("data-focus", "true");
    expect(screen.getByRole("button", { name: "退出专注模式" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "AI 学习教练" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "折叠 AI 学习教练" }));
    expect(page).toHaveAttribute("data-coach-collapsed", "true");
    expect(screen.getByRole("button", { name: "展开 AI 学习教练" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "退出专注模式" }));
    expect(page).toHaveAttribute("data-focus", "false");
    expect(screen.getByRole("button", { name: "进入专注模式" })).toBeInTheDocument();
  });

  it("keeps a task-aware AI coach in place and sends the live test context with a hint level", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    fireEvent.click(screen.getByRole("button", { name: "运行代码" }));
    await screen.findByText("菱形汇聚图");

    expect(screen.getByRole("complementary", { name: "AI 学习教练" })).toBeInTheDocument();
    expect(screen.getByText("运行结果已返回")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开上下文助学助手" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "只给方向" }));
    fireEvent.change(screen.getByRole("textbox", { name: "向学习教练提问" }), {
      target: { value: "我下一步先看哪里？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给学习教练" }));

    expect(
      await screen.findByText("先看失败用例中重复出现的节点，再对照 visited 的更新时间。"),
    ).toBeInTheDocument();
    expect(apiMocks.askCourseQuestion).toHaveBeenCalledWith(
      "我下一步先看哪里？",
      "auto",
      expect.objectContaining({
        hintLevel: "direction",
        workspaceContext: expect.objectContaining({
          active_view: "tests",
          language: "cpp",
          task_id: "task_bfs_bug_001",
          selected_test_case_id: "case_diamond",
          error_line: 2,
          test_summary: expect.stringContaining("2/4"),
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "生成针对性测试" }));
    const generatedTest = screen.getByRole("region", { name: "菱形汇聚图专项测试" });
    expect(within(generatedTest).getByText("1 2 3 4", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "加入复习" }));
    expect(screen.getByRole("status", { name: "复习任务已创建" })).toHaveTextContent(
      "已加入复习计划",
    );
    expect(window.localStorage.getItem("xuetu.learning-outputs.v1")).toContain(
      "BFS visited 标记时机",
    );
    expect(JSON.parse(window.localStorage.getItem("xuetu.learning-outputs.v1") ?? "{}")).toMatchObject({
      reviewCards: [
        expect.objectContaining({
          href: "/student/tasks/task_bfs_bug_001?view=evidence",
        }),
      ],
    });
  }, 10_000);

  it("runs edited source, shows concrete I/O, locates the error line, and opens its trace", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    const editor = (await screen.findByRole("textbox", { name: "BFS 代码" })) as HTMLTextAreaElement;
    const editedSource = "visited[current] = true;\npending.push(next);";
    fireEvent.change(editor, { target: { value: editedSource } });
    fireEvent.click(screen.getByRole("button", { name: "运行代码" }));

    expect(await screen.findByText("菱形汇聚图")).toBeInTheDocument();
    expect(screen.getByText("隔离沙箱评测")).toBeVisible();
    expect(screen.getByText("Judge0 · C++ (GCC 14.1.0)")).toBeVisible();
    expect(apiMocks.runTask).toHaveBeenCalledWith(
      "task_bfs_bug_001",
      "cpp",
      editedSource,
      null,
    );
    expect(screen.getByText("1 2 3 4 4")).toBeInTheDocument();
    const passedCase = screen.getByRole("button", { name: /基础树形图.*通过/ });
    const failedCase = screen.getByRole("button", { name: /菱形汇聚图.*失败/ });
    expect(passedCase.closest("li")).toHaveClass("test-passed");
    expect(failedCase.closest("li")).toHaveClass("test-failed");
    expect(within(passedCase).getByText("通过")).toHaveClass("passed");
    expect(within(failedCase).getByText("失败")).toHaveClass("failed");
    expect(within(passedCase).getByText("4 ms")).toBeInTheDocument();
    expect(within(failedCase).getByText("6 ms")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "定位第 2 行" }));
    const focusedEditor = screen.getByRole("textbox", { name: "BFS 代码" }) as HTMLTextAreaElement;
    expect(focusedEditor).toHaveFocus();
    expect(
      focusedEditor.value.slice(focusedEditor.selectionStart, focusedEditor.selectionEnd),
    ).toBe(
      "pending.push(next);",
    );

    fireEvent.click(screen.getByRole("button", { name: "测试结果" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看本次轨迹" }));
    expect(await screen.findByRole("heading", { name: "BFS 运行轨迹" })).toBeInTheDocument();
    expect(apiMocks.getAlgorithmTrace).toHaveBeenLastCalledWith(
      "task_bfs_bug_001",
      "cpp",
      "visited-on-dequeue",
    );
  });

  it("labels a fallback result in plain language and leaves unknown runtime metrics unknown", async () => {
    apiMocks.runTask.mockResolvedValueOnce({
      ...failedRun,
      execution_mode: "mock_fallback",
      evaluator_label: "演示降级评测",
      degraded_reason: "隔离沙箱暂时不可用。",
      duration_ms: null,
      memory_kb: null,
      test_cases: failedRun.test_cases.map((testCase) => ({
        ...testCase,
        duration_ms: null,
        memory_kb: null,
      })),
    });
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("textbox", { name: "BFS 代码" });
    fireEvent.click(screen.getByRole("button", { name: "运行代码" }));

    expect(await screen.findByText("临时评测结果")).toBeVisible();
    expect(screen.getByText("基础检查结果")).toBeVisible();
    expect(screen.queryByText(/降级通道/u)).not.toBeInTheDocument();
    expect(screen.getByText("隔离沙箱暂时不可用。")).toBeVisible();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("names the result history in student-facing language", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    fireEvent.click(screen.getByRole("button", { name: "学习记录" }));

    expect(await screen.findByText("提交评测后可查看本次结果。")).toBeInTheDocument();
    expect(screen.queryByText(/可追溯的学习证据/u)).not.toBeInTheDocument();
  });

  it("keeps the code visible for 500ms before transitioning to fresh test results", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("textbox", { name: "BFS 代码" });
    vi.useFakeTimers();

    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "运行代码" }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        screen.getByRole("status", { name: "运行完成，正在整理测试结果" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "BFS 代码" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "测试结果" })).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(screen.getByRole("textbox", { name: "BFS 代码" })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(121);
      });
      expect(screen.getByRole("heading", { name: "测试结果" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a trace generated from the same custom graph used by the runner", async () => {
    render(
      <MemoryRouter initialEntries={["/student/tasks/task_bfs_bug_001"]}>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("textbox", { name: "BFS 代码" });
    fireEvent.click(screen.getByText("自定义图输入"));
    fireEvent.change(screen.getByRole("textbox", { name: "每行一条有向边" }), {
      target: { value: "start=7\n7 8\n7 9\n8 9" },
    });
    vi.useFakeTimers();

    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "运行代码" }));
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(621);
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "查看本次轨迹" }));
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(121);
      });

      expect(apiMocks.getAlgorithmTrace).toHaveBeenLastCalledWith(
        "task_bfs_bug_001",
        "cpp",
        "visited-on-dequeue",
        "start=7\n7 8\n7 9\n8 9",
      );
      expect(screen.getByLabelText("BFS 伪代码状态")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a draft per language and runs the active language", async () => {
    apiMocks.runTask.mockResolvedValueOnce({ ...failedRun, language: "python" });
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    const languageSelect = await screen.findByRole("combobox", { name: "提交语言" });
    expect(screen.getByText("提交语言：C++ · C++17")).toBeInTheDocument();
    fireEvent.change(languageSelect, { target: { value: "python" } });
    expect(screen.getByText("提交语言：Python · Python 3.12")).toBeInTheDocument();
    const editor = screen.getByRole("textbox", { name: "BFS 代码" });
    const pythonDraft = "def bfs(graph, start):\n    return [start]";
    fireEvent.change(editor, { target: { value: pythonDraft } });

    fireEvent.change(languageSelect, { target: { value: "cpp" } });
    expect(editor).toHaveValue(task.code_templates[1]!.starter_code);
    fireEvent.change(languageSelect, { target: { value: "python" } });
    expect(editor).toHaveValue(pythonDraft);

    fireEvent.click(screen.getByRole("button", { name: "运行代码" }));
    await screen.findByText("菱形汇聚图");
    expect(apiMocks.runTask).toHaveBeenCalledWith(
      "task_bfs_bug_001",
      "python",
      pythonDraft,
      null,
    );
  });

  it("opens the synchronized trace view from the course graph", async () => {
    render(
      <MemoryRouter initialEntries={["/student/tasks/task_bfs_bug_001?view=trace"]}>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "BFS 运行轨迹" })).toBeInTheDocument();
    expect(apiMocks.getAlgorithmTrace).toHaveBeenCalledWith(
      "task_bfs_bug_001",
      "cpp",
      "visited-on-dequeue",
    );
    expect(screen.getByRole("button", { name: "运行轨迹" })).toHaveClass("active");

    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByRole("heading", { name: "发现状态冲突" })).toBeInTheDocument();
    expect(screen.getByLabelText("当前队列")).toHaveTextContent("22");
  });

  it("lazy-loads one comparison trace and keeps prediction practice local", async () => {
    render(
      <MemoryRouter initialEntries={["/student/tasks/task_bfs_bug_001?view=trace"]}>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "BFS 运行轨迹" });
    expect(apiMocks.getAlgorithmTrace).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "双轨对比" }));
    expect(await screen.findByRole("heading", { name: "BFS 双轨对比" })).toBeInTheDocument();
    expect(apiMocks.getAlgorithmTrace).toHaveBeenCalledWith(
      "task_bfs_bug_001",
      "cpp",
      "visited-on-enqueue",
    );

    fireEvent.click(screen.getByRole("button", { name: "讲解模式" }));
    fireEvent.click(screen.getByRole("button", { name: "双轨对比" }));
    expect(
      apiMocks.getAlgorithmTrace.mock.calls.filter(
        (call) => call[2] === "visited-on-enqueue",
      ),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "预测挑战" }));
    fireEvent.click(screen.getByRole("radio", { name: "空队列" }));
    fireEvent.click(screen.getByRole("button", { name: "提交预测" }));
    expect(screen.getByRole("status")).toHaveTextContent("回答正确");
    expect(apiMocks.submitTask).not.toHaveBeenCalled();
    expect(apiMocks.runDiagnosis).not.toHaveBeenCalled();
    expect(apiMocks.submitValidation).not.toHaveBeenCalled();
  });

  it("shows objective evidence separately from the cited AI diagnosis", async () => {
    apiMocks.submitTask.mockResolvedValueOnce(failedSubmission);
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    const taskHeading = await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    expect(taskHeading).toBeInTheDocument();
    expect(taskHeading.closest(".workbench-page")).toHaveClass("page-surface");
    expect(screen.getByRole("button", { name: "提交评测" })).toHaveClass(
      "gradient-button",
      "gradient-button-variant",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "提交语言" }), {
      target: { value: "python" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交评测" }));

    expect(await screen.findByText("2 / 4")).toBeInTheDocument();
    expect(apiMocks.submitTask.mock.calls[0]?.[2]).toBe("python");
    expect(apiMocks.runDiagnosis).toHaveBeenCalledWith(
      "sub_001",
      "normal",
      expect.objectContaining({
        active_view: "evidence",
        language: "python",
        task_id: "task_bfs_bug_001",
        learning_node_id: "node_bfs_001",
        submission_id: "sub_001",
        test_summary: expect.stringContaining("2/4"),
        failed_test_cases: ["图遍历用例 2：检测到重复访问"],
        learner_weak_points: ["BFS visited 标记时机"],
      }),
      expect.any(Function),
    );
    expect(screen.getByRole("heading", { name: "运行记录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "这次失败后，按 3 步继续" })).toBeInTheDocument();
    expect(screen.getByText("你这次练到了什么")).toBeInTheDocument();
    expect(screen.getByText("先回看哪个错因")).toBeInTheDocument();
    expect(screen.getByText("什么时候再练一次")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看能力图" })).toHaveAttribute(
      "href",
      "/student/profile",
    );
    expect(screen.getByRole("button", { name: "回看运行轨迹" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看错题复习" })).toHaveAttribute(
      "href",
      "/student/mistakes",
    );
    expect(screen.getByText("调试诊断")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("新增错因回看")).toBeInTheDocument();
    expect(screen.getByText("07 月 25 日")).toBeInTheDocument();
    expect(window.localStorage.getItem("xuetu.learning-outputs.v1")).toContain(
      "submission-review-sub-001",
    );
    expect(JSON.parse(window.localStorage.getItem("xuetu.learning-outputs.v1") ?? "{}")).toMatchObject({
      reviewCards: [
        expect.objectContaining({
          href: "/student/tasks/task_bfs_bug_001?view=evidence",
        }),
      ],
    });
    const coach = screen.getByRole("complementary", { name: "AI 学习教练" });
    expect(within(coach).getByRole("heading", { level: 4, name: "下一步" })).toBeInTheDocument();
    expect(within(coach).queryByText("助学策略")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /数据结构课程教材/ })).toHaveAttribute(
      "href",
      "/api/v1/sources/source_ds_book_143",
    );

    fireEvent.click(screen.getByRole("button", { name: "测试结果" }));
    const submittedPassedCase = (await screen.findByText("图遍历用例 1")).closest("li");
    const submittedFailedCase = screen.getByText("图遍历用例 2").closest("li");
    expect(within(submittedPassedCase as HTMLElement).getByText("4 ms")).toBeInTheDocument();
    expect(within(submittedFailedCase as HTMLElement).getByText("7 ms")).toBeInTheDocument();
  });

  it("shows objective diagnosis and citations before the live model finishes", async () => {
    let resolveAgentEvents!: (events: Array<Record<string, unknown>>) => void;
    apiMocks.submitTask.mockResolvedValueOnce(failedSubmission);
    apiMocks.runDiagnosis.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAgentEvents = resolve;
      }),
    );
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    fireEvent.click(screen.getByRole("button", { name: "提交评测" }));

    expect(await screen.findByText("2 / 4")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "visited 在出队后才更新，邻接顶点可能被多次加入队列。",
        {},
        { timeout: 500 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /数据结构课程教材/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "代码" }));
    expect(
      await screen.findByRole("button", { name: "提交评测" }, { timeout: 500 }),
    ).toBeEnabled();

    await act(async () => {
      resolveAgentEvents([
        {
          type: "assistant.delta",
          sequence: 4,
          payload: { delta: "模型诊断完成。", generated_by: "model" },
        },
        { type: "run.completed", sequence: 6, payload: {} },
      ]);
    });
    expect(await screen.findByText("模型诊断完成。")).toBeInTheDocument();
  });

  it("unlocks no-hint validation after the fixed code and marks mastery only after it passes", async () => {
    apiMocks.submitTask.mockResolvedValueOnce(fixedSubmission);
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    fireEvent.click(screen.getByRole("button", { name: "已修复代码" }));
    fireEvent.click(screen.getByRole("button", { name: "提交评测" }));

    expect(await screen.findByText("独立验证 · 无提示")).toBeInTheDocument();
    expect(screen.queryByText("已掌握")).not.toBeInTheDocument();

    // 验证任务模板异步加载后出现无提示编辑器，学生需提交真实代码。
    expect(
      await screen.findByText(
        "在全新的无权图中返回起点到目标点的最少边数，无法到达返回 -1。",
      ),
    ).toBeInTheDocument();
    const validationEditor = await screen.findByDisplayValue(/独立完成/);
    fireEvent.change(validationEditor, {
      target: {
        value:
          "int shortestPath(const vector<vector<int>>& graph, int start, int target) {\n  // distance 分层计数\n  return 2;\n}",
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "提交独立验证" }));

    expect(await screen.findByText("已掌握")).toBeInTheDocument();
    expect(screen.getByText("下一步：深度优先遍历")).toBeInTheDocument();
    expect(apiMocks.submitValidation).toHaveBeenCalledWith(
      "task_bfs_transfer_001",
      1,
      8,
      "cpp",
      expect.stringContaining("distance 分层计数"),
    );
  });

  it("keeps the validation editor with per-case results after a failed attempt", async () => {
    apiMocks.submitTask.mockResolvedValueOnce(fixedSubmission);
    apiMocks.submitValidation.mockResolvedValueOnce({
      ...passedValidationResult,
      passed: false,
      current_node_status: "validation_ready",
      next_recommended_node_id: "node_bfs_001",
      evaluation: {
        ...passedValidationResult.evaluation,
        passed_count: 2,
        total_count: 4,
        test_cases: [
          {
            test_case_id: "val_case_line",
            label: "教学楼直线通道",
            status: "passed",
            duration_ms: 2,
            memory_kb: 1500,
          },
          {
            test_case_id: "val_case_unreachable",
            label: "不连通目标",
            status: "failed",
            duration_ms: 3,
            memory_kb: 1520,
          },
        ],
      },
    });
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "修复 BFS 重复入队问题" });
    fireEvent.click(screen.getByRole("button", { name: "已修复代码" }));
    fireEvent.click(screen.getByRole("button", { name: "提交评测" }));

    fireEvent.click(await screen.findByRole("button", { name: "提交独立验证" }));

    expect(await screen.findByText(/未通过：2\/4 个隐藏用例/)).toBeInTheDocument();
    expect(screen.getByText("不连通目标")).toBeInTheDocument();
    expect(screen.queryByText("已掌握")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "提交独立验证" }),
    ).toBeInTheDocument();
  });
});
