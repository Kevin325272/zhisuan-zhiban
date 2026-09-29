import { describe, expect, it } from "vitest";

import {
  ONBOARDING_COURSE_IDS,
  onboardingGoalInputSchema,
  onboardingDiagnosticAnswerSchema,
  onboardingDiagnosticQuestionSetResponseSchema,
  onboardingInitialProfileSchema,
  onboardingLearningPlanSchema,
  onboardingSelfAssessmentsUpdateSchema,
  onboardingStateSchema,
  onboardingStatusSchema,
  onboardingStepSchema,
} from "../src/index.js";

describe("student onboarding contracts", () => {
  it("requires a bounded diagnostic step after the four-course self assessment", () => {
    expect(onboardingStatusSchema.options).toEqual(["not_started", "in_progress", "completed"]);
    expect(onboardingStepSchema.options).toEqual(["goals", "self_assessment", "diagnostic", "profile", "plan"]);
    expect(ONBOARDING_COURSE_IDS).toEqual([
      "course_408_ds",
      "course_408_co",
      "course_408_os",
      "course_408_cn",
    ]);

    const answer = onboardingDiagnosticAnswerSchema.parse({
      question_id: "2025-02",
      response_status: "unsure",
      selected_option_ids: [],
    });
    expect(answer.response_status).toBe("unsure");

    const questionSet = onboardingDiagnosticQuestionSetResponseSchema.parse({
      set_version: "408-v2",
      summary: { total_count: 8, saved_count: 0, completed_at: null },
      items: Array.from({ length: 8 }, (_, index) => ({
        ordinal: index + 1,
        course_id: ONBOARDING_COURSE_IDS[Math.floor(index / 2)]!,
        course_title: `课程 ${index + 1}`,
        response_status: null,
        selected_option_ids: [],
        question: {
          id: `question_${index + 1}`,
          year: 2025,
          number: index + 1,
          subject: "数据结构",
          type: "choice",
          multiple: false,
          question: "题目内容",
          options: [
            { option_id: "A", text: "选项 A", assets: [] },
            { option_id: "B", text: "选项 B", assets: [] },
          ],
          tags: [],
          assets: [],
          content_format: "plain_text",
          source: {
            provider: "test",
            dataset_id: "test",
            source_url: "https://example.com/question",
            license_status: "unverified",
            usage_scope: "local_demo_only",
          },
        },
      })),
    });
    expect(questionSet.items).toHaveLength(8);
  });

  it("validates goal constraints and exactly one self-assessment per course", () => {
    expect(onboardingGoalInputSchema.safeParse({
      target_exam_year: 2027,
      preparation_stage: "foundation",
      daily_minutes: 90,
      target_school: "某目标院校",
      target_score: 115,
    }).success).toBe(true);

    const items = ONBOARDING_COURSE_IDS.map((course_id) => ({
      course_id,
      level: "average" as const,
    }));
    expect(onboardingSelfAssessmentsUpdateSchema.parse({ items }).items).toHaveLength(4);
    expect(onboardingSelfAssessmentsUpdateSchema.safeParse({ items: items.slice(0, 3) }).success).toBe(false);
    expect(onboardingSelfAssessmentsUpdateSchema.safeParse({ items: [items[0], items[0], items[2], items[3]] }).success).toBe(false);
  });

  it("keeps the initial direction explicitly self-reported with zero objective evidence", () => {
    const parsed = onboardingInitialProfileSchema.parse({
      profile_id: "profile_1",
      version: 1,
      confidence: "low",
      evidence_status: "accumulating",
      confidence_explanation: "目前只依据学习设置形成起步方向，客观学习证据正在积累。",
      generated_at: "2026-08-11T00:00:00.000Z",
      objective_evidence_count: 0,
      subjective_evidence_count: 4,
      priority_courses: ONBOARDING_COURSE_IDS.map((course_id, index) => ({
        course_id,
        course_title: `课程 ${index + 1}`,
        priority: index === 0 ? "focus" : index === 1 ? "strengthen" : "maintain",
        self_assessment: "average",
        evidence_level: "self_report_only",
        evidence_refs: [`self:${course_id}`],
        rationale: "当前仅依据学生自评安排起步顺序。",
      })),
      boundary_note: "这不是能力测评，不代表分数、排名、录取概率或提分效果。",
    });

    expect(parsed.evidence_status).toBe("accumulating");
    expect(parsed.objective_evidence_count).toBe(0);
    expect(onboardingInitialProfileSchema.safeParse({ ...parsed, objective_evidence_count: 1 }).success).toBe(false);
    expect(onboardingInitialProfileSchema.safeParse({ ...parsed, confidence: "high" }).success).toBe(false);
    expect(onboardingInitialProfileSchema.safeParse({
      ...parsed,
      priority_courses: parsed.priority_courses.map((course, index) => (
        index === 0 ? { ...course, answered_count: 2 } : course
      )),
    }).success).toBe(false);
  });

  it("requires seven bounded days of real, navigable learning tasks", () => {
    const tasks = Array.from({ length: 7 }, (_, index) => ({
      task_id: `task_${index + 1}`,
      day_index: index + 1,
      task_date: `2026-08-${String(11 + index).padStart(2, "0")}`,
      order: 1,
      course_id: ONBOARDING_COURSE_IDS[index % 4],
      course_title: "数据结构",
      concept_id: "ds_c03_01",
      concept_title: "栈的抽象与存储",
      task_type: "course_reading" as const,
      estimated_minutes: 30,
      title: "理解栈的抽象与存储",
      reason: "根据当前学习阶段和课程自评安排。",
      completion_criteria: "完成知识点阅读并进入一次训练。",
      href: "/student/courses/data-structures",
      evidence_refs: ["self:course_408_ds"],
      status: "pending" as const,
    }));
    const parsed = onboardingLearningPlanSchema.parse({
      plan_id: "plan_1",
      version: 1,
      source: "deterministic_fallback",
      ai_status: "unavailable",
      ai_status_message: "个性化解释服务待连接，当前使用可验证基础路径。",
      start_date: "2026-08-11",
      daily_minutes: 60,
      generated_at: "2026-08-11T00:00:00.000Z",
      tasks,
      today_task_id: "task_1",
    });
    expect(parsed.tasks).toHaveLength(7);
    expect(Math.max(...parsed.tasks.map((task) => task.estimated_minutes))).toBeLessThanOrEqual(60);
  });

  it("keeps diagnostic summary bounded and rejects browser-owned ids or hidden scoring fields", () => {
    const state = {
      status: "not_started",
      current_step: "goals",
      goals: null,
      self_assessments: [],
      profile: null,
      plan: null,
      updated_at: "2026-08-11T00:00:00.000Z",
    } as const;
    expect(onboardingStateSchema.safeParse(state).success).toBe(true);
    expect(onboardingStateSchema.safeParse({ ...state, user_id: "other_student" }).success).toBe(false);
    expect(onboardingStateSchema.safeParse({
      ...state,
      diagnostic: { total_count: 8, saved_count: 0, completed_at: null },
    }).success).toBe(true);
    expect(onboardingStateSchema.safeParse({
      ...state,
      diagnostic: { total_count: 8, saved_count: 0, completed_at: null, correct_count: 8 },
    }).success).toBe(false);
  });
});
