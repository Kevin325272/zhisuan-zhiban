import { describe, expect, it } from "vitest";

import {
  onboardingLearningTaskSchema,
  studentLearningOrchestrationSchema,
  studentLearningOrchestrationTaskSchema,
  studentLearningPlanTaskProgressSchema,
  studentLearningTaskCompletionRequestSchema,
  studentLearningTaskCompletionSchema,
  studentLearningTaskSettlementSchema,
} from "../src/index.js";

const currentTask = {
  task_id: "live_mistake_001",
  source: "mistake" as const,
  task_type: "mistake_review" as const,
  course_id: "course_408_ds" as const,
  course_title: "数据结构",
  concept_id: "ds_c02_02",
  concept_title: "顺序表",
  mistake_id: "mistake_001",
  probe_session_id: null,
  title: "复习顺序表错题",
  reason: "最近一次确定性选择题评测为错误，先完成可追溯复习。",
  completion_criteria: "重练后明确标记为已掌握。",
  estimated_minutes: 20,
  href: "/student/mistakes?course_id=course_408_ds&concept_id=ds_c02_02",
  practice_question_count: 3,
  evidence_refs: ["mistake:mistake_001", "evaluation:evaluation_001"],
};

const settlementNextTask = {
  task_id: currentTask.task_id,
  task_type: currentTask.task_type,
  course_id: currentTask.course_id,
  course_title: currentTask.course_title,
  concept_id: currentTask.concept_id,
  concept_title: currentTask.concept_title,
  title: currentTask.title,
  reason: currentTask.reason,
  estimated_minutes: currentTask.estimated_minutes,
  href: currentTask.href,
};

const snapshot = {
  generated_at: "2026-08-12T00:00:00.000Z",
  source: "deterministic_evidence_rules" as const,
  ai_status: "unavailable" as const,
  ai_status_message: "AI 学习编排尚未接入，当前任务由可验证学习证据确定。",
  goal_context: {
    target_exam_year: 2027,
    preparation_stage: "foundation" as const,
    daily_minutes: 90,
    target_school: null,
    target_score: 120,
  },
  evidence_summary: {
    basis: "live_evidence" as const,
    confidence: "developing" as const,
    objective_evidence_count: 4,
    subjective_evidence_count: 4,
    reading_progress_count: 1,
    practice_attempt_count: 3,
    needs_review_count: 1,
    explanation: "当前判断结合 1 条阅读位置和 3 次真实作答。",
    evidence_refs: ["reading:course_408_ds:ds_c02_02", "attempts:3"],
  },
  plan_progress: {
    plan_id: "plan_001",
    completed_task_count: 1,
    total_task_count: 7,
    completion_percent: 14,
    tasks: Array.from({ length: 7 }, (_, index) => ({
      task_id: `task_${index + 1}`,
      day_index: index + 1,
      task_date: `2026-08-${String(12 + index).padStart(2, "0")}`,
      course_id: "course_408_ds" as const,
      course_title: "数据结构",
      concept_id: `ds_c02_0${index + 1}`,
      concept_title: `知识点 ${index + 1}`,
      task_type: "course_reading" as const,
      title: `第 ${index + 1} 天学习任务`,
      estimated_minutes: 30,
      href: "/student/courses/data-structures",
      status: index === 0 ? "completed" as const : "pending" as const,
      completion_evidence_refs: index === 0 ? ["reading:course_408_ds:ds_c02_01"] : [],
    })),
  },
  challenge_journey: {
    current_stage_label: "数据结构 · 线性表",
    current_node_id: "challenge_current_mistake_001",
    nodes: [
      {
        node_id: "challenge_completed_ds_c02_01",
        task_id: "task_1",
        kind: "course_reading" as const,
        status: "completed" as const,
        course_id: "course_408_ds" as const,
        course_title: "数据结构",
        concept_id: "ds_c02_01",
        title: "线性表的基本概念",
        href: "/student/courses/data-structures?concept_id=ds_c02_01",
      },
      {
        node_id: "challenge_current_mistake_001",
        task_id: "live_mistake_001",
        kind: "mistake_review" as const,
        status: "review_due" as const,
        course_id: "course_408_ds" as const,
        course_title: "数据结构",
        concept_id: "ds_c02_02",
        title: "复习顺序表错题",
        href: "/student/mistakes?course_id=course_408_ds&concept_id=ds_c02_02",
      },
      {
        node_id: "challenge_available_ds_c02_03",
        task_id: "task_3",
        kind: "choice_practice" as const,
        status: "available" as const,
        course_id: "course_408_ds" as const,
        course_title: "数据结构",
        concept_id: "ds_c02_03",
        title: "练习线性表的链式表示",
        href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_03",
      },
    ],
    recent_activity: {
      completed_day_count: 2,
      days: [
        { date: "2026-08-06", completed: false },
        { date: "2026-08-07", completed: false },
        { date: "2026-08-08", completed: true },
        { date: "2026-08-09", completed: false },
        { date: "2026-08-10", completed: false },
        { date: "2026-08-11", completed: true },
        { date: "2026-08-12", completed: false },
      ],
    },
    profile_updates: [
      {
        update_id: "profile_update_mistake_001",
        course_id: "course_408_ds" as const,
        course_title: "数据结构",
        kind: "mistake" as const,
        occurred_at: "2026-08-11T08:00:00.000Z",
        title: "顺序表进入待复习队列",
        detail: "最近的确定性选择题评测形成了 1 个待复习项，因此本关优先安排错题返场。",
      },
    ],
  },
  current_task: currentTask,
  course_priorities: [
    ["course_408_ds", "数据结构", "/student/courses/data-structures"],
    ["course_408_co", "计算机组成原理", "/student/courses/computer-organization"],
    ["course_408_os", "操作系统", "/student/courses/operating-systems"],
    ["course_408_cn", "计算机网络", "/student/courses/computer-networks"],
  ].map(([course_id, course_title, href], index) => ({
    rank: index + 1,
    course_id,
    course_title,
    priority: index === 0 ? "focus" as const : index === 1 ? "strengthen" as const : "maintain" as const,
    evidence_level: index === 0 ? "grounded" as const : "self_report_only" as const,
    rationale: index === 0 ? "存在一条待复习错题。" : "暂按首次设置保留学习顺序。",
    started_concept_count: index === 0 ? 2 : 0,
    concept_count: 10,
    practice_attempt_count: index === 0 ? 3 : 0,
    needs_review_count: index === 0 ? 1 : 0,
    href,
  })),
  boundary_note: "当前结果只描述已存储学习证据，不代表分数、排名、录取概率或提分效果。",
};

describe("student learning orchestration contract", () => {
  it("rejects case-review tasks until a persisted completion-evidence path exists", () => {
    const unsupportedTask = {
      ...currentTask,
      source: "initial_plan",
      task_type: "case_review",
      mistake_id: null,
    };
    const unsupportedOnboardingTask = {
      task_id: "task_case_review",
      day_index: 1,
      task_date: "2026-08-12",
      order: 1,
      course_id: "course_408_ds",
      course_title: "数据结构",
      concept_id: "ds_c02_02",
      concept_title: "顺序表",
      task_type: "case_review",
      estimated_minutes: 20,
      title: "案例理解",
      reason: "当前契约测试占位。",
      completion_criteria: "完成案例理解。",
      href: "/student/courses/data-structures",
      evidence_refs: ["source:chunk_001"],
      status: "pending",
    };
    const unsupportedSettlement = {
      version: "challenge_settlement_v1",
      task_type: "case_review",
      course_id: "course_408_ds",
      course_title: "数据结构",
      concept_id: "ds_c02_02",
      concept_title: "顺序表",
      outcome: "completed",
      result_title: "案例已完成",
      result_detail: "案例完成说明。",
      evidence_update: { added_count: 1, objective_total: 1, summary: "新增案例证据。" },
      profile_update: { kind: "learning_progress", title: "进度更新", detail: "案例进度更新。" },
      review_update: {
        status: "not_applicable",
        mistake_id: null,
        next_review_at: null,
        summary: "不涉及错题复习。",
      },
      plan_progress: {
        tracked: true,
        completed_task_count: 1,
        total_task_count: 7,
        completion_percent: 14,
      },
      next_task: null,
    };
    const unsupportedProgressTask = {
      task_id: "task_case_review",
      day_index: 1,
      task_date: "2026-08-12",
      course_id: "course_408_ds",
      course_title: "数据结构",
      concept_id: "ds_c02_02",
      concept_title: "顺序表",
      task_type: "case_review",
      title: "案例理解",
      estimated_minutes: 20,
      href: "/student/courses/data-structures",
      status: "pending",
      completion_evidence_refs: [],
    };

    expect(studentLearningOrchestrationTaskSchema.safeParse(unsupportedTask).success).toBe(false);
    expect(onboardingLearningTaskSchema.safeParse(unsupportedOnboardingTask).success).toBe(false);
    expect(studentLearningTaskSettlementSchema.safeParse(unsupportedSettlement).success).toBe(false);
    expect(studentLearningPlanTaskProgressSchema.safeParse(unsupportedProgressTask).success).toBe(false);
  });

  it("accepts one evidence-driven current task and a four-course priority view", () => {
    const parsed = studentLearningOrchestrationSchema.parse(snapshot);

    expect(parsed.current_task.task_id).toBe("live_mistake_001");
    expect(parsed.challenge_journey.nodes.find((node) => (
      node.node_id === parsed.challenge_journey.current_node_id
    ))?.task_id).toBe(parsed.current_task.task_id);
    expect(parsed.challenge_journey.recent_activity.days).toHaveLength(7);
    expect(parsed.challenge_journey.profile_updates[0]).not.toHaveProperty("evidence_refs");
    expect(parsed.course_priorities).toHaveLength(4);
    expect(parsed.plan_progress.completed_task_count).toBe(1);
  });

  it("rejects a journey whose current node does not represent the current task", () => {
    expect(studentLearningOrchestrationSchema.safeParse({
      ...snapshot,
      challenge_journey: {
        ...snapshot.challenge_journey,
        current_node_id: "challenge_available_ds_c02_03",
      },
    }).success).toBe(false);
  });

  it("rejects a missing or multi-valued current task", () => {
    const { current_task: _removed, ...withoutCurrentTask } = snapshot;
    expect(studentLearningOrchestrationSchema.safeParse(withoutCurrentTask).success).toBe(false);
    expect(studentLearningOrchestrationSchema.safeParse({
      ...snapshot,
      current_task: [currentTask, { ...currentTask, task_id: "live_mistake_002" }],
    }).success).toBe(false);
  });

  it("forbids precise concept practice when no reliable question is linked", () => {
    expect(studentLearningOrchestrationSchema.safeParse({
      ...snapshot,
      current_task: {
        ...currentTask,
        source: "reading_progress",
        task_type: "choice_practice",
        mistake_id: null,
        practice_question_count: 0,
        href: "/student/practice?subject=数据结构&concept_id=ds_c02_02",
      },
    }).success).toBe(false);
  });

  it("accepts a completion request with only the task identity", () => {
    expect(studentLearningTaskCompletionRequestSchema.parse({
      task_id: "live_practice_ds_c01",
    })).toEqual({ task_id: "live_practice_ds_c01" });
    expect(studentLearningTaskCompletionRequestSchema.safeParse({
      task_id: "live_practice_ds_c01",
      evidence_refs: ["attempt:private"],
    }).success).toBe(false);
  });

  it("represents an idempotent, evidence-backed completion without answer data", () => {
    const parsed = studentLearningTaskCompletionSchema.parse({
      task_id: "live_practice_ds_c01",
      completed_at: "2026-08-13T08:00:00.000Z",
      evidence_refs: ["attempt:attempt_001"],
      idempotent: true,
      next_task_id: currentTask.task_id,
      settlement: {
        version: "challenge_settlement_v1",
        task_type: "choice_practice",
        course_id: "course_408_ds",
        course_title: "数据结构",
        concept_id: "ds_c02_02",
        concept_title: "顺序表",
        outcome: "incorrect",
        result_title: "本关已完成",
        result_detail: "本次选择题已按题库标准答案完成确定性判分。",
        evidence_update: {
          added_count: 1,
          objective_total: 4,
          summary: "新增 1 次确定性选择题作答。",
        },
        profile_update: {
          kind: "practice_review",
          title: "顺序表进入待复习队列",
          detail: "本次错误作答已形成复习信号，后续任务会优先安排相关复习。",
        },
        review_update: {
          status: "needs_review",
          mistake_id: "mistake_001",
          next_review_at: "2026-08-14T08:00:00.000Z",
          summary: "已加入错题复习，累计答错 1 次。",
        },
        plan_progress: {
          tracked: true,
          completed_task_count: 2,
          total_task_count: 7,
          completion_percent: 29,
        },
        next_task: settlementNextTask,
      },
    });
    expect(parsed.next_task_id).toBe(currentTask.task_id);
    expect(parsed.settlement.review_update.status).toBe("needs_review");
    expect(studentLearningTaskCompletionSchema.safeParse({
      ...parsed,
      correct_option_ids: ["A"],
    }).success).toBe(false);
  });

  it("keeps the next task and settlement aligned without fabricated profile scores", () => {
    const completion = {
      task_id: "live_practice_ds_c01",
      completed_at: "2026-08-13T08:00:00.000Z",
      evidence_refs: ["attempt:attempt_001"],
      idempotent: false,
      next_task_id: currentTask.task_id,
      settlement: {
        version: "challenge_settlement_v1",
        task_type: "choice_practice",
        course_id: "course_408_ds",
        course_title: "数据结构",
        concept_id: "ds_c02_02",
        concept_title: "顺序表",
        outcome: "correct",
        result_title: "本关已完成",
        result_detail: "本次选择题已按题库标准答案完成确定性判分。",
        evidence_update: {
          added_count: 1,
          objective_total: 4,
          summary: "新增 1 次确定性选择题作答。",
        },
        profile_update: {
          kind: "practice_correct",
          title: "新增一次正确作答",
          detail: "本次结果已计入画像，仍需后续证据观察稳定掌握。",
        },
        review_update: {
          status: "not_required",
          mistake_id: null,
          next_review_at: null,
          summary: "本次正确作答未新增待复习记录。",
        },
        plan_progress: {
          tracked: true,
          completed_task_count: 2,
          total_task_count: 7,
          completion_percent: 29,
        },
        next_task: settlementNextTask,
      },
    };

    expect(studentLearningTaskCompletionSchema.safeParse({
      ...completion,
      next_task_id: "different_task",
    }).success).toBe(false);
    expect(studentLearningTaskCompletionSchema.safeParse({
      ...completion,
      settlement: {
        ...completion.settlement,
        profile_score_delta: 8,
      },
    }).success).toBe(false);
  });
});
