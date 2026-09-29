import type {
  AbilityAssessmentKey,
  CodeRunResult,
  Diagnosis,
  Evaluation,
  Evidence,
  ExecutionMode,
  LearningNode,
  SubmissionHistoryItem,
  SubmissionRequest,
  ValidationAttemptRequest,
} from "@xuetu/contracts";

import type { DemoState } from "../domain/demo-state.js";
import type { CodeEvaluator } from "./evaluator/code-evaluator.js";

export type SubmissionVariant = "visited-on-dequeue" | "visited-on-enqueue";

export type SubmissionInput = SubmissionRequest;
export type ValidationInput = ValidationAttemptRequest;

export interface SubmissionRecord {
  submission_id: string;
  sequence: number;
  task_id: string;
  task_version: number;
  status: "completed";
  code: SubmissionInput["code"];
  hint_usage_ids: string[];
  evaluation: Evaluation;
  evidence: Evidence[];
  diagnosis_id: string | null;
  learning_node_status: LearningNode["status"];
  learning_state_version: number;
  validation_id: string | null;
  learning_update: LearningStateUpdate;
  created_at: string;
}

export interface LearningStateUpdate {
  trigger: "failed_submission" | "passed_submission";
  title: string;
  ability_changes: Array<{
    key: AbilityAssessmentKey;
    label: string;
    before: number;
    after: number;
    delta: number;
    reason: string;
  }>;
  plan_changes: Array<{
    label: string;
    detail: string;
  }>;
  review_changes: Array<{
    id: string;
    title: string;
    scheduled_for: string;
    minutes: number;
    reason: string;
  }>;
}

export interface MistakeRecord {
  mistake_id: string;
  submission_id: string;
  diagnosis_id: string;
  learning_node_id: string;
  title: string;
  summary: string;
  status: "needs_review" | "resolved";
  created_at: string;
}

export interface ValidationCaseSummary {
  test_case_id: string;
  label: string;
  status: "passed" | "failed" | "error";
  duration_ms: number | null;
  memory_kb: number | null;
}

export interface ValidationEvaluationSummary {
  passed_count: number;
  total_count: number;
  execution_mode: ExecutionMode;
  evaluator_label: string;
  test_cases: ValidationCaseSummary[];
}

export interface ValidationAttempt {
  validation_attempt_id: string;
  validation_id: string;
  passed: boolean;
  previous_node_status: LearningNode["status"];
  current_node_status: LearningNode["status"];
  next_recommended_node_id: string;
  state_change_reason: string;
  learning_state_version: number;
  evaluation: ValidationEvaluationSummary;
  created_at: string;
}

export interface DemoFlowSnapshot {
  submissions: Array<[string, SubmissionRecord]>;
  diagnoses: Array<[string, Diagnosis]>;
  mistakes: Array<[string, MistakeRecord]>;
  idempotentSubmissions: Array<[string, SubmissionRecord]>;
  idempotentValidations: Array<[string, ValidationAttempt]>;
  abilityAwards: string[];
  submissionCount: number;
  diagnosisCount: number;
  validationCount: number;
}

type FlowResult<T> =
  | { ok: true; replayed: boolean; data: T }
  | {
      ok: false;
      statusCode: number;
      code: string;
      message: string;
      retryable: boolean;
      details: Record<string, unknown>;
    };

function nowIso() {
  return new Date().toISOString();
}

function dateAfterDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function evaluationFor(
  submissionId: string,
  runResult: CodeRunResult,
  index: number,
): Evaluation {
  return {
    evaluation_id: `eval_${String(index).padStart(3, "0")}`,
    submission_id: submissionId,
    status: "completed",
    passed_count: runResult.passed_count,
    total_count: runResult.total_count,
    score:
      runResult.total_count > 0
        ? Math.round((runResult.passed_count / runResult.total_count) * 100)
        : 0,
    compiler_output: runResult.status === "compile_error" ? runResult.stderr : null,
    test_cases: runResult.test_cases.map((testCase, testIndex) => ({
      test_case_id: testCase.test_case_id,
      status:
        testCase.status === "passed"
          ? "passed"
          : testCase.status === "failed"
            ? "failed"
            : "error",
      label: testCase.label,
      summary: testCase.summary,
      duration_ms: testCase.duration_ms,
      memory_kb: testCase.memory_kb,
      input_visible: testIndex < 2,
      expected_visible: testIndex < 2,
    })),
    completed_at: nowIso(),
  };
}

export function createDemoFlow(state: DemoState, codeEvaluator: CodeEvaluator) {
  const submissions = new Map<string, SubmissionRecord>();
  const diagnoses = new Map<string, Diagnosis>();
  const mistakes = new Map<string, MistakeRecord>();
  const idempotentSubmissions = new Map<string, SubmissionRecord>();
  const pendingSubmissions = new Map<string, Promise<FlowResult<SubmissionRecord>>>();
  const idempotentValidations = new Map<string, ValidationAttempt>();
  const pendingValidations = new Map<string, Promise<FlowResult<ValidationAttempt>>>();
  const abilityAwards = new Set<string>();
  let submissionCount = 0;
  let diagnosisCount = 0;
  let validationCount = 0;
  let onChange: (() => void) | null = null;

  function notifyChange() {
    onChange?.();
  }

  function bfsNode() {
    const node = state.nodes.find((item) => item.learning_node_id === "node_bfs_001");
    if (!node) throw new Error("Demo BFS node is missing.");
    return node;
  }

  function applyAbilityChange(
    key: AbilityAssessmentKey,
    label: string,
    delta: number,
    reason: string,
  ) {
    const before = state.ability_scores[key];
    const after = Math.min(100, before + delta);
    state.ability_scores[key] = after;
    return { key, label, before, after, delta: after - before, reason };
  }

  async function submitTask(
    taskId: string,
    input: SubmissionInput,
    idempotencyKey: string,
  ): Promise<FlowResult<SubmissionRecord>> {
    const replay = idempotentSubmissions.get(idempotencyKey);
    if (replay) return { ok: true, replayed: true, data: replay };
    const pending = pendingSubmissions.get(idempotencyKey);
    if (pending) {
      const settled = await pending;
      return settled.ok ? { ...settled, replayed: true } : settled;
    }

    const execution = executeSubmission(taskId, input, idempotencyKey);
    pendingSubmissions.set(idempotencyKey, execution);
    try {
      return await execution;
    } finally {
      pendingSubmissions.delete(idempotencyKey);
    }
  }

  async function executeSubmission(
    taskId: string,
    input: SubmissionInput,
    idempotencyKey: string,
  ): Promise<FlowResult<SubmissionRecord>> {
    const task = state.tasks.get(taskId);
    if (!task || task.is_independent_validation) {
      return {
        ok: false,
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        message: "学习任务不存在。",
        retryable: false,
        details: {},
      };
    }
    if (input.task_version !== task.version) {
      return {
        ok: false,
        statusCode: 409,
        code: "CONFLICTING_VERSION",
        message: "任务版本已更新，请刷新后重试。",
        retryable: true,
        details: { current_task_version: task.version },
      };
    }

    const runResult = await codeEvaluator.evaluate(taskId, {
      language: input.code.language,
      source: input.code.source,
      custom_input: input.custom_input ?? null,
    });
    if (runResult.status === "compile_error") {
      return {
        ok: false,
        statusCode: 422,
        code: "COMPILATION_ERROR",
        message: runResult.stderr ?? "代码未通过编译。",
        retryable: false,
        details: { error_line: runResult.error_line },
      };
    }

    submissionCount += 1;
    const submissionId = `sub_${String(submissionCount).padStart(3, "0")}`;
    const evaluation = evaluationFor(submissionId, runResult, submissionCount);
    const passed =
      evaluation.total_count > 0 && evaluation.passed_count === evaluation.total_count;
    const node = bfsNode();
    const firstPassForNode =
      passed && node.status !== "validation_ready" && node.status !== "mastered";
    const firstFailureAward = !passed && !abilityAwards.has(`${taskId}:failed`);
    let diagnosisId: string | null = null;

    const learningUpdate: LearningStateUpdate = passed
      ? {
          trigger: "passed_submission",
          title: "修复通过，学习路径已推进",
          ability_changes: firstPassForNode
            ? [
                applyAbilityChange(
                  "code_implementation",
                  "代码实现",
                  7,
                  "修复版本通过全部固定用例。",
                ),
                applyAbilityChange(
                  "debugging_diagnosis",
                  "调试诊断",
                  4,
                  "从失败证据完成定位、修复与回归验证。",
                ),
              ]
            : [],
          plan_changes: [
            {
              label: "进入独立验证",
              detail: "当前修复任务完成，解锁无提示迁移题。",
            },
          ],
          review_changes: [
            {
              id: `submission-review-${submissionId}`,
              title: "BFS 边界用例稳定性回访",
              scheduled_for: dateAfterDays(3),
              minutes: 10,
              reason: "三天后复查修复能否稳定迁移到新图。",
            },
          ],
        }
      : {
          trigger: "failed_submission",
          title: "本次失败已转化为学习动作",
          ability_changes: firstFailureAward
            ? [
                applyAbilityChange(
                  "debugging_diagnosis",
                  "调试诊断",
                  2,
                  "完成了失败用例与首次分叉位置的定位。",
                ),
                applyAbilityChange(
                  "algorithmic_thinking",
                  "算法思维",
                  1,
                  "识别出访问、入队与去重之间的状态约束。",
                ),
              ]
            : [],
          plan_changes: [
            {
              label: "新增错因回看",
              detail: "在当前路径中插入 BFS visited 标记时机复盘。",
            },
          ],
          review_changes: [
            {
              id: `submission-review-${submissionId}`,
              title: "BFS visited 标记时机",
              scheduled_for: dateAfterDays(1),
              minutes: 8,
              reason: "根据本次失败用例自动安排。",
            },
          ],
        };
    if (firstPassForNode) abilityAwards.add(`${taskId}:passed`);
    if (firstFailureAward) abilityAwards.add(`${taskId}:failed`);

    const failedLabels = runResult.test_cases
      .filter((testCase) => testCase.status !== "passed")
      .map((testCase) => testCase.label);
    const evidence: Evidence[] = [
      {
        evidence_id: `evidence_test_${String(submissionCount).padStart(3, "0")}`,
        type: "test_result",
        label: passed ? "全部评测通过" : "评测存在失败用例",
        summary: passed
          ? `${evaluation.total_count} 个评测用例均通过；来源：${runResult.evaluator_label}。`
          : `${failedLabels.join("、")}未通过，客观结果为 ${evaluation.passed_count}/${evaluation.total_count}；来源：${runResult.evaluator_label}。`,
        source_ref: evaluation.evaluation_id,
        created_at: nowIso(),
      },
    ];

    if (passed && node.status !== "validation_ready" && node.status !== "mastered") {
      node.status = "validation_ready";
      node.recommended_reason = "代码任务已通过，等待无提示的新任务独立验证。";
      state.learning_state_version += 1;
      const planItem = state.plan_items.find((item) => item.learning_node_id === node.learning_node_id);
      if (planItem) {
        planItem.status = "validation_ready";
        planItem.recommended_reason = "修复任务已通过，下一步完成独立迁移验证。";
      }
    }

    if (!passed) {
      diagnosisCount += 1;
      diagnosisId = `diag_${String(diagnosisCount).padStart(3, "0")}`;
      const knownRootCause = runResult.detected_variant === "visited-on-dequeue";
      const diagnosis: Diagnosis = {
        diagnosis_id: diagnosisId,
        run_id: `run_diag_${String(diagnosisCount).padStart(3, "0")}`,
        submission_id: submissionId,
        concept_id: "concept_bfs_visited",
        observations: [
          {
            text: `${failedLabels.join("、")}未通过，当前客观结果为 ${evaluation.passed_count}/${evaluation.total_count}（来源：${runResult.evaluator_label}）。`,
            evidence_ids: [evidence[0]!.evidence_id],
          },
        ],
        primary_hypothesis: knownRootCause
          ? {
              code: "BFS_VISITED_MARK_TOO_LATE",
              summary:
                "结构分析显示 visited 在出队后才更新，汇聚边会让邻接顶点在此前被重复加入队列。",
              confidence: 0.85,
              confidence_level: "high",
              evidence_ids: [evidence[0]!.evidence_id],
            }
          : {
              code: "BFS_BEHAVIOR_MISMATCH",
              summary:
                "输出与预期访问序不一致，规则分析未能锁定具体成因；请结合失败用例与运行轨迹进一步核对。",
              confidence: 0.4,
              confidence_level: "low",
              evidence_ids: [evidence[0]!.evidence_id],
            },
        alternative_hypotheses: [],
        citation_ids: knownRootCause ? ["source_ds_book_143"] : [],
        next_action: knownRootCause
          ? {
              type: "hint",
              hint_level: 1,
              label: "观察 visited 在入队前后的变化",
            }
          : {
              type: "review",
              hint_level: null,
              label: "对照失败用例回放运行轨迹",
            },
        agent_version: "rule-diagnosis-v1",
        created_at: nowIso(),
      };
      diagnoses.set(diagnosisId, diagnosis);

      const mistake: MistakeRecord = {
        mistake_id: `mistake_${String(diagnosisCount).padStart(3, "0")}`,
        submission_id: submissionId,
        diagnosis_id: diagnosisId,
        learning_node_id: node.learning_node_id,
        title: knownRootCause ? "BFS visited 标记时机" : "BFS 输出与预期不一致",
        summary: knownRootCause
          ? "顶点出队后才标记，导致同一顶点可能重复入队。"
          : `${failedLabels.join("、")}未通过，成因待结合运行轨迹确认。`,
        status: "needs_review",
        created_at: nowIso(),
      };
      mistakes.set(mistake.mistake_id, mistake);

      const planItem = state.plan_items.find((item) => item.learning_node_id === node.learning_node_id);
      if (planItem && !planItem.based_on_diagnosis_ids.includes(diagnosisId)) {
        planItem.based_on_diagnosis_ids.push(diagnosisId);
      }
    }

    const record: SubmissionRecord = {
      submission_id: submissionId,
      sequence: submissionCount,
      task_id: taskId,
      task_version: input.task_version,
      status: "completed",
      code: { ...input.code },
      hint_usage_ids: [...input.hint_usage_ids],
      evaluation,
      evidence,
      diagnosis_id: diagnosisId,
      learning_node_status: node.status,
      learning_state_version: state.learning_state_version,
      validation_id: passed ? "task_bfs_transfer_001" : null,
      learning_update: learningUpdate,
      created_at: nowIso(),
    };

    submissions.set(submissionId, record);
    idempotentSubmissions.set(idempotencyKey, record);
    notifyChange();
    return { ok: true, replayed: false, data: record };
  }

  async function submitValidation(
    validationId: string,
    input: ValidationInput,
    idempotencyKey: string,
  ): Promise<FlowResult<ValidationAttempt>> {
    const replay = idempotentValidations.get(idempotencyKey);
    if (replay) return { ok: true, replayed: true, data: replay };
    const pending = pendingValidations.get(idempotencyKey);
    if (pending) {
      const settled = await pending;
      return settled.ok ? { ...settled, replayed: true } : settled;
    }

    const execution = executeValidation(validationId, input, idempotencyKey);
    pendingValidations.set(idempotencyKey, execution);
    try {
      return await execution;
    } finally {
      pendingValidations.delete(idempotencyKey);
    }
  }

  async function executeValidation(
    validationId: string,
    input: ValidationInput,
    idempotencyKey: string,
  ): Promise<FlowResult<ValidationAttempt>> {
    const task = state.tasks.get(validationId);
    if (!task || !task.is_independent_validation) {
      return {
        ok: false,
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        message: "独立验证任务不存在。",
        retryable: false,
        details: {},
      };
    }
    if (input.task_version !== task.version) {
      return {
        ok: false,
        statusCode: 409,
        code: "CONFLICTING_VERSION",
        message: "验证任务版本已更新，请刷新后重试。",
        retryable: true,
        details: { current_task_version: task.version },
      };
    }
    if (input.expected_learning_state_version !== state.learning_state_version) {
      return {
        ok: false,
        statusCode: 409,
        code: "CONFLICTING_VERSION",
        message: "学习状态已更新，请刷新后重新提交验证。",
        retryable: true,
        details: { current_learning_state_version: state.learning_state_version },
      };
    }

    const node = bfsNode();
    if (node.status !== "validation_ready") {
      return {
        ok: false,
        statusCode: 409,
        code: "VALIDATION_NOT_READY",
        message: "请先通过当前代码任务，再进行独立验证。",
        retryable: false,
        details: { current_node_status: node.status },
      };
    }

    const runResult = await codeEvaluator.evaluate(validationId, {
      language: input.code.language,
      source: input.code.source,
      custom_input: null,
    });
    if (runResult.status === "compile_error") {
      return {
        ok: false,
        statusCode: 422,
        code: "COMPILATION_ERROR",
        message: runResult.stderr ?? "代码未通过编译。",
        retryable: false,
        details: { error_line: runResult.error_line },
      };
    }

    validationCount += 1;
    const previousStatus = node.status;
    const passed =
      runResult.status === "passed" &&
      runResult.total_count > 0 &&
      runResult.passed_count === runResult.total_count;
    if (passed) {
      node.status = "mastered";
      node.current_task_id = null;
      node.recommended_reason = "已通过无提示的新任务独立验证。";
      state.learning_state_version += 1;
      state.ability_scores.knowledge_understanding = Math.max(
        state.ability_scores.knowledge_understanding,
        88,
      );
      state.ability_scores.code_implementation = Math.max(
        state.ability_scores.code_implementation,
        78,
      );
      state.ability_scores.debugging_diagnosis = Math.max(
        state.ability_scores.debugging_diagnosis,
        76,
      );
      state.ability_scores.transfer_application = Math.max(
        state.ability_scores.transfer_application,
        74,
      );
      state.course.current_node_id = "node_dfs_001";
      state.course.progress_percent = 58;
      const planItem = state.plan_items.find((item) => item.learning_node_id === node.learning_node_id);
      if (planItem) {
        planItem.status = "mastered";
        planItem.recommended_reason = "独立验证首次通过。";
      }
      const dfsNode = state.nodes.find((item) => item.learning_node_id === "node_dfs_001");
      if (dfsNode) {
        dfsNode.status = "in_progress";
        dfsNode.recommended_reason = "BFS 已通过独立验证，下一步比较两种遍历策略。";
      }
      const dfsPlanItem = state.plan_items.find(
        (item) => item.learning_node_id === "node_dfs_001",
      );
      if (dfsPlanItem) {
        dfsPlanItem.status = "in_progress";
        dfsPlanItem.recommended_reason = "BFS 已掌握，进入 DFS 对比学习。";
      }
      for (const mistake of mistakes.values()) {
        if (mistake.learning_node_id === node.learning_node_id) {
          mistake.status = "resolved";
        }
      }
    }

    const attempt: ValidationAttempt = {
      validation_attempt_id: `val_attempt_${String(validationCount).padStart(3, "0")}`,
      validation_id: validationId,
      passed,
      previous_node_status: previousStatus,
      current_node_status: node.status,
      next_recommended_node_id: passed ? "node_dfs_001" : "node_bfs_001",
      state_change_reason: passed
        ? `独立验证任务通过（${runResult.passed_count}/${runResult.total_count}，来源：${runResult.evaluator_label}）。`
        : `独立验证未通过（${runResult.passed_count}/${runResult.total_count}，来源：${runResult.evaluator_label}），保持待验证状态。`,
      learning_state_version: state.learning_state_version,
      evaluation: {
        passed_count: runResult.passed_count,
        total_count: runResult.total_count,
        execution_mode: runResult.execution_mode,
        evaluator_label: runResult.evaluator_label,
        test_cases: runResult.test_cases.map((testCase) => ({
          test_case_id: testCase.test_case_id,
          label: testCase.label,
          status:
            testCase.status === "passed"
              ? "passed"
              : testCase.status === "failed"
                ? "failed"
                : "error",
          duration_ms: testCase.duration_ms,
          memory_kb: testCase.memory_kb,
        })),
      },
      created_at: nowIso(),
    };
    idempotentValidations.set(idempotencyKey, attempt);
    notifyChange();
    return { ok: true, replayed: false, data: attempt };
  }

  return {
    submitTask,
    submitValidation,
    getSubmission: (submissionId: string) => submissions.get(submissionId),
    listSubmissions: (taskId: string): SubmissionHistoryItem[] =>
      [...submissions.values()]
        .filter((submission) => submission.task_id === taskId)
        .sort((left, right) => right.sequence - left.sequence)
        .map((submission) => ({
          submission_id: submission.submission_id,
          task_id: submission.task_id,
          sequence: submission.sequence,
          created_at: submission.created_at,
          code: { ...submission.code },
          evaluation: {
            passed_count: submission.evaluation.passed_count,
            total_count: submission.evaluation.total_count,
            score: submission.evaluation.score,
          },
          diagnosis_id: submission.diagnosis_id,
        })),
    getEvidence: (submissionId: string) => submissions.get(submissionId)?.evidence,
    getDiagnosis: (diagnosisId: string) => diagnoses.get(diagnosisId),
    listMistakes: () => [...mistakes.values()].reverse(),
    setOnChange: (callback: (() => void) | null) => {
      onChange = callback;
    },
    snapshot: (): DemoFlowSnapshot => ({
      submissions: [...submissions.entries()],
      diagnoses: [...diagnoses.entries()],
      mistakes: [...mistakes.entries()],
      idempotentSubmissions: [...idempotentSubmissions.entries()],
      idempotentValidations: [...idempotentValidations.entries()],
      abilityAwards: [...abilityAwards.values()],
      submissionCount,
      diagnosisCount,
      validationCount,
    }),
    restore: (data: DemoFlowSnapshot) => {
      submissions.clear();
      for (const [key, value] of data.submissions) submissions.set(key, value);
      diagnoses.clear();
      for (const [key, value] of data.diagnoses) diagnoses.set(key, value);
      mistakes.clear();
      for (const [key, value] of data.mistakes) mistakes.set(key, value);
      idempotentSubmissions.clear();
      for (const [key, value] of data.idempotentSubmissions) {
        idempotentSubmissions.set(key, value);
      }
      idempotentValidations.clear();
      for (const [key, value] of data.idempotentValidations) {
        idempotentValidations.set(key, value);
      }
      abilityAwards.clear();
      for (const value of data.abilityAwards) abilityAwards.add(value);
      submissionCount = data.submissionCount;
      diagnosisCount = data.diagnosisCount;
      validationCount = data.validationCount;
    },
  };
}

export type DemoFlow = ReturnType<typeof createDemoFlow>;
