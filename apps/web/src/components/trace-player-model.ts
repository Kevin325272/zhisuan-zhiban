import type { AlgorithmTrace, AlgorithmTraceStep } from "@xuetu/contracts";

export type ComparedTraceField = "queue" | "visited" | "output";

const comparedFields: ComparedTraceField[] = ["queue", "visited", "output"];

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function countQueueEntries(queue: string[]) {
  return queue.reduce<Record<string, number>>((counts, nodeId) => {
    counts[nodeId] = (counts[nodeId] ?? 0) + 1;
    return counts;
  }, {});
}

export function compareTraceSteps(
  left: AlgorithmTraceStep | null,
  right: AlgorithmTraceStep | null,
): ComparedTraceField[] {
  if (!left && !right) return [];
  if (!left || !right) return [...comparedFields];

  return comparedFields.filter((field) => !arraysEqual(left[field], right[field]));
}

export function findStepByIndex(trace: AlgorithmTrace, stepIndex: number) {
  return trace.steps.find((step) => step.step_index === stepIndex) ?? null;
}

export function findFirstTraceDivergence(
  left: AlgorithmTrace,
  right: AlgorithmTrace,
): number | null {
  const stepIndexes = Array.from(
    new Set([
      ...left.steps.map((step) => step.step_index),
      ...right.steps.map((step) => step.step_index),
    ]),
  ).sort((first, second) => first - second);

  return (
    stepIndexes.find(
      (stepIndex) =>
        compareTraceSteps(
          findStepByIndex(left, stepIndex),
          findStepByIndex(right, stepIndex),
        ).length > 0,
    ) ?? null
  );
}
