import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlQueryablePool } from "../src/database/client.js";
import { loadMigrations, runMigrations } from "../src/database/migrate.js";
import { PostgresCommunity } from "../src/services/community/postgres-community.js";

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim() ?? "";
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const schemaName = `xuetu_community_it_${process.pid}_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;

const ownerId = "user_community_it_owner";
const otherId = "user_community_it_other";
const inactiveId = "user_community_it_inactive";
const activeCircleId = "circle_community_it_active";
const inactiveCircleId = "circle_community_it_inactive";
const postOwnId = "post_community_it_own";
const postForeignId = "post_community_it_foreign";
const postForeignDeletedId = "post_community_it_foreign_deleted";
const postRepliesId = "post_community_it_replies";
const postHiddenId = "post_community_it_hidden";
const replyOwnId = "reply_community_it_own";
const replyForeignId = "reply_community_it_foreign";
const replyForeignDeletedId = "reply_community_it_foreign_deleted";
const replyHiddenId = "reply_community_it_hidden";
const replyInactiveAuthorId = "reply_community_it_inactive_author";
const replyReplayHiddenId = "reply_community_it_replay_hidden";
const replyReplayHiddenKey = "reply-community-it-replay-hidden";
const fixtureAt = new Date("2026-09-03T02:00:00.000Z");

function assertSafeSchemaName(value: string) {
  if (!/^xuetu_community_it_[a-z0-9_]+$/u.test(value)) {
    throw new Error("Unsafe PostgreSQL integration-test schema name.");
  }
}

describeWithPostgres("PostgreSQL community visibility and deletion isolation", () => {
  let adminPool: Pool | undefined;
  let testPool: Pool | undefined;
  let schemaCreated = false;

  beforeAll(async () => {
    assertSafeSchemaName(schemaName);
    adminPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: "xuetu-community-isolation-admin",
    });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;

    testPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      application_name: "xuetu-community-isolation",
      options: `-c search_path=${schemaName} -c statement_timeout=15000`,
    });
    await runMigrations(testPool as unknown as SqlQueryablePool, loadMigrations());

    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users(user_id, display_name, account_status, auth_source, created_at, updated_at)
         VALUES ($1, '论坛集成测试作者', 'active', 'local_development', $4, $4),
                ($2, '论坛集成测试其他作者', 'active', 'local_development', $4, $4),
                ($3, '论坛集成测试停用作者', 'disabled', 'local_development', $4, $4)`,
        [ownerId, otherId, inactiveId, fixtureAt.toISOString()],
      );
      await client.query(
        `INSERT INTO community_circles(
           circle_id, school_name, description, sort_order, active, created_at, updated_at
         ) VALUES ($1, '论坛集成测试可见圈', '验证论坛可见性和软删除语义', 900, true, $3, $3),
                  ($2, '论坛集成测试隐藏圈', '验证隐藏父级不发生部分写入', 901, false, $3, $3)`,
        [activeCircleId, inactiveCircleId, fixtureAt.toISOString()],
      );

      const posts = [
        [postOwnId, activeCircleId, ownerId, "自有帖子删除集成测试", "这是用于验证自有帖子删除与重试语义的正文。", "post-community-it-own", null],
        [postForeignId, activeCircleId, otherId, "他人帖子拒绝集成测试", "这是用于验证公开可见他人帖子仍返回禁止的正文。", "post-community-it-foreign", null],
        [postForeignDeletedId, activeCircleId, otherId, "已删他人帖子集成测试", "这是用于验证已删除他人帖子不可枚举的正文。", "post-community-it-foreign-deleted", fixtureAt],
        [postRepliesId, activeCircleId, ownerId, "回复父帖可见集成测试", "这是用于验证回复删除与回复创建读取谓词的正文。", "post-community-it-replies", null],
        [postHiddenId, inactiveCircleId, ownerId, "隐藏父帖拒绝集成测试", "这是用于验证停用圈子中的父帖不会发生部分写入的正文。", "post-community-it-hidden", null],
      ] as const;
      for (const [postId, circleId, authorId, title, body, idempotencyKey, deletedAt] of posts) {
        await client.query(
          `INSERT INTO community_posts(
             post_id, circle_id, author_user_id, topic, title, body, content_origin,
             idempotency_key, created_at, updated_at, last_activity_at, deleted_at
           ) VALUES ($1, $2, $3, '备考规划', $4, $5, 'member', $6, $7, $7, $7, $8)`,
          [postId, circleId, authorId, title, body, idempotencyKey, fixtureAt.toISOString(), deletedAt],
        );
      }

      const replies = [
        [replyOwnId, postRepliesId, ownerId, "自有回复删除集成测试。", "reply-community-it-own", null],
        [replyForeignId, postRepliesId, otherId, "他人公开回复拒绝集成测试。", "reply-community-it-foreign", null],
        [replyForeignDeletedId, postRepliesId, otherId, "已删他人回复不可枚举测试。", "reply-community-it-foreign-deleted", fixtureAt],
        [replyHiddenId, postHiddenId, ownerId, "隐藏父帖下回复不得被删除。", "reply-community-it-hidden", null],
        [replyInactiveAuthorId, postRepliesId, inactiveId, "停用作者的回复不得通过编辑探测。", "reply-community-it-inactive", null],
        [replyReplayHiddenId, postHiddenId, ownerId, "隐藏父帖下的旧回复不得重放。", replyReplayHiddenKey, null],
      ] as const;
      for (const [replyId, postId, authorId, body, idempotencyKey, deletedAt] of replies) {
        await client.query(
          `INSERT INTO community_replies(
             reply_id, post_id, author_user_id, body, content_origin, idempotency_key,
             created_at, updated_at, deleted_at
           ) VALUES ($1, $2, $3, $4, 'member', $5, $6, $6, $7)`,
          [replyId, postId, authorId, body, idempotencyKey, fixtureAt.toISOString(), deletedAt],
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

  it("enforces visible ownership without partial post or reply mutations", async () => {
    if (!testPool) throw new Error("PostgreSQL integration-test pool is unavailable.");
    const community = new PostgresCommunity(testPool as unknown as SqlQueryablePool);

    await expect(community.deletePost(ownerId, postOwnId)).resolves.toEqual({ deleted: true });
    await expect(community.deletePost(ownerId, postOwnId)).resolves.toEqual({ deleted: true });
    await expect(community.deletePost(ownerId, postForeignId)).rejects.toMatchObject({
      code: "COMMUNITY_POST_FORBIDDEN",
      statusCode: 403,
    });
    await expect(community.deletePost(ownerId, postForeignDeletedId)).rejects.toMatchObject({
      code: "COMMUNITY_POST_NOT_FOUND",
      statusCode: 404,
    });
    await expect(community.deletePost(ownerId, postHiddenId)).rejects.toMatchObject({
      code: "COMMUNITY_POST_NOT_FOUND",
      statusCode: 404,
    });

    await expect(community.deleteReply(ownerId, replyOwnId)).resolves.toEqual({ deleted: true });
    await expect(community.deleteReply(ownerId, replyOwnId)).resolves.toEqual({ deleted: true });
    await expect(community.deleteReply(ownerId, replyForeignId)).rejects.toMatchObject({
      code: "COMMUNITY_REPLY_FORBIDDEN",
      statusCode: 403,
    });
    await expect(community.deleteReply(ownerId, replyForeignDeletedId)).rejects.toMatchObject({
      code: "COMMUNITY_REPLY_NOT_FOUND",
      statusCode: 404,
    });
    await expect(community.deleteReply(ownerId, replyHiddenId)).rejects.toMatchObject({
      code: "COMMUNITY_REPLY_NOT_FOUND",
      statusCode: 404,
    });
    await expect(community.updateReply(ownerId, replyInactiveAuthorId, {
      body: "不应写入停用作者回复的新内容。",
    })).rejects.toMatchObject({
      code: "COMMUNITY_REPLY_NOT_FOUND",
      statusCode: 404,
    });
    await expect(community.createReply(
      ownerId,
      postHiddenId,
      { body: "隐藏父帖下的旧回复不得重放。" },
      replyReplayHiddenKey,
    )).rejects.toMatchObject({
      code: "COMMUNITY_REPLY_NOT_FOUND",
      statusCode: 404,
    });

    const created = await community.createReply(
      ownerId,
      postRepliesId,
      { body: "可见父帖仍可创建并读取新回复。" },
      "reply-community-it-created",
    );
    expect(created).toMatchObject({
      body: "可见父帖仍可创建并读取新回复。",
      author: { is_self: true },
    });

    const postState = await testPool.query<{ post_id: string; deleted_at: Date | null }>(
      `SELECT post_id, deleted_at
         FROM community_posts
        WHERE post_id = ANY($1::text[])
        ORDER BY post_id`,
      [[postOwnId, postForeignId, postHiddenId]],
    );
    expect(postState.rows.map((row) => ({
      post_id: row.post_id,
      deleted: row.deleted_at !== null,
    }))).toEqual([
      { post_id: postForeignId, deleted: false },
      { post_id: postHiddenId, deleted: false },
      { post_id: postOwnId, deleted: true },
    ].sort((left, right) => left.post_id.localeCompare(right.post_id)));

    const replyState = await testPool.query<{
      reply_id: string;
      body: string;
      deleted_at: Date | null;
    }>(
      `SELECT reply_id, body, deleted_at
         FROM community_replies
        WHERE reply_id = ANY($1::text[])
        ORDER BY reply_id`,
      [[replyOwnId, replyForeignId, replyHiddenId, replyInactiveAuthorId, replyReplayHiddenId]],
    );
    expect(replyState.rows.map((row) => ({
      reply_id: row.reply_id,
      body: row.body,
      deleted: row.deleted_at !== null,
    }))).toEqual([
      { reply_id: replyForeignId, body: "他人公开回复拒绝集成测试。", deleted: false },
      { reply_id: replyHiddenId, body: "隐藏父帖下回复不得被删除。", deleted: false },
      { reply_id: replyInactiveAuthorId, body: "停用作者的回复不得通过编辑探测。", deleted: false },
      { reply_id: replyOwnId, body: "自有回复删除集成测试。", deleted: true },
      { reply_id: replyReplayHiddenId, body: "隐藏父帖下的旧回复不得重放。", deleted: false },
    ].sort((left, right) => left.reply_id.localeCompare(right.reply_id)));
  }, 30_000);
});
