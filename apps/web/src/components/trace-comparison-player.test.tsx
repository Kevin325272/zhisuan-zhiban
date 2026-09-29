import type { AlgorithmTrace, AlgorithmTraceStep, TraceVariant } from "@xuetu/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TraceComparisonPlayer } from "./trace-comparison-player";

function step(
  stepIndex: number,
  overrides: Partial<AlgorithmTraceStep> = {},
): AlgorithmTraceStep {
  return {
    step_index: stepIndex,
    code_line: stepIndex + 1,
    action: `执行步骤 ${stepIndex + 1}`,
    explanation: "轨迹说明",
    guiding_question: "为什么会产生差异？",
    current_node_id: "1",
    queue: ["1"],
    visited: [],
    output: [],
    newly_enqueued: [],
    source_ids: ["source_ds_book_143"],
    conflict: null,
    prediction: null,
    ...overrides,
  };
}

function trace(variant: TraceVariant, steps: AlgorithmTraceStep[]): AlgorithmTrace {
  return {
    task_id: "task_bfs_bug_001",
    variant,
    language: "cpp",
    file_name: "bfs.cpp",
    source_code: "pending.push(start);\nvisited[start] = true;",
    graph: {
      nodes: [
        { node_id: "1", label: "1", position: { x: 25, y: 50 } },
        { node_id: "2", label: "2", position: { x: 75, y: 50 } },
      ],
      edges: [{ from_node_id: "1", to_node_id: "2" }],
    },
    steps,
  };
}

const wrongTrace = trace("visited-on-dequeue", [
  step(0, { visited: [] }),
  step(1, {
    queue: ["2", "2"],
    visited: ["1"],
    output: ["1"],
    conflict: { code: "BFS_DUPLICATE_ENQUEUE", message: "节点 2 重复入队。" },
  }),
]);

const fixedTrace = trace("visited-on-enqueue", [
  step(0, { visited: ["1"] }),
  step(1, { queue: ["2"], visited: ["1", "2"], output: ["1"] }),
]);

function ComparisonHarness() {
  const [stepIndex, setStepIndex] = useState(0);
  const [activeVariant, setActiveVariant] = useState<TraceVariant>("visited-on-dequeue");

  return (
    <TraceComparisonPlayer
      activeVariant={activeVariant}
      fixedTrace={fixedTrace}
      onActiveVariantChange={setActiveVariant}
      onStepIndexChange={setStepIndex}
      stepIndex={stepIndex}
      wrongTrace={wrongTrace}
    />
  );
}

describe("TraceComparisonPlayer", () => {
  it("shows the first divergence and advances both tracks with one timeline", () => {
    render(<ComparisonHarness />);

    expect(screen.getByText("首次分叉：第 1 步")).toBeInTheDocument();
    expect(screen.getByLabelText("当前步骤差异")).toHaveTextContent("Visited");
    expect(screen.getByRole("heading", { name: "错误版" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "修复版" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("当前队列")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByLabelText("当前步骤差异")).toHaveTextContent("Queue");
    expect(screen.getByLabelText("当前步骤差异")).toHaveTextContent("Visited");
    expect(screen.getAllByLabelText("当前队列")[0]).toHaveTextContent("22");
    expect(screen.getAllByLabelText("当前队列")[1]).toHaveTextContent("2");
  });

  it("does not reuse the final snapshot when one trace lacks the current step", () => {
    render(
      <TraceComparisonPlayer
        activeVariant="visited-on-enqueue"
        fixedTrace={trace("visited-on-enqueue", [step(0, { visited: ["1"] })])}
        onActiveVariantChange={vi.fn()}
        onStepIndexChange={vi.fn()}
        stepIndex={1}
        wrongTrace={wrongTrace}
      />,
    );

    expect(screen.getByText("无对应步骤")).toBeInTheDocument();
  });

  it("offers an explicit mobile track switch without changing the shared step", () => {
    const onActiveVariantChange = vi.fn();
    render(
      <TraceComparisonPlayer
        activeVariant="visited-on-dequeue"
        fixedTrace={fixedTrace}
        onActiveVariantChange={onActiveVariantChange}
        onStepIndexChange={vi.fn()}
        stepIndex={0}
        wrongTrace={wrongTrace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看修复版" }));
    expect(onActiveVariantChange).toHaveBeenCalledWith("visited-on-enqueue");
  });
});
