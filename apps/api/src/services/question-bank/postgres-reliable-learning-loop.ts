import {
  learningRecordSchema,
  practiceMistakeRecordSchema,
  type LearningConceptProgress,
  type LearningCourseRecord,
  type PracticeMistakeRecord,
  type PracticeMistakeStatus,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";
import { buildPersonalLearningDashboard } from "./personal-learning-dashboard.js";
import { studentVisibleTargetedQuestionSql } from "./student-question-exposure.js";
import {
  PracticeMistakeNotFoundError,
  type PracticeMistakeFilter,
  type ReliableLearningLoopService,
} from "./reliable-learning-loop.js";

interface MistakeRow {
  mistake_id: string;
  course_id: string;
  course_title: string;
  question_id: string;
  question_year: number | null;
  question_number: number;
  subject: string;
  concept_id: string | null;
  concept_title: string | null;
  matched_tag: string | null;
  match_method: "exact_question_tag" | null;
  first_incorrect_attempt_id: string;
  last_incorrect_attempt_id: string;
  last_incorrect_evaluation_id: string;
  wrong_count: number;
  status: PracticeMistakeStatus;
  latest_attempt_outcome: "correct" | "incorrect" | "pending_review" | null;
  first_incorrect_at: Date | string;
  last_incorrect_at: Date | string;
  mastered_at: Date | string | null;
  updated_at: Date | string;
}

interface ConceptProgressRow {
  course_id: string;
  course_title: string;
  display_order: number;
  concept_id: string;
  concept_title: string;
  is_reading: boolean;
  attempt_count: number | string;
  correct_count: number | string;
  correct_question_count: number | string;
  first_correct_at: Date | string | null;
  last_correct_at: Date | string | null;
  incorrect_count: number | string;
  mistake_count: number | string;
  course_attempt_count?: number | string;
  course_correct_count?: number | string;
  course_incorrect_count?: number | string;
  practice_question_count: number | string;
  needs_review: boolean;
  mastered: boolean;
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMistake(row: MistakeRow): PracticeMistakeRecord {
  return practiceMistakeRecordSchema.parse({
    ...row,
    question_year: row.question_year === null ? null : Number(row.question_year),
    question_number: Number(row.question_number),
    wrong_count: Number(row.wrong_count),
    first_incorrect_at: iso(row.first_incorrect_at),
    last_incorrect_at: iso(row.last_incorrect_at),
    mastered_at: row.mastered_at ? iso(row.mastered_at) : null,
    updated_at: iso(row.updated_at),
  });
}

const mistakeColumns = `
  m.mistake_id, m.course_id, course.title AS course_title,
  m.question_id, q.year AS question_year, q.number AS question_number, q.subject,
  m.concept_id, concept.title AS concept_title,
  link.matched_tag, link.match_method,
  m.first_incorrect_attempt_id, m.last_incorrect_attempt_id,
  m.last_incorrect_evaluation_id, m.wrong_count, m.status,
  latest.status AS latest_attempt_outcome,
  m.first_incorrect_at, m.last_incorrect_at, m.mastered_at, m.updated_at
`;

export class PostgresReliableLearningLoop implements ReliableLearningLoopService {
  constructor(private readonly pool: SqlQueryablePool) {}

  async listMistakes(userId: string, filter: PracticeMistakeFilter) {
    const conditions = ["m.user_id = $1"];
    const parameters: unknown[] = [userId];
    const add = (column: string, value: unknown) => {
      parameters.push(value);
      conditions.push(`${column} = $${parameters.length}`);
    };
    if (filter.courseId) add("m.course_id", filter.courseId);
    if (filter.conceptId) add("m.concept_id", filter.conceptId);
    if (filter.status) add("m.status", filter.status);

    const result = await this.pool.query<MistakeRow>(
      `SELECT ${mistakeColumns}
       FROM practice_mistakes m
       JOIN courses course ON course.course_id = m.course_id
       JOIN questions q ON q.question_id = m.question_id
       LEFT JOIN course_core_concepts concept ON concept.concept_id = m.concept_id
       LEFT JOIN course_concept_question_links link
         ON link.concept_id = m.concept_id
        AND link.question_id = m.question_id
        AND link.status = 'active'
       LEFT JOIN LATERAL (
         SELECT evaluation.status
         FROM practice_attempts attempt
         JOIN evaluations evaluation ON evaluation.attempt_id = attempt.attempt_id
         WHERE attempt.user_id = m.user_id AND attempt.question_id = m.question_id
         ORDER BY attempt.submitted_at DESC
         LIMIT 1
       ) latest ON true
       WHERE ${conditions.join(" AND ")}
       ORDER BY (m.status = 'needs_review') DESC, m.updated_at DESC`,
      parameters,
    );
    return { items: result.rows.map(mapMistake) };
  }

  async updateMistake(
    userId: string,
    mistakeId: string,
    status: PracticeMistakeStatus,
  ): Promise<PracticeMistakeRecord> {
    const updated = await this.pool.query(
      `UPDATE practice_mistakes
       SET status = $3,
           mastered_at = CASE WHEN $3 = 'mastered' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE user_id = $1 AND mistake_id = $2`,
      [userId, mistakeId, status],
    );
    if ((updated.rowCount ?? 0) === 0) throw new PracticeMistakeNotFoundError(mistakeId);
    const result = await this.pool.query<MistakeRow>(
      `SELECT ${mistakeColumns}
       FROM practice_mistakes m
       JOIN courses course ON course.course_id = m.course_id
       JOIN questions q ON q.question_id = m.question_id
       LEFT JOIN course_core_concepts concept ON concept.concept_id = m.concept_id
       LEFT JOIN course_concept_question_links link
         ON link.concept_id = m.concept_id AND link.question_id = m.question_id AND link.status = 'active'
       LEFT JOIN LATERAL (
         SELECT evaluation.status
         FROM practice_attempts attempt
         JOIN evaluations evaluation ON evaluation.attempt_id = attempt.attempt_id
         WHERE attempt.user_id = m.user_id AND attempt.question_id = m.question_id
         ORDER BY attempt.submitted_at DESC LIMIT 1
       ) latest ON true
       WHERE m.user_id = $1 AND m.mistake_id = $2`,
      [userId, mistakeId],
    );
    const row = result.rows[0];
    if (!row) throw new PracticeMistakeNotFoundError(mistakeId);
    return mapMistake(row);
  }

  async getLearningRecord(userId: string, courseId?: string) {
    const result = await this.pool.query<ConceptProgressRow>(
      `WITH course_evidence_totals AS (
         SELECT catalog.course_id,
                COUNT(DISTINCT evidence.attempt_id)::int AS attempt_count,
                COUNT(DISTINCT evidence.attempt_id)
                  FILTER (WHERE evidence.outcome = 'correct')::int AS correct_count,
                COUNT(DISTINCT evidence.attempt_id)
                  FILTER (WHERE evidence.outcome = 'incorrect')::int AS incorrect_count
         FROM learning_evidence evidence
         JOIN questions evidence_question
           ON evidence_question.question_id = evidence.question_id
         JOIN course_catalog_entries catalog
           ON catalog.question_subject = evidence_question.subject
         WHERE evidence.user_id = $1
           AND evidence.eligible_for_learning_state_update = true
         GROUP BY catalog.course_id
       )
       SELECT course.course_id, course.title AS course_title, catalog.display_order,
              concept.concept_id, concept.title AS concept_title,
              COALESCE(course_totals.attempt_count, 0)::int AS course_attempt_count,
              COALESCE(course_totals.correct_count, 0)::int AS course_correct_count,
              COALESCE(course_totals.incorrect_count, 0)::int AS course_incorrect_count,
              EXISTS (
                SELECT 1
                FROM course_reading_history progress
                JOIN course_concept_sources source ON source.chunk_id = progress.chunk_id
                WHERE progress.user_id = $1
                  AND progress.course_id = course.course_id
                  AND source.concept_id = concept.concept_id
              ) AS is_reading,
              COUNT(DISTINCT attempt.attempt_id)::int AS attempt_count,
              COUNT(DISTINCT attempt.attempt_id) FILTER (WHERE evidence.outcome = 'correct')::int AS correct_count,
              COUNT(DISTINCT attempt.question_id) FILTER (WHERE evidence.outcome = 'correct')::int AS correct_question_count,
              MIN(evidence.created_at) FILTER (WHERE evidence.outcome = 'correct') AS first_correct_at,
              MAX(evidence.created_at) FILTER (WHERE evidence.outcome = 'correct') AS last_correct_at,
              COUNT(DISTINCT attempt.attempt_id) FILTER (WHERE evidence.outcome = 'incorrect')::int AS incorrect_count,
              COUNT(DISTINCT mistake.mistake_id)::int AS mistake_count,
              (
                SELECT COUNT(DISTINCT q.question_id)::int
                 FROM course_concept_question_links link
                 JOIN questions q ON q.question_id = link.question_id
                 JOIN question_learning_metadata meta ON meta.question_id = q.question_id
                 JOIN course_catalog_entries question_catalog
                   ON question_catalog.course_id = course.course_id
                  AND question_catalog.question_subject = q.subject
                  WHERE link.concept_id = concept.concept_id
                    AND link.status = 'active'
                   AND ${studentVisibleTargetedQuestionSql}
              ) AS practice_question_count,
              COALESCE(bool_or(mistake.status = 'needs_review'), false) AS needs_review,
              COALESCE(bool_or(mistake.status = 'mastered'), false) AS mastered
       FROM course_catalog_entries catalog
       JOIN courses course ON course.course_id = catalog.course_id
       JOIN course_core_concepts concept ON concept.course_id = course.course_id
       LEFT JOIN course_evidence_totals course_totals ON course_totals.course_id = course.course_id
       LEFT JOIN learning_evidence evidence
         ON evidence.user_id = $1
        AND evidence.concept_id = concept.concept_id
        AND evidence.eligible_for_learning_state_update = true
       LEFT JOIN practice_attempts attempt
         ON attempt.attempt_id = evidence.attempt_id
        AND attempt.user_id = $1
       LEFT JOIN practice_mistakes mistake
         ON mistake.user_id = $1 AND mistake.concept_id = concept.concept_id
       WHERE ($2::text IS NULL OR course.course_id = $2)
       GROUP BY course.course_id, course.title, catalog.display_order,
                concept.concept_id, concept.title,
                course_totals.attempt_count, course_totals.correct_count,
                course_totals.incorrect_count
       ORDER BY catalog.display_order, concept.concept_id`,
      [userId, courseId ?? null],
    );

    const grouped = new Map<string, LearningCourseRecord>();
    for (const row of result.rows) {
      const attemptCount = Number(row.attempt_count);
      const correctCount = Number(row.correct_count);
      const correctQuestionCount = Number(row.correct_question_count ?? 0);
      const incorrectCount = Number(row.incorrect_count);
      const mistakeCount = Number(row.mistake_count);
      const practiceQuestionCount = Number(row.practice_question_count);
      const hasCourseTotals = row.course_attempt_count !== undefined;
      const requiredQuestionBreadth = Math.min(2, practiceQuestionCount);
      const firstCorrectAt = row.first_correct_at ? new Date(row.first_correct_at).getTime() : null;
      const lastCorrectAt = row.last_correct_at ? new Date(row.last_correct_at).getTime() : null;
      const stableCorrectEvidence = firstCorrectAt !== null
        && lastCorrectAt !== null
        && lastCorrectAt - firstCorrectAt >= 7 * 24 * 60 * 60 * 1000;
      const masterySupported = !row.needs_review
        && correctCount >= 3
        && requiredQuestionBreadth > 0
        && correctQuestionCount >= requiredQuestionBreadth
        // A mastered mistake is item-level evidence. It must never bypass the
        // concept-level seven-day stability window.
        && stableCorrectEvidence;
      const status: LearningConceptProgress["status"] = row.needs_review
        ? "needs_review"
        : masterySupported
          ? "mastered"
          : attemptCount > 0
            ? "practiced"
            : row.is_reading
              ? "reading"
              : "not_started";
      const concept: LearningConceptProgress = {
        concept_id: row.concept_id,
        title: row.concept_title,
        status,
        attempt_count: attemptCount,
        correct_count: correctCount,
        incorrect_count: incorrectCount,
        mistake_count: mistakeCount,
        practice_question_count: practiceQuestionCount,
      };
      const course = grouped.get(row.course_id) ?? {
        course_id: row.course_id,
        title: row.course_title,
        concept_count: 0,
        started_concept_count: 0,
        practice_attempt_count: hasCourseTotals ? Number(row.course_attempt_count) : 0,
        correct_count: hasCourseTotals ? Number(row.course_correct_count ?? 0) : 0,
        incorrect_count: hasCourseTotals ? Number(row.course_incorrect_count ?? 0) : 0,
        needs_review_count: 0,
        mastered_count: 0,
        concepts: [],
      };
      course.concept_count += 1;
      course.started_concept_count += status === "not_started" ? 0 : 1;
      if (!hasCourseTotals) {
        course.practice_attempt_count += attemptCount;
        course.correct_count += correctCount;
        course.incorrect_count += incorrectCount;
      }
      course.needs_review_count += status === "needs_review" ? 1 : 0;
      course.mastered_count += status === "mastered" ? 1 : 0;
      course.concepts.push(concept);
      grouped.set(row.course_id, course);
    }

    return learningRecordSchema.parse({
      courses: [...grouped.values()],
      generated_at: new Date().toISOString(),
    });
  }

  async getPersonalLearningDashboard(userId: string) {
    const [record, mistakes] = await Promise.all([
      this.getLearningRecord(userId),
      this.listMistakes(userId, {}),
    ]);
    return buildPersonalLearningDashboard(record, mistakes.items);
  }
}
