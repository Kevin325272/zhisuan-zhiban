import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OverviewData } from "../../api/client";
import { createLearningSessionCatalog } from "./learning-session";
import { LearningSurface } from "./learning-surface-registry";

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
    description: "从结构理解到算法实现。",
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
    recommended_reason: "visited 标记时机理解不稳定。",
    completion_criteria: "完成修复并通过独立验证",
    current_task_id: "task_bfs_bug_001",
  },
  today_plan: [
    { label: "复习队列基础", status: "completed" },
    { label: "修复 BFS 代码", status: "in_progress" },
    { label: "完成独立验证", status: "not_started" },
  ],
  review_items: [],
  recent_activity: [],
} satisfies OverviewData;

const cases = [
  ["algorithm_trace", "算法过程工作面", "Queue", "visited", "BFS 过程演练"],
  ["database_lab", "数据库查询工作面", "INNER JOIN", "查询结果预览", "SQL 查询演练"],
  ["systems_flow", "机制状态工作面", "运行态", "就绪队列", "进程状态演练"],
  ["network_path", "网络路径工作面", "最长前缀匹配", "Router B", "路由决策演练"],
  ["software_practice", "程序设计工作面", "失败测试", "空数组", "测试用例演练"],
] as const;

describe("LearningSurface renderer registry", () => {
  it.each(cases)("renders %s with its own course-appropriate state", (type, label, first, second, modeLabel) => {
    const session = createLearningSessionCatalog(overview).find(
      (candidate) => candidate.renderer_type === type,
    );

    expect(session).toBeDefined();
    render(<LearningSurface session={session!} />);

    const surface = screen.getByRole("region", { name: label });
    expect(within(surface).getAllByText(first, { exact: false }).length).toBeGreaterThan(0);
    expect(within(surface).getAllByText(second, { exact: false }).length).toBeGreaterThan(0);
    expect(within(surface).getByText(modeLabel)).toBeInTheDocument();
    expect(within(surface).queryByText(/前端|本地|示例|演示|确定性/)).not.toBeInTheDocument();
  });

  it("teaches BFS by synchronizing graph state, queue changes, pseudocode, and step controls", () => {
    const session = createLearningSessionCatalog(overview).find(
      (candidate) => candidate.renderer_type === "algorithm_trace",
    );

    render(<LearningSurface session={session!} />);

    const surface = screen.getByRole("region", { name: "算法过程工作面" });
    const queue = within(surface).getByRole("region", { name: "Queue 变化" });
    const next = within(surface).getByRole("button", { name: "下一步" });

    expect(within(surface).getByText("初始化起点")).toBeInTheDocument();
    expect(within(queue).getByText("队首")).toBeInTheDocument();
    expect(within(queue).getByText("队尾")).toBeInTheDocument();
    expect(within(queue).getByText("1", { selector: "b" })).toBeInTheDocument();
    expect(within(surface).getByText("标记 1 为已发现并入队")).toHaveAttribute(
      "aria-current",
      "step",
    );

    fireEvent.click(next);
    expect(within(surface).getByText("取出节点 1")).toBeInTheDocument();
    expect(within(surface).getByLabelText("节点 1：当前处理")).toBeInTheDocument();

    for (let step = 0; step < 5; step += 1) fireEvent.click(next);

    expect(within(surface).getByText("检查节点 3 的邻接点")).toBeInTheDocument();
    const stepPanel = within(surface).getByRole("complementary", { name: "当前步骤与伪代码" });
    expect(within(stepPanel).getByText(/节点 5 已在发现时标记，阻止重复入队/)).toBeInTheDocument();
    expect(within(queue).getByText("4", { selector: "b" })).toBeInTheDocument();
    expect(within(queue).getByText("5", { selector: "b" })).toBeInTheDocument();
    expect(within(queue).getByText("6", { selector: "b" })).toBeInTheDocument();
    expect(within(surface).getByLabelText("节点 3：已访问")).toBeInTheDocument();
    expect(within(surface).getByLabelText("节点 5：已入队")).toBeInTheDocument();

    fireEvent.click(within(surface).getByRole("button", { name: "重置演示" }));
    expect(within(surface).getByText("初始化起点")).toBeInTheDocument();
    expect(within(surface).getByRole("button", { name: "上一步" })).toBeDisabled();
  });

  it("renders the database example with lightweight static syntax tokens", () => {
    const session = createLearningSessionCatalog(overview).find(
      (candidate) => candidate.renderer_type === "database_lab",
    );

    render(<LearningSurface session={session!} />);

    const sql = screen.getByLabelText("SQL 示例");
    expect(within(sql).getAllByText(/SELECT|FROM|JOIN/).length).toBeGreaterThan(0);
    expect(sql.querySelector(".sql-keyword")).toHaveTextContent("SELECT");
    expect(sql.querySelector(".sql-table")).toHaveTextContent("student");
    expect(sql.querySelector(".sql-field")).toHaveTextContent("s.name");
    expect(sql.querySelector(".sql-string")).toHaveTextContent("'数据库原理'");
    expect(sql.querySelector(".sql-comment")).toHaveTextContent("课程选课关系");
  });
});
