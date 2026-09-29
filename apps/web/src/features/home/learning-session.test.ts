import { describe, expect, it } from "vitest";

import type { OverviewData } from "../../api/client";
import {
  adaptOverviewToLearningSession,
  createLearningSessionCatalog,
  learningRendererTypes,
} from "./learning-session";

const overview = {
  student: {
    user_id: "user_demo_001",
    display_name: "林晓",
    major: "计算机科学与技术",
    grade: "2024级",
    avatar_url: null,
  },
  current_course: {
    course_id: "course_ds_001",
    title: "数据结构",
    description: "从结构理解到算法实现，建立可验证的知识掌握路径。",
    progress_percent: 42,
    current_node_id: "node_bfs_001",
    updated_at: "2026-07-22T09:30:00Z",
  },
  recommended_node: {
    learning_node_id: "node_bfs_001",
    course_id: "course_ds_001",
    concept_id: "concept_bfs_visited",
    title: "广度优先遍历",
    status: "in_progress",
    prerequisite_node_ids: [],
    recommended_reason: "最近两次提交显示 visited 标记时机理解不稳定。",
    completion_criteria: "完成修复并通过独立验证",
    current_task_id: "task_bfs_bug_001",
  },
  today_plan: [
    { label: "复习队列基础", status: "completed" },
    { label: "修复 BFS 代码", status: "in_progress" },
    { label: "完成独立验证", status: "not_started" },
  ],
  review_items: [
    {
      concept_id: "concept_bfs_visited",
      label: "visited 标记时机",
      evidence_label: "2 次错误",
      learning_node_id: "node_bfs_001",
    },
  ],
  recent_activity: [{ label: "提交 BFS 练习", occurred_at: "2026-07-26T09:30:00Z" }],
} satisfies OverviewData;

describe("LearningSession adapter", () => {
  it("derives the active task and diagnosis from the overview instead of fixed homepage copy", () => {
    const session = adaptOverviewToLearningSession(overview);

    expect(session.course.title).toBe("数据结构");
    expect(session.renderer_type).toBe("algorithm_trace");
    expect(session.task.title).toBe("广度优先遍历");
    expect(session.decision.diagnosis).toBe(
      "最近两次提交显示 visited 标记时机理解不稳定。",
    );
    expect(session.path.map((step) => step.label)).toEqual([
      "复习队列基础",
      "修复 BFS 代码",
      "完成独立验证",
    ]);
  });

  it("keeps provenance structured without surfacing developer-facing runtime notes", () => {
    const session = adaptOverviewToLearningSession(overview);

    expect(session.material.source_path).toBe(
      "data/data-structures/samples/bfs-rag-sample.jsonl",
    );
    expect(session.material.truth_status).toBe("test_only_unverified");
    expect(session.material.note).not.toMatch(/联调|接口|模型|前端/u);
    expect(session.decision.evidence.every((item) => !item.includes("csdn_"))).toBe(true);
    expect(session.disclosure).toBe("");
  });

  it("exposes one course sample for every supported learning surface without engineering labels", () => {
    const catalog = createLearningSessionCatalog(overview);

    expect(catalog).toHaveLength(5);
    expect(catalog.map((session) => session.renderer_type)).toEqual(learningRendererTypes);
    expect(catalog.map((session) => session.course.title)).toEqual([
      "数据结构",
      "数据库原理",
      "操作系统与组成原理",
      "计算机网络",
      "程序设计与软件工程",
    ]);
    expect(catalog.slice(1).every((session) => session.demo_mode)).toBe(true);
    expect(catalog.every((session) => session.disclosure === "")).toBe(true);
    expect(catalog.every((session) => !/前端|接口|模型|后端|模拟器/u.test(session.material.note))).toBe(true);
  });
});
