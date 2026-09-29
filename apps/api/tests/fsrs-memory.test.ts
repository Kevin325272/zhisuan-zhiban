import { describe, expect, it } from "vitest";

import {
  FSRS_ALGORITHM_VERSION,
  advanceQuestionMemory,
  questionMemoryRetrievability,
  type StoredQuestionMemoryState,
} from "../src/services/question-bank/fsrs-memory.js";

const reviewTime = new Date("2026-08-24T06:00:00.000Z");

describe("FSRS question memory adapter", () => {
  it("maps deterministic incorrect evidence to Again and persists a versioned card", () => {
    const result = advanceQuestionMemory(null, {
      attemptId: "attempt_wrong_001",
      outcome: "incorrect",
      reviewedAt: reviewTime,
    });

    expect(result.replayed).toBe(false);
    expect(result.rating).toBe("Again");
    expect(result.state).toMatchObject({
      algorithm_version: FSRS_ALGORITHM_VERSION,
      last_attempt_id: "attempt_wrong_001",
      reps: 1,
    });
    expect(new Date(result.state.due).getTime()).toBeGreaterThan(reviewTime.getTime());
    expect(result.state.last_review).toBe(reviewTime.toISOString());
  });

  it("maps deterministic correct evidence to Good and increases the next due date", () => {
    const first = advanceQuestionMemory(null, {
      attemptId: "attempt_correct_001",
      outcome: "correct",
      reviewedAt: reviewTime,
    });
    const nextReview = new Date("2026-08-25T06:00:00.000Z");
    const second = advanceQuestionMemory(first.state, {
      attemptId: "attempt_correct_002",
      outcome: "correct",
      reviewedAt: nextReview,
    });

    expect(first.rating).toBe("Good");
    expect(second.rating).toBe("Good");
    expect(second.state.reps).toBe(2);
    expect(new Date(second.state.due).getTime()).toBeGreaterThan(nextReview.getTime());
  });

  it("does not advance the same attempt twice", () => {
    const first = advanceQuestionMemory(null, {
      attemptId: "attempt_same_001",
      outcome: "incorrect",
      reviewedAt: reviewTime,
    });
    const replay = advanceQuestionMemory(first.state, {
      attemptId: "attempt_same_001",
      outcome: "incorrect",
      reviewedAt: new Date("2026-08-25T06:00:00.000Z"),
    });

    expect(replay.replayed).toBe(true);
    expect(replay.state).toEqual(first.state);
  });

  it("serializes database state without exposing library-specific objects", () => {
    const state: StoredQuestionMemoryState = {
      due: "2026-08-27T06:00:00.000Z",
      stability: 2.5,
      difficulty: 5.1,
      elapsed_days: 1,
      scheduled_days: 2,
      reps: 2,
      lapses: 0,
      learning_steps: 0,
      state: 2,
      last_review: "2026-08-25T06:00:00.000Z",
      last_attempt_id: "attempt_002",
      algorithm_version: FSRS_ALGORITHM_VERSION,
    };

    const retrievability = questionMemoryRetrievability(
      state,
      new Date("2026-08-26T06:00:00.000Z"),
    );
    expect(retrievability).toBeGreaterThanOrEqual(0);
    expect(retrievability).toBeLessThanOrEqual(1);
  });

  it("rejects invalid timestamps and unsupported stored versions", () => {
    expect(() => advanceQuestionMemory(null, {
      attemptId: "attempt_invalid",
      outcome: "correct",
      reviewedAt: new Date(Number.NaN),
    })).toThrow("review timestamp");

    expect(() => questionMemoryRetrievability({
      due: "not-a-date",
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      learning_steps: 0,
      state: 1,
      last_review: reviewTime.toISOString(),
      last_attempt_id: "attempt_001",
      algorithm_version: "legacy" as typeof FSRS_ALGORITHM_VERSION,
    }, reviewTime)).toThrow();
  });
});
