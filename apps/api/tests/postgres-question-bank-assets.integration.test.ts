import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlQueryablePool } from "../src/database/client.js";
import { loadMigrations, runMigrations } from "../src/database/migrate.js";
import { PostgresQuestionBank } from "../src/services/question-bank/postgres-question-bank.js";

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim() ?? "";
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const schemaName = `xuetu_question_asset_it_${process.pid}_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;

const ownerId = "user_question_asset_it_owner";
const otherId = "user_question_asset_it_other";
const courseId = "course_question_asset_it";
const batchId = "batch_question_asset_it";
const questionId = "question_asset_it_primary";
const otherQuestionId = "question_asset_it_other";
const ownerAttemptId = "attempt_question_asset_it_owner";
const otherAttemptId = "attempt_question_asset_it_other";
const otherQuestionAttemptId = "attempt_question_asset_it_other_question";
const unevaluatedAttemptId = "attempt_question_asset_it_unevaluated";
const questionAssetId = "asset_question_asset_it_question";
const optionAssetId = "asset_question_asset_it_option";
const explanationAssetId = "asset_question_asset_it_explanation";
const solutionAssetId = "asset_question_asset_it_solution";
const fixtureAt = new Date("2026-09-03T04:00:00.000Z");

const assetFixtures = [
  {
    assetId: questionAssetId,
    role: "question",
    optionId: null,
    content: Buffer.from("question-image-bytes", "utf8"),
  },
  {
    assetId: optionAssetId,
    role: "option",
    optionId: "A",
    content: Buffer.from("option-image-bytes", "utf8"),
  },
  {
    assetId: explanationAssetId,
    role: "explanation",
    optionId: null,
    content: Buffer.from("explanation-image-bytes", "utf8"),
  },
  {
    assetId: solutionAssetId,
    role: "solution",
    optionId: null,
    content: Buffer.from("solution-image-bytes", "utf8"),
  },
] as const;

function assertSafeSchemaName(value: string) {
  if (!/^xuetu_question_asset_it_[a-z0-9_]+$/u.test(value)) {
    throw new Error("Unsafe PostgreSQL integration-test schema name.");
  }
}

function assetReference(
  assetId: string,
  role: "question" | "option" | "explanation" | "solution",
  optionId: string | null,
) {
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

describeWithPostgres("PostgreSQL question asset authorization", () => {
  let adminPool: Pool | undefined;
  let testPool: Pool | undefined;
  let schemaCreated = false;

  beforeAll(async () => {
    assertSafeSchemaName(schemaName);
    adminPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: "xuetu-question-asset-isolation-admin",
    });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;

    testPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      application_name: "xuetu-question-asset-isolation",
      options: `-c search_path=${schemaName} -c statement_timeout=15000`,
    });
    await runMigrations(testPool as unknown as SqlQueryablePool, loadMigrations());

    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users(
           user_id, display_name, account_status, auth_source, created_at, updated_at
         ) VALUES ($1, '题库资产集成测试学生', 'active', 'local_development', $3, $3),
                  ($2, '题库资产集成测试其他学生', 'active', 'local_development', $3, $3)`,
        [ownerId, otherId, fixtureAt.toISOString()],
      );
      await client.query(
        `INSERT INTO courses(
           course_id, course_code, title, discipline, status, created_by, created_at, updated_at
         ) VALUES ($1, 'QUESTION-ASSET-IT', '题库资产授权集成测试', 'computer_science',
                   'active', $2, $3, $3)`,
        [courseId, ownerId, fixtureAt.toISOString()],
      );
      await client.query(
        `INSERT INTO question_import_batches(
           import_batch_id, dataset_id, archive_sha256, source_provider, source_url,
           license_status, usage_scope, status, question_count, started_at, completed_at
         ) VALUES ($1, 'question_asset_it', $2, 'self_authored_integration_test', NULL,
                   'verified', 'authorized_product_use', 'completed', 2, $3, $3)`,
        [batchId, "a".repeat(64), fixtureAt.toISOString()],
      );

      const topLevelAssets = assetFixtures.map((asset) =>
        assetReference(asset.assetId, asset.role, asset.optionId)
      );
      const options = [
        {
          option_id: "A",
          text: "选项 A",
          assets: [assetReference(optionAssetId, "option", "A")],
        },
        { option_id: "B", text: "选项 B", assets: [] },
      ];
      await client.query(
        `INSERT INTO questions(
           question_id, course_id, import_batch_id, year, number, subject,
           question_type, multiple, question_text, options, tags, assets,
           answer_key, explanation_text, solution_text, source_url,
           license_status, usage_scope, review_status, reviewed_by, reviewed_at,
           created_at, updated_at
         ) VALUES (
           $1, $3, $4, 2026, 1, '数据结构', 'choice', false,
           '题库资产授权集成测试主问题', $5::jsonb, ARRAY['资产授权'], $6::jsonb,
           '["A"]'::jsonb, '提交后解析', '提交后解答',
           'https://example.invalid/question-asset-it/1', 'verified',
           'authorized_product_use', 'approved', $7, $8, $8, $8
         ), (
           $2, $3, $4, 2026, 2, '数据结构', 'choice', false,
           '题库资产授权集成测试其他问题', $5::jsonb, ARRAY['资产授权'], '[]'::jsonb,
           '["A"]'::jsonb, '其他题解析', '其他题解答',
           'https://example.invalid/question-asset-it/2', 'verified',
           'authorized_product_use', 'approved', $7, $8, $8, $8
         )`,
        [
          questionId,
          otherQuestionId,
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
                   2026, false, 'core', 'teacher_verified', $3, $3),
                  ($2, 'past_exam', ARRAY['targeted', 'past_exam', 'mock_exam']::text[],
                   2026, false, 'core', 'teacher_verified', $3, $3)`,
        [questionId, otherQuestionId, fixtureAt.toISOString()],
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

      const attempts = [
        [ownerAttemptId, ownerId, questionId, "evaluated"],
        [otherAttemptId, otherId, questionId, "evaluated"],
        [otherQuestionAttemptId, ownerId, otherQuestionId, "evaluated"],
        [unevaluatedAttemptId, ownerId, questionId, "submitted"],
      ] as const;
      for (const [attemptId, userId, attemptQuestionId, status] of attempts) {
        await client.query(
          `INSERT INTO practice_attempts(
             attempt_id, user_id, course_id, question_id, answer_type,
             selected_option_ids, response_text, status, submitted_at
           ) VALUES ($1, $2, $3, $4, 'choice', '["A"]'::jsonb, NULL, $5, $6)`,
          [attemptId, userId, courseId, attemptQuestionId, status, fixtureAt.toISOString()],
        );
      }
      const evaluatedAttempts = [ownerAttemptId, otherAttemptId, otherQuestionAttemptId];
      for (const [index, attemptId] of evaluatedAttempts.entries()) {
        await client.query(
          `INSERT INTO evaluations(
             evaluation_id, attempt_id, grading_mode, status, is_correct, score,
             correct_option_ids, explanation_text, reference_solution,
             review_required, created_at
           ) VALUES ($1, $2, 'deterministic_choice', 'correct', true, 100,
                     '["A"]'::jsonb, '已评测解析', NULL, false, $3)`,
          [`evaluation_question_asset_it_${index}`, attemptId, fixtureAt.toISOString()],
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

  it("serves public assets before submission but binds answer assets to an evaluated owner attempt for the same question", async () => {
    if (!testPool) throw new Error("PostgreSQL integration-test pool is unavailable.");
    const repository = new PostgresQuestionBank(
      testPool as unknown as SqlQueryablePool,
      courseId,
    );

    await expect(repository.openAsset(ownerId, questionId, questionAssetId)).resolves.toEqual({
      role: "question",
      mimeType: "image/png",
      byteLength: assetFixtures[0].content.length,
      content: assetFixtures[0].content,
    });
    await expect(repository.openAsset(ownerId, questionId, optionAssetId)).resolves.toEqual({
      role: "option",
      mimeType: "image/png",
      byteLength: assetFixtures[1].content.length,
      content: assetFixtures[1].content,
    });

    const refused = await Promise.all([
      repository.openAsset(ownerId, questionId, explanationAssetId),
      repository.openAsset(ownerId, questionId, solutionAssetId),
      repository.openAsset(ownerId, questionId, explanationAssetId, otherAttemptId),
      repository.openAsset(ownerId, questionId, explanationAssetId, otherQuestionAttemptId),
      repository.openAsset(ownerId, questionId, explanationAssetId, unevaluatedAttemptId),
    ]);
    expect(refused).toEqual([null, null, null, null, null]);

    await expect(
      repository.openAsset(ownerId, questionId, explanationAssetId, ownerAttemptId),
    ).resolves.toEqual({
      role: "explanation",
      mimeType: "image/png",
      byteLength: assetFixtures[2].content.length,
      content: assetFixtures[2].content,
    });
    await expect(
      repository.openAsset(ownerId, questionId, solutionAssetId, ownerAttemptId),
    ).resolves.toEqual({
      role: "solution",
      mimeType: "image/png",
      byteLength: assetFixtures[3].content.length,
      content: assetFixtures[3].content,
    });
  });

  it("rechecks current review, content-review, and exposure state for a historical evaluated attempt", async () => {
    if (!testPool) throw new Error("PostgreSQL integration-test pool is unavailable.");
    const repository = new PostgresQuestionBank(
      testPool as unknown as SqlQueryablePool,
      courseId,
    );
    const readSensitiveAsset = () =>
      repository.openAsset(ownerId, questionId, explanationAssetId, ownerAttemptId);

    await expect(readSensitiveAsset()).resolves.toMatchObject({ role: "explanation" });

    try {
      await testPool.query(
        "UPDATE questions SET review_status = 'pending_review' WHERE question_id = $1",
        [questionId],
      );
      await expect(readSensitiveAsset()).resolves.toBeNull();
    } finally {
      await testPool.query(
        "UPDATE questions SET review_status = 'approved' WHERE question_id = $1",
        [questionId],
      );
    }

    try {
      await testPool.query(
        `UPDATE question_learning_metadata
            SET content_review_status = 'pending_teacher_review'
          WHERE question_id = $1`,
        [questionId],
      );
      await expect(readSensitiveAsset()).resolves.toBeNull();
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
      await expect(readSensitiveAsset()).resolves.toBeNull();
    } finally {
      await testPool.query(
        "UPDATE questions SET license_status = 'verified' WHERE question_id = $1",
        [questionId],
      );
    }
  });

  it("rejects persisted blob byte-length corruption at the database boundary", async () => {
    if (!testPool) throw new Error("PostgreSQL integration-test pool is unavailable.");
    const digest = createHash("sha256").update(assetFixtures[0].content).digest("hex");

    await expect(testPool.query(
      "UPDATE question_asset_blobs SET byte_length = byte_length + 1 WHERE content_sha256 = $1",
      [digest],
    )).rejects.toMatchObject({ code: "23514" });

    const repository = new PostgresQuestionBank(
      testPool as unknown as SqlQueryablePool,
      courseId,
    );
    await expect(repository.openAsset(ownerId, questionId, questionAssetId)).resolves.toMatchObject({
      byteLength: assetFixtures[0].content.length,
      content: assetFixtures[0].content,
    });
  });
});
