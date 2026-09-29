export type ConceptEvidenceStatus =
  | "signal"
  | "developing"
  | "provisionally_stable"
  | "transfer_validated";

export interface ConceptEvidenceSnapshot {
  concept_id: string;
  status: ConceptEvidenceStatus;
  correct_attempt_ids: string[];
  correct_question_ids: string[];
  incorrect_attempt_ids: string[];
  first_correct_at: string | null;
  last_correct_at: string | null;
  pending_count: number;
  updated_at: string | null;
}

export interface ConceptEvidenceInput {
  outcome: "correct" | "incorrect" | "pending_review" | "skipped";
  question_id: string;
  attempt_id: string | null;
  evaluated_at: string;
  question_role: "anchor" | "contrast" | "transfer" | "ordinary";
  independent: boolean;
  eligible: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function emptyConceptEvidence(conceptId: string): ConceptEvidenceSnapshot {
  return {
    concept_id: conceptId,
    status: "signal",
    correct_attempt_ids: [],
    correct_question_ids: [],
    incorrect_attempt_ids: [],
    first_correct_at: null,
    last_correct_at: null,
    pending_count: 0,
    updated_at: null,
  };
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

/**
 * Applies one server-validated evidence event. The function deliberately
 * ignores duplicate question evidence and any event which is not eligible for
 * learning-state updates; callers persist the event separately for audit.
 */
export function applyConceptEvidence(
  current: ConceptEvidenceSnapshot,
  input: ConceptEvidenceInput,
): ConceptEvidenceSnapshot {
  const next: ConceptEvidenceSnapshot = {
    ...current,
    correct_attempt_ids: [...current.correct_attempt_ids],
    correct_question_ids: [...current.correct_question_ids],
    incorrect_attempt_ids: [...current.incorrect_attempt_ids],
  };

  if (input.outcome === "pending_review" || input.outcome === "skipped" || !input.eligible) {
    if (input.outcome === "pending_review") next.pending_count += 1;
    return next;
  }

  if (input.outcome === "incorrect") {
    if (input.attempt_id && !next.incorrect_attempt_ids.includes(input.attempt_id)) {
      next.incorrect_attempt_ids.push(input.attempt_id);
    }
    // A new reliable incorrect answer is a signal even after earlier progress.
    // Keep the historical transfer evidence, but make the current state
    // actionable again until a later correct answer resolves this signal.
    next.status = "signal";
    next.updated_at = input.evaluated_at;
    return next;
  }

  // A correct answer only supplies concept evidence when it is an independent
  // question. Repeating the same question is still useful for item-level FSRS,
  // but cannot advance the concept state.
  if (
    !input.independent
    || input.question_role === "anchor"
    || next.correct_question_ids.includes(input.question_id)
  ) {
    return next;
  }

  next.correct_question_ids = unique([...next.correct_question_ids, input.question_id]);
  if (input.attempt_id) next.correct_attempt_ids = unique([...next.correct_attempt_ids, input.attempt_id]);
  // The snapshot stores only first/last dates; callers that hydrate an existing
  // row retain those values. For a new event, derive them from the event date.
  if (!next.first_correct_at || input.evaluated_at < next.first_correct_at) {
    next.first_correct_at = input.evaluated_at;
  }
  if (!next.last_correct_at || input.evaluated_at > next.last_correct_at) {
    next.last_correct_at = input.evaluated_at;
  }
  // One correct answer can only resolve one pending incorrect signal. Keeping
  // the rest prevents a single lucky answer from clearing several unresolved
  // errors in the derived snapshot; the immutable event history is unchanged.
  if (next.incorrect_attempt_ids.length > 0) next.incorrect_attempt_ids.shift();

  const correctCount = next.correct_question_ids.length;
  const span = next.first_correct_at && next.last_correct_at
    ? new Date(next.last_correct_at).getTime() - new Date(next.first_correct_at).getTime()
    : 0;
  const noUnresolvedIncorrect = next.incorrect_attempt_ids.length === 0;
  if (noUnresolvedIncorrect && input.question_role === "transfer"
    && correctCount >= 3
    && next.correct_question_ids.length >= 2
    && span >= 7 * DAY_MS) {
    next.status = "transfer_validated";
  } else if (noUnresolvedIncorrect && correctCount >= 3
    && next.correct_question_ids.length >= 2
    && span >= 7 * DAY_MS) {
    next.status = "provisionally_stable";
  } else if (noUnresolvedIncorrect && next.status !== "transfer_validated") {
    next.status = "developing";
  }
  next.updated_at = input.evaluated_at;
  return next;
}
