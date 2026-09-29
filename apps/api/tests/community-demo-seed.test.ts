import { describe, expect, it } from "vitest";

import {
  communityPostCreateRequestSchema,
  communityReplyCreateRequestSchema,
} from "@xuetu/contracts";

import type { SqlClient, SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import {
  COMMUNITY_DEMO_POSTS,
  COMMUNITY_DEMO_REPLIES,
} from "../src/database/community-demo-content.js";
import { PRE_DEFENSE_STUDENTS } from "../src/database/pre-defense-demo-roster.js";
import { seedCommunityDemo } from "../src/database/seed-community-demo.js";

describe("community demo seed", () => {
  it("populates every school circle with varied, explicitly sample content", () => {
    expect(COMMUNITY_DEMO_POSTS.length).toBeGreaterThanOrEqual(32);
    expect(COMMUNITY_DEMO_REPLIES.length).toBeGreaterThanOrEqual(64);
    expect(new Set(COMMUNITY_DEMO_POSTS.map((post) => post.circleId)).size)
      .toBeGreaterThanOrEqual(8);
    expect(new Set(COMMUNITY_DEMO_POSTS.map((post) => post.topic))).toEqual(new Set([
      "择校交流",
      "备考规划",
      "课程讨论",
      "经验复盘",
    ]));
    const knownUsers = new Set(PRE_DEFENSE_STUDENTS.map((student) => student.userId));
    expect(COMMUNITY_DEMO_POSTS.every((post) => knownUsers.has(post.authorUserId))).toBe(true);
    expect(COMMUNITY_DEMO_REPLIES.every((reply) => knownUsers.has(reply.authorUserId))).toBe(true);
  });

  it("keeps every sample conversation distinct and within the public forum contract", () => {
    expect(new Set(COMMUNITY_DEMO_POSTS.map((post) => post.title)).size)
      .toBe(COMMUNITY_DEMO_POSTS.length);
    expect(new Set(COMMUNITY_DEMO_POSTS.map((post) => post.body)).size)
      .toBe(COMMUNITY_DEMO_POSTS.length);
    expect(new Set(COMMUNITY_DEMO_REPLIES.map((reply) => reply.body)).size)
      .toBe(COMMUNITY_DEMO_REPLIES.length);

    for (const post of COMMUNITY_DEMO_POSTS) {
      expect(communityPostCreateRequestSchema.safeParse({
        circle_id: post.circleId,
        topic: post.topic,
        title: post.title,
        body: post.body,
      }).success).toBe(true);
    }
    for (const reply of COMMUNITY_DEMO_REPLIES) {
      expect(communityReplyCreateRequestSchema.safeParse({ body: reply.body }).success).toBe(true);
    }
  });

  it("sounds like peer discussion instead of a formal study report", () => {
    const content = [
      ...COMMUNITY_DEMO_POSTS.flatMap((post) => [post.title, post.body]),
      ...COMMUNITY_DEMO_REPLIES.map((reply) => reply.body),
    ].join("\n");

    expect(content).not.toMatch(/逐项核对|重点确认|稳定拿出|标准情况|时间分配有没有改善|掌握情况显得比实际更好/u);

    const replyCounts = new Map<string, number>();
    for (const reply of COMMUNITY_DEMO_REPLIES) {
      replyCounts.set(reply.postId, (replyCounts.get(reply.postId) ?? 0) + 1);
    }
    const counts = COMMUNITY_DEMO_POSTS.map((post) => replyCounts.get(post.postId) ?? 0);
    expect(new Set(counts).size).toBeGreaterThanOrEqual(3);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(4);

    const shortReplies = COMMUNITY_DEMO_REPLIES.filter((reply) => reply.body.length <= 18);
    const detailedReplies = COMMUNITY_DEMO_REPLIES.filter((reply) => reply.body.length >= 48);
    expect(shortReplies.length).toBeGreaterThanOrEqual(8);
    expect(detailedReplies.length).toBeGreaterThanOrEqual(6);

    const questionTitles = COMMUNITY_DEMO_POSTS.filter((post) => /[？?]$/u.test(post.title));
    expect(questionTitles.length).toBeGreaterThanOrEqual(10);
    expect(questionTitles.length).toBeLessThanOrEqual(24);

    const templatedQuestionEndings = COMMUNITY_DEMO_POSTS.filter((post) => (
      /大家(?:会|一般|平时|都是)[^。]*[？?]$/u.test(post.body)
    ));
    expect(templatedQuestionEndings.length).toBeLessThanOrEqual(4);
  });

  it("writes sample provenance and remains idempotent through stable ids", async () => {
    const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const query = async <Row = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> => {
      statements.push({ sql, parameters });
      return { rows: [], rowCount: 1 };
    };
    const client: SqlClient = { query, release() {} };
    const pool: SqlQueryablePool = { query, connect: async () => client };

    const result = await seedCommunityDemo(pool, () => new Date("2026-08-27T02:00:00.000Z"));

    expect(result.posts).toBe(COMMUNITY_DEMO_POSTS.length);
    expect(result.replies).toBe(COMMUNITY_DEMO_REPLIES.length);
    expect(statements.some(({ sql }) => sql.includes("'sample'"))).toBe(true);
    expect(statements.filter(({ sql }) => sql.includes("INSERT INTO community_posts")))
      .toHaveLength(COMMUNITY_DEMO_POSTS.length);
    expect(statements.every(({ sql }) => !sql.includes("DELETE FROM community_"))).toBe(true);
  });
});
