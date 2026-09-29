import type { StudentCareSignal } from "@xuetu/contracts";

import type { StudentCareConfig } from "../../config/student-care.js";

export interface StudentCareAccuracyEvidence {
  courseId: string;
  recentAttemptCount: number;
  recentIncorrectCount: number;
  recentConceptCount: number;
  baselineAttemptCount: number;
  baselineIncorrectCount: number;
}

export interface StudentCareRuleEvidence {
  activeLearningDates: string[];
  lastLearningAt: string | null;
  sessionStartedAt: string[];
  accuracyByCourse: StudentCareAccuracyEvidence[];
  rhythm: {
    baselineCompletedDayCount: number;
    recentCompletedDayCount: number;
    hasPendingTask: boolean;
    hasDueReview: boolean;
  };
}

export interface StudentCareRuleMatch {
  signalCode: StudentCareSignal;
  reasonSummary: string;
  evidenceSummary: Record<string, string | number | boolean | null>;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

function instant(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid care evidence timestamp: ${value}`);
  return timestamp;
}

export function toShanghaiLearningDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(instant(value));
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function learningDayNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`Invalid Shanghai learning date: ${value}`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid Shanghai learning date: ${value}`);
  return timestamp / DAY_MS;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle] ?? 0
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function roundedRate(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function returnAfterGap(
  evidence: StudentCareRuleEvidence,
  config: StudentCareConfig,
  now: Date,
): StudentCareRuleMatch | null {
  const activeDays = [...new Set(evidence.activeLearningDates)]
    .map(learningDayNumber)
    .sort((left, right) => left - right);
  if (activeDays.length < config.returnAfterGap.minActiveDays || !evidence.lastLearningAt) {
    return null;
  }
  const gaps = activeDays.slice(1).map((day, index) => day - (activeDays[index] ?? day));
  const personalMedianGapDays = median(gaps);
  const thresholdGapDays = Math.max(
    config.returnAfterGap.minGapDays,
    personalMedianGapDays * config.returnAfterGap.medianGapMultiplier,
  );
  const lastLearningAt = instant(evidence.lastLearningAt);
  if (now.getTime() - lastLearningAt < thresholdGapDays * DAY_MS) return null;

  const sessions = evidence.sessionStartedAt.map(instant).sort((left, right) => right - left);
  const latestSession = sessions[0];
  if (latestSession === undefined) return null;
  const recentSessionBoundary = now.getTime() - config.returnAfterGap.recentSessionHours * 60 * 60 * 1_000;
  if (latestSession < recentSessionBoundary || latestSession > now.getTime()) return null;
  if (latestSession - lastLearningAt < thresholdGapDays * DAY_MS) return null;
  if (!sessions.some((session) => session <= lastLearningAt)) return null;

  return {
    signalCode: "return_after_gap",
    reasonSummary: "最近几天没有新的学习记录。",
    evidenceSummary: {
      active_learning_day_count: activeDays.length,
      personal_median_gap_days: roundedRate(personalMedianGapDays),
      threshold_gap_days: roundedRate(thresholdGapDays),
      inactivity_days: Math.floor((now.getTime() - lastLearningAt) / DAY_MS),
      latest_session_at: new Date(latestSession).toISOString(),
    },
  };
}

function accuracyShift(
  evidence: StudentCareRuleEvidence,
  config: StudentCareConfig,
): StudentCareRuleMatch | null {
  const matches = evidence.accuracyByCourse.flatMap((course) => {
    if (
      course.recentAttemptCount < config.accuracyShift.recentMinAttempts
      || course.recentConceptCount < config.accuracyShift.recentMinConcepts
      || course.baselineAttemptCount < config.accuracyShift.baselineMinAttempts
    ) return [];
    const recentErrorRate = course.recentIncorrectCount / course.recentAttemptCount;
    const baselineErrorRate = course.baselineIncorrectCount / course.baselineAttemptCount;
    const increase = recentErrorRate - baselineErrorRate;
    if (
      recentErrorRate < config.accuracyShift.recentMinErrorRate
      || increase < config.accuracyShift.minErrorRateIncrease
    ) return [];
    return [{ course, recentErrorRate, baselineErrorRate, increase }];
  }).sort((left, right) => (
    right.increase - left.increase || left.course.courseId.localeCompare(right.course.courseId)
  ));
  const selected = matches[0];
  if (!selected) return null;
  return {
    signalCode: "accuracy_shift",
    reasonSummary: "最近这部分学习比平时更费力。",
    evidenceSummary: {
      course_id: selected.course.courseId,
      recent_attempt_count: selected.course.recentAttemptCount,
      recent_concept_count: selected.course.recentConceptCount,
      recent_error_rate: roundedRate(selected.recentErrorRate),
      baseline_attempt_count: selected.course.baselineAttemptCount,
      baseline_error_rate: roundedRate(selected.baselineErrorRate),
      error_rate_increase: roundedRate(selected.increase),
    },
  };
}

function rhythmDrop(
  evidence: StudentCareRuleEvidence,
  config: StudentCareConfig,
): StudentCareRuleMatch | null {
  const rhythm = evidence.rhythm;
  if (
    rhythm.baselineCompletedDayCount < config.rhythmDrop.baselineMinCompletedDays
    || rhythm.recentCompletedDayCount > config.rhythmDrop.recentMaxCompletedDays
    || (!rhythm.hasPendingTask && !rhythm.hasDueReview)
  ) return null;
  return {
    signalCode: "rhythm_drop",
    reasonSummary: "最近一周完成学习任务的天数比你前两周的节奏少。",
    evidenceSummary: {
      baseline_completed_day_count: rhythm.baselineCompletedDayCount,
      recent_completed_day_count: rhythm.recentCompletedDayCount,
      has_pending_task: rhythm.hasPendingTask,
      has_due_review: rhythm.hasDueReview,
    },
  };
}

export function evaluateStudentCareSignal(
  evidence: StudentCareRuleEvidence,
  config: StudentCareConfig,
  now: Date,
): StudentCareRuleMatch | null {
  if (!config.enabled) return null;
  return returnAfterGap(evidence, config, now)
    ?? accuracyShift(evidence, config)
    ?? rhythmDrop(evidence, config);
}
