import type { AlgorithmTrace, AlgorithmTraceStep } from "@xuetu/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AlgorithmTracePlayer } from "./algorithm-trace-player";

const trace: AlgorithmTrace = {
  task_id: "task_bfs_bug_001",
  variant: "visited-on-dequeue",
  language: "cpp",
  file_name: "bfs.cpp",
  source_code: "pending.push(start);\nconst int current = pending.front();\npending.push(next);",
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
        question: "下一步 Queue 是什么？",
        options: [
          { option_id: "empty", label: "空队列" },
          { option_id: "one", label: "[1]" },
        ],
        correct_option_id: "empty",
        explanation: "节点 1 出队。",
      },
    },
    {
      step_index: 1,
      code_line: 3,
      action: "节点 2 重复入队",
      explanation: "visited 更新太晚。",
      guiding_question: "标记前移会发生什么？",
      current_node_id: "2",
      queue: ["2", "2"],
      visited: ["1"],
      output: ["1", "2"],
      newly_enqueued: ["2"],
      source_ids: ["source_ds_book_143"],
      conflict: {
        code: "BFS_DUPLICATE_ENQUEUE",
        message: "节点 2 重复入队。",
      },
      prediction: null,
    },
  ],
};

function PlayerHarness({ onStepChange }: { onStepChange?: (step: AlgorithmTraceStep) => void }) {
  const [stepIndex, setStepIndex] = useState(0);

  return (
    <AlgorithmTracePlayer
      onStepChange={onStepChange}
      onStepIndexChange={setStepIndex}
      stepIndex={stepIndex}
      trace={trace}
    />
  );
}

describe("AlgorithmTracePlayer", () => {
  afterEach(() => vi.useRealTimers());

  it("synchronizes the summary, code, graph state, state dock, and timeline", () => {
    const onStepChange = vi.fn();
    render(<PlayerHarness onStepChange={onStepChange} />);

    expect(screen.getByLabelText("执行摘要")).toHaveTextContent("起点 1 入队");
    expect(screen.getByLabelText("当前节点")).toHaveTextContent("1");
    expect(screen.getByLabelText("当前队列")).toHaveTextContent("1");
    expect(screen.getByLabelText("已发现节点")).toHaveTextContent("空");
    expect(screen.getByLabelText("遍历输出")).toHaveTextContent("空");
    expect(screen.getByText("bfs.cpp")).toBeInTheDocument();
    const codePane = screen.getByLabelText("同步代码");
    expect(codePane.querySelectorAll("li")[0]).toHaveClass("active");
    expect(codePane.querySelector(".token.keyword")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /跳到第 2 步/ }));

    expect(screen.getByLabelText("执行摘要")).toHaveTextContent("含重复");
    expect(screen.getByLabelText("当前队列")).toHaveTextContent("22");
    expect(screen.getByLabelText("遍历输出")).toHaveTextContent("12");
    expect(screen.getByLabelText("节点 2 在队列中出现 2 次")).toBeInTheDocument();
    expect(codePane.querySelectorAll("li")[2]).toHaveClass(
      "active",
      "conflict",
    );
    expect(onStepChange).toHaveBeenLastCalledWith(trace.steps[1]);
  });

  it("keeps active-line syncing inside the code pane without scrolling the document", () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      render(<PlayerHarness />);
      fireEvent.click(screen.getByRole("button", { name: /跳到第 2 步/ }));

      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });

  it("uses a controlled step index for next and reset actions", () => {
    const onStepIndexChange = vi.fn();
    const { rerender } = render(
      <AlgorithmTracePlayer
        onStepIndexChange={onStepIndexChange}
        stepIndex={0}
        trace={trace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(onStepIndexChange).toHaveBeenLastCalledWith(1);

    rerender(
      <AlgorithmTracePlayer
        onStepIndexChange={onStepIndexChange}
        stepIndex={1}
        trace={trace}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "回到起点" }));
    expect(onStepIndexChange).toHaveBeenLastCalledWith(0);
  });

  it("plays to the final step and can reset", () => {
    vi.useFakeTimers();
    render(<PlayerHarness />);

    fireEvent.click(screen.getByRole("button", { name: "播放轨迹" }));
    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.getByText("节点 2 重复入队")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "回到起点" }));
    expect(screen.getByText("起点 1 入队")).toBeInTheDocument();
  });

  it("lets the student resize the synchronized code and graph panes with the keyboard", () => {
    render(<PlayerHarness />);

    const separator = screen.getByRole("separator", { name: "调整代码与图状态宽度" });
    expect(separator).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "55");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "32");
  });
});
