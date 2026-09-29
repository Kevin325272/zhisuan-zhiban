import { readDatabaseConfig } from "../src/config/database.js";
import { loadLocalEnvironment } from "../src/config/local-env.js";
import { createPostgresPool } from "../src/database/client.js";
import { PostgresReliableLearningLoop } from "../src/services/question-bank/postgres-reliable-learning-loop.js";

interface CountRow {
  eligible_attempts: number | string;
  unattributed_attempts: number | string;
  pending_attempts: number | string;
}

interface CandidateRow {
  user_id: string;
}

interface CourseEvidenceRow {
  course_id: string;
  total_attempts: number | string;
  unattributed_attempts: number | string;
  attributed_attempts: number | string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadLocalEnvironment();
  const pool = createPostgresPool(readDatabaseConfig());
  try {
    const counts = await pool.query<CountRow>(
      `SELECT COUNT(DISTINCT attempt_id)::int AS eligible_attempts,
              COUNT(DISTINCT attempt_id) FILTER (WHERE concept_id IS NULL)::int
                AS unattributed_attempts,
              COUNT(DISTINCT attempt_id) FILTER (WHERE outcome = 'pending_review')::int
                AS pending_attempts
       FROM learning_evidence
       WHERE eligible_for_learning_state_update = true`,
    );
    const count = counts.rows[0];
    assert(count, "Learning evidence totals could not be loaded.");
    assert(Number(count.pending_attempts) === 0, "Pending-review evidence can update learning state.");

    const candidate = await pool.query<CandidateRow>(
      `SELECT user_id
       FROM learning_evidence
       WHERE eligible_for_learning_state_update = true
       GROUP BY user_id
       ORDER BY COUNT(DISTINCT attempt_id)
                  FILTER (WHERE concept_id IS NULL) DESC,
                COUNT(DISTINCT attempt_id) DESC,
                user_id
       LIMIT 1`,
    );
    const userId = candidate.rows[0]?.user_id;
    assert(userId, "No deterministic evidence is available for the integrity check.");

    const expected = await pool.query<CourseEvidenceRow>(
      `SELECT catalog.course_id,
              COUNT(DISTINCT evidence.attempt_id)::int AS total_attempts,
              COUNT(DISTINCT evidence.attempt_id)
                FILTER (WHERE evidence.concept_id IS NULL)::int AS unattributed_attempts,
              COUNT(DISTINCT evidence.attempt_id)
                FILTER (WHERE evidence.concept_id IS NOT NULL)::int AS attributed_attempts
       FROM learning_evidence evidence
       JOIN questions question ON question.question_id = evidence.question_id
       JOIN course_catalog_entries catalog
         ON catalog.question_subject = question.subject
       WHERE evidence.user_id = $1
         AND evidence.eligible_for_learning_state_update = true
       GROUP BY catalog.course_id
       ORDER BY catalog.course_id`,
      [userId],
    );
    assert(expected.rows.length > 0, "The selected evidence cannot be mapped to a 408 course.");

    const record = await new PostgresReliableLearningLoop(pool).getLearningRecord(userId);
    let mappedCourseTotal = 0;
    let conceptTotal = 0;
    for (const row of expected.rows) {
      const course = record.courses.find((item) => item.course_id === row.course_id);
      assert(course, `Mapped course ${row.course_id} is missing from the learning record.`);
      const courseConceptTotal = course.concepts.reduce(
        (sum, concept) => sum + concept.attempt_count,
        0,
      );
      const expectedTotal = Number(row.total_attempts);
      const expectedAttributed = Number(row.attributed_attempts);
      const expectedUnattributed = Number(row.unattributed_attempts);
      assert(
        course.practice_attempt_count === expectedTotal,
        `Course total mismatch for ${row.course_id}.`,
      );
      assert(
        courseConceptTotal === expectedAttributed,
        `Concept attribution mismatch for ${row.course_id}.`,
      );
      assert(
        course.practice_attempt_count - courseConceptTotal === expectedUnattributed,
        `Unattributed evidence was lost or assigned to a concept for ${row.course_id}.`,
      );
      mappedCourseTotal += course.practice_attempt_count;
      conceptTotal += courseConceptTotal;
    }

    console.log(
      `Learning profile integrity smoke passed: eligible=${Number(count.eligible_attempts)}, `
      + `unattributed=${Number(count.unattributed_attempts)}, candidate_courses=${expected.rows.length}, `
      + `mapped_course_total=${mappedCourseTotal}, concept_total=${conceptTotal}, pending=0`,
    );
  } finally {
    await pool.end();
  }
}

await main();
