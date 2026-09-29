import type {
  CodeRunCaseStatus,
  CodeRunRequest,
  CodeRunResult,
  CodeRunTestCase,
  ProgrammingLanguage,
} from "@xuetu/contracts";

import { classifyBfsSource } from "../code-runner.js";
import {
  builtInBfsCases,
  expectedOutputFor,
  parseCustomGraph,
  type BfsGraphCase,
} from "./bfs-cases.js";
import {
  CodeEvaluatorError,
  type CodeEvaluator,
  type CodeEvaluatorHealth,
} from "./code-evaluator.js";
import type {
  Judge0ExecutionRequest,
  Judge0Language,
  Judge0SubmissionResult,
} from "./judge0-client.js";
import { buildBfsProgram } from "./language-harnesses.js";
import {
  buildShortestPathProgram,
  builtInShortestPathCases,
  expectedDistanceFor,
  taskKindFor,
} from "./shortest-path-task.js";

interface Judge0ExecutionClient {
  execute(request: Judge0ExecutionRequest): Promise<Judge0SubmissionResult>;
}

interface RuntimeResolver {
  resolve(language: ProgrammingLanguage): Promise<Judge0Language>;
}

interface Judge0CodeEvaluatorOptions {
  client: Judge0ExecutionClient;
  resolver: RuntimeResolver;
  allowMockFallback: boolean;
  fallback: CodeEvaluator;
}

const TYPESCRIPT_COMPILER_OPTIONS = "--target ES2015 --lib ES2015,DOM";

function executionRequest(
  sourceCode: string,
  runtime: Judge0Language,
  language: ProgrammingLanguage,
): Judge0ExecutionRequest {
  const base = { sourceCode, languageId: runtime.id };
  return language === "typescript"
    ? { ...base, compilerOptions: TYPESCRIPT_COMPILER_OPTIONS }
    : base;
}

let judgeRunSequence = 0;

export class Judge0CodeEvaluator implements CodeEvaluator {
  private degradedReason: string | null = null;

  constructor(private readonly options: Judge0CodeEvaluatorOptions) {}

  async evaluate(taskId: string, request: CodeRunRequest): Promise<CodeRunResult> {
    try {
      const result = await this.evaluateInSandbox(taskId, request);
      this.degradedReason = null;
      return result;
    } catch (caught) {
      if (
        caught instanceof CodeEvaluatorError &&
        caught.category === "infrastructure" &&
        this.options.allowMockFallback
      ) {
        this.degradedReason = caught.message;
        const fallback = await this.options.fallback.evaluate(taskId, request);
        return {
          ...fallback,
          execution_mode: "mock_fallback",
          evaluator_label: "演示降级评测",
          degraded_reason: caught.message,
        };
      }
      throw caught;
    }
  }

  async health(): Promise<CodeEvaluatorHealth> {
    if (this.degradedReason) {
      return {
        status: "degraded_mock",
        label: "演示降级评测",
        detail: this.degradedReason,
      };
    }
    try {
      const runtime = await this.options.resolver.resolve("cpp");
      return {
        status: "sandbox",
        label: `Judge0 · ${runtime.name}`,
        detail: null,
      };
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "隔离评测服务不可用。";
      return this.options.allowMockFallback
        ? { status: "degraded_mock", label: "演示降级评测", detail }
        : { status: "unavailable", label: "评测服务不可用", detail };
    }
  }

  private async evaluateInSandbox(
    taskId: string,
    request: CodeRunRequest,
  ): Promise<CodeRunResult> {
    judgeRunSequence += 1;
    const runId = `sandbox_run_${String(judgeRunSequence).padStart(3, "0")}`;
    const runtime = await this.options.resolver.resolve(request.language);
    if (taskKindFor(taskId) === "shortest_path") {
      return this.evaluateShortestPathInSandbox(taskId, request, runId, runtime);
    }
    const classification = classifyBfsSource(request.language, request.source);
    const detectedVariant =
      classification.kind === "compile_error" ? null : classification.kind;
    const cases = [...builtInBfsCases];
    if (request.custom_input?.trim()) cases.push(parseCustomGraph(request.custom_input));

    const testCases: CodeRunTestCase[] = [];
    for (const graphCase of cases) {
      const program = buildBfsProgram(request.language, request.source, graphCase);
      const raw = await this.options.client.execute(
        executionRequest(program.source, runtime, request.language),
      );
      const mapped = mapJudgeStatus(raw, graphCase);
      if (mapped.status === "compile_error") {
        const compilerOutput = raw.compile_output ?? raw.stderr ?? raw.message ?? "编译失败。";
        return {
          run_id: runId,
          task_id: taskId,
          status: "compile_error",
          execution_mode: "sandbox",
          evaluator_label: `Judge0 · ${runtime.name}`,
          degraded_reason: null,
          language: request.language,
          detected_variant: null,
          passed_count: 0,
          total_count: 0,
          duration_ms: null,
          memory_kb: null,
          stdout: raw.stdout ?? "",
          stderr: compilerOutput,
          error_line: compilerErrorLine(compilerOutput),
          trace_available: false,
          trace_variant: null,
          test_cases: [],
        };
      }
      testCases.push(mapped);
    }

    const passedCount = testCases.filter((item) => item.status === "passed").length;
    const durationValues = testCases.flatMap((item) =>
      item.duration_ms === null ? [] : [item.duration_ms],
    );
    const memoryValues = testCases.flatMap((item) =>
      item.memory_kb === null ? [] : [item.memory_kb],
    );
    const status = aggregateStatus(testCases);
    const firstError = testCases.find((item) => item.stderr)?.stderr ?? null;
    const classificationMessage =
      classification.kind === "compile_error" ? null : classification.message;

    return {
      run_id: runId,
      task_id: taskId,
      status,
      execution_mode: "sandbox",
      evaluator_label: `Judge0 · ${runtime.name}`,
      degraded_reason: null,
      language: request.language,
      detected_variant: detectedVariant,
      passed_count: passedCount,
      total_count: testCases.length,
      duration_ms:
        durationValues.length > 0
          ? durationValues.reduce((sum, value) => sum + value, 0)
          : null,
      memory_kb: memoryValues.length > 0 ? Math.max(...memoryValues) : null,
      stdout: `运行完成：${passedCount}/${testCases.length} 个用例通过。`,
      stderr: firstError ?? (status === "failed" ? classificationMessage : null),
      error_line:
        status === "passed" || classification.kind === "compile_error"
          ? null
          : classification.errorLine,
      trace_available:
        detectedVariant !== null && (status === "passed" || status === "failed"),
      trace_variant: detectedVariant,
      test_cases: testCases,
    };
  }

  private async evaluateShortestPathInSandbox(
    taskId: string,
    request: CodeRunRequest,
    runId: string,
    runtime: Judge0Language,
  ): Promise<CodeRunResult> {
    const testCases: CodeRunTestCase[] = [];
    for (const graphCase of builtInShortestPathCases) {
      const program = buildShortestPathProgram(request.language, request.source, graphCase);
      const raw = await this.options.client.execute(
        executionRequest(program.source, runtime, request.language),
      );
      const expectedOutput = String(expectedDistanceFor(graphCase));
      const mapped = mapJudgeCase(raw, {
        testCaseId: graphCase.id,
        label: graphCase.label,
        input: graphCase.input,
        expectedOutput,
        passedSummary: "最少边数计算正确。",
        failedSummary: (actual) => `期望 ${expectedOutput}，实际得到 ${actual || "空输出"}。`,
      });
      if (mapped.status === "compile_error") {
        const compilerOutput = raw.compile_output ?? raw.stderr ?? raw.message ?? "编译失败。";
        return {
          run_id: runId,
          task_id: taskId,
          status: "compile_error",
          execution_mode: "sandbox",
          evaluator_label: `Judge0 · ${runtime.name}`,
          degraded_reason: null,
          language: request.language,
          detected_variant: null,
          passed_count: 0,
          total_count: 0,
          duration_ms: null,
          memory_kb: null,
          stdout: raw.stdout ?? "",
          stderr: compilerOutput,
          error_line: compilerErrorLine(compilerOutput),
          trace_available: false,
          trace_variant: null,
          test_cases: [],
        };
      }
      testCases.push(mapped);
    }

    const passedCount = testCases.filter((item) => item.status === "passed").length;
    const durationValues = testCases.flatMap((item) =>
      item.duration_ms === null ? [] : [item.duration_ms],
    );
    const memoryValues = testCases.flatMap((item) =>
      item.memory_kb === null ? [] : [item.memory_kb],
    );
    const status = aggregateStatus(testCases);
    const firstError = testCases.find((item) => item.stderr)?.stderr ?? null;

    return {
      run_id: runId,
      task_id: taskId,
      status,
      execution_mode: "sandbox",
      evaluator_label: `Judge0 · ${runtime.name}`,
      degraded_reason: null,
      language: request.language,
      detected_variant: null,
      passed_count: passedCount,
      total_count: testCases.length,
      duration_ms:
        durationValues.length > 0
          ? durationValues.reduce((sum, value) => sum + value, 0)
          : null,
      memory_kb: memoryValues.length > 0 ? Math.max(...memoryValues) : null,
      stdout: `运行完成：${passedCount}/${testCases.length} 个用例通过。`,
      stderr: firstError,
      error_line: null,
      trace_available: false,
      trace_variant: null,
      test_cases: testCases,
    };
  }
}

function normalizeOutput(value: string | null) {
  return (value ?? "").trim().replace(/\s+/gu, " ");
}

function milliseconds(value: string | number | null) {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : null;
}

function caseStatus(result: Judge0SubmissionResult): CodeRunCaseStatus {
  if (/memory/iu.test(result.status.description)) return "memory_limit_exceeded";
  switch (result.status.id) {
    case 3:
      return "passed";
    case 4:
      return "failed";
    case 5:
      return "time_limit_exceeded";
    case 6:
      return "compile_error";
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
    case 12:
    case 14:
      return "runtime_error";
    default:
      return "internal_error";
  }
}

function mapJudgeStatus(
  result: Judge0SubmissionResult,
  graphCase: BfsGraphCase,
): CodeRunTestCase {
  const expectedOutput = expectedOutputFor(graphCase);
  const actualOutput = normalizeOutput(result.stdout);
  let status = caseStatus(result);
  if (status === "passed" && actualOutput !== expectedOutput) status = "failed";
  const stderr = result.compile_output ?? result.stderr ?? result.message;

  const summaryByStatus: Record<CodeRunCaseStatus, string> = {
    passed: "访问顺序正确，未发现重复入队。",
    failed: `期望 ${expectedOutput}，实际得到 ${actualOutput || "空输出"}。`,
    compile_error: "代码未通过编译。",
    runtime_error: "程序运行时异常终止。",
    time_limit_exceeded: "程序运行超过时间限制。",
    memory_limit_exceeded: "程序运行超过内存限制。",
    internal_error: "隔离评测服务未能完成该用例。",
  };

  return {
    test_case_id: graphCase.id,
    label: graphCase.label,
    status,
    judge_status: status,
    input: graphCase.input,
    expected_output: expectedOutput,
    actual_output: actualOutput,
    summary: summaryByStatus[status],
    duration_ms: milliseconds(result.time),
    memory_kb: result.memory === null ? null : Math.ceil(result.memory),
    stdout: result.stdout ?? "",
    stderr,
  };
}

interface JudgeCaseMapping {
  testCaseId: string;
  label: string;
  input: string;
  expectedOutput: string;
  passedSummary: string;
  failedSummary: (actualOutput: string) => string;
}

function mapJudgeCase(
  result: Judge0SubmissionResult,
  mapping: JudgeCaseMapping,
): CodeRunTestCase {
  const actualOutput = normalizeOutput(result.stdout);
  let status = caseStatus(result);
  if (status === "passed" && actualOutput !== mapping.expectedOutput) status = "failed";
  const stderr = result.compile_output ?? result.stderr ?? result.message;

  const summaryByStatus: Record<CodeRunCaseStatus, string> = {
    passed: mapping.passedSummary,
    failed: mapping.failedSummary(actualOutput),
    compile_error: "代码未通过编译。",
    runtime_error: "程序运行时异常终止。",
    time_limit_exceeded: "程序运行超过时间限制。",
    memory_limit_exceeded: "程序运行超过内存限制。",
    internal_error: "隔离评测服务未能完成该用例。",
  };

  return {
    test_case_id: mapping.testCaseId,
    label: mapping.label,
    status,
    judge_status: status,
    input: mapping.input,
    expected_output: mapping.expectedOutput,
    actual_output: actualOutput,
    summary: summaryByStatus[status],
    duration_ms: milliseconds(result.time),
    memory_kb: result.memory === null ? null : Math.ceil(result.memory),
    stdout: result.stdout ?? "",
    stderr,
  };
}

function aggregateStatus(testCases: CodeRunTestCase[]): CodeRunResult["status"] {
  const statuses = new Set(testCases.map((item) => item.status));
  if (statuses.has("internal_error")) return "internal_error";
  if (statuses.has("runtime_error")) return "runtime_error";
  if (statuses.has("memory_limit_exceeded")) return "memory_limit_exceeded";
  if (statuses.has("time_limit_exceeded")) return "time_limit_exceeded";
  if (statuses.has("failed")) return "failed";
  return "passed";
}

function compilerErrorLine(output: string) {
  const fileStyle = /:(\d+):\d+/u.exec(output);
  if (fileStyle) return Number(fileStyle[1]);
  const lineStyle = /\bline\s+(\d+)\b/iu.exec(output);
  return lineStyle ? Number(lineStyle[1]) : null;
}
