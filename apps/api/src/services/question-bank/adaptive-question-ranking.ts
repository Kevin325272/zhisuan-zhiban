import type { QuestionRankingExplanation } from "@xuetu/contracts";

export const ADAPTIVE_QUESTION_RANKING_VERSION = "fsrs_v6_weighted_v1" as const;

export interface AdaptiveQuestionCandidate {
  question_id: string;
  due: string | null;
  retrievability: number | null;
  attempt_count: number;
  concept_correct_count: number;
  concept_incorrect_count: number;
  wrong_count: number;
  importance: "core" | "extended";
}

export interface RankedAdaptiveQuestionCandidate extends AdaptiveQuestionCandidate {
  ranking: QuestionRankingExplanation;
}

function validNow(now: Date) {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid adaptive-ranking timestamp.");
}

function validCount(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid adaptive-ranking ${label}.`);
  }
}

function dueTime(value: string | null) {
  if (value === null) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) throw new Error("Invalid adaptive-ranking due timestamp.");
  return time;
}

function validate(candidate: AdaptiveQuestionCandidate, now: Date) {
  validNow(now);
  if (!candidate.question_id.trim()) throw new Error("Adaptive-ranking question id is required.");
  dueTime(candidate.due);
  if (
    candidate.retrievability !== null
    && (
      !Number.isFinite(candidate.retrievability)
      || candidate.retrievability < 0
      || candidate.retrievability > 1
    )
  ) {
    throw new Error("Invalid adaptive-ranking retrievability.");
  }
  validCount(candidate.attempt_count, "attempt count");
  validCount(candidate.concept_correct_count, "concept correct count");
  validCount(candidate.concept_incorrect_count, "concept incorrect count");
  validCount(candidate.wrong_count, "wrong count");
}

export function scoreAdaptiveQuestionCandidate(
  candidate: AdaptiveQuestionCandidate,
  now: Date,
): QuestionRankingExplanation {
  validate(candidate, now);
  const conceptAttempts = candidate.concept_correct_count + candidate.concept_incorrect_count;
  const components = {
    memory_risk: candidate.retrievability === null ? 0.35 : 1 - candidate.retrievability,
    concept_weakness: conceptAttempts === 0
      ? 0
      : candidate.concept_incorrect_count / conceptAttempts,
    repeated_error: Math.min(candidate.wrong_count, 3) / 3,
    importance: candidate.importance === "core" ? 1 : 0.55,
    novelty: candidate.attempt_count === 0 ? 1 : 1 / (1 + candidate.attempt_count),
  };
  const priorityScore = Math.round(100 * (
    (0.55 * components.memory_risk)
    + (0.2 * components.concept_weakness)
    + (0.1 * components.repeated_error)
    + (0.1 * components.importance)
    + (0.05 * components.novelty)
  ));
  const candidateDue = dueTime(candidate.due);
  const reasonLines: string[] = [];
  if (candidate.retrievability === null) {
    reasonLines.push("尚无稳定作答证据");
  } else if (candidateDue !== null && candidateDue <= now.getTime()) {
    reasonLines.push("已到复习时间");
  } else {
    reasonLines.push("已有个体复习记录");
  }
  if (conceptAttempts > 0) {
    reasonLines.push(`知识点错答 ${candidate.concept_incorrect_count}/${conceptAttempts}`);
  }
  if (candidate.wrong_count > 0) {
    reasonLines.push(`同题已错 ${candidate.wrong_count} 次`);
  }
  if (candidate.importance === "core") reasonLines.push("核心知识点");
  if (candidate.attempt_count === 0) reasonLines.push("未练习过");

  return {
    algorithm_version: ADAPTIVE_QUESTION_RANKING_VERSION,
    priority_score: priorityScore,
    evidence_level: candidate.retrievability !== null && conceptAttempts >= 3
      ? "grounded"
      : "limited",
    components,
    reason_lines: reasonLines.slice(0, 4),
  };
}

export function rankAdaptiveQuestionCandidates(
  candidates: AdaptiveQuestionCandidate[],
  now: Date,
): RankedAdaptiveQuestionCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    ranking: scoreAdaptiveQuestionCandidate(candidate, now),
  })).sort((left, right) => {
    const scoreDelta = right.ranking.priority_score - left.ranking.priority_score;
    if (scoreDelta !== 0) return scoreDelta;
    const leftDue = dueTime(left.due) ?? Number.POSITIVE_INFINITY;
    const rightDue = dueTime(right.due) ?? Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    if (left.wrong_count !== right.wrong_count) return right.wrong_count - left.wrong_count;
    if (left.attempt_count !== right.attempt_count) return left.attempt_count - right.attempt_count;
    return left.question_id.localeCompare(right.question_id);
  });
}
