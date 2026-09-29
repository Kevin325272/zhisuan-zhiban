import { randomUUID } from "node:crypto";

import { readDatabaseConfig } from "../src/config/database.js";
import { loadLocalEnvironment } from "../src/config/local-env.js";
import { createPostgresPool, type SqlQueryablePool } from "../src/database/client.js";
import { PostgresReliableLearningLoop } from "../src/services/question-bank/postgres-reliable-learning-loop.js";
import { studentVisibleTargetedQuestionSql } from "../src/services/question-bank/student-question-exposure.js";

interface LinkedQuestionRow {
  concept_id: string;
  concept_course_id: string;
  question_id: string;
  question_course_id: string;
  answer_key: unknown;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadLocalEnvironment();
  const pool = createPostgresPool(readDatabaseConfig());
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `smoke_clean_mastery_${suffix}`;

  try {
    await client.query("BEGIN");
    const linked = await client.query<LinkedQuestionRow>(
      `WITH eligible_links AS (
         SELECT link.concept_id, link.question_id
         FROM course_concept_question_links link
         JOIN questions q ON q.question_id = link.question_id
         JOIN question_learning_metadata meta ON meta.question_id = q.question_id
         WHERE link.status = 'active'
           AND ${studentVisibleTargetedQuestionSql}
       ), candidate AS (
         SELECT concept_id
         FROM eligible_links
         GROUP BY concept_id
         HAVING COUNT(DISTINCT question_id) >= 2
         ORDER BY concept_id
         LIMIT 1
       )
       SELECT link.concept_id, concept.course_id AS concept_course_id,
              question.question_id, question.course_id AS question_course_id,
              question.answer_key
       FROM candidate
       JOIN eligible_links link ON link.concept_id = candidate.concept_id
       JOIN course_core_concepts concept ON concept.concept_id = link.concept_id
       JOIN questions question ON question.question_id = link.question_id
       ORDER BY question.question_id
       LIMIT 2`,
    );
    assert(linked.rows.length === 2, "No concept has two active, reliably linked questions.");
    const [firstQuestion, secondQuestion] = linked.rows;
    assert(firstQuestion && secondQuestion, "Two linked questions were not loaded.");

    await client.query(
      `INSERT INTO users (user_id, display_name, account_status, auth_source)
       VALUES ($1, '无错掌握规则冒烟用户', 'active', 'local_development')`,
      [userId],
    );

    const attempts = [
      { question: firstQuestion, submittedAt: "2030-01-01T08:00:00.000Z" },
      { question: secondQuestion, submittedAt: "2030-01-04T08:00:00.000Z" },
      { question: firstQuestion, submittedAt: "2030-01-08T07:59:59.000Z" },
    ];
    for (const [index, item] of attempts.entries()) {
      const attemptId = `smoke_clean_attempt_${suffix}_${index + 1}`;
      const evaluationId = `smoke_clean_evaluation_${suffix}_${index + 1}`;
      await client.query(
        `INSERT INTO practice_attempts (
           attempt_id, user_id, course_id, question_id, concept_id,
           answer_type, selected_option_ids, response_text, status, submitted_at
         ) VALUES ($1, $2, $3, $4, $5, 'choice', $6::jsonb, NULL, 'evaluated', $7)`,
        [
          attemptId,
          userId,
          item.question.question_course_id,
          item.question.question_id,
          item.question.concept_id,
          JSON.stringify(item.question.answer_key),
          item.submittedAt,
        ],
      );
      await client.query(
        `INSERT INTO evaluations (
           evaluation_id, attempt_id, grading_mode, status, is_correct, score,
           correct_option_ids, explanation_text, reference_solution, review_required, created_at
         ) VALUES ($1, $2, 'deterministic_choice', 'correct', true, 100,
                   $3::jsonb, NULL, NULL, false, $4)`,
        [evaluationId, attemptId, JSON.stringify(item.question.answer_key), item.submittedAt],
      );
      await client.query(
        `INSERT INTO learning_evidence (
           evidence_id, evaluation_id, attempt_id, user_id, course_id,
           question_id, concept_id, outcome, grading_mode, evidence_payload,
           eligible_for_learning_state_update, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'correct',
                   'deterministic_choice', $8::jsonb, true, $9)`,
        [
          `smoke_clean_evidence_${suffix}_${index + 1}`,
          evaluationId,
          attemptId,
          userId,
          item.question.question_course_id,
          item.question.question_id,
          item.question.concept_id,
          JSON.stringify({ source: "synthetic_verification" }),
          item.submittedAt,
        ],
      );
    }

    const learningLoop = new PostgresReliableLearningLoop(client as unknown as SqlQueryablePool);
    const statusForCandidate = async () => {
      const record = await learningLoop.getLearningRecord(userId, firstQuestion.concept_course_id);
      return record.courses
        .flatMap((course) => course.concepts)
        .find((concept) => concept.concept_id === firstQuestion.concept_id)?.status;
    };

    const beforeThreshold = await statusForCandidate();
    assert(
      beforeThreshold === "practiced",
      `Evidence below seven days was promoted to mastered (course=${firstQuestion.concept_course_id}, concept=${firstQuestion.concept_id}, status=${String(beforeThreshold)}).`,
    );
    await client.query(
      `UPDATE practice_attempts SET submitted_at = '2030-01-08T08:00:00.000Z'
       WHERE attempt_id = $1`,
      [`smoke_clean_attempt_${suffix}_3`],
    );
    await client.query(
      `UPDATE evaluations SET created_at = '2030-01-08T08:00:00.000Z'
       WHERE evaluation_id = $1`,
      [`smoke_clean_evaluation_${suffix}_3`],
    );
    await client.query(
      `UPDATE learning_evidence SET created_at = '2030-01-08T08:00:00.000Z'
       WHERE evidence_id = $1`,
      [`smoke_clean_evidence_${suffix}_3`],
    );
    const atThreshold = await statusForCandidate();
    assert(atThreshold === "mastered", "Three clean attempts across seven days did not become mastered.");

    const mistakes = await client.query<{ count: number | string }>(
      "SELECT COUNT(*)::int AS count FROM practice_mistakes WHERE user_id = $1",
      [userId],
    );
    assert(Number(mistakes.rows[0]?.count) === 0, "Clean mastery smoke unexpectedly created a mistake.");
    console.log("Clean mastery smoke passed: attempts=3, breadth=2, before_7d=practiced, at_7d=mastered, mistakes=0, rollback=true");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
}

await main();
