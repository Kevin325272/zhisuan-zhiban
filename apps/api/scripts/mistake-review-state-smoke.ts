import { randomUUID } from "node:crypto";

import { createPostgresPool } from "../src/database/client.js";
import { readDatabaseConfig } from "../src/config/database.js";
import { loadLocalEnvironment } from "../src/config/local-env.js";

interface ReviewStateRow {
  status: "needs_review" | "mastered";
  next_review_at: Date | string | null;
  consecutive_success_count: number | string;
  last_processed_attempt_id: string | null;
  wrong_count: number | string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function iso(value: Date | string | null) {
  return value === null ? null : new Date(value).toISOString();
}

function expectedIso(value: string) {
  return new Date(value).toISOString();
}

async function main() {
  loadLocalEnvironment();
  const pool = createPostgresPool(readDatabaseConfig());
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `smoke_review_${suffix}`;

  try {
    await client.query("BEGIN");
    const questionResult = await client.query<{ question_id: string; course_id: string }>(
      `SELECT question.question_id, question.course_id
       FROM questions question
       WHERE question.question_type = 'choice'
         AND EXISTS (
           SELECT 1
           FROM course_catalog_entries catalog
           WHERE catalog.question_subject = question.subject
         )
       ORDER BY question.year DESC, question.number ASC
       LIMIT 1`,
    );
    const question = questionResult.rows[0];
    assert(question, "No answer-backed 408 choice question is available for review-state smoke testing.");

    await client.query(
      `INSERT INTO users (user_id, display_name, account_status, auth_source)
       VALUES ($1, '复习状态机冒烟用户', 'active', 'local_development')`,
      [userId],
    );

    let sequence = 0;
    async function recordEvidence(outcome: "correct" | "incorrect", createdAt: string) {
      sequence += 1;
      const attemptId = `smoke_attempt_${suffix}_${sequence}`;
      const evaluationId = `smoke_evaluation_${suffix}_${sequence}`;
      const evidenceId = `smoke_evidence_${suffix}_${sequence}`;
      await client.query(
        `INSERT INTO practice_attempts (
           attempt_id, user_id, course_id, question_id, answer_type,
           selected_option_ids, response_text, status, submitted_at
         ) VALUES ($1, $2, $3, $4, 'choice', '["A"]'::jsonb, NULL, 'evaluated', $5)`,
        [attemptId, userId, question.course_id, question.question_id, createdAt],
      );
      await client.query(
        `INSERT INTO evaluations (
           evaluation_id, attempt_id, grading_mode, status, is_correct, score,
           correct_option_ids, explanation_text, reference_solution, review_required, created_at
         ) VALUES ($1, $2, 'deterministic_choice', $3, $4, $5,
                   '["A"]'::jsonb, NULL, NULL, false, $6)`,
        [evaluationId, attemptId, outcome, outcome === "correct", outcome === "correct" ? 100 : 0, createdAt],
      );
      await client.query(
        `INSERT INTO learning_evidence (
           evidence_id, evaluation_id, attempt_id, user_id, course_id,
           question_id, concept_id, outcome, grading_mode, evidence_payload,
           eligible_for_learning_state_update, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'deterministic_choice',
                   '{}'::jsonb, true, $8)`,
        [evidenceId, evaluationId, attemptId, userId, question.course_id, question.question_id, outcome, createdAt],
      );
      return { attemptId, evaluationId };
    }

    async function currentState() {
      const result = await client.query<ReviewStateRow>(
        `SELECT mistake.status, review_state.next_review_at,
                review_state.consecutive_success_count, review_state.last_processed_attempt_id,
                mistake.wrong_count
         FROM practice_mistakes mistake
         JOIN practice_mistake_review_states review_state ON review_state.mistake_id = mistake.mistake_id
         WHERE mistake.user_id = $1 AND mistake.question_id = $2`,
        [userId, question.question_id],
      );
      const state = result.rows[0];
      assert(state, "Review state was not created for a deterministic incorrect answer.");
      return state;
    }

    const firstIncorrectAt = "2030-01-01T08:00:00.000Z";
    await recordEvidence("incorrect", firstIncorrectAt);
    let state = await currentState();
    assert(state.status === "needs_review", "Incorrect answer did not create a needs_review mistake.");
    assert(Number(state.consecutive_success_count) === 0, "Incorrect answer did not reset correct streak.");
    assert(iso(state.next_review_at) === expectedIso("2030-01-02T08:00:00.000Z"), "Incorrect answer did not schedule a one-day review.");

    await recordEvidence("correct", "2030-01-01T12:00:00.000Z");
    state = await currentState();
    assert(Number(state.consecutive_success_count) === 0, "An early correct answer advanced the review streak.");
    assert(iso(state.next_review_at) === expectedIso("2030-01-02T08:00:00.000Z"), "An early correct answer changed the due date.");

    const firstCorrect = await recordEvidence("correct", "2030-01-02T08:00:00.000Z");
    state = await currentState();
    assert(Number(state.consecutive_success_count) === 1, "First correct re-practice did not advance the streak.");
    assert(iso(state.next_review_at) === expectedIso("2030-01-05T08:00:00.000Z"), "First correct re-practice did not schedule a three-day review.");

    await client.query(
      `INSERT INTO learning_evidence (
         evidence_id, evaluation_id, attempt_id, user_id, course_id,
         question_id, concept_id, outcome, grading_mode, evidence_payload,
         eligible_for_learning_state_update, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, 'correct', 'deterministic_choice',
                 '{}'::jsonb, true, '2030-01-02T08:01:00.000Z')`,
      [
        `smoke_duplicate_${suffix}`,
        firstCorrect.evaluationId,
        firstCorrect.attemptId,
        userId,
        question.course_id,
        question.question_id,
      ],
    );
    state = await currentState();
    assert(Number(state.consecutive_success_count) === 1, "Duplicate attempt evidence advanced the review streak.");
    assert(iso(state.next_review_at) === expectedIso("2030-01-05T08:00:00.000Z"), "Duplicate attempt evidence changed the review date.");

    await recordEvidence("correct", "2030-01-05T08:00:00.000Z");
    state = await currentState();
    assert(Number(state.consecutive_success_count) === 2, "Second correct re-practice did not advance the streak.");
    assert(iso(state.next_review_at) === expectedIso("2030-01-12T08:00:00.000Z"), "Second correct re-practice did not schedule a seven-day review.");

    await recordEvidence("correct", "2030-01-12T08:00:00.000Z");
    state = await currentState();
    assert(state.status === "mastered", "Third correct re-practice did not mark the mistake mastered.");
    assert(Number(state.consecutive_success_count) === 3, "Mastered state did not retain the three-success threshold.");
    assert(state.next_review_at === null, "Mastered state still has a scheduled review.");

    await recordEvidence("incorrect", "2030-01-13T08:00:00.000Z");
    state = await currentState();
    assert(state.status === "needs_review", "A new incorrect answer did not reopen the mastered mistake.");
    assert(Number(state.consecutive_success_count) === 0, "A new incorrect answer did not reset the success streak.");
    assert(Number(state.wrong_count) === 2, "A new incorrect answer did not increment the wrong-answer count.");
    assert(iso(state.next_review_at) === expectedIso("2030-01-14T08:00:00.000Z"), "A new incorrect answer did not reset the one-day review schedule.");

    console.log("Mistake review state smoke passed: early=ignored, incorrect=1d, correct=3d/7d/mastered, duplicate=idempotent, reincorrect=reset, rollback=true");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
}

await main();
