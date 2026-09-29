import { describe, expect, it } from "vitest";

import {
  personalLearningDashboardSchema,
  personalLearningDimensionKeySchema,
} from "../src/index.js";

const mistake = {
  mistake_id: "mistake_001",
  course_id: "course_408_ds",
  course_title: "数据结构",
  question_id: "2026-01",
  question_year: 2026,
  question_number: 1,
  subject: "数据结构",
  concept_id: "ds_c02_02",
  concept_title: "顺序表的存储表示",
  matched_tag: "顺序表",
  match_method: "exact_question_tag",
  first_incorrect_attempt_id: "attempt_001",
  last_incorrect_attempt_id: "attempt_001",
  last_incorrect_evaluation_id: "evaluation_001",
  wrong_count: 1,
  status: "needs_review",
  latest_attempt_outcome: "incorrect",
  first_incorrect_at: "2026-08-02T00:00:00.000Z",
  last_incorrect_at: "2026-08-02T00:00:00.000Z",
  mastered_at: null,
  updated_at: "2026-08-02T00:00:00.000Z",
} as const;

const dimensions = [
  ["knowledge_coverage", "知识覆盖", 50, 2, "limited"],
  ["practice_coverage", "练习覆盖", 25, 1, "limited"],
  ["answer_accuracy", "作答准确", 67, 3, "grounded"],
  ["mistake_recovery", "错题修复", 0, 1, "limited"],
  ["mastery_stability", "掌握稳定", 0, 1, "limited"],
] as const;

function dashboard() {
  return {
    generated_at: "2026-08-07T00:00:00.000Z",
    totals: {
      course_count: 1,
      concept_count: 4,
      started_concept_count: 2,
      practice_attempt_count: 3,
      correct_count: 2,
      incorrect_count: 1,
      needs_review_count: 1,
    },
    courses: [{
      course_id: "course_408_ds",
      title: "数据结构",
      concept_count: 4,
      started_concept_count: 2,
      practice_attempt_count: 3,
      correct_count: 2,
      incorrect_count: 1,
      needs_review_count: 1,
      mastered_count: 0,
      evidence_level: "grounded",
      dimensions: dimensions.map(([key, label, score, evidence_count, evidence_level]) => ({
        key,
        label,
        score,
        evidence_count,
        evidence_level,
        explanation: `${label}的真实证据说明。`,
        recommendation: `${label}的下一步建议。`,
      })),
      strongest_dimension_key: "answer_accuracy",
      priority_dimension_key: "mistake_recovery",
      priority_concept: {
        concept_id: "ds_c02_02",
        title: "顺序表的存储表示",
        status: "needs_review",
        attempt_count: 3,
        correct_count: 2,
        incorrect_count: 1,
        mistake_count: 1,
        practice_question_count: 3,
      },
      recent_mistakes: [mistake],
      next_action: {
        kind: "review_mistakes",
        label: "复习 1 个待巩固知识点",
        concept_id: "ds_c02_02",
      },
    }],
  } as const;
}

describe("personal learning dashboard contracts", () => {
  it("fixes one comparable five-dimension profile for every 408 course", () => {
    expect(personalLearningDimensionKeySchema.options).toEqual([
      "knowledge_coverage",
      "practice_coverage",
      "answer_accuracy",
      "mistake_recovery",
      "mastery_stability",
    ]);
    expect(personalLearningDashboardSchema.parse(dashboard()).courses[0]?.dimensions).toHaveLength(5);
  });

  it("keeps insufficient evidence distinct from a real zero score", () => {
    const value = dashboard();
    const course = value.courses[0];
    const result = personalLearningDashboardSchema.parse({
      ...value,
      courses: [{
        ...course,
        evidence_level: "none",
        dimensions: course.dimensions.map((dimension) => ({
          ...dimension,
          score: null,
          evidence_count: 0,
          evidence_level: "none",
        })),
        strongest_dimension_key: null,
        priority_dimension_key: null,
        priority_concept: null,
        recent_mistakes: [],
        next_action: {
          kind: "start_course",
          label: "开始课程学习",
          concept_id: null,
        },
      }],
    });

    expect(result.courses[0]?.dimensions[0]?.score).toBeNull();
    expect(result.courses[0]?.strongest_dimension_key).toBeNull();
  });

  it("rejects browser-supplied score fields outside the strict DTO", () => {
    expect(() => personalLearningDashboardSchema.parse({
      ...dashboard(),
      ranking: 1,
    })).toThrow();
  });
});
