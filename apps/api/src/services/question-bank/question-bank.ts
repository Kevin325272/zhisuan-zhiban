import type {
  AnswerSubmission,
  PastExamCatalogResponse,
  PracticeAttemptRecord,
  PracticeLearningEvidence,
  PracticeSelection,
  QuestionAssetReference,
  QuestionDto,
  QuestionEvaluationResult,
  QuestionPracticeItem,
} from "@xuetu/contracts";
import type { SqlClient } from "../../database/client.js";

export interface StoredQuestion {
  courseId: string;
  question: QuestionDto;
  correctOptionIds: string[];
  explanation: string | null;
  referenceSolution: string | null;
  answerAssets: QuestionAssetReference[];
}

/**
 * Server-only grading material frozen when a timed paper starts.  It is kept
 * separate from the public question payload so a later source withdrawal or
 * review-state change cannot invalidate an already-started paper.
 */
export interface SnapshotQuestionEvaluation {
  courseId: string;
  question: QuestionDto;
  correctOptionIds: string[];
  explanation: string | null;
  referenceSolution: string | null;
  answerAssets: QuestionAssetReference[];
}

export interface QuestionSelectionResult {
  items: QuestionPracticeItem[];
  total: number;
  limit: number;
  offset: number;
  context?: {
    concept_id: string;
    concept_title: string;
    course_id: string;
    course_title: string;
    subject: string;
    match_method: "exact_question_tag";
  } | null;
}

export interface QuestionEvaluationBundle {
  attempt: PracticeAttemptRecord;
  evaluation: QuestionEvaluationResult;
  evidence: PracticeLearningEvidence;
  idempotency_replayed?: boolean;
}

export interface QuestionBankService {
  readonly courseId: string;
  listPastExamPapers(userId: string): Promise<PastExamCatalogResponse>;
  openAsset(
    userId: string,
    questionId: string,
    assetId: string,
    attemptId?: string,
  ): Promise<QuestionAssetFile | null>;
  select(userId: string, selection: PracticeSelection): Promise<QuestionSelectionResult>;
  get(questionId: string): Promise<QuestionDto | null>;
  evaluate(
    userId: string,
    submission: AnswerSubmission,
    idempotencyKey: string,
  ): Promise<QuestionEvaluationBundle>;
  /**
   * Optional transaction-aware evaluator. PostgreSQL-backed callers use this
   * to keep an enclosing workflow atomic; lightweight adapters may only expose
   * the standalone evaluator above.
   */
  evaluateInTransaction?(
    client: SqlClient,
    userId: string,
    submission: AnswerSubmission,
    idempotencyKey: string,
  ): Promise<QuestionEvaluationBundle>;
}

export interface QuestionAssetFile {
  role: QuestionAssetReference["role"];
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  byteLength: number;
  content: Buffer;
}

export class QuestionNotFoundError extends Error {
  constructor(questionId: string) {
    super(`Question not found: ${questionId}`);
    this.name = "QuestionNotFoundError";
  }
}

export class QuestionSubmissionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "QuestionSubmissionError";
    this.code = code;
  }
}

interface EvaluationContext {
  userId: string;
  now: () => Date;
  createId: (prefix: string) => string;
  persistenceStatus: "not_persisted" | "persisted";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function evaluateStoredQuestion(
  stored: StoredQuestion,
  submission: AnswerSubmission,
  context: EvaluationContext,
): QuestionEvaluationBundle {
  if (submission.question_id !== stored.question.id) {
    throw new QuestionSubmissionError(
      "QUESTION_ID_MISMATCH",
      "Submission question does not match the loaded question.",
    );
  }
  if (submission.answer_type !== stored.question.type) {
    throw new QuestionSubmissionError(
      "ANSWER_TYPE_MISMATCH",
      "Submission answer type does not match the question type.",
    );
  }

  const createdAt = context.now().toISOString();
  const attemptId = context.createId("attempt");
  const evaluationId = context.createId("evaluation");
  const evidenceId = context.createId("evidence");

  if (submission.answer_type === "choice") {
    const selected = sortedUnique(submission.selected_option_ids);
    if (selected.length !== submission.selected_option_ids.length) {
      throw new QuestionSubmissionError(
        "DUPLICATE_SELECTED_OPTION",
        "Selected options must be unique.",
      );
    }
    const validOptions = new Set(stored.question.options.map((option) => option.option_id));
    if (selected.some((optionId) => !validOptions.has(optionId))) {
      throw new QuestionSubmissionError(
        "UNKNOWN_SELECTED_OPTION",
        "Selected option does not exist on the question.",
      );
    }
    const correctOptionIds = sortedUnique(stored.correctOptionIds);
    const isCorrect =
      selected.length === correctOptionIds.length &&
      selected.every((optionId, index) => optionId === correctOptionIds[index]);
    const score = isCorrect ? (100 as const) : (0 as const);
    const status = isCorrect ? ("correct" as const) : ("incorrect" as const);

    return {
      attempt: {
        attempt_id: attemptId,
        user_id: context.userId,
        course_id: stored.courseId,
        question_id: stored.question.id,
        concept_id: submission.concept_id ?? null,
        answer_type: "choice",
        selected_option_ids: selected,
        response_text: null,
        status: "evaluated",
        submitted_at: createdAt,
      },
      evaluation: {
        evaluation_id: evaluationId,
        submission_id: attemptId,
        question_id: stored.question.id,
        grading_mode: "deterministic_choice",
        status,
        is_correct: isCorrect,
        score,
        correct_option_ids: correctOptionIds,
        explanation: stored.explanation,
        reference_solution: stored.referenceSolution,
        answer_assets: stored.answerAssets,
        review_required: false,
        created_at: createdAt,
        source: stored.question.source,
      },
      evidence: {
        evidence_id: evidenceId,
        evaluation_id: evaluationId,
        submission_id: attemptId,
        question_id: stored.question.id,
        concept_id: submission.concept_id ?? null,
        subject: stored.question.subject,
        year: stored.question.year,
        question_type: stored.question.type,
        outcome: status,
        grading_mode: "deterministic_choice",
        selected_option_ids: selected,
        response_present: false,
        tags: stored.question.tags,
        review_required: false,
        eligible_for_learning_state_update: true,
        persistence_status: context.persistenceStatus,
        created_at: createdAt,
        source: stored.question.source,
      },
    };
  }

  return {
    attempt: {
      attempt_id: attemptId,
      user_id: context.userId,
      course_id: stored.courseId,
      question_id: stored.question.id,
      concept_id: submission.concept_id ?? null,
      answer_type: "subjective",
      selected_option_ids: null,
      response_text: submission.response_text,
      status: "pending_review",
      submitted_at: createdAt,
    },
    evaluation: {
      evaluation_id: evaluationId,
      submission_id: attemptId,
      question_id: stored.question.id,
      grading_mode: "ai_or_teacher_review_required",
      status: "pending_review",
      is_correct: null,
      score: null,
      correct_option_ids: [],
      explanation: stored.explanation,
      reference_solution: stored.referenceSolution,
      answer_assets: stored.answerAssets,
      review_required: true,
      created_at: createdAt,
      source: stored.question.source,
    },
    evidence: {
      evidence_id: evidenceId,
      evaluation_id: evaluationId,
      submission_id: attemptId,
      question_id: stored.question.id,
      concept_id: submission.concept_id ?? null,
      subject: stored.question.subject,
      year: stored.question.year,
      question_type: stored.question.type,
      outcome: "pending_review",
      grading_mode: "ai_or_teacher_review_required",
      selected_option_ids: null,
      response_present: true,
      tags: stored.question.tags,
      review_required: true,
      eligible_for_learning_state_update: false,
      persistence_status: context.persistenceStatus,
      created_at: createdAt,
      source: stored.question.source,
    },
  };
}
