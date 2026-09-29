import {
  mistakeRecommendationResponseSchema,
  type MistakeRecommendation,
  type MistakeRecommendationResponse,
} from "@xuetu/contracts";

import { withTransaction, type SqlQueryablePool } from "../../database/client.js";
import { PracticeMistakeNotFoundError } from "./reliable-learning-loop.js";
import {
  MISTAKE_RECOMMENDATION_ALGORITHM_VERSION,
  eligibleMistake,
  rankMistakeRecommendations,
  scoreMistakeRecommendation,
  type MistakeRecommendationCandidate,
} from "./mistake-recommendation.js";

interface RecommendationRow {
  mistake_id: string;
  course_id: string;
  course_title: string;
  question_id: string;
  question_number: number | string;
  subject: string;
  concept_id: string;
  concept_title: string;
  wrong_count: number | string;
  next_review_at: Date | string;
  last_incorrect_at: Date | string;
  concept_correct_count: number | string;
  concept_incorrect_count: number | string;
  importance: "core" | "extended";
  match_method: "exact_question_tag";
  question_type: "choice";
}

interface LockedMistakeRow {
  mistake_id: string;
  status: "needs_review" | "mastered";
}

interface ReviewStateRow {
  mistake_id: string;
  status: "needs_review";
  next_review_at: Date | string;
  consecutive_success_count: number | string;
  last_processed_attempt_id: string | null;
}

export interface MistakeRecommendationFilter {
  courseId?: string;
  limit: number;
}

export interface MistakeRecommendationService {
  listRecommendations(
    userId: string,
    filter: MistakeRecommendationFilter,
  ): Promise<MistakeRecommendationResponse>;
  reopenMistake(userId: string, mistakeId: string): Promise<ReviewState>;
}

export interface ReviewState {
  mistake_id: string;
  status: "needs_review" | "mastered";
  next_review_at: string | null;
  consecutive_success_count: number;
  next_review_interval_days: number | null;
  last_processed_attempt_id: string | null;
}

export class PracticeMistakeNotMasteredError extends Error {
  constructor(readonly mistakeId: string) {
    super(`Practice mistake is not mastered: ${mistakeId}`);
    this.name = "PracticeMistakeNotMasteredError";
  }
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function count(value: number | string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Invalid mistake-recommendation evidence count.");
  }
  return parsed;
}

function asCandidate(row: RecommendationRow): MistakeRecommendationCandidate {
  return {
    mistake_id: row.mistake_id,
    concept_id: row.concept_id,
    match_method: row.match_method,
    question_type: row.question_type,
    answer_backed: true,
    wrong_count: count(row.wrong_count),
    next_review_at: iso(row.next_review_at),
    last_incorrect_at: iso(row.last_incorrect_at),
    concept_correct_count: count(row.concept_correct_count),
    concept_incorrect_count: count(row.concept_incorrect_count),
    importance: row.importance,
  };
}

function practiceHref(subject: string, conceptId: string, questionId: string) {
  return `/student/practice?subject=${encodeURIComponent(subject)}&concept_id=${encodeURIComponent(conceptId)}&question_id=${encodeURIComponent(questionId)}`;
}

function mapRecommendation(
  row: RecommendationRow,
  candidate: MistakeRecommendationCandidate,
  now: Date,
): MistakeRecommendation {
  const score = scoreMistakeRecommendation(candidate, now);
  return {
    mistake_id: row.mistake_id,
    course_id: row.course_id,
    course_title: row.course_title,
    question_id: row.question_id,
    question_number: Number(row.question_number),
    concept_id: row.concept_id,
    concept_title: row.concept_title,
    algorithm_version: MISTAKE_RECOMMENDATION_ALGORITHM_VERSION,
    next_review_at: candidate.next_review_at!,
    priority_score: score.priority_score,
    due_status: score.due_status,
    evidence_level: score.evidence_level,
    reason_lines: score.reason_lines,
    evidence_refs: [
      `mistake:${row.mistake_id}`,
      `review_state:${row.mistake_id}`,
      `concept:${row.concept_id}`,
    ],
    practice_href: practiceHref(row.subject, row.concept_id, row.question_id),
  };
}

export class PostgresMistakeRecommendation implements MistakeRecommendationService {
  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listRecommendations(
    userId: string,
    filter: MistakeRecommendationFilter,
  ): Promise<MistakeRecommendationResponse> {
    if (!userId.trim()) throw new Error("A student user ID is required.");
    if (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 20) {
      throw new Error("Recommendation limit must be between 1 and 20.");
    }

    const generatedAt = this.now();
    const result = await this.pool.query<RecommendationRow>(
      `SELECT
         mistake.mistake_id,
         mistake.course_id,
         course.title AS course_title,
         mistake.question_id,
         question.number AS question_number,
         question.subject,
         mistake.concept_id,
         concept.title AS concept_title,
         mistake.wrong_count,
         review_state.next_review_at,
         mistake.last_incorrect_at,
         concept_evidence.correct_count AS concept_correct_count,
         concept_evidence.incorrect_count AS concept_incorrect_count,
         concept.importance,
         link.match_method,
         question.question_type
       FROM practice_mistakes mistake
       JOIN practice_mistake_review_states review_state
         ON review_state.mistake_id = mistake.mistake_id
        AND review_state.user_id = mistake.user_id
       JOIN courses course ON course.course_id = mistake.course_id
       JOIN questions question ON question.question_id = mistake.question_id
       JOIN course_core_concepts concept ON concept.concept_id = mistake.concept_id
       JOIN course_concept_question_links link
         ON link.concept_id = mistake.concept_id
        AND link.question_id = mistake.question_id
        AND link.status = 'active'
        AND link.match_method = 'exact_question_tag'
       JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE evidence.outcome = 'correct')::int AS correct_count,
           COUNT(*) FILTER (WHERE evidence.outcome = 'incorrect')::int AS incorrect_count
         FROM learning_evidence evidence
         WHERE evidence.user_id = mistake.user_id
           AND evidence.concept_id = mistake.concept_id
           AND evidence.eligible_for_learning_state_update IS TRUE
           AND evidence.grading_mode = 'deterministic_choice'
           AND evidence.outcome IN ('correct', 'incorrect')
       ) concept_evidence ON true
       WHERE mistake.user_id = $1
         AND mistake.status = 'needs_review'
         AND question.question_type = 'choice'
         AND jsonb_array_length(question.answer_key) > 0
         AND review_state.next_review_at <= $2
         AND ($3::text IS NULL OR mistake.course_id = $3)`,
      [userId, generatedAt.toISOString(), filter.courseId?.trim() || null],
    );

    const rowsByMistakeId = new Map<string, RecommendationRow>();
    const candidates = result.rows.flatMap((row) => {
      const candidate = asCandidate(row);
      if (!eligibleMistake(candidate)) return [];
      rowsByMistakeId.set(candidate.mistake_id, row);
      return [candidate];
    });
    const items = rankMistakeRecommendations(candidates, generatedAt)
      .slice(0, filter.limit)
      .map((candidate) => {
        const row = rowsByMistakeId.get(candidate.mistake_id);
        if (!row) throw new Error("Mistake recommendation row is missing.");
        return mapRecommendation(row, candidate, generatedAt);
      });

    return mistakeRecommendationResponseSchema.parse({
      algorithm_version: MISTAKE_RECOMMENDATION_ALGORITHM_VERSION,
      generated_at: generatedAt.toISOString(),
      items,
    });
  }

  async reopenMistake(userId: string, mistakeId: string): Promise<ReviewState> {
    const reviewedAt = this.now().toISOString();
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query<LockedMistakeRow>(
        `SELECT mistake_id, status
         FROM practice_mistakes
         WHERE user_id = $1 AND mistake_id = $2
         FOR UPDATE`,
        [userId, mistakeId],
      );
      const mistake = locked.rows[0];
      if (!mistake) throw new PracticeMistakeNotFoundError(mistakeId);
      if (mistake.status !== "mastered") throw new PracticeMistakeNotMasteredError(mistakeId);

      await client.query(
        `UPDATE practice_mistakes
         SET status = 'needs_review', mastered_at = NULL, updated_at = $3
         WHERE user_id = $1 AND mistake_id = $2`,
        [userId, mistakeId, reviewedAt],
      );
      const state = await client.query<ReviewStateRow>(
        `INSERT INTO practice_mistake_review_states (
           mistake_id, user_id, next_review_at, consecutive_success_count,
           last_processed_attempt_id, last_reviewed_at, algorithm_version, created_at, updated_at
         ) VALUES ($1, $2, $3, 0, NULL, NULL, 'evidence_weighted_v1', $3, $3)
         ON CONFLICT (mistake_id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           next_review_at = EXCLUDED.next_review_at,
           consecutive_success_count = 0,
           last_processed_attempt_id = NULL,
           last_reviewed_at = NULL,
           algorithm_version = EXCLUDED.algorithm_version,
           updated_at = EXCLUDED.updated_at
         RETURNING mistake_id, 'needs_review'::text AS status, next_review_at,
                   consecutive_success_count, last_processed_attempt_id`,
        [mistakeId, userId, reviewedAt],
      );
      const row = state.rows[0];
      if (!row) throw new Error("Mistake review state was not written.");
      return {
        mistake_id: row.mistake_id,
        status: row.status,
        next_review_at: iso(row.next_review_at),
        consecutive_success_count: count(row.consecutive_success_count),
        next_review_interval_days: 0,
        last_processed_attempt_id: row.last_processed_attempt_id,
      };
    });
  }
}
