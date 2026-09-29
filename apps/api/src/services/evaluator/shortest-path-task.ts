import type { ProgrammingLanguage } from "@xuetu/contracts";

import { allNodesFor, type BfsGraphCase } from "./bfs-cases.js";

/**
 * 独立验证任务（无权图最少边数）的用例、模板与 harness。
 * 与 BFS 修复任务共用图结构约定：有向边、顶点编号 0-15。
 */

export interface ShortestPathCase extends BfsGraphCase {
  target: number;
}

export type EvaluatorTaskKind = "bfs_traversal" | "shortest_path";

const shortestPathTaskIds = new Set(["task_bfs_transfer_001"]);

export function taskKindFor(taskId: string): EvaluatorTaskKind {
  return shortestPathTaskIds.has(taskId) ? "shortest_path" : "bfs_traversal";
}

export const builtInShortestPathCases: readonly ShortestPathCase[] = [
  {
    id: "val_case_line",
    label: "教学楼直线通道",
    start: 1,
    target: 4,
    edges: [
      [1, 2],
      [2, 3],
      [3, 4],
    ],
    input: "start=1 target=4\n1 2\n2 3\n3 4",
  },
  {
    id: "val_case_rings",
    label: "环形连廊汇聚",
    start: 1,
    target: 5,
    edges: [
      [1, 2],
      [1, 3],
      [2, 4],
      [3, 4],
      [4, 5],
    ],
    input: "start=1 target=5\n1 2\n1 3\n2 4\n3 4\n4 5",
  },
  {
    id: "val_case_shortcut",
    label: "近道与长路并存",
    start: 1,
    target: 6,
    edges: [
      [1, 2],
      [2, 3],
      [3, 6],
      [1, 4],
      [4, 5],
      [5, 6],
      [2, 6],
    ],
    input: "start=1 target=6\n1 2\n2 3\n3 6\n1 4\n4 5\n5 6\n2 6",
  },
  {
    id: "val_case_unreachable",
    label: "不连通目标",
    start: 1,
    target: 6,
    edges: [
      [1, 2],
      [2, 3],
      [5, 6],
    ],
    input: "start=1 target=6\n1 2\n2 3\n5 6",
  },
];

export function expectedDistanceFor(graphCase: ShortestPathCase): number {
  const adjacency = new Map<number, number[]>();
  for (const [from, to] of graphCase.edges) {
    const neighbors = adjacency.get(from) ?? [];
    neighbors.push(to);
    adjacency.set(from, neighbors);
  }

  const distance = new Map<number, number>([[graphCase.start, 0]]);
  const pending = [graphCase.start];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    if (current === graphCase.target) return distance.get(current) ?? 0;
    for (const next of adjacency.get(current) ?? []) {
      if (distance.has(next)) continue;
      distance.set(next, (distance.get(current) ?? 0) + 1);
      pending.push(next);
    }
  }
  return distance.get(graphCase.target) ?? -1;
}

interface ShortestPathTemplate {
  file_name: string;
  starter_code: string;
  reference_code: string;
}

const cStarter = `int shortest_path(int graph[][16], int degree[], int start, int target) {
  /* 独立完成：返回 start 到 target 的最少边数；无法到达时返回 -1。 */
  return -1;
}`;

const cReference = `#include <stdbool.h>

int shortest_path(int graph[][16], int degree[], int start, int target) {
  bool visited[16] = {false};
  int distance[16] = {0};
  int queue[64];
  int head = 0;
  int tail = 0;
  queue[tail++] = start;
  visited[start] = true;

  while (head < tail) {
    int current = queue[head++];
    if (current == target) return distance[current];
    for (int i = 0; i < degree[current]; i++) {
      int next = graph[current][i];
      if (!visited[next]) {
        visited[next] = true;
        distance[next] = distance[current] + 1;
        queue[tail++] = next;
      }
    }
  }
  return -1;
}`;

const cppStarter = `#include <queue>
#include <vector>
using namespace std;

int shortestPath(const vector<vector<int>>& graph, int start, int target) {
  // 独立完成：返回 start 到 target 的最少边数；无法到达时返回 -1。
  return -1;
}`;

const cppReference = `#include <queue>
#include <vector>
using namespace std;

int shortestPath(const vector<vector<int>>& graph, int start, int target) {
  vector<int> distance(graph.size(), -1);
  queue<int> pending;
  pending.push(start);
  distance[start] = 0;

  while (!pending.empty()) {
    const int current = pending.front();
    pending.pop();
    if (current == target) return distance[current];
    for (const int next : graph[current]) {
      if (distance[next] == -1) {
        distance[next] = distance[current] + 1;
        pending.push(next);
      }
    }
  }
  return -1;
}`;

const javaStarter = `import java.util.List;

public class ShortestPath {
  public static int shortestPath(List<List<Integer>> graph, int start, int target) {
    // 独立完成：返回 start 到 target 的最少边数；无法到达时返回 -1。
    return -1;
  }
}`;

const javaReference = `import java.util.ArrayDeque;
import java.util.List;
import java.util.Queue;

public class ShortestPath {
  public static int shortestPath(List<List<Integer>> graph, int start, int target) {
    int[] distance = new int[graph.size()];
    java.util.Arrays.fill(distance, -1);
    Queue<Integer> pending = new ArrayDeque<>();
    pending.offer(start);
    distance[start] = 0;

    while (!pending.isEmpty()) {
      int current = pending.remove();
      if (current == target) return distance[current];
      for (int next : graph.get(current)) {
        if (distance[next] == -1) {
          distance[next] = distance[current] + 1;
          pending.offer(next);
        }
      }
    }
    return -1;
  }
}`;

const pythonStarter = `def shortest_path(graph, start, target):
    # 独立完成：返回 start 到 target 的最少边数；无法到达时返回 -1。
    return -1`;

const pythonReference = `from collections import deque

def shortest_path(graph, start, target):
    distance = {start: 0}
    pending = deque([start])
    while pending:
        current = pending.popleft()
        if current == target:
            return distance[current]
        for next_node in graph.get(current, []):
            if next_node not in distance:
                distance[next_node] = distance[current] + 1
                pending.append(next_node)
    return -1`;

const javascriptStarter = `function shortestPath(graph, start, target) {
  // 独立完成：返回 start 到 target 的最少边数；无法到达时返回 -1。
  return -1;
}`;

const javascriptReference = `function shortestPath(graph, start, target) {
  const distance = new Map([[start, 0]]);
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === target) return distance.get(current);
    for (const next of graph.get(current) ?? []) {
      if (!distance.has(next)) {
        distance.set(next, distance.get(current) + 1);
        pending.push(next);
      }
    }
  }
  return -1;
}`;

const typescriptStarter = `function shortestPath(graph: Map<number, number[]>, start: number, target: number): number {
  // 独立完成：返回 start 到 target 的最少边数；无法到达时返回 -1。
  return -1;
}`;

const typescriptReference = `function shortestPath(graph: Map<number, number[]>, start: number, target: number): number {
  const distance = new Map<number, number>([[start, 0]]);
  const pending: number[] = [start];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (current === target) return distance.get(current)!;
    for (const next of graph.get(current) ?? []) {
      if (!distance.has(next)) {
        distance.set(next, distance.get(current)! + 1);
        pending.push(next);
      }
    }
  }
  return -1;
}`;

const goStarter = `package transfer

func shortestPath(graph map[int][]int, start int, target int) int {
  // 独立完成：返回 start 到 target 的最少边数；无法到达时返回 -1。
  return -1
}`;

const goReference = `package transfer

func shortestPath(graph map[int][]int, start int, target int) int {
  distance := map[int]int{start: 0}
  pending := []int{start}
  for len(pending) > 0 {
    current := pending[0]
    pending = pending[1:]
    if current == target {
      return distance[current]
    }
    for _, next := range graph[current] {
      if _, seen := distance[next]; !seen {
        distance[next] = distance[current] + 1
        pending = append(pending, next)
      }
    }
  }
  return -1
}`;

const rustStarter = `use std::collections::HashMap;

fn shortest_path(graph: &HashMap<usize, Vec<usize>>, start: usize, target: usize) -> i32 {
    // 独立完成：返回 start 到 target 的最少边数；无法到达时返回 -1。
    let _ = (graph, start, target);
    -1
}`;

const rustReference = `use std::collections::{HashMap, VecDeque};

fn shortest_path(graph: &HashMap<usize, Vec<usize>>, start: usize, target: usize) -> i32 {
    let mut distance: HashMap<usize, i32> = HashMap::new();
    let mut pending = VecDeque::new();
    distance.insert(start, 0);
    pending.push_back(start);
    while let Some(current) = pending.pop_front() {
        if current == target {
            return distance[&current];
        }
        for &next in graph.get(&current).into_iter().flatten() {
            if !distance.contains_key(&next) {
                distance.insert(next, distance[&current] + 1);
                pending.push_back(next);
            }
        }
    }
    -1
}`;

export const shortestPathTemplates: Record<ProgrammingLanguage, ShortestPathTemplate> = {
  c: { file_name: "shortest_path.c", starter_code: cStarter, reference_code: cReference },
  cpp: { file_name: "shortest_path.cpp", starter_code: cppStarter, reference_code: cppReference },
  java: {
    file_name: "ShortestPath.java",
    starter_code: javaStarter,
    reference_code: javaReference,
  },
  python: {
    file_name: "shortest_path.py",
    starter_code: pythonStarter,
    reference_code: pythonReference,
  },
  javascript: {
    file_name: "shortest_path.js",
    starter_code: javascriptStarter,
    reference_code: javascriptReference,
  },
  typescript: {
    file_name: "shortest_path.ts",
    starter_code: typescriptStarter,
    reference_code: typescriptReference,
  },
  go: { file_name: "shortest_path.go", starter_code: goStarter, reference_code: goReference },
  rust: { file_name: "shortest_path.rs", starter_code: rustStarter, reference_code: rustReference },
};

export interface BuiltShortestPathProgram {
  source: string;
  fileName: string;
}

function adjacencyEntries(graphCase: ShortestPathCase) {
  const value = new Map<number, number[]>();
  for (const node of allNodesFor(graphCase)) value.set(node, []);
  for (const [from, to] of graphCase.edges) value.get(from)!.push(to);
  return [...value.entries()];
}

type ShortestPathHarness = (source: string, graphCase: ShortestPathCase) => string;

const shortestPathHarnesses: Record<ProgrammingLanguage, ShortestPathHarness> = {
  c: (source, graphCase) => `#include <stdio.h>\n${source}\n\nint main(void) {
  int __xuetu_graph[16][16] = {{0}};
  int __xuetu_degree[16] = {0};
${graphCase.edges
  .map(([from, to]) => `  __xuetu_graph[${from}][__xuetu_degree[${from}]++] = ${to};`)
  .join("\n")}
  printf("%d\\n", shortest_path(__xuetu_graph, __xuetu_degree, ${graphCase.start}, ${graphCase.target}));
  return 0;
}`,
  cpp: (source, graphCase) => `#include <iostream>\n${source}\n\nint main() {
  vector<vector<int>> __xuetu_graph(${Math.max(...allNodesFor(graphCase)) + 1});
${graphCase.edges
  .map(([from, to]) => `  __xuetu_graph[${from}].push_back(${to});`)
  .join("\n")}
  cout << shortestPath(__xuetu_graph, ${graphCase.start}, ${graphCase.target}) << '\\n';
  return 0;
}`,
  java: (source, graphCase) => {
    const normalized = source.replace(/public\s+class\s+ShortestPath/u, "class ShortestPath");
    return `import java.util.ArrayList;\nimport java.util.List;\n${normalized}\n\npublic class Main {
  public static void main(String[] args) {
    List<List<Integer>> __xuetuGraph = new ArrayList<>();
    for (int i = 0; i < ${Math.max(...allNodesFor(graphCase)) + 1}; i++) {
      __xuetuGraph.add(new ArrayList<>());
    }
${graphCase.edges
  .map(([from, to]) => `    __xuetuGraph.get(${from}).add(${to});`)
  .join("\n")}
    System.out.println(ShortestPath.shortestPath(__xuetuGraph, ${graphCase.start}, ${graphCase.target}));
  }
}`;
  },
  python: (source, graphCase) => {
    const graph = adjacencyEntries(graphCase)
      .map(([node, neighbors]) => `${node}: [${neighbors.join(", ")}]`)
      .join(", ");
    return `${source}\n\nif __name__ == "__main__":
    __xuetu_graph = {${graph}}
    print(shortest_path(__xuetu_graph, ${graphCase.start}, ${graphCase.target}))`;
  },
  javascript: (source, graphCase) => {
    const entries = adjacencyEntries(graphCase)
      .map(([node, neighbors]) => `[${node}, [${neighbors.join(", ")}]]`)
      .join(", ");
    return `${source}\n\nconst __xuetuGraph = new Map([${entries}]);\nconsole.log(String(shortestPath(__xuetuGraph, ${graphCase.start}, ${graphCase.target})));`;
  },
  typescript: (source, graphCase) => {
    const entries = adjacencyEntries(graphCase)
      .map(([node, neighbors]) => `[${node}, [${neighbors.join(", ")}]]`)
      .join(", ");
    return `${source}\n\nconst __xuetuGraph = new Map<number, number[]>([${entries}]);\nconsole.log(String(shortestPath(__xuetuGraph, ${graphCase.start}, ${graphCase.target})));`;
  },
  go: (source, graphCase) => {
    const normalized = source.replace(/^package\s+\w+\s*/u, 'package main\n\nimport "fmt"\n\n');
    const entries = adjacencyEntries(graphCase)
      .map(([node, neighbors]) => `    ${node}: []int{${neighbors.join(", ")}}`)
      .join(",\n");
    return `${normalized}\n\nfunc main() {
  __xuetuGraph := map[int][]int{
${entries},
  }
  fmt.Println(shortestPath(__xuetuGraph, ${graphCase.start}, ${graphCase.target}))
}`;
  },
  rust: (source, graphCase) => `${source}\n\nfn main() {
    let mut __xuetu_graph: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
${adjacencyEntries(graphCase)
  .map(
    ([node, neighbors]) =>
      `    __xuetu_graph.insert(${node}, vec![${neighbors.join(", ")}]);`,
  )
  .join("\n")}
    println!("{}", shortest_path(&__xuetu_graph, ${graphCase.start}, ${graphCase.target}));
}`,
};

export function buildShortestPathProgram(
  language: ProgrammingLanguage,
  source: string,
  graphCase: ShortestPathCase,
): BuiltShortestPathProgram {
  return {
    source: shortestPathHarnesses[language](source, graphCase),
    fileName: shortestPathTemplates[language].file_name,
  };
}

export type ShortestPathClassification =
  | { kind: "correct" }
  | { kind: "incomplete"; message: string };

/**
 * 演示评测（mock 模式）使用的启发式分类：不执行代码，只判断
 * 是否具备“逐层计数 + 目标判断 + 不可达返回 -1”的结构特征。
 * 真实判定以 Judge0 沙箱为准。
 */
export function classifyShortestPathSource(source: string): ShortestPathClassification {
  if (source.includes("mock: shortest-path-correct")) return { kind: "correct" };
  if (source.includes("mock: shortest-path-wrong")) {
    return { kind: "incomplete", message: "演示标记：题解未完成。" };
  }

  const hasQueue = /queue|deque|pending|push|append|offer|VecDeque/iu.test(source);
  const hasDistance = /dist|distance|depth|level|step|层|距离/iu.test(source);
  const usesTarget = /target/u.test(source);
  const stillStarter = /独立完成/u.test(source);

  if (!stillStarter && hasQueue && hasDistance && usesTarget) {
    return { kind: "correct" };
  }
  return {
    kind: "incomplete",
    message:
      "演示评测未检测到“队列逐层扩展并维护距离”的结构，请补全实现（沙箱模式将以真实运行为准）。",
  };
}
