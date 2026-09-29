import { describe, expect, it } from "vitest";

import { programmingLanguageIds } from "@xuetu/contracts";

import {
  buildShortestPathProgram,
  builtInShortestPathCases,
  classifyShortestPathSource,
  expectedDistanceFor,
  shortestPathTemplates,
  taskKindFor,
} from "../src/services/evaluator/shortest-path-task.js";
import { runShortestPathCode, runTaskCode } from "../src/services/code-runner.js";

describe("shortest path validation task", () => {
  it("classifies task ids into evaluator kinds", () => {
    expect(taskKindFor("task_bfs_transfer_001")).toBe("shortest_path");
    expect(taskKindFor("task_bfs_bug_001")).toBe("bfs_traversal");
  });

  it("computes reference distances with true BFS layering", () => {
    const byId = Object.fromEntries(
      builtInShortestPathCases.map((item) => [item.id, expectedDistanceFor(item)]),
    );
    expect(byId).toEqual({
      val_case_line: 3,
      val_case_rings: 3,
      val_case_shortcut: 2,
      val_case_unreachable: -1,
    });
  });

  it("builds a runnable harness embedding student code for every language", () => {
    const graphCase = builtInShortestPathCases[0]!;
    for (const language of programmingLanguageIds) {
      const template = shortestPathTemplates[language];
      const program = buildShortestPathProgram(
        language,
        template.reference_code,
        graphCase,
      );
      expect(program.fileName).toBe(template.file_name);
      expect(program.source).toContain("__xuetu");
      expect(program.source.length).toBeGreaterThan(template.reference_code.length);
    }
  });

  it("keeps starter templates hint-free and without a reference solution", () => {
    for (const language of programmingLanguageIds) {
      const starter = shortestPathTemplates[language].starter_code;
      expect(starter).toContain("独立完成");
      expect(classifyShortestPathSource(starter).kind).toBe("incomplete");
    }
  });

  it("accepts every reference implementation in the demo classifier", () => {
    for (const language of programmingLanguageIds) {
      const reference = shortestPathTemplates[language].reference_code;
      expect(classifyShortestPathSource(reference).kind).toBe("correct");
    }
  });

  it("produces a fully failed demo run for an unfinished submission", () => {
    const result = runShortestPathCode("task_bfs_transfer_001", {
      language: "cpp",
      source: shortestPathTemplates.cpp.starter_code,
      custom_input: null,
    });
    expect(result.execution_mode).toBe("mock");
    expect(result.evaluator_label).toBe("演示评测");
    expect(result.status).toBe("failed");
    // 起始模板返回 -1，只有“不可达”用例会侥幸通过。
    expect(result.passed_count).toBe(1);
    expect(result.total_count).toBe(4);
  });

  it("dispatches the transfer task through the shared mock runner", () => {
    const result = runTaskCode("task_bfs_transfer_001", {
      language: "python",
      source: shortestPathTemplates.python.reference_code,
      custom_input: null,
    });
    expect(result.status).toBe("passed");
    expect(result.passed_count).toBe(4);
    expect(result.detected_variant).toBeNull();
    expect(result.trace_available).toBe(false);
  });
});
