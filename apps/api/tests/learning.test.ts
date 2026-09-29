import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CodeRunResult } from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import { getProgrammingLanguageDefinition } from "../src/domain/programming-languages.js";
import {
  CodeEvaluatorError,
  type CodeEvaluator,
} from "../src/services/evaluator/code-evaluator.js";

const failedCode = {
  language: "cpp",
  source: "// mock: visited-on-dequeue",
};

const fixedCode = {
  language: "cpp",
  source: "// mock: visited-on-enqueue",
};

describe("student learning flow", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ enableLegacyDemoRoutes: true });
  });

  afterEach(async () => {
    await app.close();
  });

  async function submit(variant: "visited-on-dequeue" | "visited-on-enqueue", key: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: { "idempotency-key": key },
      payload: {
        task_version: 1,
        answer: null,
        code: variant === "visited-on-dequeue" ? failedCode : fixedCode,
        client_draft_version: 7,
        hint_usage_ids: [],
        mock_answer_variant: variant,
      },
    });
  }

  it("runs the current source and returns visible input, expected, and actual output", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/runs",
      payload: {
        language: "cpp",
        source: `void bfs() {
  visited[current] = true;
  pending.push(next);
}`,
        custom_input: null,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: "failed",
      detected_variant: "visited-on-dequeue",
      passed_count: 2,
      total_count: 4,
      trace_available: true,
      trace_variant: "visited-on-dequeue",
    });
    expect(response.json().data.test_cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          test_case_id: "case_diamond",
          expected_output: "1 2 3 4",
          actual_output: "1 2 3 4 4",
        }),
      ]),
    );
  });

  it("awaits an injected sandbox evaluator while keeping public status minimal", async () => {
    const sandboxResult: CodeRunResult = {
      run_id: "sandbox_run_route",
      task_id: "task_bfs_bug_001",
      status: "passed",
      execution_mode: "sandbox",
      evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
      degraded_reason: null,
      language: "cpp",
      detected_variant: "visited-on-enqueue",
      passed_count: 1,
      total_count: 1,
      duration_ms: 8,
      memory_kb: 1832,
      stdout: "运行完成：1/1 个用例通过。",
      stderr: null,
      error_line: null,
      trace_available: true,
      trace_variant: "visited-on-enqueue",
      test_cases: [
        {
          test_case_id: "case_tree",
          label: "基础树形图",
          status: "passed",
          judge_status: "passed",
          input: "start=1\n1 2",
          expected_output: "1 2",
          actual_output: "1 2",
          summary: "访问顺序正确。",
          duration_ms: 8,
          memory_kb: 1832,
          stdout: "1 2\n",
          stderr: null,
        },
      ],
    };
    const evaluator: CodeEvaluator = {
      evaluate: vi.fn(async () => sandboxResult),
      health: vi.fn(async () => ({
        status: "sandbox" as const,
        label: "Judge0 · C++ (GCC 14.1.0)",
        detail: null,
      })),
    };
    await app.close();
    app = buildApp({ codeEvaluator: evaluator, enableLegacyDemoRoutes: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/runs",
      payload: { language: "cpp", source: fixedCode.source, custom_input: null },
    });
    const submission = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: { "idempotency-key": "reuse-recent-sandbox-run" },
      payload: {
        task_version: 1,
        answer: null,
        code: fixedCode,
        custom_input: null,
        client_draft_version: 7,
        hint_usage_ids: [],
        mock_answer_variant: "visited-on-enqueue",
      },
    });
    const status = await app.inject({ method: "GET", url: "/api/v1/system-status" });

    expect(response.statusCode).toBe(200);
    expect(submission.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      execution_mode: "sandbox",
      duration_ms: 8,
      memory_kb: 1832,
    });
    expect(evaluator.evaluate).toHaveBeenCalledWith(
      "task_bfs_bug_001",
      expect.objectContaining({ language: "cpp" }),
    );
    expect(evaluator.evaluate).toHaveBeenCalledOnce();
    expect(status.json().data).toEqual({ status: "ready" });
    expect(evaluator.health).not.toHaveBeenCalled();
  });

  it("maps typed evaluator infrastructure failures without losing retry semantics", async () => {
    const evaluator: CodeEvaluator = {
      evaluate: vi.fn(async () => {
        throw new CodeEvaluatorError(
          "隔离评测服务暂时不可用。",
          "EVALUATOR_NETWORK_ERROR",
          503,
          true,
          "infrastructure",
        );
      }),
      health: vi.fn(async () => ({
        status: "unavailable" as const,
        label: "评测服务不可用",
        detail: "隔离评测服务暂时不可用。",
      })),
    };
    await app.close();
    app = buildApp({ codeEvaluator: evaluator, enableLegacyDemoRoutes: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/runs",
      payload: { language: "cpp", source: fixedCode.source, custom_input: null },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: "EVALUATOR_NETWORK_ERROR",
      message: "隔离评测服务暂时不可用。",
      retryable: true,
    });
  });

  it("runs and stores the language selected by the student", async () => {
    const python = getProgrammingLanguageDefinition("python");
    const rust = getProgrammingLanguageDefinition("rust");
    const runResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/runs",
      payload: {
        language: "python",
        source: python.starter_code,
        custom_input: null,
      },
    });

    expect(runResponse.statusCode).toBe(200);
    expect(runResponse.json().data).toMatchObject({
      language: "python",
      status: "failed",
      passed_count: 2,
    });

    const submitResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: { "idempotency-key": "rust-language-history" },
      payload: {
        task_version: 1,
        answer: null,
        code: { language: "rust", source: rust.fixed_code },
        client_draft_version: 7,
        hint_usage_ids: [],
        mock_answer_variant: "visited-on-dequeue",
      },
    });
    expect(submitResponse.statusCode).toBe(201);

    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
    });
    expect(historyResponse.json().data.items[0].code).toMatchObject({
      language: "rust",
      source: rust.fixed_code,
    });
  });

  it("validates run payloads and custom graph input", async () => {
    const emptySource = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/runs",
      payload: { language: "cpp", source: "", custom_input: null },
    });
    const invalidGraph = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/runs",
      payload: {
        language: "cpp",
        source: fixedCode.source,
        custom_input: "这不是一条边",
      },
    });

    expect(emptySource.statusCode).toBe(400);
    expect(emptySource.json().error.code).toBe("VALIDATION_ERROR");
    expect(invalidGraph.statusCode).toBe(400);
    expect(invalidGraph.json().error.code).toBe("INVALID_CUSTOM_INPUT");
  });

  it("derives submission behavior from source instead of the client preset", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: { "idempotency-key": "source-over-preset" },
      payload: {
        task_version: 1,
        answer: null,
        code: fixedCode,
        client_draft_version: 7,
        hint_usage_ids: [],
        mock_answer_variant: "visited-on-dequeue",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.evaluation.passed_count).toBe(4);
  });

  it("derives submission evidence from the injected evaluator and evaluates an idempotent request once", async () => {
    const objectiveFailure: CodeRunResult = {
      run_id: "sandbox_submission_failure",
      task_id: "task_bfs_bug_001",
      status: "failed",
      execution_mode: "sandbox",
      evaluator_label: "Judge0 · C++ (GCC 14.1.0)",
      degraded_reason: null,
      language: "cpp",
      detected_variant: "visited-on-dequeue",
      passed_count: 1,
      total_count: 2,
      duration_ms: 9,
      memory_kb: 1880,
      stdout: "运行完成：1/2 个用例通过。",
      stderr: "汇聚图出现重复节点。",
      error_line: 8,
      trace_available: true,
      trace_variant: "visited-on-dequeue",
      test_cases: [
        {
          test_case_id: "case_tree",
          label: "基础树形图",
          status: "passed",
          judge_status: "passed",
          input: "start=1\n1 2",
          expected_output: "1 2",
          actual_output: "1 2",
          summary: "访问顺序正确。",
          duration_ms: 4,
          memory_kb: 1800,
          stdout: "1 2\n",
          stderr: null,
        },
        {
          test_case_id: "case_diamond",
          label: "菱形汇聚图",
          status: "failed",
          judge_status: "failed",
          input: "start=1\n1 2\n1 3\n2 4\n3 4",
          expected_output: "1 2 3 4",
          actual_output: "1 2 3 4 4",
          summary: "期望 1 2 3 4，实际得到 1 2 3 4 4。",
          duration_ms: 5,
          memory_kb: 1880,
          stdout: "1 2 3 4 4\n",
          stderr: null,
        },
      ],
    };
    const evaluate = vi.fn(async () => objectiveFailure);
    const evaluator: CodeEvaluator = {
      evaluate,
      health: vi.fn(async () => ({
        status: "sandbox" as const,
        label: objectiveFailure.evaluator_label,
        detail: null,
      })),
    };
    await app.close();
    app = buildApp({ codeEvaluator: evaluator, enableLegacyDemoRoutes: true });
    const payload = {
      task_version: 1,
      answer: null,
      code: fixedCode,
      custom_input: "start=7\n7 8\n7 9\n8 9",
      client_draft_version: 7,
      hint_usage_ids: [],
      mock_answer_variant: "visited-on-enqueue",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: { "idempotency-key": "objective-evaluation" },
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
      headers: { "idempotency-key": "objective-evaluation" },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({
      evaluation: {
        passed_count: 1,
        total_count: 2,
        score: 50,
        test_cases: expect.arrayContaining([
          expect.objectContaining({
            test_case_id: "case_diamond",
            status: "failed",
            duration_ms: 5,
            memory_kb: 1880,
          }),
        ]),
      },
      learning_node_status: "in_progress",
      learning_update: { trigger: "failed_submission" },
    });
    expect(first.json().data.evidence[0].summary).toContain("1/2");
    expect(first.json().data.evidence[0].summary).toContain("Judge0");
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledWith(
      "task_bfs_bug_001",
      expect.objectContaining({ custom_input: payload.custom_input }),
    );
  });

  it("lists immutable task submissions newest first", async () => {
    const empty = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.items).toEqual([]);

    await submit("visited-on-dequeue", "history-failed");
    await submit("visited-on-enqueue", "history-fixed");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/task_bfs_bug_001/submissions",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      task_id: "task_bfs_bug_001",
      items: [
        {
          submission_id: "sub_002",
          sequence: 2,
          code: fixedCode,
          evaluation: { passed_count: 4, total_count: 4, score: 100 },
          diagnosis_id: null,
        },
        {
          submission_id: "sub_001",
          sequence: 1,
          code: failedCode,
          evaluation: { passed_count: 2, total_count: 4, score: 50 },
          diagnosis_id: "diag_001",
        },
      ],
    });

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/tasks/not-found/submissions",
    });
    expect(missing.statusCode).toBe(404);
  });

  it("moves from evidence-backed failure to validation-ready and only then mastered", async () => {
    const failed = await submit("visited-on-dequeue", "flow-failed");

    expect(failed.statusCode).toBe(201);
    expect(failed.json().data).toMatchObject({
      evaluation: { passed_count: 2, total_count: 4 },
      learning_node_status: "in_progress",
      learning_state_version: 7,
      learning_update: {
        trigger: "failed_submission",
        ability_changes: expect.arrayContaining([
          expect.objectContaining({
            key: "debugging_diagnosis",
            label: "调试诊断",
            before: 68,
            after: 70,
            delta: 2,
          }),
        ]),
        plan_changes: expect.arrayContaining([
          expect.objectContaining({ label: "新增错因回看" }),
        ]),
        review_changes: expect.arrayContaining([
          expect.objectContaining({ title: "BFS visited 标记时机" }),
        ]),
      },
    });

    const fixed = await submit("visited-on-enqueue", "flow-fixed");
    const fixedData = fixed.json().data;

    expect(fixed.statusCode).toBe(201);
    expect(fixedData).toMatchObject({
      evaluation: { passed_count: 4, total_count: 4 },
      learning_node_status: "validation_ready",
      learning_state_version: 8,
      validation_id: "task_bfs_transfer_001",
      learning_update: {
        trigger: "passed_submission",
        ability_changes: expect.arrayContaining([
          expect.objectContaining({
            key: "code_implementation",
            label: "代码实现",
            before: 61,
            after: 68,
            delta: 7,
          }),
        ]),
        plan_changes: expect.arrayContaining([
          expect.objectContaining({ label: "进入独立验证" }),
        ]),
      },
    });

    const abilityBeforeValidation = await app.inject({
      method: "GET",
      url: "/api/v1/student/ability-assessment?course_id=course_ds_001",
    });
    expect(abilityBeforeValidation.statusCode).toBe(200);
    expect(abilityBeforeValidation.json().data.dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "algorithmic_thinking", score: 75 }),
        expect.objectContaining({ key: "code_implementation", score: 68 }),
        expect.objectContaining({ key: "debugging_diagnosis", score: 74 }),
      ]),
    );

    const failedValidation = await app.inject({
      method: "POST",
      url: "/api/v1/validations/task_bfs_transfer_001/attempts",
      headers: { "idempotency-key": "flow-validation-wrong" },
      payload: {
        task_version: 1,
        expected_learning_state_version: fixedData.learning_state_version,
        answer: null,
        code: { language: "cpp", source: "// mock: shortest-path-wrong" },
      },
    });
    expect(failedValidation.statusCode).toBe(201);
    expect(failedValidation.json().data).toMatchObject({
      passed: false,
      previous_node_status: "validation_ready",
      current_node_status: "validation_ready",
      next_recommended_node_id: "node_bfs_001",
      evaluation: expect.objectContaining({
        total_count: 4,
        execution_mode: "mock",
      }),
    });

    const validated = await app.inject({
      method: "POST",
      url: "/api/v1/validations/task_bfs_transfer_001/attempts",
      headers: { "idempotency-key": "flow-validation" },
      payload: {
        task_version: 1,
        expected_learning_state_version: fixedData.learning_state_version,
        answer: null,
        code: { language: "cpp", source: "// mock: shortest-path-correct" },
      },
    });

    expect(validated.statusCode).toBe(201);
    expect(validated.json().data).toMatchObject({
      passed: true,
      previous_node_status: "validation_ready",
      current_node_status: "mastered",
      next_recommended_node_id: "node_dfs_001",
      learning_state_version: 9,
      evaluation: expect.objectContaining({
        passed_count: 4,
        total_count: 4,
        execution_mode: "mock",
      }),
    });

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/student/overview",
    });
    expect(overview.json().data).toMatchObject({
      current_course: { current_node_id: "node_dfs_001", progress_percent: 58 },
      recommended_node: {
        learning_node_id: "node_dfs_001",
        status: "in_progress",
      },
      today_plan: [
        { label: "完成 BFS 独立验证", status: "completed" },
        { label: "比较 BFS 与 DFS", status: "in_progress" },
        { label: "实现递归 DFS", status: "not_started" },
      ],
    });

    const practiceTasks = await app.inject({
      method: "GET",
      url: "/api/v1/practice/tasks?course_id=course_ds_001",
    });
    expect(practiceTasks.json().data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: "task_bfs_bug_001",
          status: "mastered",
          last_result: "4 / 4",
        }),
      ]),
    );
  });

  it("replays the same immutable submission for a duplicate idempotency key", async () => {
    const first = await submit("visited-on-dequeue", "same-request");
    const second = await submit("visited-on-enqueue", "same-request");

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.json().data).toEqual(first.json().data);

    const submissionId = first.json().data.submission_id;
    const stored = await app.inject({
      method: "GET",
      url: `/api/v1/submissions/${submissionId}`,
    });
    expect(stored.json().data.submission_id).toBe(submissionId);
  });

  it("rejects an independent validation based on a stale learning-state version", async () => {
    await submit("visited-on-enqueue", "version-fixed");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/validations/task_bfs_transfer_001/attempts",
      headers: { "idempotency-key": "version-stale" },
      payload: {
        task_version: 1,
        expected_learning_state_version: 7,
        answer: null,
        code: { language: "cpp", source: "// mock: shortest-path-correct" },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "CONFLICTING_VERSION",
        retryable: true,
        details: { current_learning_state_version: 8 },
      },
    });
  });

  it("exposes objective evidence, a cited diagnosis, the mistake record and updated plan", async () => {
    const submission = await submit("visited-on-dequeue", "evidence-failed");
    const data = submission.json().data;

    const evidence = await app.inject({
      method: "GET",
      url: `/api/v1/submissions/${data.submission_id}/evidence`,
    });
    expect(evidence.json().data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "test_result", source_ref: data.evaluation.evaluation_id }),
      ]),
    );

    const diagnosis = await app.inject({
      method: "GET",
      url: `/api/v1/diagnoses/${data.diagnosis_id}`,
    });
    expect(diagnosis.json().data).toMatchObject({
      diagnosis_id: data.diagnosis_id,
      citation_ids: ["source_ds_book_143"],
      next_action: { type: "hint", hint_level: 1 },
    });

    const mistakes = await app.inject({ method: "GET", url: "/api/v1/mistakes" });
    expect(mistakes.json().data.items[0]).toMatchObject({
      learning_node_id: "node_bfs_001",
      diagnosis_id: data.diagnosis_id,
      status: "needs_review",
    });

    const plan = await app.inject({
      method: "GET",
      url: "/api/v1/learning-plan?course_id=course_ds_001",
    });
    expect(plan.json().data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          learning_node_id: "node_bfs_001",
          based_on_diagnosis_ids: [data.diagnosis_id],
        }),
      ]),
    );
  });
});
