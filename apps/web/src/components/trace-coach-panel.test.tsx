import type { AlgorithmTraceStep } from "@xuetu/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TraceCoachPanel } from "./trace-coach-panel";

const step: AlgorithmTraceStep = {
  step_index: 4,
  code_line: 11,
  action: "节点 3 重复入队",
  explanation: "节点 3 已在队列中，但 visited[3] 仍为 false。",
  guiding_question: "如果第一次入队时就标记，判断会怎样？",
  current_node_id: "2",
  queue: ["3", "3", "4"],
  visited: ["1", "2"],
  output: ["1", "2"],
  newly_enqueued: ["3", "4"],
  source_ids: ["source_ds_book_143"],
  conflict: {
    code: "BFS_DUPLICATE_ENQUEUE",
    message: "节点 3 已在队列中但仍未标记访问。",
  },
  prediction: null,
};

describe("TraceCoachPanel", () => {
  it("grounds the current conflict in explanation, question, and source", () => {
    render(<TraceCoachPanel step={step} variant="visited-on-dequeue" />);

    expect(screen.getByRole("heading", { name: "发现状态冲突" })).toBeInTheDocument();
    expect(screen.getByText("节点 3 已在队列中但仍未标记访问。")).toBeInTheDocument();
    expect(screen.getByText("如果第一次入队时就标记，判断会怎样？")).toBeInTheDocument();
    expect(screen.getByText("教材 6.2.1 · 广度优先遍历")).toBeInTheDocument();
  });

  it("shows a consistent state for a corrected step", () => {
    render(
      <TraceCoachPanel
        step={{ ...step, conflict: null, action: "跳过已发现节点 3" }}
        variant="visited-on-enqueue"
      />,
    );

    expect(screen.getByRole("heading", { name: "当前状态一致" })).toBeInTheDocument();
  });
});
