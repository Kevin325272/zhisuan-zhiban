import { describe, expect, it } from "vitest";

import { readStudentCareConfig } from "../src/config/student-care.js";
import {
  evaluateStudentCareSignal,
  toShanghaiLearningDateKey,
  type StudentCareRuleEvidence,
} from "../src/services/student-care/student-care-rules.js";

const now = new Date("2026-08-21T08:00:00.000Z");
const config = readStudentCareConfig({ STUDENT_CARE_ENABLED: "true" });

function evidence(overrides: Partial<StudentCareRuleEvidence> = {}): StudentCareRuleEvidence {
  return {
    activeLearningDates: [],
    lastLearningAt: null,
    sessionStartedAt: [],
    accuracyByCourse: [],
    rhythm: {
      baselineCompletedDayCount: 0,
      recentCompletedDayCount: 0,
      hasPendingTask: false,
      hasDueReview: false,
    },
    ...overrides,
  };
}

describe("student care deterministic rules", () => {
  it("uses Asia/Shanghai rather than UTC for learning-day keys", () => {
    expect(toShanghaiLearningDateKey("2026-08-20T15:59:59.999Z")).toBe("2026-08-20");
    expect(toShanghaiLearningDateKey("2026-08-20T16:00:00.000Z")).toBe("2026-08-21");
  });

  it("returns none when feature evidence is insufficient", () => {
    expect(evaluateStudentCareSignal(evidence(), config, now)).toBeNull();
  });

  it("requires both a personal learning baseline and a newly returned session", () => {
    const base = evidence({
      activeLearningDates: ["2026-08-01", "2026-08-03", "2026-08-05", "2026-08-07"],
      lastLearningAt: "2026-08-15T08:00:00.000Z",
      sessionStartedAt: [
        "2026-08-21T07:45:00.000Z",
        "2026-08-15T07:00:00.000Z",
      ],
    });

    expect(evaluateStudentCareSignal(base, config, now)).toMatchObject({
      signalCode: "return_after_gap",
      evidenceSummary: {
        active_learning_day_count: 4,
        personal_median_gap_days: 2,
        threshold_gap_days: 4,
      },
    });
    expect(evaluateStudentCareSignal({
      ...base,
      sessionStartedAt: ["2026-08-15T07:00:00.000Z"],
    }, config, now)).toBeNull();
  });

  it("uses the greater of four days and twice the personal median gap", () => {
    const result = evaluateStudentCareSignal(evidence({
      activeLearningDates: ["2026-07-20", "2026-07-23", "2026-07-26", "2026-07-29"],
      lastLearningAt: "2026-08-14T08:00:00.000Z",
      sessionStartedAt: [
        "2026-08-21T07:45:00.000Z",
        "2026-08-14T07:00:00.000Z",
      ],
    }), config, now);

    expect(result).toMatchObject({
      signalCode: "return_after_gap",
      evidenceSummary: { personal_median_gap_days: 3, threshold_gap_days: 6 },
    });
  });

  it("triggers accuracy shift only within one course and at two concepts", () => {
    const result = evaluateStudentCareSignal(evidence({
      accuracyByCourse: [{
        courseId: "course_408_ds",
        recentAttemptCount: 8,
        recentIncorrectCount: 5,
        recentConceptCount: 2,
        baselineAttemptCount: 20,
        baselineIncorrectCount: 7,
      }],
    }), config, now);

    expect(result).toMatchObject({
      signalCode: "accuracy_shift",
      evidenceSummary: {
        course_id: "course_408_ds",
        recent_attempt_count: 8,
        baseline_attempt_count: 20,
        recent_error_rate: 0.625,
        baseline_error_rate: 0.35,
      },
    });
    expect(evaluateStudentCareSignal(evidence({
      accuracyByCourse: [{
        courseId: "course_408_ds",
        recentAttemptCount: 8,
        recentIncorrectCount: 5,
        recentConceptCount: 1,
        baselineAttemptCount: 20,
        baselineIncorrectCount: 7,
      }],
    }), config, now)).toBeNull();
  });

  it("does not combine insufficient attempts from different courses", () => {
    expect(evaluateStudentCareSignal(evidence({
      accuracyByCourse: ["course_408_ds", "course_408_co"].map((courseId) => ({
        courseId,
        recentAttemptCount: 4,
        recentIncorrectCount: 3,
        recentConceptCount: 2,
        baselineAttemptCount: 10,
        baselineIncorrectCount: 2,
      })),
    }), config, now)).toBeNull();
  });

  it("requires a strong earlier rhythm, a 0-1 day recent rhythm, and pending work", () => {
    expect(evaluateStudentCareSignal(evidence({
      rhythm: {
        baselineCompletedDayCount: 6,
        recentCompletedDayCount: 1,
        hasPendingTask: true,
        hasDueReview: false,
      },
    }), config, now)).toMatchObject({
      signalCode: "rhythm_drop",
      evidenceSummary: {
        baseline_completed_day_count: 6,
        recent_completed_day_count: 1,
      },
    });
    expect(evaluateStudentCareSignal(evidence({
      rhythm: {
        baselineCompletedDayCount: 6,
        recentCompletedDayCount: 1,
        hasPendingTask: false,
        hasDueReview: false,
      },
    }), config, now)).toBeNull();
  });

  it("selects return, then accuracy, then rhythm when signals overlap", () => {
    const allSignals = evidence({
      activeLearningDates: ["2026-08-01", "2026-08-03", "2026-08-05", "2026-08-07"],
      lastLearningAt: "2026-08-15T08:00:00.000Z",
      sessionStartedAt: ["2026-08-21T07:45:00.000Z", "2026-08-15T07:00:00.000Z"],
      accuracyByCourse: [{
        courseId: "course_408_ds",
        recentAttemptCount: 8,
        recentIncorrectCount: 6,
        recentConceptCount: 2,
        baselineAttemptCount: 20,
        baselineIncorrectCount: 4,
      }],
      rhythm: {
        baselineCompletedDayCount: 7,
        recentCompletedDayCount: 0,
        hasPendingTask: false,
        hasDueReview: true,
      },
    });

    expect(evaluateStudentCareSignal(allSignals, config, now)?.signalCode)
      .toBe("return_after_gap");
    expect(evaluateStudentCareSignal({
      ...allSignals,
      activeLearningDates: [],
      lastLearningAt: null,
      sessionStartedAt: [],
    }, config, now)?.signalCode).toBe("accuracy_shift");
  });
});
