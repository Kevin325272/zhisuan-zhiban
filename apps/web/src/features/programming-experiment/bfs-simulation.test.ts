import { describe, expect, it } from "vitest";

import { BFS_GRAPH_PRESETS, buildBfsTrace } from "./bfs-simulation";

describe("buildBfsTrace", () => {
  it("returns a complete deterministic trace for the default graph", () => {
    const trace = buildBfsTrace(BFS_GRAPH_PRESETS[0]!, 1);
    const finalStep = trace.at(-1)!;

    expect(finalStep.visited).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(finalStep.queue).toEqual([]);
    expect(finalStep.edgeChecks).toBe(14);
    expect(trace[0]).toMatchObject({ title: "初始化起点", queue: [1], visited: [], pseudoLine: 0 });
    expect(finalStep.title).toBe("遍历完成");
  });

  it("changes the visit order when the start node changes", () => {
    const trace = buildBfsTrace(BFS_GRAPH_PRESETS[0]!, 2);

    expect(trace.at(-1)?.visited).toEqual([2, 1, 4, 5, 3, 6, 7]);
    expect(trace[0]?.queue).toEqual([2]);
  });

  it("never puts a discovered node into the queue twice", () => {
    const trace = buildBfsTrace(BFS_GRAPH_PRESETS[0]!, 1);

    for (const step of trace) {
      expect(new Set(step.queue).size).toBe(step.queue.length);
      expect(new Set(step.discovered).size).toBe(step.discovered.length);
    }
  });

  it("does not share mutable arrays between steps", () => {
    const trace = buildBfsTrace(BFS_GRAPH_PRESETS[0]!, 1);

    expect(trace[0]?.queue).not.toBe(trace[1]?.queue);
    expect(trace[0]?.visited).not.toBe(trace[1]?.visited);
    expect(trace[0]?.discovered).not.toBe(trace[1]?.discovered);
  });

  it("rejects a start node that is not in the graph", () => {
    expect(() => buildBfsTrace(BFS_GRAPH_PRESETS[0]!, 99)).toThrow("起点节点不存在");
  });
});

