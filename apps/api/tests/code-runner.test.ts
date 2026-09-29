import { describe, expect, it } from "vitest";

import { programmingLanguageDefinitions } from "../src/domain/programming-languages.js";
import { classifyBfsSource, runBfsCode } from "../src/services/code-runner.js";

const wrongSource = `vector<int> bfs(const vector<vector<int>>& graph, int start) {
  vector<bool> visited(graph.size(), false);
  vector<int> order;
  queue<int> pending;
  pending.push(start);

  while (!pending.empty()) {
    const int current = pending.front();
    pending.pop();
    visited[current] = true;
    order.push_back(current);

    for (const int next : graph[current]) {
      if (!visited[next]) {
        pending.push(next);
      }
    }
  }
  return order;
}`;

const fixedSource = wrongSource
  .replace("  pending.push(start);", "  pending.push(start);\n  visited[start] = true;")
  .replace(
    "        pending.push(next);",
    "        visited[next] = true;\n        pending.push(next);",
  )
  .replace("    visited[current] = true;\n", "");

describe("source-driven BFS runner", () => {
  for (const definition of programmingLanguageDefinitions) {
    it(`${definition.language} detects the BFS visited timing`, () => {
      const wrong = runBfsCode("task_bfs_bug_001", {
        language: definition.language,
        source: definition.starter_code,
        custom_input: null,
      });
      const fixed = runBfsCode("task_bfs_bug_001", {
        language: definition.language,
        source: definition.fixed_code,
        custom_input: null,
      });

      expect(wrong).toMatchObject({
        status: "failed",
        passed_count: 2,
        total_count: 4,
      });
      expect(wrong.error_line).toBeGreaterThan(0);
      expect(fixed).toMatchObject({
        status: "passed",
        passed_count: 4,
        total_count: 4,
      });
    });
  }

  it("detects whether visited is updated before enqueue", () => {
    expect(classifyBfsSource("cpp", wrongSource)).toMatchObject({
      kind: "visited-on-dequeue",
      errorLine: 15,
    });
    expect(classifyBfsSource("cpp", fixedSource)).toMatchObject({
      kind: "visited-on-enqueue",
      errorLine: null,
    });
    expect(classifyBfsSource("cpp", "// mock: visited-on-enqueue").kind).toBe(
      "visited-on-enqueue",
    );
  });

  it("reports an unmatched delimiter as a compile error", () => {
    expect(classifyBfsSource("cpp", "int main() {\n  return 0;\n")).toMatchObject({
      kind: "compile_error",
      errorLine: 1,
    });
  });

  it("shows duplicate visits for the dequeue-time implementation", () => {
    const result = runBfsCode("task_bfs_bug_001", {
      language: "cpp",
      source: wrongSource,
      custom_input: null,
    });

    expect(result.status).toBe("failed");
    expect(result.detected_variant).toBe("visited-on-dequeue");
    expect(result.passed_count).toBe(2);
    expect(result.total_count).toBe(4);
    expect(result.error_line).toBe(15);
    expect(result.test_cases.find((item) => item.test_case_id === "case_diamond")).toMatchObject({
      status: "failed",
      expected_output: "1 2 3 4",
      actual_output: "1 2 3 4 4",
    });
  });

  it("passes all built-in cases after moving visited before enqueue", () => {
    const result = runBfsCode("task_bfs_bug_001", {
      language: "cpp",
      source: fixedSource,
      custom_input: null,
    });

    expect(result.status).toBe("passed");
    expect(result.detected_variant).toBe("visited-on-enqueue");
    expect(result.passed_count).toBe(4);
    expect(result.stderr).toBeNull();
  });

  it("runs an optional custom graph with the same detected behavior", () => {
    const result = runBfsCode("task_bfs_bug_001", {
      language: "cpp",
      source: wrongSource,
      custom_input: "start=1\n1 2\n1 3\n2 4\n3 4",
    });

    expect(result.total_count).toBe(5);
    expect(result.test_cases.at(-1)).toMatchObject({
      test_case_id: "case_custom",
      status: "failed",
      actual_output: "1 2 3 4 4",
    });
  });
});
