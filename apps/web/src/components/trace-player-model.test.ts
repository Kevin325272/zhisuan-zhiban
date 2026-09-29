import type { AlgorithmTrace, AlgorithmTraceStep, TraceVariant } from "@xuetu/contracts";
import { describe, expect, it } from "vitest";

import {
  compareTraceSteps,
  countQueueEntries,
  findFirstTraceDivergence,
  findStepByIndex,
} from "./trace-player-model";

function step(
  stepIndex: number,
  overrides: Partial<AlgorithmTraceStep> = {},
): AlgorithmTraceStep {
  return {
    step_index: stepIndex,
    code_line: stepIndex + 1,
    action: `第 ${stepIndex + 1} 步`,
    explanation: "轨迹说明",
    guiding_question: "下一步会发生什么？",
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
    source_code: "void bfs() {}",
    graph: {
      nodes: [{ node_id: "1", label: "1", position: { x: 50, y: 50 } }],
      edges: [],
    },
    steps,
  };
}

describe("trace player model", () => {
  it("counts duplicate queue entries without removing order from the source queue", () => {
    const queue = ["3", "3", "4"];

    expect(countQueueEntries(queue)).toEqual({ "3": 2, "4": 1 });
    expect(queue).toEqual(["3", "3", "4"]);
  });

  it("compares Queue, Visited, and Output as ordered execution fields", () => {
    const wrongStep = step(0, { visited: [], output: [] });
    const fixedStep = step(0, { visited: ["1"], output: [] });

    expect(compareTraceSteps(wrongStep, fixedStep)).toEqual(["visited"]);
    expect(
      compareTraceSteps(
        step(1, { queue: ["3", "3", "4"], output: ["1", "2"] }),
        step(1, { queue: ["3", "4"], output: ["1", "2", "3"] }),
      ),
    ).toEqual(["queue", "output"]);
    expect(compareTraceSteps(wrongStep, null)).toEqual(["queue", "visited", "output"]);
  });

  it("finds the first divergence by strict step index", () => {
    const wrongTrace = trace("visited-on-dequeue", [
      step(0, { visited: [] }),
      step(2, { queue: ["2", "3"] }),
    ]);
    const fixedTrace = trace("visited-on-enqueue", [
      step(0, { visited: ["1"] }),
      step(1, { queue: [] }),
    ]);

    expect(findFirstTraceDivergence(wrongTrace, fixedTrace)).toBe(0);
    expect(findStepByIndex(wrongTrace, 2)?.queue).toEqual(["2", "3"]);
    expect(findStepByIndex(wrongTrace, 1)).toBeNull();
    expect(findStepByIndex(wrongTrace, 99)).toBeNull();
  });

  it("returns null when every aligned execution field is equal", () => {
    const sharedSteps = [step(0), step(1, { queue: [] })];

    expect(
      findFirstTraceDivergence(
        trace("visited-on-dequeue", sharedSteps),
        trace("visited-on-enqueue", sharedSteps),
      ),
    ).toBeNull();
  });
});
