import type { AlgorithmTrace, AlgorithmTraceStep } from "@xuetu/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  TracePredictionChallenge,
  type TraceChallengeAnswers,
} from "./trace-prediction-challenge";

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
    visited: ["1"],
    output: stepIndex === 0 ? [] : ["1"],
    newly_enqueued: stepIndex === 0 ? ["1"] : [],
    source_ids: ["source_ds_book_143"],
    conflict: null,
    prediction:
      stepIndex === 0
        ? {
            question: "节点 1 出队后，Queue 会变成什么？",
            options: [
              { option_id: "keep-one", label: "[1]" },
              { option_id: "empty", label: "空队列" },
              { option_id: "add-two", label: "[1, 2]" },
            ],
            correct_option_id: "empty",
            explanation: "节点 1 位于队首，执行 pop 后队列为空。",
          }
        : null,
    ...overrides,
  };
}

function buildTrace(steps = [step(0), step(1)]): AlgorithmTrace {
  return {
    task_id: "task_bfs_bug_001",
    variant: "visited-on-enqueue",
    language: "cpp",
    file_name: "bfs.cpp",
    source_code: "pending.push(start);\npending.pop();",
    graph: {
      nodes: [{ node_id: "1", label: "1", position: { x: 50, y: 50 } }],
      edges: [],
    },
    steps,
  };
}

function ChallengeHarness({ trace = buildTrace() }: { trace?: AlgorithmTrace }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<TraceChallengeAnswers>({});

  return (
    <TracePredictionChallenge
      answers={answers}
      onAnswer={(index, optionId) =>
        setAnswers((current) => ({ ...current, [index]: optionId }))
      }
      onStepIndexChange={setStepIndex}
      stepIndex={stepIndex}
      trace={trace}
    />
  );
}

describe("TracePredictionChallenge", () => {
  it("locks the next state until an answer is submitted, then reveals and advances", () => {
    render(<ChallengeHarness />);

    expect(screen.getByRole("heading", { name: "预测下一步" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /跳到第 2 步/ })).toBeDisabled();
    expect(screen.queryByText(/真实下一步 Queue/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "空队列" }));
    fireEvent.click(screen.getByRole("button", { name: "提交预测" }));

    expect(screen.getByRole("status")).toHaveTextContent("回答正确");
    expect(screen.getByRole("status")).toHaveTextContent("真实下一步 Queue：空");
    expect(screen.getByRole("button", { name: "继续到下一步" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "继续到下一步" }));
    expect(screen.getByRole("heading", { name: "挑战完成" })).toBeInTheDocument();
    expect(screen.getByText("答对 1 / 1 题")).toBeInTheDocument();
  });

  it("shows corrective feedback for an incorrect prediction", () => {
    render(<ChallengeHarness />);

    fireEvent.click(screen.getByRole("radio", { name: "[1]" }));
    fireEvent.click(screen.getByRole("button", { name: "提交预测" }));

    expect(screen.getByRole("status")).toHaveTextContent("预测有偏差");
    expect(screen.getByRole("status")).toHaveTextContent(
      "节点 1 位于队首，执行 pop 后队列为空。",
    );
  });

  it("falls back to ordinary stepping when prediction metadata is absent", () => {
    const onStepIndexChange = vi.fn();
    render(
      <TracePredictionChallenge
        answers={{}}
        onAnswer={vi.fn()}
        onStepIndexChange={onStepIndexChange}
        stepIndex={0}
        trace={buildTrace([step(0, { prediction: null }), step(1)])}
      />,
    );

    expect(screen.getByText("本步暂无预测题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续到下一步" }));
    expect(onStepIndexChange).toHaveBeenCalledWith(1);
  });
});
