import { describe, expect, it } from "vitest";

import {
  pilotConsentRequestSchema,
  pilotFeedbackRequestSchema,
  pilotParticipantEnrollmentSchema,
  pilotStudentStudySchema,
  pilotTaskCompletionRequestSchema,
  pilotTaskEvaluationRequestSchema,
  pilotTaskEvaluationResponseSchema,
} from "../src/index.js";

describe("pilot study contracts", () => {
  it("requires affirmative versioned consent and a bounded baseline confidence rating", () => {
    expect(pilotConsentRequestSchema.parse({
      accepted: true,
      notice_version: "pilot_notice_v1",
      baseline_confidence: 3,
    })).toEqual({
      accepted: true,
      notice_version: "pilot_notice_v1",
      baseline_confidence: 3,
    });
    expect(pilotConsentRequestSchema.safeParse({
      accepted: false,
      notice_version: "pilot_notice_v1",
      baseline_confidence: 3,
    }).success).toBe(false);
    expect(pilotConsentRequestSchema.safeParse({
      accepted: true,
      notice_version: "pilot_notice_v1",
      baseline_confidence: 6,
    }).success).toBe(false);
  });

  it("enrolls an existing account with an anonymous code and explicit data class", () => {
    expect(pilotParticipantEnrollmentSchema.parse({
      username: "trial_student_01",
      participant_code: "P001",
      role_label: "2023级计算机科学与技术专业学生",
      participant_kind: "real_trial",
    }).participant_code).toBe("P001");
    expect(pilotParticipantEnrollmentSchema.safeParse({
      username: "trial_student_01",
      participant_code: "P001",
      role_label: "2023级计算机科学与技术专业学生",
      participant_kind: "demo",
    }).success).toBe(false);
    expect(pilotParticipantEnrollmentSchema.safeParse({
      username: "trial_student_01",
      participant_code: "王同学",
      role_label: "学生",
      participant_kind: "real_trial",
    }).success).toBe(false);
  });

  it("accepts only a server-issued attempt id for objective completion", () => {
    expect(pilotTaskCompletionRequestSchema.parse({ attempt_id: "attempt_001" }))
      .toEqual({ attempt_id: "attempt_001" });
    expect(pilotTaskCompletionRequestSchema.parse({})).toEqual({});
    expect(pilotTaskCompletionRequestSchema.safeParse({
      attempt_id: "attempt_001",
      is_correct: true,
      score: 100,
    }).success).toBe(false);
  });

  it("keeps pilot evaluation requests and responses answer-redacted", () => {
    expect(pilotTaskEvaluationRequestSchema.parse({
      selected_option_ids: ["A"],
    })).toEqual({ selected_option_ids: ["A"] });
    expect(pilotTaskEvaluationResponseSchema.parse({
      task_id: "pilot_queue_baseline_v1",
      attempt_id: "attempt_001",
      question_id: "2010-02",
      outcome: "incorrect",
      score: 0,
      grading_mode: "deterministic_choice",
      evidence_at: "2026-08-22T09:02:30.000Z",
      task_completed: true,
    })).not.toHaveProperty("correct_option_ids");
    expect(pilotTaskEvaluationResponseSchema.safeParse({
      task_id: "pilot_queue_baseline_v1",
      attempt_id: "attempt_001",
      question_id: "2010-02",
      outcome: "correct",
      score: 100,
      grading_mode: "deterministic_choice",
      evidence_at: "2026-08-22T09:02:30.000Z",
      task_completed: true,
      explanation: "答案泄露",
    }).success).toBe(false);
  });

  it("bounds final ratings and discourages oversized free text", () => {
    expect(pilotFeedbackRequestSchema.parse({
      ease_of_use: 4,
      guidance_helpfulness: 5,
      confidence_after: 4,
      continued_use_intent: 4,
      open_feedback: "任务顺序清楚，迁移题仍需要思考。",
    }).guidance_helpfulness).toBe(5);
    expect(pilotFeedbackRequestSchema.safeParse({
      ease_of_use: 0,
      guidance_helpfulness: 5,
      confidence_after: 4,
      continued_use_intent: 4,
      open_feedback: "",
    }).success).toBe(false);
    expect(pilotFeedbackRequestSchema.safeParse({
      ease_of_use: 4,
      guidance_helpfulness: 5,
      confidence_after: 4,
      continued_use_intent: 4,
      open_feedback: "x".repeat(501),
    }).success).toBe(false);
  });

  it("keeps the student view anonymous and strict", () => {
    const parsed = pilotStudentStudySchema.parse({
      kind: "enrolled",
      study: {
        study_id: "pilot_408_queue_v1",
        title: "队列知识点三阶段试用",
        notice_version: "pilot_notice_v1",
        notice_text: "请在自愿、知情的前提下参加试用。",
      },
      participant: {
        participant_code: "P001",
        role_label: "2023级计算机科学与技术专业学生",
        participant_kind: "real_trial",
        consent_notice_version: null,
        consented_at: null,
        baseline_confidence: null,
        completed_at: null,
      },
      tasks: [],
      feedback: null,
    });
    expect(parsed.kind === "enrolled" ? parsed.participant.consent_notice_version : "unexpected")
      .toBeNull();
    expect(JSON.stringify(parsed)).not.toMatch(/user_id|username|display_name|password|session/iu);
    expect(pilotStudentStudySchema.safeParse({
      ...parsed,
      user_id: "user_private_001",
    }).success).toBe(false);
  });
});
