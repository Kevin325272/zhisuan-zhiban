import { describe, expect, it } from "vitest";

import type { OnboardingCourseId, OnboardingSelfAssessmentLevel } from "@xuetu/contracts";

import {
  buildDeterministicOnboardingResult,
  type OnboardingCourseResource,
} from "../src/services/onboarding/deterministic-onboarding-planner.js";

const resources: OnboardingCourseResource[] = [
  ["course_408_ds", "数据结构", "数据结构", "/student/courses/data-structures", "ds_c03_01", "栈的抽象与存储"],
  ["course_408_co", "计算机组成原理", "组成原理", "/student/courses/computer-organization", "co_c06_03", "补码加减与溢出判断"],
  ["course_408_os", "操作系统", "操作系统", "/student/courses/operating-systems", "os_c05_03", "页面置换算法"],
  ["course_408_cn", "计算机网络", "计算机网络", "/student/courses/computer-networks", "cn_c06_01", "DNS 层次命名与解析"],
].map(([courseId, courseTitle, subject, courseHref, conceptId, conceptTitle]) => ({
  courseId,
  courseTitle,
  subject,
  courseHref,
  fallbackConcept: {
    conceptId,
    conceptTitle,
    practiceQuestionCount: 2,
  },
})) as OnboardingCourseResource[];

function assessments(overrides: Partial<Record<string, OnboardingSelfAssessmentLevel>> = {}) {
  return resources.map((course) => ({
    course_id: course.courseId,
    level: overrides[course.courseId] ?? "average",
  }));
}

function build(input: {
  assessmentOverrides?: Partial<Record<string, OnboardingSelfAssessmentLevel>>;
  dailyMinutes?: number;
  practiceQuestionCount?: number;
  now?: Date;
  screening?: Array<{
    courseId: OnboardingCourseId;
    answeredCount: number;
    correctCount: number;
    incorrectCount: number;
    unsureCount: number;
    skippedCount: number;
    riskConcepts: Array<{ conceptId: string; conceptTitle: string; questionId: string }>;
  }>;
} = {}) {
  let id = 0;
  return buildDeterministicOnboardingResult({
    goals: {
      target_exam_year: 2027,
      preparation_stage: "foundation",
      daily_minutes: input.dailyMinutes ?? 60,
      target_school: null,
      target_score: 110,
      saved_at: "2026-08-12T00:00:00.000Z",
    },
    selfAssessments: assessments(input.assessmentOverrides),
    resources: input.practiceQuestionCount === undefined ? resources : resources.map((resource) => ({
      ...resource,
      fallbackConcept: { ...resource.fallbackConcept, practiceQuestionCount: input.practiceQuestionCount! },
    })),
    profileVersion: 1,
    planVersion: 1,
    now: input.now ?? new Date("2026-08-12T00:00:00.000Z"),
    createId: (prefix) => `${prefix}_${++id}`,
    ...(input.screening ? { screening: input.screening } : {}),
  });
}

describe("deterministic onboarding planner", () => {
  it.each([90, 180, 360])("does not repeat the same reading within a day when no practice is available (%i minutes)", (dailyMinutes) => {
    const { plan } = build({ dailyMinutes, practiceQuestionCount: 0 });
    for (let day = 1; day <= 7; day += 1) {
      const tasks = plan.tasks.filter((task) => task.day_index === day);
      const identities = tasks.map((task) => `${task.course_id}:${task.concept_id}:${task.task_type}`);
      expect(new Set(identities).size).toBe(tasks.length);
      expect(tasks.reduce((minutes, task) => minutes + task.estimated_minutes, 0)).toBe(dailyMinutes);
      expect(tasks.map((task) => task.order)).toEqual(tasks.map((_, index) => index + 1));
    }
  });
  it("builds only a self-reported starting direction with zero objective evidence", () => {
    const result = build();

    expect(result.profile).toMatchObject({
      confidence: "low",
      evidence_status: "accumulating",
      objective_evidence_count: 0,
      subjective_evidence_count: 4,
    });
    expect(result.profile.priority_courses.every((course) => (
      course.evidence_level === "self_report_only"
      && course.evidence_refs.every((reference) => reference.startsWith("self:"))
    ))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/diagnostic|诊断|答错|正确率|能力分/iu);
  });

  it("changes the starting order only from the learner's four course self-reports", () => {
    const dsFirst = build({ assessmentOverrides: { course_408_ds: "not_started", course_408_cn: "good" } });
    const cnFirst = build({ assessmentOverrides: { course_408_ds: "good", course_408_cn: "not_started" } });

    expect(dsFirst.profile.priority_courses[0]?.course_id).toBe("course_408_ds");
    expect(cnFirst.profile.priority_courses[0]?.course_id).toBe("course_408_cn");
    expect(dsFirst.plan.tasks[0]?.course_id).not.toBe(cnFirst.plan.tasks[0]?.course_id);
  });

  it("keeps every day within the saved time budget and links to real student routes", () => {
    const result = build({ dailyMinutes: 30 });

    expect(new Set(result.plan.tasks.map((task) => task.day_index))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
    for (let day = 1; day <= 7; day += 1) {
      const minutes = result.plan.tasks
        .filter((task) => task.day_index === day)
        .reduce((sum, task) => sum + task.estimated_minutes, 0);
      expect(minutes).toBeLessThanOrEqual(30);
    }
    expect(result.plan.tasks.every((task) => task.href.startsWith("/student/"))).toBe(true);
  });

  it("remains usable while AI planning is unavailable", () => {
    const result = build();

    expect(result.plan.source).toBe("deterministic_fallback");
    expect(result.plan.ai_status).toBe("unavailable");
    expect(result.plan.tasks).toHaveLength(7);
    expect(result.plan.today_task_id).toBe(result.plan.tasks[0]?.task_id);
  });

  it("turns a larger daily time budget into a materially larger daily workload", () => {
    const shortPlan = build({ dailyMinutes: 30 }).plan;
    const longPlan = build({ dailyMinutes: 180 }).plan;
    const minutesForDay = (plan: typeof shortPlan, day: number) => plan.tasks
      .filter((task) => task.day_index === day)
      .reduce((sum, task) => sum + task.estimated_minutes, 0);

    expect(longPlan.tasks.length).toBeGreaterThan(shortPlan.tasks.length);
    expect(minutesForDay(shortPlan, 1)).toBe(30);
    expect(minutesForDay(longPlan, 1)).toBe(180);
    expect(longPlan.tasks.filter((task) => task.day_index === 1).length).toBeGreaterThan(1);
  });

  it("rotates all observed risk concepts instead of repeating only the first one", () => {
    const result = build({
      dailyMinutes: 180,
      screening: resources.map((course) => course.courseId === "course_408_ds"
        ? {
          courseId: course.courseId,
          answeredCount: 2,
          correctCount: 0,
          incorrectCount: 2,
          unsureCount: 0,
          skippedCount: 0,
          riskConcepts: [
            { conceptId: "ds_c03_01", conceptTitle: "栈的抽象与存储", questionId: "question_ds_1" },
            { conceptId: "ds_c08_03", conceptTitle: "冒泡与快速排序", questionId: "question_ds_2" },
          ],
        }
        : {
          courseId: course.courseId,
          answeredCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          unsureCount: 0,
          skippedCount: 2,
          riskConcepts: [],
        }),
    });
    const dataStructureConcepts = new Set(result.plan.tasks
      .filter((task) => task.course_id === "course_408_ds")
      .map((task) => task.concept_id));

    expect(dataStructureConcepts).toEqual(new Set(["ds_c03_01", "ds_c08_03"]));
  });

  it("uses the Asia/Shanghai calendar date around local midnight", () => {
    const result = build({ now: new Date("2026-08-25T16:30:00.000Z") });

    expect(result.plan.start_date).toBe("2026-08-26");
    expect(result.plan.tasks[0]?.task_date).toBe("2026-08-26");
    expect(result.plan.tasks.at(-1)?.task_date).toBe("2026-09-01");
  });

  it("uses a completed screening gap to reorder the start without treating skips as wrong answers", () => {
    const result = build({
      screening: resources.map((course) => course.courseId === "course_408_cn"
        ? {
          courseId: course.courseId,
          answeredCount: 1,
          correctCount: 0,
          incorrectCount: 1,
          unsureCount: 0,
          skippedCount: 1,
          riskConcepts: [{
            conceptId: "cn_c06_01",
            conceptTitle: "DNS 层次命名与解析",
            questionId: "question_cn_1",
          }],
        }
        : {
          courseId: course.courseId,
          answeredCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          unsureCount: 0,
          skippedCount: 2,
          riskConcepts: [],
        }),
    });

    expect(result.profile.priority_courses[0]?.course_id).toBe("course_408_cn");
    expect(result.profile.priority_courses[0]?.evidence_level).toBe("screening_signal");
    expect(result.profile.screening).toMatchObject({
      status: "completed",
      correct_count: 0,
      risk_concepts: [{ concept_id: "cn_c06_01" }],
    });
    expect(result.plan.tasks[0]).toMatchObject({
      course_id: "course_408_cn",
      concept_id: "cn_c06_01",
    });
    expect(result.profile.priority_courses
      .filter((course) => course.course_id !== "course_408_cn")
      .every((course) => course.evidence_level === "self_report_only" || course.evidence_level === "screening_signal"))
      .toBe(true);
  });

  it("falls back to course reading when a screening gap has no eligible practice question", () => {
    const result = build({
      screening: resources.map((course) => course.courseId === "course_408_co"
        ? {
          courseId: course.courseId,
          answeredCount: 1,
          correctCount: 0,
          incorrectCount: 1,
          unsureCount: 0,
          skippedCount: 1,
          riskConcepts: [{
            conceptId: "co_c07_01",
            conceptTitle: "机器指令与指令格式",
            questionId: "screening-408-v3-04",
            practiceQuestionCount: 0,
          }],
        }
        : {
          courseId: course.courseId,
          answeredCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          unsureCount: 0,
          skippedCount: 2,
          riskConcepts: [],
        }),
    });

    expect(result.plan.tasks[0]).toMatchObject({
      course_id: "course_408_co",
      concept_id: "co_c07_01",
      task_type: "course_reading",
      href: "/student/courses/computer-organization",
    });
  });
});
