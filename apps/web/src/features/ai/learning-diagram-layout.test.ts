import { describe, expect, it } from "vitest";
import type { LearningDiagram } from "@xuetu/contracts";
import { layoutLearningDiagram } from "./learning-diagram-layout";

const nodes = ["system", "hardware", "software", "systemSoftware", "applications"].map((id) => ({ id, label: id, description: id }));
describe("learning diagram relationships", () => {
  it("keeps nested software categories below software even with bidirectional hardware links", () => {
    const diagram: LearningDiagram = { kind: "structure", title: "系统组成", summary: "组成与协作", nodes, edges: [
      { from: "system", to: "hardware" }, { from: "system", to: "software" },
      { from: "software", to: "systemSoftware" }, { from: "software", to: "applications" },
      { from: "hardware", to: "software" }, { from: "software", to: "hardware" },
    ] };
    const layout = layoutLearningDiagram(diagram);
    const position = (id: string) => layout.positions.find((node) => node.id === id)!;
    expect(position("system").y).toBeLessThan(position("software").y);
    expect(position("hardware").y).toBe(position("software").y);
    expect(position("software").y).toBeLessThan(position("systemSoftware").y);
    expect(position("systemSoftware").y).toBe(position("applications").y);
    expect(Math.abs(position("applications").x - position("systemSoftware").x)).toBeGreaterThan(layout.nodeWidth);
  });
  it("keeps every disconnected or cyclic node visible without overlapping", () => {
    const diagram: LearningDiagram = { kind: "structure", title: "关系", summary: "关系", nodes, edges: [
      { from: "system", to: "hardware" }, { from: "hardware", to: "system" },
    ] };
    const layout = layoutLearningDiagram(diagram);
    expect(new Set(layout.positions.map((node) => `${node.x},${node.y}`)).size).toBe(nodes.length);
    for (const node of layout.positions) {
      expect(node.x - layout.nodeWidth / 2).toBeGreaterThanOrEqual(0);
      expect(node.x + layout.nodeWidth / 2).toBeLessThanOrEqual(720);
      expect(node.y).toBeGreaterThan(0); expect(node.y).toBeLessThan(layout.height);
    }
  });
});
