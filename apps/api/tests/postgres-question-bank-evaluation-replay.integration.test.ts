import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AnswerSubmission, QuestionAssetReference } from "@xuetu/contracts";

import type { SqlQueryablePool } from "../src/database/client.js";
import { loadMigrations, runMigrations } from "../src/database/migrate.js";
import { QuestionNotFoundError } from "../src/services/question-bank/question-bank.js";
import { PostgresQuestionBank } from "../src/services/question-bank/postgres-question-bank.js";

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim() ?? "";
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const schemaName = `xuetu_question_replay_it_${process.pid}_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;

const ownerId = "user_question_replay_it_owner";
const otherId = "user_question_replay_it_other";
const courseId = "course_question_replay_it";
const batchId = "batch_question_replay_it";
const questionId = "question_replay_it_primary";
const idempotencyKey = "question-replay-it-shared-key";
const newIdempotencyKey = "question-replay-it-new-key";
const fixtureAt = new Date("2026-09-03T05:00:00.000Z");

const questionAssetId = "asset_question_replay_it_question";
const optionAssetId = "asset_question_replay_it_option";
const explanationAssetId = "asset_question_replay_it_explanation";
const solutionAssetId = "asset_question_replay_it_solution";

const assetFixtures = [
  {
    assetId: questionAssetId,
    role: "question",
    optionId: null,
    content: Buffer.from("question-replay-question-image", "utf8"),
  },
  {
    assetId: optionAssetId,
    role: "option",
    optionId: "A",
    content: Buffer.from("question-replay-option-image", "utf8"),
  },
  {
    assetId: explanationAssetId,
    role: "explanation",
    optionId: null,
    content: Buffer.from("question-replay-explanation-image", "utf8"),
  },
  {
    assetId: solutionAssetId,
    role: "solution",
    optionId: null,
    content: Buffer.from("question-replay-solution-image", "utf8"),
  },
] as const;

const submission: AnswerSubmission = {
  question_id: questionId,
  answer_type: "choice",
  selected_option_ids: ["B"],
};

function assertSafeSchemaName(value: string) {
  if (!/^xuetu_question_replay_it_[a-z0-9_]+$/u.test(value)) {
    throw new Error("Unsafe PostgreSQL integration-test schema name.");
  }
}

function assetReference(
  assetId: string,
  role: QuestionAssetReference["role"],
  optionId: string | null,
): QuestionAssetReference {
  return {
    asset_id: assetId,
    role,
    option_id: optionId,
    reference_kind: "local_file",
    source_reference: `question-assets/${assetId}.png`,
    mime_type: "image/png",
    availability: "authenticated_api",
  };
}

async function snapshotQuestionState(pool: Pool, userId: string) {
  const idempotency = await pool.query(
    `SELECT *
       FROM practice_evaluation_idempotency
      WHERE user_id = $1
      ORDER BY idempotency_key`,
    [userId],
  );
  const attempts = await pool.query(
    `SELECT *
       FROM practice_attempts
      WHERE user_id = $1 AND question_id = $2
      ORDER BY attempt_id`,
    [userId, questionId],
  );
  const evaluations = await pool.query(
    `SELECT evaluation.*
       FROM evaluations evaluation
       JOIN practice_attempts attempt ON attempt.attempt_id = evaluation.attempt_id
      WHERE attempt.user_id = $1 AND attempt.question_id = $2
      ORDER BY evaluation.evaluation_id`,
    [userId, questionId],
  );
  const evidence = await pool.query(
    `SELECT *
       FROM learning_evidence
      WHERE user_id = $1 AND question_id = $2
      ORDER BY evidence_id`,
    [userId, questionId],
  );
  const memory = await pool.query(
    `SELECT *
       FROM student_question_memory_states
      WHERE user_id = $1 AND question_id = $2
      ORDER BY question_id`,
    [userId, questionId],
  );
  const mistakes = await pool.query(
    `SELECT *
       FROM practice_mistakes
      WHERE user_id = $1 AND question_id = $2
      ORDER BY mistake_id`,
    [userId, questionId],
  );
  const mistakeReviews = await pool.query(
    `SELECT review.*
       FROM practice_mistake_review_states review
       JOIN practice_mistakes mistake ON mistake.mistake_id = review.mistake_id
      WHERE mistake.user_id = $1 AND mistake.question_id = $2
      ORDER BY review.mistake_id`,
    [userId, questionId],
  );
  return {
    idempotency: idempotency.rows,
    attempts: attempts.rows,
    evaluations: evaluations.rows,
    evidence: evidence.rows,
    memory: memory.rows,
    mistakes: mistakes.rows,
    mistakeReviews: mistakeReviews.rows,
  };
}

describeWithPostgres("PostgreSQL question evaluation idempotency", () => {
  let adminPool: Pool | undefined;
  let testPool: Pool | undefined;
  let schemaCreated = false;

  beforeAll(async () => {
    assertSafeSchemaName(schemaName);
    adminPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: "xuetu-question-replay-isolation-admin",
    });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;

    testPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      application_name: "xuetu-question-replay-isolation",
      options: `-c search_path=${schemaName} -c statement_timeout=15000`,
    });
    await runMigrations(testPool as unknown as SqlQueryablePool, loadMigrations());

    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users(
           user_id, display_name, account_status, auth_source, created_at, updated_at
         ) VALUES ($1, '题库重放集成测试学生', 'active', 'local_development', $3, $3),
                  ($2, '题库重放集成测试其他学生', 'active', 'local_development', $3, $3)`,
        [ownerId, otherId, fixtureAt.toISOString()],
      );
      await client.query(
        `INSERT INTO courses(
           course_id, course_code, title, discipline, status, created_by, created_at, updated_at
         ) VALUES ($1, 'QUESTION-REPLAY-IT', '题库重放集成测试', 'computer_science',
                   'active', $2, $3, $3)`,
        [courseId, ownerId, fixtureAt.toISOString()],
      );
      await client.query(
        `INSERT INTO course_catalog_entries(
           course_id, slug, question_subject, summary, display_order,
           material_status, created_at, updated_at
         ) VALUES ($1, 'question-replay-it', '重放测试科目', '题库重放集成测试目录项',
                   32000, 'available', $2, $2)`,
        [courseId, fixtureAt.toISOString()],
      );
      await client.query(
        `INSERT INTO question_import_batches(
           import_batch_id, dataset_id, archive_sha256, source_provider, source_url,
           license_status, usage_scope, status, question_count, started_at, completed_at
         ) VALUES ($1, 'question_replay_it', $2, 'self_authored_integration_test', NULL,
                   'verified', 'authorized_product_use', 'completed', 1, $3, $3)`,
        [batchId, "b".repeat(64), fixtureAt.toISOString()],
      );

      const topLevelAssets = assetFixtures.map((asset) =>
        assetReference(asset.assetId, asset.role, asset.optionId)
      );
      const options = [
        {
          option_id: "A",
          text: "正确选项 A",
          assets: [assetReference(optionAssetId, "option", "A")],
        },
        { option_id: "B", text: "错误选项 B", assets: [] },
      ];
      await client.query(
        `INSERT INTO questions(
           question_id, course_id, import_batch_id, year, number, subject,
           question_type, multiple, question_text, options, tags, assets,
           answer_key, explanation_text, solution_text, source_url,
           license_status, usage_scope, review_status, reviewed_by, reviewed_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, 2026, 1, '重放测试科目', 'choice', false,
           '题库评测重放集成测试问题', $4::jsonb, ARRAY['评测重放'], $5::jsonb,
           '["A"]'::jsonb, '首次提交后可见的解析', '首次提交后可见的参考解答',
           'https://example.invalid/question-replay-it/1', 'verified',
           'authorized_product_use', 'approved', $6, $7, $7, $7
         )`,
        [
          questionId,
          courseId,
          batchId,
          JSON.stringify(options),
          JSON.stringify(topLevelAssets),
          ownerId,
          fixtureAt.toISOString(),
        ],
      );
      await client.query(
        `INSERT INTO question_learning_metadata(
           question_id, source_type, allowed_modes, paper_year, protect_full_paper,
           importance, content_review_status, created_at, updated_at
         ) VALUES ($1, 'past_exam', ARRAY['targeted', 'past_exam', 'mock_exam']::text[],
                   2026, false, 'core', 'teacher_verified', $2, $2)`,
        [questionId, fixtureAt.toISOString()],
      );

      for (const asset of assetFixtures) {
        const digest = createHash("sha256").update(asset.content).digest("hex");
        await client.query(
          `INSERT INTO question_asset_blobs(
             content_sha256, mime_type, byte_length, content, created_at
           ) VALUES ($1, 'image/png', $2, $3, $4)`,
          [digest, asset.content.length, asset.content, fixtureAt.toISOString()],
        );
        await client.query(
          `INSERT INTO question_asset_links(
             question_id, asset_id, role, option_id, content_sha256, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            questionId,
            asset.assetId,
            asset.role,
            asset.optionId,
            digest,
            fixtureAt.toISOString(),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }, 60_000);

  afterAll(async () => {
    await testPool?.end();
    if (adminPool && schemaCreated) {
      assertSafeSchemaName(schemaName);
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    }
    await adminPool?.end();
  }, 30_000);

  it("replays one committed answer snapshot after live withdrawal without duplicating learning state", async () => {
    if (!testPool) throw new Error("PostgreSQL integration-test pool is unavailable.");
    let idSequence = 0;
    const repository = new PostgresQuestionBank(
      testPool as unknown as SqlQueryablePool,
      courseId,
      {
        now: () => fixtureAt,
        createId: (prefix) => `${prefix}_question_replay_it_${++idSequence}`,
      },
    );

    const first = await repository.evaluate(ownerId, submission, idempotencyKey);
    expect(first).toMatchObject({
      idempotency_replayed: false,
      evaluation: {
        grading_mode: "deterministic_choice",
        status: "incorrect",
        is_correct: false,
        score: 0,
        correct_option_ids: ["A"],
        explanation: "首次提交后可见的解析",
        reference_solution: "首次提交后可见的参考解答",
        answer_assets: [
          assetReference(explanationAssetId, "explanation", null),
          assetReference(solutionAssetId, "solution", null),
        ],
      },
      evidence: {
        outcome: "incorrect",
        eligible_for_learning_state_update: true,
        persistence_status: "persisted",
      },
    });

    const committedState = await snapshotQuestionState(testPool, ownerId);
    expect(committedState.idempotency).toHaveLength(1);
    expect(committedState.attempts).toHaveLength(1);
    expect(committedState.evaluations).toHaveLength(1);
    expect(committedState.evidence).toHaveLength(1);
    expect(committedState.memory).toHaveLength(1);
    expect(committedState.mistakes).toHaveLength(1);
    expect(committedState.mistakeReviews).toHaveLength(1);
    expect(committedState.mistakes[0]).toMatchObject({
      wrong_count: 1,
      first_incorrect_attempt_id: first.attempt.attempt_id,
      last_incorrect_attempt_id: first.attempt.attempt_id,
      last_incorrect_evaluation_id: first.evaluation.evaluation_id,
    });
    expect(committedState.memory[0]).toMatchObject({
      last_attempt_id: first.attempt.attempt_id,
    });
    expect(committedState.mistakeReviews[0]).toMatchObject({
      last_processed_attempt_id: first.attempt.attempt_id,
    });

    const expectReplayWithoutMutation = async () => {
      const replay = await repository.evaluate(ownerId, submission, idempotencyKey);
      expect(replay).toEqual({ ...first, idempotency_replayed: true });
      expect(await snapshotQuestionState(testPool!, ownerId)).toEqual(committedState);
    };

    try {
      await testPool.query(
        "UPDATE questions SET review_status = 'pending_review' WHERE question_id = $1",
        [questionId],
      );
      await expectReplayWithoutMutation();

      await expect(repository.evaluate(ownerId, {
        ...submission,
        selected_option_ids: ["A"],
      }, idempotencyKey)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      expect(await snapshotQuestionState(testPool, ownerId)).toEqual(committedState);

      await expect(
        repository.evaluate(ownerId, submission, newIdempotencyKey),
      ).rejects.toBeInstanceOf(QuestionNotFoundError);
      expect(await snapshotQuestionState(testPool, ownerId)).toEqual(committedState);

      await expect(
        repository.evaluate(otherId, submission, idempotencyKey),
      ).rejects.toBeInstanceOf(QuestionNotFoundError);
      expect((await snapshotQuestionState(testPool, otherId)).idempotency).toHaveLength(0);
    } finally {
      await testPool.query(
        "UPDATE questions SET review_status = 'approved' WHERE question_id = $1",
        [questionId],
      );
    }

    const otherFirst = await repository.evaluate(otherId, submission, idempotencyKey);
    expect(otherFirst.idempotency_replayed).toBe(false);
    expect(otherFirst.attempt.attempt_id).not.toBe(first.attempt.attempt_id);
    expect(otherFirst.evaluation.evaluation_id).not.toBe(first.evaluation.evaluation_id);
    expect((await snapshotQuestionState(testPool, otherId)).idempotency).toHaveLength(1);
    expect(await snapshotQuestionState(testPool, ownerId)).toEqual(committedState);

    try {
      await testPool.query(
        `UPDATE question_learning_metadata
            SET content_review_status = 'pending_teacher_review'
          WHERE question_id = $1`,
        [questionId],
      );
      await expectReplayWithoutMutation();
    } finally {
      await testPool.query(
        `UPDATE question_learning_metadata
            SET content_review_status = 'teacher_verified'
          WHERE question_id = $1`,
        [questionId],
      );
    }

    try {
      await testPool.query(
        "UPDATE questions SET license_status = 'restricted' WHERE question_id = $1",
        [questionId],
      );
      await expectReplayWithoutMutation();
    } finally {
      await testPool.query(
        "UPDATE questions SET license_status = 'verified' WHERE question_id = $1",
        [questionId],
      );
    }
  });
});
