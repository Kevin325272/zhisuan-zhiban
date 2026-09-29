import {
  programmingLanguageMeta,
  type ProgrammingLanguage,
} from "@xuetu/contracts";

export interface ProgrammingLanguageDefinition {
  language: ProgrammingLanguage;
  file_name: string;
  starter_code: string;
  fixed_code: string;
  enqueue_next: RegExp;
  mark_next: RegExp;
  mark_current: RegExp;
  trace_lines: {
    wrong: { start: number; dequeue: number; enqueue: number };
    fixed: { start: number; dequeue: number; enqueue: number };
  };
}

interface DefinitionInput extends Omit<ProgrammingLanguageDefinition, "file_name" | "trace_lines"> {
  start: RegExp;
  dequeue: RegExp;
}

function findLine(source: string, pattern: RegExp) {
  const index = source.split(/\r?\n/).findIndex((line) => pattern.test(line));
  if (index < 0) throw new Error(`Language template is missing semantic pattern: ${pattern.source}`);
  return index + 1;
}

function createDefinition(input: DefinitionInput): ProgrammingLanguageDefinition {
  return {
    language: input.language,
    file_name: programmingLanguageMeta[input.language].file_name,
    starter_code: input.starter_code,
    fixed_code: input.fixed_code,
    enqueue_next: input.enqueue_next,
    mark_next: input.mark_next,
    mark_current: input.mark_current,
    trace_lines: {
      wrong: {
        start: findLine(input.starter_code, input.start),
        dequeue: findLine(input.starter_code, input.dequeue),
        enqueue: findLine(input.starter_code, input.enqueue_next),
      },
      fixed: {
        start: findLine(input.fixed_code, input.start),
        dequeue: findLine(input.fixed_code, input.dequeue),
        enqueue: findLine(input.fixed_code, input.enqueue_next),
      },
    },
  };
}

const cWrong = `#include <stdbool.h>
#include <stddef.h>

int bfs(int graph[][16], int degree[], int start, int order[]) {
  bool visited[16] = {false};
  int queue[16];
  int head = 0;
  int tail = 0;
  int order_count = 0;
  queue[tail++] = start;

  while (head < tail) {
    int current = queue[head++];
    visited[current] = true;
    order[order_count++] = current;

    for (int i = 0; i < degree[current]; i++) {
      int next = graph[current][i];
      if (!visited[next]) {
        queue[tail++] = next;
      }
    }
  }
  return order_count;
}`;

const cFixed = `#include <stdbool.h>
#include <stddef.h>

int bfs(int graph[][16], int degree[], int start, int order[]) {
  bool visited[16] = {false};
  int queue[16];
  int head = 0;
  int tail = 0;
  int order_count = 0;
  queue[tail++] = start;
  visited[start] = true;

  while (head < tail) {
    int current = queue[head++];
    order[order_count++] = current;

    for (int i = 0; i < degree[current]; i++) {
      int next = graph[current][i];
      if (!visited[next]) {
        visited[next] = true;
        queue[tail++] = next;
      }
    }
  }
  return order_count;
}`;

const cppWrong = `#include <queue>
#include <vector>
using namespace std;

vector<int> bfs(const vector<vector<int>>& graph, int start) {
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

const cppFixed = `#include <queue>
#include <vector>
using namespace std;

vector<int> bfs(const vector<vector<int>>& graph, int start) {
  vector<bool> visited(graph.size(), false);
  vector<int> order;
  queue<int> pending;
  pending.push(start);
  visited[start] = true;

  while (!pending.empty()) {
    const int current = pending.front();
    pending.pop();
    order.push_back(current);

    for (const int next : graph[current]) {
      if (!visited[next]) {
        visited[next] = true;
        pending.push(next);
      }
    }
  }
  return order;
}`;

const javaWrong = `import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;

public class BfsTraversal {
  public static List<Integer> bfs(List<List<Integer>> graph, int start) {
    boolean[] visited = new boolean[graph.size()];
    List<Integer> order = new ArrayList<>();
    Queue<Integer> pending = new ArrayDeque<>();
    pending.offer(start);

    while (!pending.isEmpty()) {
      int current = pending.remove();
      visited[current] = true;
      order.add(current);

      for (int next : graph.get(current)) {
        if (!visited[next]) {
          pending.offer(next);
        }
      }
    }
    return order;
  }
}`;

const javaFixed = `import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;

public class BfsTraversal {
  public static List<Integer> bfs(List<List<Integer>> graph, int start) {
    boolean[] visited = new boolean[graph.size()];
    List<Integer> order = new ArrayList<>();
    Queue<Integer> pending = new ArrayDeque<>();
    pending.offer(start);
    visited[start] = true;

    while (!pending.isEmpty()) {
      int current = pending.remove();
      order.add(current);

      for (int next : graph.get(current)) {
        if (!visited[next]) {
          visited[next] = true;
          pending.offer(next);
        }
      }
    }
    return order;
  }
}`;

const pythonWrong = `from collections import deque

def bfs(graph, start):
    visited = set()
    order = []
    pending = deque([start])

    while pending:
        current = pending.popleft()
        visited.add(current)
        order.append(current)

        for next_node in graph.get(current, []):
            if next_node not in visited:
                pending.append(next_node)

    return order`;

const pythonFixed = `from collections import deque

def bfs(graph, start):
    visited = {start}
    order = []
    pending = deque([start])

    while pending:
        current = pending.popleft()
        order.append(current)

        for next_node in graph.get(current, []):
            if next_node not in visited:
                visited.add(next_node)
                pending.append(next_node)

    return order`;

const javascriptWrong = `function bfs(graph, start) {
  const visited = new Set();
  const order = [];
  const pending = [start];

  while (pending.length > 0) {
    const current = pending.shift();
    visited.add(current);
    order.push(current);

    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) {
        pending.push(next);
      }
    }
  }
  return order;
}`;

const javascriptFixed = `function bfs(graph, start) {
  const visited = new Set([start]);
  const order = [];
  const pending = [start];

  while (pending.length > 0) {
    const current = pending.shift();
    order.push(current);

    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return order;
}`;

const typescriptWrong = `function bfs(graph: Map<number, number[]>, start: number): number[] {
  const visited = new Set<number>();
  const order: number[] = [];
  const pending: number[] = [start];

  while (pending.length > 0) {
    const current = pending.shift()!;
    visited.add(current);
    order.push(current);

    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) {
        pending.push(next);
      }
    }
  }
  return order;
}`;

const typescriptFixed = `function bfs(graph: Map<number, number[]>, start: number): number[] {
  const visited = new Set<number>([start]);
  const order: number[] = [];
  const pending: number[] = [start];

  while (pending.length > 0) {
    const current = pending.shift()!;
    order.push(current);

    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return order;
}`;

const goWrong = `package traversal

func bfs(graph map[int][]int, start int) []int {
  visited := make(map[int]bool)
  order := make([]int, 0)
  pending := []int{start}

  for len(pending) > 0 {
    current := pending[0]
    pending = pending[1:]
    visited[current] = true
    order = append(order, current)

    for _, next := range graph[current] {
      if !visited[next] {
        pending = append(pending, next)
      }
    }
  }
  return order
}`;

const goFixed = `package traversal

func bfs(graph map[int][]int, start int) []int {
  visited := make(map[int]bool)
  order := make([]int, 0)
  pending := []int{start}
  visited[start] = true

  for len(pending) > 0 {
    current := pending[0]
    pending = pending[1:]
    order = append(order, current)

    for _, next := range graph[current] {
      if !visited[next] {
        visited[next] = true
        pending = append(pending, next)
      }
    }
  }
  return order
}`;

const rustWrong = `use std::collections::{HashMap, HashSet, VecDeque};

fn bfs(graph: &HashMap<usize, Vec<usize>>, start: usize) -> Vec<usize> {
    let mut visited = HashSet::new();
    let mut order = Vec::new();
    let mut pending = VecDeque::new();
    pending.push_back(start);

    while let Some(current) = pending.pop_front() {
        visited.insert(current);
        order.push(current);

        for &next in graph.get(&current).into_iter().flatten() {
            if !visited.contains(&next) {
                pending.push_back(next);
            }
        }
    }
    order
}`;

const rustFixed = `use std::collections::{HashMap, HashSet, VecDeque};

fn bfs(graph: &HashMap<usize, Vec<usize>>, start: usize) -> Vec<usize> {
    let mut visited = HashSet::new();
    let mut order = Vec::new();
    let mut pending = VecDeque::new();
    pending.push_back(start);
    visited.insert(start);

    while let Some(current) = pending.pop_front() {
        order.push(current);

        for &next in graph.get(&current).into_iter().flatten() {
            if !visited.contains(&next) {
                visited.insert(next);
                pending.push_back(next);
            }
        }
    }
    order
}`;

export const programmingLanguageDefinitions: readonly ProgrammingLanguageDefinition[] = [
  createDefinition({
    language: "c",
    starter_code: cWrong,
    fixed_code: cFixed,
    start: /queue\s*\[\s*tail\+\+\s*\]\s*=\s*start/,
    dequeue: /current\s*=\s*queue\s*\[\s*head\+\+\s*\]/,
    enqueue_next: /queue\s*\[\s*tail\+\+\s*\]\s*=\s*next/,
    mark_next: /visited\s*\[\s*next\s*\]\s*=\s*true/,
    mark_current: /visited\s*\[\s*current\s*\]\s*=\s*true/,
  }),
  createDefinition({
    language: "cpp",
    starter_code: cppWrong,
    fixed_code: cppFixed,
    start: /pending\s*\.\s*push\s*\(\s*start\s*\)/,
    dequeue: /current\s*=\s*pending\s*\.\s*front\s*\(\s*\)/,
    enqueue_next: /pending\s*\.\s*push\s*\(\s*next\s*\)/,
    mark_next: /visited\s*\[\s*next\s*\]\s*=\s*(?:true|1)/,
    mark_current: /visited\s*\[\s*current\s*\]\s*=\s*(?:true|1)/,
  }),
  createDefinition({
    language: "java",
    starter_code: javaWrong,
    fixed_code: javaFixed,
    start: /pending\s*\.\s*offer\s*\(\s*start\s*\)/,
    dequeue: /current\s*=\s*pending\s*\.\s*remove\s*\(\s*\)/,
    enqueue_next: /pending\s*\.\s*offer\s*\(\s*next\s*\)/,
    mark_next: /visited\s*\[\s*next\s*\]\s*=\s*true/,
    mark_current: /visited\s*\[\s*current\s*\]\s*=\s*true/,
  }),
  createDefinition({
    language: "python",
    starter_code: pythonWrong,
    fixed_code: pythonFixed,
    start: /pending\s*=\s*deque\s*\(\s*\[\s*start\s*\]\s*\)/,
    dequeue: /current\s*=\s*pending\s*\.\s*popleft\s*\(\s*\)/,
    enqueue_next: /pending\s*\.\s*append\s*\(\s*next_node\s*\)/,
    mark_next: /visited\s*\.\s*add\s*\(\s*next_node\s*\)/,
    mark_current: /visited\s*\.\s*add\s*\(\s*current\s*\)/,
  }),
  createDefinition({
    language: "javascript",
    starter_code: javascriptWrong,
    fixed_code: javascriptFixed,
    start: /pending\s*=\s*\[\s*start\s*\]/,
    dequeue: /current\s*=\s*pending\s*\.\s*shift\s*\(\s*\)/,
    enqueue_next: /pending\s*\.\s*push\s*\(\s*next\s*\)/,
    mark_next: /visited\s*\.\s*add\s*\(\s*next\s*\)/,
    mark_current: /visited\s*\.\s*add\s*\(\s*current\s*\)/,
  }),
  createDefinition({
    language: "typescript",
    starter_code: typescriptWrong,
    fixed_code: typescriptFixed,
    start: /pending[^=]*=\s*\[\s*start\s*\]/,
    dequeue: /current\s*=\s*pending\s*\.\s*shift\s*\(\s*\)/,
    enqueue_next: /pending\s*\.\s*push\s*\(\s*next\s*\)/,
    mark_next: /visited\s*\.\s*add\s*\(\s*next\s*\)/,
    mark_current: /visited\s*\.\s*add\s*\(\s*current\s*\)/,
  }),
  createDefinition({
    language: "go",
    starter_code: goWrong,
    fixed_code: goFixed,
    start: /pending\s*:=\s*\[\]int\s*\{\s*start\s*\}/,
    dequeue: /current\s*:=\s*pending\s*\[\s*0\s*\]/,
    enqueue_next: /pending\s*=\s*append\s*\(\s*pending\s*,\s*next\s*\)/,
    mark_next: /visited\s*\[\s*next\s*\]\s*=\s*true/,
    mark_current: /visited\s*\[\s*current\s*\]\s*=\s*true/,
  }),
  createDefinition({
    language: "rust",
    starter_code: rustWrong,
    fixed_code: rustFixed,
    start: /pending\s*\.\s*push_back\s*\(\s*start\s*\)/,
    dequeue: /current\s*\)\s*=\s*pending\s*\.\s*pop_front\s*\(\s*\)/,
    enqueue_next: /pending\s*\.\s*push_back\s*\(\s*next\s*\)/,
    mark_next: /visited\s*\.\s*insert\s*\(\s*next\s*\)/,
    mark_current: /visited\s*\.\s*insert\s*\(\s*current\s*\)/,
  }),
];

export function getProgrammingLanguageDefinition(language: ProgrammingLanguage) {
  const definition = programmingLanguageDefinitions.find((item) => item.language === language);
  if (!definition) throw new Error(`Unsupported programming language: ${language}`);
  return definition;
}
