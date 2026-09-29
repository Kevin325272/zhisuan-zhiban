import type {
  CodeRunRequest,
  CodeRunResult,
  CodeRunTestCase,
  ProgrammingLanguage,
  TraceVariant,
} from "@xuetu/contracts";

import { getProgrammingLanguageDefinition } from "../domain/programming-languages.js";
import {
  builtInBfsCases,
  expectedOutputFor,
  InvalidCustomInputError,
  parseCustomGraph,
  type BfsGraphCase,
} from "./evaluator/bfs-cases.js";

export { InvalidCustomInputError } from "./evaluator/bfs-cases.js";

import {
  builtInShortestPathCases,
  classifyShortestPathSource,
  expectedDistanceFor,
  taskKindFor,
} from "./evaluator/shortest-path-task.js";

type SourceClassification =
  | {
      kind: TraceVariant;
      errorLine: number | null;
      message: string | null;
    }
  | {
      kind: "compile_error";
      errorLine: number;
      message: string;
    };

let runSequence = 0;

export function classifyBfsSource(
  language: ProgrammingLanguage,
  source: string,
): SourceClassification {
  if (source.includes("mock: visited-on-enqueue")) {
    return { kind: "visited-on-enqueue", errorLine: null, message: null };
  }
  if (source.includes("mock: visited-on-dequeue")) {
    return {
      kind: "visited-on-dequeue",
      errorLine: 1,
      message: "visited 标记发生在出队阶段。",
    };
  }

  const definition = getProgrammingLanguageDefinition(language);
  const syntaxIssue = findDelimiterIssue(source);
  if (syntaxIssue) {
    return {
      kind: "compile_error",
      errorLine: syntaxIssue.line,
      message: syntaxIssue.message,
    };
  }

  const lines = source.split(/\r?\n/);
  const enqueueLine = lines.findIndex((line) => definition.enqueue_next.test(line));
  const markNextLine = lines.findIndex((line) => definition.mark_next.test(line));

  if (enqueueLine >= 0 && markNextLine >= 0 && markNextLine < enqueueLine) {
    return { kind: "visited-on-enqueue", errorLine: null, message: null };
  }

  const markCurrentLine = lines.findIndex((line) => definition.mark_current.test(line));
  const errorLine = (enqueueLine >= 0 ? enqueueLine : markCurrentLine >= 0 ? markCurrentLine : 0) + 1;
  return {
    kind: "visited-on-dequeue",
    errorLine,
    message: "visited 标记发生在出队后，汇聚路径会让同一顶点重复入队。",
  };
}

export function runTaskCode(taskId: string, request: CodeRunRequest): CodeRunResult {
  return taskKindFor(taskId) === "shortest_path"
    ? runShortestPathCode(taskId, request)
    : runBfsCode(taskId, request);
}

export function runShortestPathCode(taskId: string, request: CodeRunRequest): CodeRunResult {
  runSequence += 1;
  const runId = `code_run_${String(runSequence).padStart(3, "0")}`;
  const syntaxIssue = findDelimiterIssue(request.source);
  if (syntaxIssue) {
    return {
      run_id: runId,
      task_id: taskId,
      status: "compile_error",
      execution_mode: "mock",
      evaluator_label: "演示评测",
      degraded_reason: null,
      language: request.language,
      detected_variant: null,
      passed_count: 0,
      total_count: 0,
      duration_ms: 0,
      memory_kb: 0,
      stdout: "",
      stderr: syntaxIssue.message,
      error_line: syntaxIssue.line,
      trace_available: false,
      trace_variant: null,
      test_cases: [],
    };
  }

  const classification = classifyShortestPathSource(request.source);
  const testCases = builtInShortestPathCases.map((graphCase, index) => {
    const expectedOutput = String(expectedDistanceFor(graphCase));
    const actualOutput = classification.kind === "correct" ? expectedOutput : "-1";
    const passed = actualOutput === expectedOutput;
    return {
      test_case_id: graphCase.id,
      label: graphCase.label,
      status: passed ? ("passed" as const) : ("failed" as const),
      judge_status: passed ? ("passed" as const) : ("failed" as const),
      input: graphCase.input,
      expected_output: expectedOutput,
      actual_output: actualOutput,
      summary: passed
        ? "最少边数计算正确。"
        : `期望 ${expectedOutput}，实际得到 ${actualOutput}。`,
      duration_ms: 2 + index * 2,
      memory_kb: 1480 + graphCase.edges.length * 12,
      stdout: `${actualOutput}\n`,
      stderr: null,
    };
  });
  const passedCount = testCases.filter((item) => item.status === "passed").length;
  const status = passedCount === testCases.length ? ("passed" as const) : ("failed" as const);

  return {
    run_id: runId,
    task_id: taskId,
    status,
    execution_mode: "mock",
    evaluator_label: "演示评测",
    degraded_reason: null,
    language: request.language,
    detected_variant: null,
    passed_count: passedCount,
    total_count: testCases.length,
    duration_ms: testCases.reduce((sum, item) => sum + (item.duration_ms ?? 0), 0),
    memory_kb: Math.max(...testCases.map((item) => item.memory_kb ?? 0)),
    stdout: `运行完成：${passedCount}/${testCases.length} 个用例通过。`,
    stderr: status === "failed" && classification.kind === "incomplete" ? classification.message : null,
    error_line: null,
    trace_available: false,
    trace_variant: null,
    test_cases: testCases,
  };
}

export function runBfsCode(taskId: string, request: CodeRunRequest): CodeRunResult {
  runSequence += 1;
  const runId = `code_run_${String(runSequence).padStart(3, "0")}`;
  const classification = classifyBfsSource(request.language, request.source);

  if (classification.kind === "compile_error") {
    return {
      run_id: runId,
      task_id: taskId,
      status: "compile_error",
      execution_mode: "mock",
      evaluator_label: "演示评测",
      degraded_reason: null,
      language: request.language,
      detected_variant: null,
      passed_count: 0,
      total_count: 0,
      duration_ms: 0,
      memory_kb: 0,
      stdout: "",
      stderr: classification.message,
      error_line: classification.errorLine,
      trace_available: false,
      trace_variant: null,
      test_cases: [],
    };
  }

  const cases = [...builtInBfsCases];
  if (request.custom_input?.trim()) {
    cases.push(parseCustomGraph(request.custom_input));
  }

  const testCases = cases.map((graphCase, index) =>
    evaluateCase(graphCase, classification.kind, index),
  );
  const passedCount = testCases.filter((item) => item.status === "passed").length;
  const totalDuration = testCases.reduce((sum, item) => sum + (item.duration_ms ?? 0), 0);
  const peakMemory = Math.max(...testCases.map((item) => item.memory_kb ?? 0));
  const status = passedCount === testCases.length ? "passed" : "failed";

  return {
    run_id: runId,
    task_id: taskId,
    status,
    execution_mode: "mock",
    evaluator_label: "演示评测",
    degraded_reason: null,
    language: request.language,
    detected_variant: classification.kind,
    passed_count: passedCount,
    total_count: testCases.length,
    duration_ms: totalDuration,
    memory_kb: peakMemory,
    stdout: `运行完成：${passedCount}/${testCases.length} 个用例通过。`,
    stderr: status === "failed" ? classification.message : null,
    error_line: status === "failed" ? classification.errorLine : null,
    trace_available: true,
    trace_variant: classification.kind,
    test_cases: testCases,
  };
}

function evaluateCase(
  graphCase: BfsGraphCase,
  variant: TraceVariant,
  index: number,
): CodeRunTestCase {
  const expectedOutput = expectedOutputFor(graphCase);
  const actual = bfs(graphCase, variant);
  const actualOutput = actual.join(" ");
  const passed = expectedOutput === actualOutput;
  const nodeCount = new Set(graphCase.edges.flat()).size;

  return {
    test_case_id: graphCase.id,
    label: graphCase.label,
    status: passed ? "passed" : "failed",
    judge_status: passed ? "passed" : "failed",
    input: graphCase.input,
    expected_output: expectedOutput,
    actual_output: actualOutput,
    summary: passed
      ? "访问顺序正确，未发现重复入队。"
      : `期望 ${expectedOutput}，实际得到 ${actualOutput}。`,
    duration_ms: 3 + index * 2,
    memory_kb: 1640 + nodeCount * 16,
    stdout: `${actualOutput}\n`,
    stderr: null,
  };
}

function bfs(graphCase: BfsGraphCase, variant: TraceVariant) {
  const adjacency = new Map<number, number[]>();
  for (const [from, to] of graphCase.edges) {
    const neighbors = adjacency.get(from) ?? [];
    neighbors.push(to);
    adjacency.set(from, neighbors);
  }

  const visited = new Set<number>();
  const queue = [graphCase.start];
  const order: number[] = [];
  if (variant === "visited-on-enqueue") visited.add(graphCase.start);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (variant === "visited-on-dequeue") visited.add(current);
    order.push(current);

    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      if (variant === "visited-on-enqueue") visited.add(next);
      queue.push(next);
    }
  }

  return order;
}

function findDelimiterIssue(source: string): { line: number; message: string } | null {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closing = new Set(Object.values(pairs));
  const stack: Array<{ delimiter: string; line: number }> = [];
  let line = 1;
  let state: "normal" | "line_comment" | "block_comment" | "string" | "character" = "normal";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];

    if (char === "\n") {
      line += 1;
      if (state === "line_comment") state = "normal";
      continue;
    }
    if (state === "line_comment") continue;
    if (state === "block_comment") {
      if (char === "*" && next === "/") {
        state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "string" || state === "character") {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if ((state === "string" && char === '"') || (state === "character" && char === "'")) {
        state = "normal";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line_comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block_comment";
      index += 1;
      continue;
    }
    if (char === '"') {
      state = "string";
      continue;
    }
    if (char === "'") {
      state = "character";
      continue;
    }
    if (pairs[char]) {
      stack.push({ delimiter: char, line });
      continue;
    }
    if (closing.has(char)) {
      const opening = stack.pop();
      if (!opening || pairs[opening.delimiter] !== char) {
        return { line, message: `第 ${line} 行：分隔符“${char}”没有匹配的起始符号。` };
      }
    }
  }

  const unclosed = stack.at(-1);
  if (!unclosed) return null;
  return {
    line: unclosed.line,
    message: `第 ${unclosed.line} 行：缺少右分隔符“${pairs[unclosed.delimiter]}”。`,
  };
}
