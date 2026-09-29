export const MISTAKE_RECOMMENDATION_ALGORITHM_VERSION = "evidence_weighted_v1" as const;

export interface MistakeRecommendationCandidate {
  mistake_id: string;
  concept_id: string | null;
  match_method: "exact_question_tag" | string | null;
  question_type: "choice" | "subjective" | string;
  answer_backed: boolean;
  wrong_count: number;
  next_review_at: string | null;
  last_incorrect_at: string;
  concept_correct_count: number;
  concept_incorrect_count: number;
  importance: "core" | "extended";
}

export interface MistakeRecommendationScore {
  priority_score: number;
  due_status: "due" | "upcoming";
  evidence_level: "limited" | "grounded";
  reason_lines: string[];
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function asTime(value: string) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) throw new Error("Invalid recommendation timestamp.");
  return time;
}

function dueTiming(nextReviewAt: string, now: Date) {
  const overdueMs = now.getTime() - asTime(nextReviewAt);
  if (overdueMs < 0) return { due_status: "upcoming" as const, urgency: 0 };
  const overdueDays = overdueMs / (24 * 60 * 60 * 1000);
  return {
    due_status: "due" as const,
    urgency: clamp(0.6 + ((0.4 * overdueDays) / 7)),
  };
}

export function eligibleMistake(candidate: MistakeRecommendationCandidate) {
  const totalConceptAttempts = candidate.concept_correct_count + candidate.concept_incorrect_count;
  return candidate.concept_id !== null
    && candidate.match_method === "exact_question_tag"
    && candidate.question_type === "choice"
    && candidate.answer_backed
    && candidate.next_review_at !== null
    && totalConceptAttempts > 0;
}

export function scoreMistakeRecommendation(
  candidate: MistakeRecommendationCandidate,
  now: Date,
): MistakeRecommendationScore {
  if (!eligibleMistake(candidate) || !candidate.next_review_at) {
    throw new Error("Ineligible mistake cannot be scored.");
  }

  const timing = dueTiming(candidate.next_review_at, now);
  const repeatedError = clamp(Math.min(candidate.wrong_count, 3) / 3);
  const totalConceptAttempts = candidate.concept_correct_count + candidate.concept_incorrect_count;
  const conceptWeakness = clamp(candidate.concept_incorrect_count / totalConceptAttempts);
  const importance = candidate.importance === "core" ? 1 : 0.55;
  const priorityScore = Math.round(100 * (
    (0.4 * timing.urgency)
    + (0.25 * repeatedError)
    + (0.2 * conceptWeakness)
    + (0.15 * importance)
  ));
  const reasonLines = [
    timing.due_status === "due" ? "已到复习时间" : "已安排下一次复习",
    `同一题已错 ${Math.min(candidate.wrong_count, 3)} 次`,
    candidate.importance === "core" ? "核心知识点" : "扩展知识点",
  ];

  return {
    priority_score: priorityScore,
    due_status: timing.due_status,
    evidence_level: totalConceptAttempts >= 3 ? "grounded" : "limited",
    reason_lines: reasonLines,
  };
}

export function rankMistakeRecommendations(
  candidates: MistakeRecommendationCandidate[],
  now: Date,
) {
  return [...candidates].sort((left, right) => {
    const scoreDelta = scoreMistakeRecommendation(right, now).priority_score
      - scoreMistakeRecommendation(left, now).priority_score;
    if (scoreDelta !== 0) return scoreDelta;
    const reviewDelta = asTime(left.next_review_at!) - asTime(right.next_review_at!);
    if (reviewDelta !== 0) return reviewDelta;
    if (left.wrong_count !== right.wrong_count) return right.wrong_count - left.wrong_count;
    const incorrectDelta = asTime(left.last_incorrect_at) - asTime(right.last_incorrect_at);
    if (incorrectDelta !== 0) return incorrectDelta;
    return left.mistake_id.localeCompare(right.mistake_id);
  });
}
