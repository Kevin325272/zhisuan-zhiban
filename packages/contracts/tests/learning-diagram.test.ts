import { describe, expect, it } from "vitest";
import { learningDiagramSchema, studentAiPreferencesPatchSchema } from "../src/index.js";
const graph = { kind: "flow", title: "取指", summary: "读取指令", nodes: [{ id: "pc", label: "地址", description: "提供地址" }, { id: "ir", label: "指令", description: "接收指令" }], edges: [{ from: "pc", to: "ir" }] };
describe("bounded learning diagrams", () => {
  it("accepts flow and structure diagrams with valid references", () => { expect(learningDiagramSchema.safeParse(graph).success).toBe(true); expect(learningDiagramSchema.safeParse({ ...graph, kind: "structure" }).success).toBe(true); });
  it.each([{ ...graph, edges: [{ from: "pc", to: "missing" }] }, { ...graph, nodes: [graph.nodes[0], graph.nodes[0]] }, { ...graph, nodes: Array(7).fill(graph.nodes[0]) }, { ...graph, html: "<script>" }, { ...graph, edges: [graph.edges[0], graph.edges[0]] }])("rejects unsafe size, unknown fields or broken graphs", (value) => { expect(learningDiagramSchema.safeParse(value).success).toBe(false); });
  it("requires an actual boolean preference without a caller-supplied owner", () => { expect(studentAiPreferencesPatchSchema.safeParse({}).success).toBe(false); expect(studentAiPreferencesPatchSchema.safeParse({ collaboration_enabled: false }).success).toBe(true); expect(studentAiPreferencesPatchSchema.safeParse({ user_id: "other", collaboration_enabled: false }).success).toBe(false); });
});
