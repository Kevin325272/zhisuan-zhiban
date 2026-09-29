import type {
  AbilityAssessmentKey,
  Citation,
  CourseSummary,
  LearningNode,
  PlanItem,
  StudentProfile,
  Task,
} from "@xuetu/contracts";

import {
  getProgrammingLanguageDefinition,
  programmingLanguageDefinitions,
} from "./programming-languages.js";
import { shortestPathTemplates } from "../services/evaluator/shortest-path-task.js";

export interface DemoState {
  student: StudentProfile;
  course: CourseSummary;
  nodes: LearningNode[];
  tasks: Map<string, Task>;
  citations: Map<string, Citation>;
  plan_items: PlanItem[];
  ability_scores: Record<AbilityAssessmentKey, number>;
  learning_state_version: number;
}

export function createDemoState(): DemoState {
  const student: StudentProfile = {
    user_id: "user_demo_001",
    display_name: "演示学生",
    major: "计算机科学与技术",
    grade: "2024级",
    avatar_url: null,
  };

  const course: CourseSummary = {
    course_id: "course_ds_001",
    title: "数据结构",
    description: "从结构理解到算法实现，建立可验证的知识掌握路径。",
    progress_percent: 42,
    current_node_id: "node_bfs_001",
    updated_at: "2026-07-22T09:30:00Z",
  };

  const nodes: LearningNode[] = [
    {
      learning_node_id: "node_queue_001",
      course_id: course.course_id,
      concept_id: "concept_queue",
      title: "队列基础",
      status: "mastered",
      prerequisite_node_ids: [],
      recommended_reason: null,
      completion_criteria: "独立完成队列基本操作任务。",
      current_task_id: null,
    },
    {
      learning_node_id: "node_graph_repr_001",
      course_id: course.course_id,
      concept_id: "concept_graph_repr",
      title: "邻接矩阵与邻接表",
      status: "mastered",
      prerequisite_node_ids: [],
      recommended_reason: null,
      completion_criteria: "能够为给定图选择并构建合适表示。",
      current_task_id: null,
    },
    {
      learning_node_id: "node_bfs_001",
      course_id: course.course_id,
      concept_id: "concept_bfs",
      title: "广度优先遍历",
      status: "in_progress",
      prerequisite_node_ids: [
        "node_queue_001",
        "node_graph_repr_001",
        "node_graph_traversal_001",
      ],
      recommended_reason: "最近两次提交显示 visited 标记时机理解不稳定。",
      completion_criteria: "完成代码任务并首次通过独立验证。",
      current_task_id: "task_bfs_bug_001",
    },
    {
      learning_node_id: "node_graph_traversal_001",
      course_id: course.course_id,
      concept_id: "concept_graph_traversal",
      title: "图的遍历",
      status: "needs_review",
      prerequisite_node_ids: ["node_graph_repr_001"],
      recommended_reason: "遍历框架已理解，但不同访问策略的状态维护仍需巩固。",
      completion_criteria: "能够解释图遍历中的访问状态与去重机制。",
      current_task_id: null,
    },
    {
      learning_node_id: "node_dfs_001",
      course_id: course.course_id,
      concept_id: "concept_dfs",
      title: "深度优先遍历",
      status: "not_started",
      prerequisite_node_ids: ["node_graph_traversal_001"],
      recommended_reason: "完成 BFS 独立验证后进入。",
      completion_criteria: "完成递归与显式栈两种实现。",
      current_task_id: null,
    },
    {
      learning_node_id: "node_shortest_001",
      course_id: course.course_id,
      concept_id: "concept_unweighted_shortest_path",
      title: "无权图最短路径",
      status: "not_started",
      prerequisite_node_ids: ["node_bfs_001"],
      recommended_reason: "需要先稳定掌握 BFS 的队列与访问标记。",
      completion_criteria: "独立完成无权图最短路径任务。",
      current_task_id: null,
    },
    {
      learning_node_id: "node_connected_001",
      course_id: course.course_id,
      concept_id: "concept_connected_components",
      title: "连通分量",
      status: "not_started",
      prerequisite_node_ids: ["node_bfs_001", "node_dfs_001"],
      recommended_reason: "需要先掌握 BFS 与 DFS 两种遍历策略。",
      completion_criteria: "能够标记并统计无向图的连通分量。",
      current_task_id: null,
    },
  ];

  const defaultLanguage = getProgrammingLanguageDefinition("cpp");
  const codeTemplates = programmingLanguageDefinitions.map((definition) => ({
    language: definition.language,
    file_name: definition.file_name,
    starter_code: definition.starter_code,
    fixed_code: definition.fixed_code,
  }));

  const tasks = new Map<string, Task>([
    [
      "task_bfs_bug_001",
      {
        task_id: "task_bfs_bug_001",
        learning_node_id: "node_bfs_001",
        type: "code",
        title: "修复 BFS 重复入队问题",
        prompt_markdown: "修复代码，使每个顶点只入队一次，并保持正确的广度优先访问顺序。",
        language: "cpp",
        starter_code: defaultLanguage.starter_code,
        code_templates: codeTemplates,
        time_limit_ms: 1000,
        memory_limit_mb: 128,
        allowed_hint_level: 2,
        is_independent_validation: false,
        version: 1,
      },
    ],
    [
      "task_bfs_transfer_001",
      {
        task_id: "task_bfs_transfer_001",
        learning_node_id: "node_bfs_001",
        type: "transfer_validation",
        title: "校园节点的最少边数",
        prompt_markdown:
          "在一批全新的无权有向图中实现 `shortestPath`：返回起点到目标点经过的最少边数，无法到达时返回 -1。本环节不提供提示，提交后由评测器在隐藏用例上判定。",
        language: "cpp",
        starter_code: shortestPathTemplates.cpp.starter_code,
        code_templates: (Object.keys(shortestPathTemplates) as Array<
          keyof typeof shortestPathTemplates
        >).map((language) => ({
          language,
          file_name: shortestPathTemplates[language].file_name,
          starter_code: shortestPathTemplates[language].starter_code,
        })),
        time_limit_ms: 1000,
        memory_limit_mb: 128,
        allowed_hint_level: 0,
        is_independent_validation: true,
        version: 1,
      },
    ],
  ]);

  const citation: Citation = {
    source_id: "source_ds_book_143",
    document_id: "doc_ds_textbook_v1",
    title: "数据结构课程教材",
    section: "6.2.1 广度优先遍历",
    page: 143,
    paragraph: "p_06_02_01_04",
    snippet: "顶点入队时应立即标记为已访问，避免同一顶点被重复加入队列。",
    relevance: 0.91,
    knowledge_base_version: "kb_ds_2026_07_20",
    viewer_url: "/api/v1/sources/source_ds_book_143",
  };

  const plan_items: PlanItem[] = [
    {
      plan_item_id: "plan_item_001",
      learning_node_id: "node_queue_001",
      position: 1,
      status: "mastered",
      recommended_reason: "BFS 使用队列维护待访问顶点。",
      completion_criteria: "独立完成队列基本操作任务。",
      based_on_diagnosis_ids: [],
    },
    {
      plan_item_id: "plan_item_002",
      learning_node_id: "node_graph_repr_001",
      position: 2,
      status: "mastered",
      recommended_reason: "遍历前需要理解图的存储方式。",
      completion_criteria: "正确构建邻接表。",
      based_on_diagnosis_ids: [],
    },
    {
      plan_item_id: "plan_item_003",
      learning_node_id: "node_bfs_001",
      position: 3,
      status: "in_progress",
      recommended_reason: "两次提交出现重复访问，且尚未完成独立验证。",
      completion_criteria: "独立验证任务首次通过。",
      based_on_diagnosis_ids: [],
    },
    {
      plan_item_id: "plan_item_004",
      learning_node_id: "node_dfs_001",
      position: 4,
      status: "not_started",
      recommended_reason: "完成 BFS 后比较两种遍历策略。",
      completion_criteria: "完成 DFS 对比任务。",
      based_on_diagnosis_ids: [],
    },
  ];

  return {
    student,
    course,
    nodes,
    tasks,
    citations: new Map([[citation.source_id, citation]]),
    plan_items,
    ability_scores: {
      knowledge_understanding: 82,
      algorithmic_thinking: 74,
      code_implementation: 61,
      debugging_diagnosis: 68,
      system_thinking: 56,
      transfer_application: 64,
    },
    learning_state_version: 7,
  };
}
