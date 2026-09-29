import { describe, expect, it } from "vitest";

import {
  ADAPTIVE_QUESTION_RANKING_VERSION,
  rankAdaptiveQuestionCandidates,
  scoreAdaptiveQuestionCandidate,
  type AdaptiveQuestionCandidate,
} from "../src/services/question-bank/adaptive-question-ranking.js";

const now = new Date("2026-08-24T06:00:00.000Z");

function candidate(overrides: Partial<AdaptiveQuestionCandidate> = {}): AdaptiveQuestionCandidate {
  return {
    question_id: "2020-01",
    due: "2026-08-23T06:00:00.000Z",
    retrievability: 0.2,
    attempt_count: 4,
    concept_correct_count: 1,
    concept_incorrect_count: 3,
    wrong_count: 2,
    importance: "core",
    ...overrides,
  };
}

describe("adaptive question ranking", () => {
  it("uses the exact FSRS 55/20/10/10/5 weighted formula", () => {
    const score = scoreAdaptiveQuestionCandidate(candidate(), now);

    expect(score.algorithm_version).toBe(ADAPTIVE_QUESTION_RANKING_VERSION);
    expect(score.components).toEqual({
      memory_risk: 0.8,
      concept_weakness: 0.75,
      repeated_error: 2 / 3,
      importance: 1,
      novelty: 0.2,
    });
    expect(score.priority_score).toBe(77);
    expect(score.evidence_level).toBe("grounded");
  });

  it("uses neutral memory risk and limited evidence for an unseen question", () => {
    const score = scoreAdaptiveQuestionCandidate(candidate({
      retrievability: null,
      due: null,
      attempt_count: 0,
      concept_correct_count: 0,
      concept_incorrect_count: 0,
      wrong_count: 0,
    }), now);

    expect(score.components.memory_risk).toBe(0.35);
    expect(score.components.novelty).toBe(1);
    expect(score.priority_score).toBe(34);
    expect(score.evidence_level).toBe("limited");
    expect(score.reason_lines).toContain("尚无稳定作答证据");
    expect(score.reason_lines).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/精准|难度|能力等级/u),
    ]));
  });

  it("stably breaks ties by due time, repeated error, novelty, and question id", () => {
    const base = {
      retrievability: 0.5,
      concept_correct_count: 1,
      concept_incorrect_count: 1,
      importance: "extended" as const,
    };
    const ranked = rankAdaptiveQuestionCandidates([
      candidate({ ...base, question_id: "2020-04", due: null, wrong_count: 1, attempt_count: 2 }),
      candidate({ ...base, question_id: "2020-03", due: null, wrong_count: 1, attempt_count: 2 }),
      candidate({ ...base, question_id: "2020-02", due: null, wrong_count: 1, attempt_count: 1 }),
      candidate({ ...base, question_id: "2020-01", due: "2026-08-22T06:00:00.000Z", wrong_count: 1, attempt_count: 2 }),
    ], now);

    expect(ranked.map((item) => item.question_id)).toEqual([
      "2020-02",
      "2020-01",
      "2020-03",
      "2020-04",
    ]);
  });

  it("rejects invalid evidence and timestamp inputs instead of emitting NaN", () => {
    expect(() => scoreAdaptiveQuestionCandidate(candidate({ retrievability: 1.1 }), now)).toThrow();
    expect(() => scoreAdaptiveQuestionCandidate(candidate({ attempt_count: -1 }), now)).toThrow();
    expect(() => scoreAdaptiveQuestionCandidate(candidate({ due: "not-a-date" }), now)).toThrow();
    expect(() => scoreAdaptiveQuestionCandidate(candidate(), new Date(Number.NaN))).toThrow();
  });
});
