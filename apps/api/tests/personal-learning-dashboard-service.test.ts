import type {
  LearningRecord,
  PracticeMistakeRecord,
} from "@xuetu/contracts";
import { describe, expect, it } from "vitest";

import { buildPersonalLearningDashboard } from "../src/services/question-bank/personal-learning-dashboard.js";

function mistake(
  mistakeId: string,
  status: "needs_review" | "mastered",
  conceptId: string,
): PracticeMistakeRecord {
  return {
    mistake_id: mistakeId,
    course_id: "course_408_ds",
    course_title: "数据结构",
    question_id: `question_${mistakeId}`,
    question_year: 2026,
    question_number: 1,
    subject: "数据结构",
    concept_id: conceptId,
    concept_title: conceptId === "ds_c02_02" ? "顺序表" : "链表",
    matched_tag: "线性表",
    match_method: "exact_question_tag",
    first_incorrect_attempt_id: `first_${mistakeId}`,
    last_incorrect_attempt_id: `last_${mistakeId}`,
    last_incorrect_evaluation_id: `evaluation_${mistakeId}`,
    wrong_count: 1,
    status,
    latest_attempt_outcome: status === "mastered" ? "correct" : "incorrect",
    first_incorrect_at: "2026-08-01T00:00:00.000Z",
    last_incorrect_at: "2026-08-02T00:00:00.000Z",
    mastered_at: status === "mastered" ? "2026-08-03T00:00:00.000Z" : null,
    updated_at: status === "mastered"
      ? "2026-08-03T00:00:00.000Z"
      : "2026-08-04T00:00:00.000Z",
  };
}

const record: LearningRecord = {
  generated_at: "2026-08-07T00:00:00.000Z",
  courses: [
    {
      course_id: "course_408_ds",
      title: "数据结构",
      concept_count: 4,
      started_concept_count: 3,
      practice_attempt_count: 3,
      correct_count: 2,
      incorrect_count: 1,
      needs_review_count: 1,
      mastered_count: 1,
      concepts: [
        { concept_id: "ds_c02_01", title: "线性表", status: "mastered", attempt_count: 2, correct_count: 2, incorrect_count: 0, mistake_count: 1, practice_question_count: 2 },
        { concept_id: "ds_c02_02", title: "顺序表", status: "needs_review", attempt_count: 1, correct_count: 0, incorrect_count: 1, mistake_count: 1, practice_question_count: 3 },
        { concept_id: "ds_c02_03", title: "链式存储", status: "reading", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 2 },
        { concept_id: "ds_c02_04", title: "静态链表", status: "not_started", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 0 },
      ],
    },
    {
      course_id: "course_408_cn",
      title: "计算机网络",
      concept_count: 2,
      started_concept_count: 0,
      practice_attempt_count: 0,
      correct_count: 0,
      incorrect_count: 0,
      needs_review_count: 0,
      mastered_count: 0,
      concepts: [
        { concept_id: "cn_c01_01", title: "协议分层", status: "not_started", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 2 },
        { concept_id: "cn_c01_02", title: "服务与接口", status: "not_started", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 1 },
      ],
    },
  ],
};

describe("personal learning dashboard aggregation", () => {
  it("derives five explainable scores from stored course evidence", () => {
    const result = buildPersonalLearningDashboard(record, [
      mistake("mistake_needs_review", "needs_review", "ds_c02_02"),
      mistake("mistake_mastered", "mastered", "ds_c02_01"),
    ]);
    const course = result.courses[0];

    expect(course?.dimensions.map((dimension) => dimension.score)).toEqual([
      75,
      50,
      67,
      50,
      50,
    ]);
    expect(course?.strongest_dimension_key).toBe("knowledge_coverage");
    expect(course?.priority_dimension_key).toBe("mistake_recovery");
    expect(course?.priority_concept?.concept_id).toBe("ds_c02_02");
    expect(course?.next_action).toMatchObject({ kind: "review_mistakes" });
    expect(course?.recent_mistakes.map((item) => item.mistake_id)).toEqual([
      "mistake_needs_review",
      "mistake_mastered",
    ]);
  });

  it("does not turn absent attempts or mistakes into artificial ability scores", () => {
    const result = buildPersonalLearningDashboard(record, []);
    const course = result.courses.find((item) => item.course_id === "course_408_cn");

    expect(course?.dimensions.map((dimension) => dimension.score)).toEqual([
      0,
      0,
      null,
      null,
      null,
    ]);
    expect(course?.evidence_level).toBe("none");
    expect(course?.strongest_dimension_key).toBeNull();
    expect(course?.priority_dimension_key).toBeNull();
    expect(course?.priority_concept).toBeNull();
    expect(course?.next_action).toEqual({
      kind: "start_course",
      label: "从课程知识地图开始学习",
      concept_id: null,
    });
  });

  it("keeps totals and recent mistakes isolated by course", () => {
    const unrelated = {
      ...mistake("mistake_os", "needs_review", "os_c01_01"),
      course_id: "course_408_os",
      course_title: "操作系统",
      subject: "操作系统",
    };
    const result = buildPersonalLearningDashboard(record, [
      unrelated,
      mistake("mistake_ds", "needs_review", "ds_c02_02"),
    ]);

    expect(result.totals).toMatchObject({
      course_count: 2,
      concept_count: 6,
      practice_attempt_count: 3,
      needs_review_count: 1,
    });
    expect(result.courses[0]?.recent_mistakes).toHaveLength(1);
    expect(result.courses[0]?.recent_mistakes[0]?.course_id).toBe("course_408_ds");
    expect(result.courses[1]?.recent_mistakes).toHaveLength(0);
  });

  it("scores mistake recovery from the full course history while showing only three recent rows", () => {
    const result = buildPersonalLearningDashboard(record, [
      mistake("mistake_mastered", "mastered", "ds_c02_01"),
      mistake("mistake_review_1", "needs_review", "ds_c02_02"),
      mistake("mistake_review_2", "needs_review", "ds_c02_02"),
      mistake("mistake_review_3", "needs_review", "ds_c02_02"),
    ]);
    const course = result.courses[0];
    const recovery = course?.dimensions.find((item) => item.key === "mistake_recovery");

    expect(recovery?.score).toBe(25);
    expect(recovery?.evidence_count).toBe(4);
    expect(course?.recent_mistakes).toHaveLength(3);
  });

  it("does not call one correct attempt stable mastery", () => {
    const oneAttemptRecord: LearningRecord = {
      generated_at: "2026-08-07T00:00:00.000Z",
      courses: [{
        course_id: "course_408_ds",
        title: "数据结构",
        concept_count: 1,
        started_concept_count: 1,
        practice_attempt_count: 1,
        correct_count: 1,
        incorrect_count: 0,
        needs_review_count: 0,
        mastered_count: 0,
        concepts: [{
          concept_id: "ds_c01",
          title: "算法复杂度",
          status: "practiced",
          attempt_count: 1,
          correct_count: 1,
          incorrect_count: 0,
          mistake_count: 0,
          practice_question_count: 3,
        }],
      }],
    };

    const result = buildPersonalLearningDashboard(oneAttemptRecord, []);
    const stability = result.courses[0]?.dimensions.find((item) => item.key === "mastery_stability");

    expect(stability).toMatchObject({ score: 0, evidence_count: 1, evidence_level: "limited" });
    expect(stability?.explanation).toContain("0 个已稳定掌握");
  });

  it("does not count one wrong answer three times or call one answer a strength", () => {
    const oneWrongRecord: LearningRecord = {
      generated_at: "2026-08-07T00:00:00.000Z",
      courses: [{
        course_id: "course_408_ds",
        title: "数据结构",
        concept_count: 4,
        started_concept_count: 1,
        practice_attempt_count: 1,
        correct_count: 0,
        incorrect_count: 1,
        needs_review_count: 1,
        mastered_count: 0,
        concepts: [
          { concept_id: "ds_c02_02", title: "顺序表", status: "needs_review", attempt_count: 1, correct_count: 0, incorrect_count: 1, mistake_count: 1, practice_question_count: 1 },
          { concept_id: "ds_c02_03", title: "链表", status: "not_started", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 1 },
          { concept_id: "ds_c02_04", title: "栈", status: "not_started", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 1 },
          { concept_id: "ds_c02_05", title: "队列", status: "not_started", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 1 },
        ],
      }],
    };

    const wrong = buildPersonalLearningDashboard(oneWrongRecord, [
      mistake("mistake_single", "needs_review", "ds_c02_02"),
    ]).courses[0];
    expect(wrong?.evidence_level).toBe("limited");
    expect(wrong?.strongest_dimension_key).toBeNull();

    const oneCorrectRecord = structuredClone(oneWrongRecord);
    const course = oneCorrectRecord.courses[0]!;
    course.correct_count = 1;
    course.incorrect_count = 0;
    course.needs_review_count = 0;
    course.concepts[0] = {
      ...course.concepts[0]!,
      status: "practiced",
      correct_count: 1,
      incorrect_count: 0,
      mistake_count: 0,
    };
    const correct = buildPersonalLearningDashboard(oneCorrectRecord, []).courses[0];
    expect(correct?.evidence_level).toBe("limited");
    expect(correct?.strongest_dimension_key).toBeNull();
  });
});
