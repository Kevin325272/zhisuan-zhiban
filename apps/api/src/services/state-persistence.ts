import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  abilityAssessmentKeySchema,
  diagnosisSchema,
  evaluationSchema,
  evidenceSchema,
  executionModeSchema,
  learningNodeStatusSchema,
  programmingLanguageSchema,
  type AbilityAssessmentKey,
  type LearningNode,
  type PlanItem,
} from "@xuetu/contracts";
import { z } from "zod";

import type { DemoState } from "../domain/demo-state.js";
import type { DemoFlow, DemoFlowSnapshot } from "./demo-flow.js";

/**
 * 单用户 JSON 快照持久化：只保存运行期可变状态（节点状态、计划、能力分、
 * 提交/诊断/错题记录），任务模板与知识库内容始终来自代码，避免陈旧数据覆盖新版本。
 */

interface PersistedNodeState {
  learning_node_id: string;
  status: LearningNode["status"];
  recommended_reason: string | null;
  current_task_id: string | null;
}

interface PersistedPlanItemState {
  plan_item_id: string;
  status: PlanItem["status"];
  recommended_reason: string;
  based_on_diagnosis_ids: string[];
}

export interface PersistedState {
  version: 1;
  saved_at: string;
  course: {
    progress_percent: number;
    current_node_id: string | null;
    updated_at: string;
  };
  nodes: PersistedNodeState[];
  plan_items: PersistedPlanItemState[];
  ability_scores: Record<AbilityAssessmentKey, number>;
  learning_state_version: number;
  flow: DemoFlowSnapshot;
}

const idSchema = z.string().min(1);
const isoDateTimeSchema = z.string().datetime();

const learningStateUpdateSchema = z.object({
  trigger: z.enum(["failed_submission", "passed_submission"]),
  title: z.string().min(1),
  ability_changes: z.array(
    z.object({
      key: abilityAssessmentKeySchema,
      label: z.string().min(1),
      before: z.number().min(0).max(100),
      after: z.number().min(0).max(100),
      delta: z.number(),
      reason: z.string().min(1),
    }),
  ),
  plan_changes: z.array(
    z.object({
      label: z.string().min(1),
      detail: z.string().min(1),
    }),
  ),
  review_changes: z.array(
    z.object({
      id: idSchema,
      title: z.string().min(1),
      scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
      minutes: z.number().int().positive(),
      reason: z.string().min(1),
    }),
  ),
});

const submissionRecordSchema = z.object({
  submission_id: idSchema,
  sequence: z.number().int().positive(),
  task_id: idSchema,
  task_version: z.number().int().positive(),
  status: z.literal("completed"),
  code: z.object({
    language: programmingLanguageSchema,
    source: z.string().min(1).max(20_000),
  }),
  hint_usage_ids: z.array(idSchema),
  evaluation: evaluationSchema,
  evidence: z.array(evidenceSchema),
  diagnosis_id: idSchema.nullable(),
  learning_node_status: learningNodeStatusSchema,
  learning_state_version: z.number().int().nonnegative(),
  validation_id: idSchema.nullable(),
  learning_update: learningStateUpdateSchema,
  created_at: isoDateTimeSchema,
});

const mistakeRecordSchema = z.object({
  mistake_id: idSchema,
  submission_id: idSchema,
  diagnosis_id: idSchema,
  learning_node_id: idSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  status: z.enum(["needs_review", "resolved"]),
  created_at: isoDateTimeSchema,
});

const validationAttemptSchema = z.object({
  validation_attempt_id: idSchema,
  validation_id: idSchema,
  passed: z.boolean(),
  previous_node_status: learningNodeStatusSchema,
  current_node_status: learningNodeStatusSchema,
  next_recommended_node_id: idSchema,
  state_change_reason: z.string().min(1),
  learning_state_version: z.number().int().nonnegative(),
  evaluation: z.object({
    passed_count: z.number().int().nonnegative(),
    total_count: z.number().int().positive(),
    execution_mode: executionModeSchema,
    evaluator_label: z.string().min(1),
    test_cases: z.array(
      z.object({
        test_case_id: idSchema,
        label: z.string().min(1),
        status: z.enum(["passed", "failed", "error"]),
        duration_ms: z.number().int().nonnegative().nullable(),
        memory_kb: z.number().int().nonnegative().nullable(),
      }),
    ),
  }),
  created_at: isoDateTimeSchema,
});

const flowSnapshotSchema = z.object({
  submissions: z.array(z.tuple([idSchema, submissionRecordSchema])),
  diagnoses: z.array(z.tuple([idSchema, diagnosisSchema])),
  mistakes: z.array(z.tuple([idSchema, mistakeRecordSchema])),
  idempotentSubmissions: z.array(z.tuple([idSchema, submissionRecordSchema])),
  idempotentValidations: z.array(z.tuple([idSchema, validationAttemptSchema])),
  abilityAwards: z.array(idSchema),
  submissionCount: z.number().int().nonnegative(),
  diagnosisCount: z.number().int().nonnegative(),
  validationCount: z.number().int().nonnegative(),
});

const persistedStateSchema = z.object({
  version: z.literal(1),
  saved_at: isoDateTimeSchema,
  course: z.object({
    progress_percent: z.number().min(0).max(100),
    current_node_id: idSchema.nullable(),
    updated_at: isoDateTimeSchema,
  }),
  nodes: z.array(
    z.object({
      learning_node_id: idSchema,
      status: learningNodeStatusSchema,
      recommended_reason: z.string().min(1).nullable(),
      current_task_id: idSchema.nullable(),
    }),
  ),
  plan_items: z.array(
    z.object({
      plan_item_id: idSchema,
      status: learningNodeStatusSchema,
      recommended_reason: z.string().min(1),
      based_on_diagnosis_ids: z.array(idSchema),
    }),
  ),
  ability_scores: z.record(abilityAssessmentKeySchema, z.number().min(0).max(100)),
  learning_state_version: z.number().int().nonnegative(),
  flow: flowSnapshotSchema,
});

function quarantineSnapshot(filePath: string) {
  try {
    renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
  } catch {
    // 无法移动时保留原文件，下一次启动仍会安全忽略。
  }
}

export function buildPersistedState(state: DemoState, flow: DemoFlow): PersistedState {
  return {
    version: 1,
    saved_at: new Date().toISOString(),
    course: {
      progress_percent: state.course.progress_percent,
      current_node_id: state.course.current_node_id,
      updated_at: state.course.updated_at,
    },
    nodes: state.nodes.map((node) => ({
      learning_node_id: node.learning_node_id,
      status: node.status,
      recommended_reason: node.recommended_reason,
      current_task_id: node.current_task_id,
    })),
    plan_items: state.plan_items.map((item) => ({
      plan_item_id: item.plan_item_id,
      status: item.status,
      recommended_reason: item.recommended_reason,
      based_on_diagnosis_ids: [...item.based_on_diagnosis_ids],
    })),
    ability_scores: { ...state.ability_scores },
    learning_state_version: state.learning_state_version,
    flow: flow.snapshot(),
  };
}

export function loadPersistedState(filePath: string): PersistedState | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = persistedStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      quarantineSnapshot(filePath);
      return null;
    }
    return parsed.data as PersistedState;
  } catch {
    // 快照损坏时保留现场并从演示基线重新开始，不让启动失败。
    quarantineSnapshot(filePath);
    return null;
  }
}

export function applyPersistedState(
  state: DemoState,
  flow: DemoFlow,
  data: PersistedState,
) {
  state.course.progress_percent = data.course.progress_percent;
  state.course.current_node_id = data.course.current_node_id;
  state.course.updated_at = data.course.updated_at;
  for (const saved of data.nodes) {
    const node = state.nodes.find(
      (item) => item.learning_node_id === saved.learning_node_id,
    );
    if (!node) continue;
    node.status = saved.status;
    node.recommended_reason = saved.recommended_reason;
    node.current_task_id = saved.current_task_id;
  }
  for (const saved of data.plan_items) {
    const item = state.plan_items.find(
      (candidate) => candidate.plan_item_id === saved.plan_item_id,
    );
    if (!item) continue;
    item.status = saved.status;
    item.recommended_reason = saved.recommended_reason;
    item.based_on_diagnosis_ids = [...saved.based_on_diagnosis_ids];
  }
  for (const key of Object.keys(state.ability_scores) as AbilityAssessmentKey[]) {
    const value = data.ability_scores?.[key];
    if (typeof value === "number") state.ability_scores[key] = value;
  }
  state.learning_state_version = data.learning_state_version;
  flow.restore(data.flow);
}

export function createStatePersister(
  filePath: string,
  state: DemoState,
  flow: DemoFlow,
  options: { debounceMs?: number } = {},
) {
  const debounceMs = options.debounceMs ?? 200;
  let timer: NodeJS.Timeout | null = null;

  function writeNow() {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      const payload = JSON.stringify(buildPersistedState(state, flow));
      const temporaryPath = `${filePath}.tmp`;
      writeFileSync(temporaryPath, payload, "utf8");
      renameSync(temporaryPath, filePath);
    } catch (error) {
      console.error("[xuetu] 学习状态落盘失败：", error);
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(writeNow, debounceMs);
    timer.unref?.();
  }

  return { schedule, flush: writeNow };
}
