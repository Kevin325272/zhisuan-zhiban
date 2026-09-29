import type { CourseMap, CourseMapNode } from "@xuetu/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KnowledgeGraph } from "./knowledge-graph";

function node(
  learningNodeId: string,
  title: string,
  prerequisites: string[],
  weaknessCount: number,
  position: { x: number; y: number },
): CourseMapNode {
  return {
    learning_node_id: learningNodeId,
    course_id: "course_ds_001",
    concept_id: `concept_${learningNodeId}`,
    title,
    status: learningNodeId === "node_queue_001" ? "mastered" : "in_progress",
    prerequisite_node_ids: prerequisites,
    recommended_reason: "用于图谱交互测试。",
    completion_criteria: "完成客观评测。",
    current_task_id: learningNodeId === "node_bfs_001" ? "task_bfs_bug_001" : null,
    mastery_percent: learningNodeId === "node_bfs_001" ? 62 : 80,
    evidence_count: 2,
    weakness_count: weaknessCount,
    source_count: 2,
    position,
  };
}

const courseMap: CourseMap = {
  course: {
    course_id: "course_ds_001",
    title: "数据结构",
    description: "从结构理解到算法实现。",
    progress_percent: 42,
    current_node_id: "node_bfs_001",
    updated_at: "2026-07-22T09:30:00Z",
  },
  recommended_node_id: "node_bfs_001",
  nodes: [
    node("node_queue_001", "队列基础", [], 0, { x: 12, y: 35 }),
    node("node_graph_001", "图的表示", [], 0, { x: 34, y: 65 }),
    node(
      "node_bfs_001",
      "广度优先遍历",
      ["node_queue_001", "node_graph_001"],
      2,
      { x: 58, y: 44 },
    ),
    node("node_dfs_001", "深度优先遍历", ["node_graph_001"], 0, { x: 84, y: 67 }),
  ],
  edges: [
    {
      from_node_id: "node_queue_001",
      to_node_id: "node_bfs_001",
      relation: "prerequisite",
    },
    {
      from_node_id: "node_graph_001",
      to_node_id: "node_bfs_001",
      relation: "prerequisite",
    },
    {
      from_node_id: "node_graph_001",
      to_node_id: "node_dfs_001",
      relation: "prerequisite",
    },
  ],
};

describe("KnowledgeGraph", () => {
  it("exposes semantic node controls and reports selection", () => {
    const onSelectNode = vi.fn();
    render(
      <KnowledgeGraph
        courseMap={courseMap}
        onlyWeak={false}
        onSelectNode={onSelectNode}
        selectedNodeId="node_bfs_001"
      />,
    );

    const bfsNode = screen.getByRole("button", {
      name: "广度优先遍历，当前推荐，掌握度 62%",
    });
    expect(bfsNode).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /深度优先遍历/ }));
    expect(onSelectNode).toHaveBeenCalledWith("node_dfs_001");
  });

  it("keeps prerequisites visible when filtering to weak concepts", () => {
    render(
      <KnowledgeGraph
        courseMap={courseMap}
        onlyWeak
        onSelectNode={vi.fn()}
        selectedNodeId="node_bfs_001"
      />,
    );

    expect(screen.getByRole("button", { name: /广度优先遍历/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /队列基础/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /图的表示/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /深度优先遍历/ })).not.toBeInTheDocument();
  });
});
