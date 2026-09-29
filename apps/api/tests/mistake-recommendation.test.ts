import { describe, expect, it } from "vitest";

import * as recommendation from "../src/services/question-bank/mistake-recommendation.js";

type Candidate = {
  mistake_id: string;
  concept_id: string | null;
  match_method: "exact_question_tag" | "fuzzy" | null;
  question_type: "choice" | "subjective";
  answer_backed: boolean;
  wrong_count: number;
  next_review_at: string | null;
  last_incorrect_at: string;
  concept_correct_count: number;
  concept_incorrect_count: number;
  importance: "core" | "extended";
};

type Scorer = {
  eligibleMistake?: (candidate: Candidate) => boolean;
  scoreMistakeRecommendation?: (candidate: Candidate, now: Date) => {
    priority_score: number;
    due_status: "due" | "upcoming";
    evidence_level: "limited" | "grounded";
    reason_lines: string[];
  };
  rankMistakeRecommendations?: (candidates: Candidate[], now: Date) => Candidate[];
};

const now = new Date("2026-08-16T08:00:00.000Z");

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    mistake_id: "mistake_001",
    concept_id: "ds_c02_02",
    match_method: "exact_question_tag",
    question_type: "choice",
    answer_backed: true,
    wrong_count: 1,
    next_review_at: "2026-08-16T08:00:00.000Z",
    last_incorrect_at: "2026-08-12T08:00:00.000Z",
    concept_correct_count: 1,
    concept_incorrect_count: 1,
    importance: "core",
    ...overrides,
  };
}

function scorer() {
  const value = recommendation as Scorer;
  expect(value.eligibleMistake).toBeTypeOf("function");
  expect(value.scoreMistakeRecommendation).toBeTypeOf("function");
  expect(value.rankMistakeRecommendations).toBeTypeOf("function");
  return value;
}

describe("evidence weighted mistake recommendation", () => {
  it("accepts only answer-backed choice mistakes with an exact concept relation", () => {
    const value = scorer();
    if (!value.eligibleMistake) return;

    expect(value.eligibleMistake(candidate())).toBe(true);
    expect(value.eligibleMistake(candidate({ concept_id: null }))).toBe(false);
    expect(value.eligibleMistake(candidate({ match_method: "fuzzy" }))).toBe(false);
    expect(value.eligibleMistake(candidate({ question_type: "subjective" }))).toBe(false);
    expect(value.eligibleMistake(candidate({ answer_backed: false }))).toBe(false);
    expect(value.eligibleMistake(candidate({ concept_correct_count: 0, concept_incorrect_count: 0 }))).toBe(false);
  });

  it("ranks an overdue, repeated core mistake above a newly due extended mistake", () => {
    const value = scorer();
    if (!value.scoreMistakeRecommendation) return;

    const overdueCore = value.scoreMistakeRecommendation(candidate({
      wrong_count: 3,
      next_review_at: "2026-08-09T08:00:00.000Z",
      concept_correct_count: 0,
      concept_incorrect_count: 3,
      importance: "core",
    }), now);
    const dueExtended = value.scoreMistakeRecommendation(candidate({
      wrong_count: 1,
      next_review_at: "2026-08-16T08:00:00.000Z",
      concept_correct_count: 2,
      concept_incorrect_count: 1,
      importance: "extended",
    }), now);

    expect(overdueCore.priority_score).toBeGreaterThan(dueExtended.priority_score);
    expect(overdueCore.reason_lines).toContain("同一题已错 3 次");
    expect(dueExtended.due_status).toBe("due");
  });

  it("keeps equal-score due records in deterministic review-time order", () => {
    const value = scorer();
    if (!value.rankMistakeRecommendations) return;

    const ranked = value.rankMistakeRecommendations([
      candidate({ mistake_id: "later", next_review_at: "2026-08-15T08:00:00.000Z" }),
      candidate({ mistake_id: "earlier", next_review_at: "2026-08-14T08:00:00.000Z" }),
    ], now);

    expect(ranked.map((item) => item.mistake_id)).toEqual(["earlier", "later"]);
  });
});
