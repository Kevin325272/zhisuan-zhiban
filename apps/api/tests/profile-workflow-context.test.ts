import { describe, expect, it } from "vitest";

import { StudentProfileWorkflowContextRepository } from "../src/services/profile-workflow/profile-workflow-context.js";

describe("student profile workflow context", () => {
  it("builds profile inputs from onboarding and deterministic dashboard evidence", async () => {
    const repository = new StudentProfileWorkflowContextRepository(
      {
        async getState() {
          return {
            status: "completed",
            current_step: "plan",
            goals: {
              target_exam_year: 2027,
              preparation_stage: "foundation",
              daily_minutes: 60,
              target_school: "示例大学",
              target_score: 120,
              saved_at: "2026-08-18T00:00:00.000Z",
            },
            self_assessments: [
              { course_id: "course_408_co", level: "weak" },
            ],
            profile: {
              profile_id: "onboarding_profile_001",
              version: 1,
              confidence: "low",
              evidence_status: "accumulating",
              confidence_explanation: "证据正在形成。",
              generated_at: "2026-08-18T00:00:00.000Z",
              objective_evidence_count: 0,
              subjective_evidence_count: 1,
              priority_courses: [],
              boundary_note: "不是能力测评。",
            },
            plan: null,
            updated_at: "2026-08-18T00:00:00.000Z",
          };
        },
      },
      {
        async getPersonalLearningDashboard() {
          return {
            generated_at: "2026-08-18T00:00:00.000Z",
            totals: {
              course_count: 1,
              concept_count: 4,
              started_concept_count: 2,
              practice_attempt_count: 2,
              correct_count: 1,
              incorrect_count: 1,
              needs_review_count: 1,
            },
            courses: [{
              course_id: "course_408_co",
              title: "计算机组成原理",
              concept_count: 4,
              started_concept_count: 2,
              practice_attempt_count: 2,
              correct_count: 1,
              incorrect_count: 1,
              needs_review_count: 1,
              mastered_count: 0,
              evidence_level: "limited",
              dimensions: [
                { key: "knowledge_coverage", label: "知识覆盖", score: 50, evidence_count: 2, evidence_level: "limited", explanation: "覆盖", recommendation: "继续" },
                { key: "practice_coverage", label: "练习覆盖", score: 25, evidence_count: 1, evidence_level: "limited", explanation: "练习", recommendation: "继续" },
                { key: "answer_accuracy", label: "作答准确", score: 50, evidence_count: 2, evidence_level: "limited", explanation: "准确", recommendation: "继续" },
                { key: "mistake_recovery", label: "错题修复", score: 0, evidence_count: 1, evidence_level: "limited", explanation: "错题", recommendation: "复习" },
                { key: "mastery_stability", label: "掌握稳定", score: 0, evidence_count: 1, evidence_level: "limited", explanation: "稳定", recommendation: "继续" },
              ],
              strongest_dimension_key: "knowledge_coverage",
              priority_dimension_key: "mistake_recovery",
              priority_concept: {
                concept_id: "co_c01_01",
                title: "硬件、软件与计算机系统",
                status: "needs_review",
                attempt_count: 2,
                correct_count: 1,
                incorrect_count: 1,
                mistake_count: 1,
                practice_question_count: 3,
              },
              recent_mistakes: [],
              next_action: { kind: "review_mistakes", label: "复习待巩固知识点", concept_id: "co_c01_01" },
            }],
          };
        },
      },
    );

    const result = await repository.build(
      "user_student_001",
      "profile_workflow_001",
      "course_408_co",
    );

    expect(result?.profile_id).toBe("onboarding_profile_001");
    expect(result?.inputs.profile_id).toBe("onboarding_profile_001");
    expect(JSON.parse(result?.inputs.backend_portrait_basis ?? "{}")).toMatchObject({
      courses: [{ course_id: "course_408_co", priority_dimension_key: "mistake_recovery" }],
    });
    const portraitBasis = JSON.parse(result?.inputs.backend_portrait_basis ?? "{}") as {
      strength_candidates?: Array<Record<string, unknown>>;
      priority_gap_candidates?: Array<Record<string, unknown>>;
      allowed_next_tasks?: Array<Record<string, unknown>>;
    };
    expect(portraitBasis.strength_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate_id: expect.stringMatching(/^strength_/u),
        course_id: "course_408_co",
        dimension_key: "knowledge_coverage",
        evidence_ids: expect.any(Array),
      }),
    ]));
    expect(portraitBasis.priority_gap_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate_id: expect.stringMatching(/^gap_/u),
        course_id: "course_408_co",
        dimension_key: "mistake_recovery",
        concept_id: "co_c01_01",
      }),
    ]));
    expect(portraitBasis.allowed_next_tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate_id: expect.stringMatching(/^task_/u),
        course_id: "course_408_co",
        concept_id: "co_c01_01",
        estimated_minutes: expect.any(Number),
      }),
    ]));
    expect(portraitBasis).not.toHaveProperty("candidate_strengths");
    expect(portraitBasis).not.toHaveProperty("candidate_priority_gaps");
    expect(portraitBasis).not.toHaveProperty("candidate_tasks");
    expect(result?.inputs.backend_portrait_basis).not.toContain("question_text");
    expect(result?.inputs.backend_portrait_basis).not.toContain("correct_option_ids");
    expect(result?.course_progress[0]?.practice_attempt_count).toBe(2);
  });

  it("returns no context before the student has a completed initial profile", async () => {
    const repository = new StudentProfileWorkflowContextRepository(
      ({ async getState() { return { profile: null }; } } as never),
      ({ async getPersonalLearningDashboard() { throw new Error("must not be called"); } } as never),
    );

    await expect(repository.build(
      "user_student_001",
      "profile_workflow_002",
      "course_408_co",
    )).resolves.toBeNull();
  });
});
