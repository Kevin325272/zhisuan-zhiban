import type { AlgorithmTrace, AlgorithmTraceStep, TraceVariant } from "@xuetu/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TraceExperience } from "./trace-experience";

function step(
  stepIndex: number,
  overrides: Partial<AlgorithmTraceStep> = {},
): AlgorithmTraceStep {
  return {
    step_index: stepIndex,
    code_line: stepIndex + 1,
    action: stepIndex === 0 ? "起点 1 入队" : "节点 1 出队",
    explanation: "轨迹说明",
    guiding_question: "下一步会发生什么？",
    current_node_id: "1",
    queue: stepIndex === 0 ? ["1"] : [],
    visited: [],
    output: stepIndex === 0 ? [] : ["1"],
    newly_enqueued: stepIndex === 0 ? ["1"] : [],
    source_ids: ["source_ds_book_143"],
    conflict: null,
    prediction:
      stepIndex === 0
        ? {
            question: "节点 1 出队后，Queue 会变成什么？",
            options: [
              { option_id: "keep", label: "[1]" },
              { option_id: "empty", label: "空队列" },
            ],
            correct_option_id: "empty",
            explanation: "节点 1 出队后队列为空。",
          }
        : null,
    ...overrides,
  };
}

function trace(variant: TraceVariant): AlgorithmTrace {
  return {
    task_id: "task_bfs_bug_001",
    variant,
    language: "cpp",
    file_name: "bfs.cpp",
    source_code: "pending.push(start);\npending.pop();",
    graph: {
      nodes: [{ node_id: "1", label: "1", position: { x: 50, y: 50 } }],
      edges: [],
    },
    steps: [
      step(0, { visited: variant === "visited-on-enqueue" ? ["1"] : [] }),
      step(1, { visited: ["1"] }),
    ],
  };
}

const wrongTrace = trace("visited-on-dequeue");
const fixedTrace = trace("visited-on-enqueue");

describe("TraceExperience", () => {
  it("lazy-loads comparison mode and renders both traces when available", () => {
    const onRequestComparison = vi.fn();
    const view = render(
      <TraceExperience
        comparisonError={null}
        comparisonLoading={false}
        comparisonTrace={null}
        onRequestComparison={onRequestComparison}
        trace={wrongTrace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "双轨对比" }));
    expect(onRequestComparison).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载对比轨迹");

    view.rerender(
      <TraceExperience
        comparisonError={null}
        comparisonLoading={false}
        comparisonTrace={fixedTrace}
        onRequestComparison={onRequestComparison}
        trace={wrongTrace}
      />,
    );
    expect(screen.getByRole("heading", { name: "BFS 双轨对比" })).toBeInTheDocument();
    expect(screen.getByText("首次分叉：第 1 步")).toBeInTheDocument();
  });

  it("retains the current step while switching modes", () => {
    render(
      <TraceExperience
        comparisonError={null}
        comparisonLoading={false}
        comparisonTrace={fixedTrace}
        onRequestComparison={vi.fn()}
        trace={wrongTrace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /跳到第 2 步/ }));
    fireEvent.click(screen.getByRole("button", { name: "预测挑战" }));
    expect(screen.getByRole("heading", { name: "挑战完成" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "讲解模式" }));
    expect(screen.getByLabelText("执行摘要")).toHaveTextContent("节点 1 出队");
  });

  it("keeps submitted challenge feedback during mode changes", () => {
    render(
      <TraceExperience
        comparisonError={null}
        comparisonLoading={false}
        comparisonTrace={fixedTrace}
        onRequestComparison={vi.fn()}
        trace={wrongTrace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预测挑战" }));
    fireEvent.click(screen.getByRole("radio", { name: "空队列" }));
    fireEvent.click(screen.getByRole("button", { name: "提交预测" }));
    expect(screen.getByRole("status")).toHaveTextContent("回答正确");

    fireEvent.click(screen.getByRole("button", { name: "讲解模式" }));
    fireEvent.click(screen.getByRole("button", { name: "预测挑战" }));
    expect(screen.getByRole("status")).toHaveTextContent("回答正确");
  });

  it("shows a retry action when the second trace fails", () => {
    const onRequestComparison = vi.fn();
    render(
      <TraceExperience
        comparisonError="修复版轨迹加载失败。"
        comparisonLoading={false}
        comparisonTrace={null}
        onRequestComparison={onRequestComparison}
        trace={wrongTrace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "双轨对比" }));
    expect(screen.getByRole("alert")).toHaveTextContent("修复版轨迹加载失败");
    expect(screen.getByRole("heading", { name: "BFS 运行轨迹" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载对比轨迹" }));
    expect(onRequestComparison).toHaveBeenCalledTimes(1);
  });
});
