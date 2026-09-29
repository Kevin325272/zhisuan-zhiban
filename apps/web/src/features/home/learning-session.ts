import type { OverviewData } from "../../api/client";
import bfsSampleLabels from "../../../../../data/data-structures/samples/bfs-sample-labels.json";

export const learningRendererTypes = [
  "algorithm_trace",
  "database_lab",
  "systems_flow",
  "network_path",
  "software_practice",
] as const;

export type LearningRendererType = (typeof learningRendererTypes)[number];
export type LearningPathState = "completed" | "current" | "upcoming";

export interface LearningSession {
  id: string;
  course: {
    id: string;
    title: string;
    category: string;
    progress: number;
  };
  material: {
    title: string;
    kind: string;
    source_path: string;
    truth_status: string;
    note: string;
  };
  goal: string;
  renderer_type: LearningRendererType;
  decision: {
    source_label: string;
    evidence: string[];
    diagnosis: string;
    task_reason: string;
  };
  task: {
    title: string;
    summary: string;
    href: string;
    action_label: string;
  };
  path: Array<{
    id: string;
    label: string;
    state: LearningPathState;
  }>;
  guide: {
    title: string;
    steps: string[];
  };
  demo_mode: boolean;
  disclosure: string;
}

const rendererLabels: Record<LearningRendererType, string> = {
  algorithm_trace: "算法过程与调试",
  database_lab: "数据库与 SQL",
  systems_flow: "机制流程与状态推演",
  network_path: "协议分层与报文路径",
  software_practice: "代码阅读与工程练习",
};

function inferRendererType(courseTitle: string): LearningRendererType {
  if (/数据结构|算法/.test(courseTitle)) return "algorithm_trace";
  if (/数据库|SQL/.test(courseTitle)) return "database_lab";
  if (/操作系统|组成原理|计算机组成/.test(courseTitle)) return "systems_flow";
  if (/网络/.test(courseTitle)) return "network_path";
  return "software_practice";
}

function pathState(status: string): LearningPathState {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "current";
  return "upcoming";
}

const localBfsEvidence = bfsSampleLabels.selection.slice(0, 3).map(
  (item) => item.note,
);

export function adaptOverviewToLearningSession(overview: OverviewData): LearningSession {
  const rendererType = inferRendererType(overview.current_course.title);
  const reviewEvidence = overview.review_items.map(
    (item) => `${item.label} · ${item.evidence_label}`,
  );
  const isAlgorithmFixture = rendererType === "algorithm_trace";
  const taskId = overview.recommended_node.current_task_id ?? "task_bfs_bug_001";

  return {
    id: `overview:${overview.current_course.course_id}`,
    course: {
      id: overview.current_course.course_id,
      title: overview.current_course.title,
      category: rendererLabels[rendererType],
      progress: overview.current_course.progress_percent,
    },
    material: isAlgorithmFixture
      ? {
          title: "广度优先遍历过程练习",
          kind: "课程示例",
          source_path: "data/data-structures/samples/bfs-rag-sample.jsonl",
          truth_status: bfsSampleLabels.review_status,
          note: "用于熟悉队列变化与访问标记时机。",
        }
      : {
          title: `${overview.current_course.title} · ${overview.recommended_node.title}`,
          kind: "课程内容",
          source_path: "/api/v1/student/overview",
          truth_status: "local_api_context",
          note: "当前学习节点的配套内容。",
        },
    goal: `完成“${overview.recommended_node.title}”当前学习节点，并形成可验证的新证据`,
    renderer_type: rendererType,
    decision: {
      source_label: "当前学习安排",
      evidence: [...reviewEvidence, ...(isAlgorithmFixture ? localBfsEvidence : [])].slice(0, 3),
      diagnosis: overview.recommended_node.recommended_reason ?? "尚未形成稳定诊断，先通过当前任务补充学习证据。",
      task_reason: `先推进“${overview.recommended_node.title}”，完成后再根据结果更新路径。`,
    },
    task: {
      title: overview.recommended_node.title,
      summary: overview.current_course.description,
      href: `/student/tasks/${taskId}`,
      action_label: "继续本次学习",
    },
    path: overview.today_plan.map((item, index) => ({
      id: `overview-step-${index + 1}`,
      label: item.label,
      state: pathState(item.status),
    })),
    guide: {
      title: `围绕“${overview.recommended_node.title}”分步推进`,
      steps: [
        "先确认当前材料和目标是否匹配",
        "再观察练习中的过程证据",
        "最后独立完成一次验证",
      ],
    },
    demo_mode: false,
    disclosure: "",
  };
}

const frontendExamples: LearningSession[] = [
  {
    id: "example:algorithm",
    course: { id: "example_algorithm", title: "数据结构", category: rendererLabels.algorithm_trace, progress: 42 },
    material: {
      title: "BFS 过程练习",
      kind: "课程示例",
      source_path: "data/data-structures/samples/bfs-rag-sample.jsonl",
      truth_status: "test_only_unverified",
      note: "用于熟悉算法轨迹与调试。",
    },
    goal: "理解 visited 标记时机，并用运行轨迹验证修复",
    renderer_type: "algorithm_trace",
    decision: {
      source_label: "课程练习",
      evidence: localBfsEvidence,
      diagnosis: "visited 更新时机仍不稳定，需要结合队列轨迹确认。",
      task_reason: "先观察重复入队，再修改代码并独立验证。",
    },
    task: {
      title: "广度优先遍历",
      summary: "观察队列变化，定位重复入队的触发位置。",
      href: "/student/tasks/task_bfs_bug_001",
      action_label: "进入算法练习",
    },
    path: [
      { id: "a1", label: "复习队列", state: "completed" },
      { id: "a2", label: "观察运行轨迹", state: "current" },
      { id: "a3", label: "修复并验证", state: "upcoming" },
    ],
    guide: { title: "从队列证据定位错误", steps: ["标出首次发现节点的时刻", "对比入队与标记顺序", "用新图独立验证"] },
    demo_mode: true,
    disclosure: "",
  },
  {
    id: "example:database",
    course: { id: "example_database", title: "数据库原理", category: rendererLabels.database_lab, progress: 36 },
    material: {
      title: "第 4 章：关系查询与 JOIN",
      kind: "课程示例",
      source_path: "frontend-demo://database/join",
      truth_status: "frontend_example",
      note: "用于熟悉多表查询与结果对照。",
    },
    goal: "区分连接条件与筛选条件，读懂多表查询结果",
    renderer_type: "database_lab",
    decision: {
      source_label: "课程练习",
      evidence: ["练习 02 · 连接条件遗漏", "结果表 · 出现笛卡尔积", "目标 · 独立写出 INNER JOIN"],
      diagnosis: "能够识别表字段，但连接条件和筛选顺序容易混淆。",
      task_reason: "先修正一条 JOIN 查询，再比较结果行数变化。",
    },
    task: {
      title: "修正课程选课查询",
      summary: "连接 student、enrollment 与 course，找出缺失的连接条件。",
      href: "/student/practice",
      action_label: "进入 SQL 练习",
    },
    path: [
      { id: "d1", label: "确认表关系", state: "completed" },
      { id: "d2", label: "补全 JOIN 条件", state: "current" },
      { id: "d3", label: "解释查询结果", state: "upcoming" },
    ],
    guide: { title: "从关系到查询结果", steps: ["标记主外键", "逐个加入连接条件", "比较过滤前后结果"] },
    demo_mode: true,
    disclosure: "",
  },
  {
    id: "example:systems",
    course: { id: "example_systems", title: "操作系统与组成原理", category: rendererLabels.systems_flow, progress: 28 },
    material: {
      title: "进程状态与时间片调度",
      kind: "课程示例",
      source_path: "frontend-demo://systems/process-state",
      truth_status: "frontend_example",
      note: "用于熟悉进程状态与调度过程。",
    },
    goal: "解释一次时间片耗尽后的状态迁移与队列变化",
    renderer_type: "systems_flow",
    decision: {
      source_label: "课程练习",
      evidence: ["状态题 · 就绪/阻塞混淆", "调度题 · 时间片事件遗漏", "目标 · 能完整推演状态迁移"],
      diagnosis: "能记住状态名称，但事件、状态和队列之间尚未连起来。",
      task_reason: "先推演一个进程的状态变化，再检查就绪队列。",
    },
    task: {
      title: "推演时间片轮转",
      summary: "观察 P2 时间片耗尽后 CPU 与就绪队列如何变化。",
      href: "/student/practice",
      action_label: "开始机制推演",
    },
    path: [
      { id: "s1", label: "识别状态", state: "completed" },
      { id: "s2", label: "推演调度事件", state: "current" },
      { id: "s3", label: "解释队列变化", state: "upcoming" },
    ],
    guide: { title: "把事件映射到状态变化", steps: ["确定当前运行进程", "判断触发事件", "更新 CPU 和就绪队列"] },
    demo_mode: true,
    disclosure: "",
  },
  {
    id: "example:network",
    course: { id: "example_network", title: "计算机网络", category: rendererLabels.network_path, progress: 31 },
    material: {
      title: "网络层：IP 转发与路由选择",
      kind: "课程示例",
      source_path: "frontend-demo://network/packet-path",
      truth_status: "frontend_example",
      note: "用于熟悉路由匹配与报文路径。",
    },
    goal: "根据地址和路由表判断报文下一跳",
    renderer_type: "network_path",
    decision: {
      source_label: "课程练习",
      evidence: ["配置题 · 默认路由误用", "路径题 · 下一跳判断错误", "目标 · 独立完成一次连通性定位"],
      diagnosis: "协议层次清楚，但路由匹配与实际报文路径没有对应起来。",
      task_reason: "沿一条报文路径逐跳核对路由表。",
    },
    task: {
      title: "定位报文下一跳",
      summary: "根据三台路由器的前缀表判断数据包转发路径。",
      href: "/student/practice",
      action_label: "开始路径练习",
    },
    path: [
      { id: "n1", label: "识别协议层", state: "completed" },
      { id: "n2", label: "匹配路由前缀", state: "current" },
      { id: "n3", label: "验证端到端路径", state: "upcoming" },
    ],
    guide: { title: "逐跳解释报文路径", steps: ["读取目标 IP", "执行最长前缀匹配", "核对下一跳和出接口"] },
    demo_mode: true,
    disclosure: "",
  },
  {
    id: "example:software",
    course: { id: "example_software", title: "程序设计与软件工程", category: rendererLabels.software_practice, progress: 47 },
    material: {
      title: "单元测试与边界条件",
      kind: "课程示例",
      source_path: "frontend-demo://software/unit-test",
      truth_status: "frontend_example",
      note: "用于熟悉代码阅读与边界测试。",
    },
    goal: "把需求拆成可验证行为，并补齐边界用例",
    renderer_type: "software_practice",
    decision: {
      source_label: "课程练习",
      evidence: ["测试 03 · 空数组失败", "代码阅读 · 未处理 null", "目标 · 独立补齐边界测试"],
      diagnosis: "主流程实现正确，但需求拆解和边界覆盖不完整。",
      task_reason: "先从失败测试还原行为，再补最小修复。",
    },
    task: {
      title: "补齐边界测试",
      summary: "阅读失败用例，把“空输入”拆成明确的可验证行为。",
      href: "/student/practice",
      action_label: "进入仿真练习",
    },
    path: [
      { id: "p1", label: "阅读需求", state: "completed" },
      { id: "p2", label: "定位失败测试", state: "current" },
      { id: "p3", label: "修复并回归", state: "upcoming" },
    ],
    guide: { title: "从失败测试拆解任务", steps: ["复述预期行为", "定位缺失分支", "先补测试再最小修复"] },
    demo_mode: true,
    disclosure: "",
  },
];

export function createLearningSessionCatalog(overview: OverviewData): LearningSession[] {
  const current = adaptOverviewToLearningSession(overview);

  return learningRendererTypes.map((rendererType) =>
    rendererType === current.renderer_type
      ? current
      : frontendExamples.find((session) => session.renderer_type === rendererType)!,
  );
}


