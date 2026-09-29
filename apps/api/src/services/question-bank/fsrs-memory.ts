import {
  Rating,
  createEmptyCard,
  fsrs,
  type Card,
  type CardInput,
  type Grade,
} from "ts-fsrs";

export const FSRS_ALGORITHM_VERSION = "fsrs_v6_ts_fsrs_5_4_1" as const;

export interface StoredQuestionMemoryState {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  state: 0 | 1 | 2 | 3;
  last_review: string | null;
  last_attempt_id: string;
  algorithm_version: typeof FSRS_ALGORITHM_VERSION;
}

export interface DeterministicMemoryReview {
  attemptId: string;
  outcome: "correct" | "incorrect";
  reviewedAt: Date;
}

export interface QuestionMemoryAdvanceResult {
  state: StoredQuestionMemoryState;
  rating: "Again" | "Good";
  replayed: boolean;
}

const scheduler = fsrs({ enable_fuzz: false });

function validDate(value: Date, label: string) {
  if (Number.isNaN(value.getTime())) throw new Error(`Invalid ${label}.`);
  return value;
}

function storedDate(value: string | null, label: string): Date | undefined {
  if (value === null) return undefined;
  return validDate(new Date(value), label);
}

function finiteNumber(value: number, label: string, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`Invalid FSRS ${label}.`);
  }
  return value;
}

function count(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid FSRS ${label}.`);
  return value;
}

function cardInput(state: StoredQuestionMemoryState): CardInput {
  if (state.algorithm_version !== FSRS_ALGORITHM_VERSION) {
    throw new Error(`Unsupported question-memory algorithm: ${state.algorithm_version}.`);
  }
  if (!Number.isInteger(state.state) || state.state < 0 || state.state > 3) {
    throw new Error("Invalid FSRS card state.");
  }
  const lastReview = storedDate(state.last_review, "FSRS last review timestamp");
  return {
    due: validDate(new Date(state.due), "FSRS due timestamp"),
    stability: finiteNumber(state.stability, "stability"),
    difficulty: finiteNumber(state.difficulty, "difficulty"),
    elapsed_days: count(state.elapsed_days, "elapsed days"),
    scheduled_days: count(state.scheduled_days, "scheduled days"),
    reps: count(state.reps, "repetitions"),
    lapses: count(state.lapses, "lapses"),
    learning_steps: count(state.learning_steps, "learning steps"),
    state: state.state,
    ...(lastReview ? { last_review: lastReview } : {}),
  };
}

function storedCard(card: Card, attemptId: string): StoredQuestionMemoryState {
  if (!attemptId.trim()) throw new Error("Question-memory attempt id is required.");
  if (!Number.isInteger(card.state) || card.state < 0 || card.state > 3) {
    throw new Error("FSRS returned an invalid card state.");
  }
  return {
    due: validDate(card.due, "FSRS due timestamp").toISOString(),
    stability: finiteNumber(card.stability, "stability"),
    difficulty: finiteNumber(card.difficulty, "difficulty"),
    elapsed_days: count(card.elapsed_days, "elapsed days"),
    scheduled_days: count(card.scheduled_days, "scheduled days"),
    reps: count(card.reps, "repetitions"),
    lapses: count(card.lapses, "lapses"),
    learning_steps: count(card.learning_steps, "learning steps"),
    state: card.state,
    last_review: card.last_review
      ? validDate(card.last_review, "FSRS last review timestamp").toISOString()
      : null,
    last_attempt_id: attemptId,
    algorithm_version: FSRS_ALGORITHM_VERSION,
  };
}

export function advanceQuestionMemory(
  current: StoredQuestionMemoryState | null,
  review: DeterministicMemoryReview,
): QuestionMemoryAdvanceResult {
  const reviewedAt = validDate(review.reviewedAt, "review timestamp");
  if (!review.attemptId.trim()) throw new Error("Question-memory attempt id is required.");
  if (current) {
    cardInput(current);
    if (current.last_attempt_id === review.attemptId) {
      return {
        state: current,
        rating: review.outcome === "incorrect" ? "Again" : "Good",
        replayed: true,
      };
    }
  }

  const rating: Grade = review.outcome === "incorrect" ? Rating.Again : Rating.Good;
  const card = current ? cardInput(current) : createEmptyCard(reviewedAt);
  const next = scheduler.next(card, reviewedAt, rating);
  return {
    state: storedCard(next.card, review.attemptId),
    rating: rating === Rating.Again ? "Again" : "Good",
    replayed: false,
  };
}

export function questionMemoryRetrievability(
  state: StoredQuestionMemoryState,
  now: Date,
): number {
  const at = validDate(now, "retrievability timestamp");
  const value = scheduler.get_retrievability(cardInput(state), at, false);
  if (!Number.isFinite(value)) throw new Error("FSRS returned invalid retrievability.");
  return Math.min(1, Math.max(0, value));
}
