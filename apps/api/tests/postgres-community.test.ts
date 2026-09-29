import { describe, expect, it } from "vitest";

import type {
  SqlClient,
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import { CommunityError } from "../src/services/community/community.js";
import { PostgresCommunity } from "../src/services/community/postgres-community.js";

const now = "2026-08-27T02:00:00.000Z";

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    post_id: "post_001",
    circle_id: "circle_xju",
    school_name: "新疆大学",
    topic: "备考规划",
    title: "一轮复习如何安排四门课",
    body: "我每天大约有四小时，想听听大家怎么分配。",
    excerpt: "我每天大约有四小时，想听听大家怎么分配。",
    author_user_id: "student_001",
    display_name: "许泽宇",
    reply_count: "2",
    like_count: "3",
    view_count: 18,
    liked_by_me: false,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
    content_origin: "member",
    ...overrides,
  };
}

function poolWith(
  execute: (sql: string, parameters: readonly unknown[]) => SqlQueryResult | Promise<SqlQueryResult>,
) {
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async <Row = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> => {
    statements.push({ sql, parameters });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: null };
    return await execute(sql, parameters) as SqlQueryResult<Row>;
  };
  const client: SqlClient = { query, release() {} };
  const pool: SqlQueryablePool = { query, connect: async () => client };
  return { pool, statements };
}

describe("PostgresCommunity", () => {
  it("counts only active target members and posts from active authors in circle summaries", async () => {
    const { pool, statements } = poolWith((sql) => {
      if (sql.includes("WITH current_target AS")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await service.listCircles("student_001");

    const sql = statements[0]?.sql ?? "";
    expect(sql).toContain("FROM users target_member");
    expect(sql).toContain("target_member.account_status = 'active'");
    expect(sql).toContain("target_role.role_key = 'student'");
    expect(sql).toContain("COALESCE(selected_target.school, onboarding.target_school)");
    expect(sql).not.toContain("UNION");
    expect(sql).toContain("JOIN users author");
    expect(sql).toContain("author.account_status = 'active'");
  });

  it("keeps search parameterized and returns bounded pagination metadata", async () => {
    const { pool, statements } = poolWith((sql) => {
      if (sql.includes("COUNT(*)::text AS total")) return { rows: [{ total: "1" }], rowCount: 1 };
      if (sql.includes("WITH post_rows AS")) return { rows: [postRow()], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    const result = await service.listPosts("student_001", {
      circle_id: "circle_xju",
      topic: "备考规划",
      search: "TCP%_",
      sort: "recent",
      page: 2,
      page_size: 10,
    });

    expect(result).toMatchObject({ page: 2, page_size: 10, total: 1, total_pages: 1 });
    expect(result.items[0]).toMatchObject({ post_id: "post_001", author: { is_self: true } });
    expect(statements.every(({ sql }) => !sql.includes("TCP%_"))).toBe(true);
    expect(statements.some(({ parameters }) => parameters.includes("%TCP\\%\\_%"))).toBe(true);
    const countSql = statements.find(({ sql }) => sql.includes("COUNT(*)::text AS total"))?.sql ?? "";
    const dataSql = statements.find(({ sql }) => sql.includes("WITH post_rows AS"))?.sql ?? "";
    expect(countSql).toContain("ESCAPE E'\\\\'");
    expect(countSql).toContain("JOIN community_circles");
    expect(countSql).toContain("JOIN users");
    expect(dataSql).toContain("COUNT(*) AS reply_count");
    expect(dataSql).not.toContain("COUNT(*)::text AS reply_count");
  });

  it("counts a signed-in student's view only once across repeated detail reads", async () => {
    let firstView = true;
    const { pool, statements } = poolWith((sql) => {
      if (sql.includes("INSERT INTO community_post_views")) {
        const inserted = firstView;
        firstView = false;
        return { rows: inserted ? [{ post_id: "post_001" }] : [], rowCount: inserted ? 1 : 0 };
      }
      if (sql.startsWith("UPDATE community_posts") && sql.includes("view_count")) {
        return { rows: [{ post_id: "post_001" }], rowCount: 1 };
      }
      if (sql.includes("WITH post_rows AS")) return { rows: [postRow()], rowCount: 1 };
      if (sql.includes("COUNT(*)::text AS total") && sql.includes("community_replies")) {
        return { rows: [{ total: "0" }], rowCount: 1 };
      }
      if (sql.includes("FROM community_replies reply")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await service.getPost("student_001", "post_001", { reply_page: 1, reply_page_size: 30 });
    await service.getPost("student_001", "post_001", { reply_page: 1, reply_page_size: 30 });

    expect(statements.filter(({ sql }) => sql.startsWith("UPDATE community_posts") && sql.includes("view_count")))
      .toHaveLength(1);
  });

  it("returns the original post for the same idempotency key without inserting again", async () => {
    const { pool, statements } = poolWith((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM community_posts") && sql.includes("idempotency_key")) {
        return {
          rows: [{
            post_id: "post_001",
            circle_id: "circle_xju",
            topic: "备考规划",
            title: "一轮复习如何安排四门课",
            body: "我每天大约有四小时，想听听大家怎么分配。",
            deleted_at: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("WITH post_rows AS")) return { rows: [postRow()], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    const created = await service.createPost("student_001", {
      circle_id: "circle_xju",
      topic: "备考规划",
      title: "一轮复习如何安排四门课",
      body: "我每天大约有四小时，想听听大家怎么分配。",
    }, "post-create-001");

    expect(created.post_id).toBe("post_001");
    expect(statements.some(({ sql }) => sql.includes("INSERT INTO community_posts"))).toBe(false);
  });

  it("rejects reusing a post idempotency key for different content", async () => {
    const { pool } = poolWith((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM community_posts") && sql.includes("idempotency_key")) {
        return {
          rows: [{
            post_id: "post_001",
            circle_id: "circle_xju",
            topic: "备考规划",
            title: "已经发布的原始标题",
            body: "已经发布的原始正文内容。",
            deleted_at: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("WITH post_rows AS")) return { rows: [postRow()], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.createPost("student_001", {
      circle_id: "circle_xju",
      topic: "备考规划",
      title: "这次请求使用了不同标题",
      body: "这次请求使用了不同的正文内容。",
    }, "post-create-001")).rejects.toMatchObject({
      code: "COMMUNITY_IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
  });

  it("rejects reusing a reply idempotency key for different content", async () => {
    const { pool } = poolWith((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM community_replies") && sql.includes("idempotency_key")) {
        return {
          rows: [{
            reply_id: "reply_001",
            post_id: "post_001",
            body: "已经发布的回复内容。",
            deleted_at: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM community_replies reply")) {
        return {
          rows: [{
            reply_id: "reply_001",
            post_id: "post_001",
            author_user_id: "student_001",
            display_name: "程嘉树",
            body: "已经发布的回复内容。",
            created_at: now,
            updated_at: now,
            content_origin: "member",
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.createReply(
      "student_001",
      "post_001",
      { body: "这次提交的是另一条回复。" },
      "reply-create-001",
    )).rejects.toMatchObject({
      code: "COMMUNITY_IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
  });

  it("does not replay a reply after its parent post becomes hidden", async () => {
    const { pool } = poolWith((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM community_replies") && sql.includes("idempotency_key")) {
        return {
          rows: [{
            reply_id: "reply_001",
            post_id: "post_001",
            body: "已经发布的回复内容。",
            deleted_at: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM community_replies reply")) {
        return sql.includes("JOIN community_posts post")
          ? { rows: [], rowCount: 0 }
          : {
              rows: [{
                reply_id: "reply_001",
                post_id: "post_001",
                author_user_id: "student_001",
                display_name: "程嘉树",
                body: "已经发布的回复内容。",
                created_at: now,
                updated_at: now,
                content_origin: "member",
              }],
              rowCount: 1,
            };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.createReply(
      "student_001",
      "post_001",
      { body: "已经发布的回复内容。" },
      "reply-create-001",
    )).rejects.toMatchObject({
      code: "COMMUNITY_REPLY_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("serializes and rejects a sixth post inside the ten-minute window", async () => {
    const { pool } = poolWith((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM community_posts") && sql.includes("idempotency_key")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM community_circles")) return { rows: [{ circle_id: "circle_xju" }], rowCount: 1 };
      if (sql.includes("recent_count")) return { rows: [{ recent_count: "5" }], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.createPost("student_001", {
      circle_id: "circle_xju",
      topic: "备考规划",
      title: "一轮复习如何安排四门课",
      body: "我每天大约有四小时，想听听大家怎么分配。",
    }, "post-create-002")).rejects.toMatchObject({
      code: "COMMUNITY_POST_RATE_LIMITED",
      statusCode: 429,
    });
  });

  it("does not let one student edit another student's post", async () => {
    const { pool } = poolWith((sql) => {
      if (sql.includes("FROM community_posts post") && sql.includes("circle.active = true")) {
        return { rows: [{ post_id: "post_001" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE community_posts")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT author_user_id, deleted_at")) {
        return { rows: [{ author_user_id: "student_002", deleted_at: null }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.updatePost("student_001", "post_001", {
      title: "更新后的讨论标题",
    })).rejects.toEqual(expect.objectContaining<Partial<CommunityError>>({
      code: "COMMUNITY_POST_FORBIDDEN",
      statusCode: 403,
    }));
  });

  it("checks that a post is still visible before editing it", async () => {
    let changed = false;
    const { pool } = poolWith((sql) => {
      if (sql.includes("FROM community_posts post") && sql.includes("circle.active = true")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE community_posts")) {
        changed = true;
        return { rows: [{ post_id: "post_001" }], rowCount: 1 };
      }
      if (sql.includes("WITH post_rows AS")) return { rows: [postRow()], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.updatePost("student_001", "post_001", {
      title: "不应写入隐藏讨论的新标题",
    })).rejects.toMatchObject({ code: "COMMUNITY_POST_NOT_FOUND", statusCode: 404 });
    expect(changed).toBe(false);
  });

  it("checks that a post is still visible before deleting it", async () => {
    let changed = false;
    const { pool } = poolWith((sql) => {
      if (sql.includes("FROM community_posts post") && sql.includes("circle.active = true")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE community_posts")) {
        changed = true;
        return { rows: [{ post_id: "post_001" }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.deletePost("student_001", "post_001"))
      .rejects.toMatchObject({ code: "COMMUNITY_POST_NOT_FOUND", statusCode: 404 });
    expect(changed).toBe(false);
  });

  it("preserves post deletion semantics after the visibility check", async () => {
    let ownPostDeleted = false;
    const { pool, statements } = poolWith((sql, parameters) => {
      if (sql.includes("FROM community_posts post") && sql.includes("FOR UPDATE OF post")) {
        const postId = parameters[0];
        if (postId === "post_own") {
          return {
            rows: [{ author_user_id: "student_001", deleted_at: ownPostDeleted ? now : null }],
            rowCount: 1,
          };
        }
        if (postId === "post_foreign") {
          return { rows: [{ author_user_id: "student_002", deleted_at: null }], rowCount: 1 };
        }
        if (postId === "post_foreign_deleted") {
          return { rows: [{ author_user_id: "student_002", deleted_at: now }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE community_posts")) {
        ownPostDeleted = true;
        return { rows: [{ post_id: "post_own" }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.deletePost("student_001", "post_own"))
      .resolves.toEqual({ deleted: true });
    await expect(service.deletePost("student_001", "post_own"))
      .resolves.toEqual({ deleted: true });
    await expect(service.deletePost("student_001", "post_foreign"))
      .rejects.toMatchObject({ code: "COMMUNITY_POST_FORBIDDEN", statusCode: 403 });
    await expect(service.deletePost("student_001", "post_foreign_deleted"))
      .rejects.toMatchObject({ code: "COMMUNITY_POST_NOT_FOUND", statusCode: 404 });

    const updates = statements.filter(({ sql }) => sql.startsWith("UPDATE community_posts"));
    expect(updates).toHaveLength(1);
    const lockIndex = statements.findIndex(({ sql }) =>
      sql.includes("FROM community_posts post") && sql.includes("FOR UPDATE OF post")
    );
    const updateIndex = statements.findIndex(({ sql }) => sql.startsWith("UPDATE community_posts"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(lockIndex);
  });

  it("does not reveal an inactive author's hidden reply through editing", async () => {
    let attemptedUpdate = false;
    const { pool } = poolWith((sql) => {
      if (sql.includes("FROM community_replies reply") && sql.includes("FOR UPDATE OF post")) {
        return sql.includes("JOIN users reply_author")
          ? { rows: [], rowCount: 0 }
          : { rows: [{ reply_id: "reply_001" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE community_replies")) {
        attemptedUpdate = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT author_user_id, deleted_at FROM community_replies")) {
        return { rows: [{ author_user_id: "student_002", deleted_at: null }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.updateReply("student_001", "reply_001", {
      body: "不应写入不可见回复的新内容。",
    })).rejects.toMatchObject({ code: "COMMUNITY_REPLY_NOT_FOUND", statusCode: 404 });
    expect(attemptedUpdate).toBe(false);
  });

  it("checks that a reply parent is still visible before deleting it", async () => {
    let changed = false;
    const { pool } = poolWith((sql) => {
      if (sql.includes("FROM community_replies reply") && sql.includes("circle.active = true")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE community_replies")) {
        changed = true;
        return { rows: [{ reply_id: "reply_001", post_id: "post_001" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE community_posts post")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.deleteReply("student_001", "reply_001"))
      .rejects.toMatchObject({ code: "COMMUNITY_REPLY_NOT_FOUND", statusCode: 404 });
    expect(changed).toBe(false);
  });

  it("preserves reply deletion semantics after the parent visibility check", async () => {
    let ownReplyDeleted = false;
    const { pool, statements } = poolWith((sql, parameters) => {
      if (sql.includes("FROM community_replies reply") && sql.includes("FOR UPDATE OF post")) {
        const replyId = parameters[0];
        if (replyId === "reply_own") {
          return {
            rows: [{ author_user_id: "student_001", deleted_at: ownReplyDeleted ? now : null }],
            rowCount: 1,
          };
        }
        if (replyId === "reply_foreign") {
          return { rows: [{ author_user_id: "student_002", deleted_at: null }], rowCount: 1 };
        }
        if (replyId === "reply_foreign_deleted") {
          return { rows: [{ author_user_id: "student_002", deleted_at: now }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE community_replies")) {
        ownReplyDeleted = true;
        return { rows: [{ reply_id: "reply_own", post_id: "post_001" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE community_posts post")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.deleteReply("student_001", "reply_own"))
      .resolves.toEqual({ deleted: true });
    await expect(service.deleteReply("student_001", "reply_own"))
      .resolves.toEqual({ deleted: true });
    await expect(service.deleteReply("student_001", "reply_foreign"))
      .rejects.toMatchObject({ code: "COMMUNITY_REPLY_FORBIDDEN", statusCode: 403 });
    await expect(service.deleteReply("student_001", "reply_foreign_deleted"))
      .rejects.toMatchObject({ code: "COMMUNITY_REPLY_NOT_FOUND", statusCode: 404 });

    const replyUpdates = statements.filter(({ sql }) => sql.startsWith("UPDATE community_replies"));
    expect(replyUpdates).toHaveLength(1);
    expect(statements.filter(({ sql }) => sql.startsWith("UPDATE community_posts post")))
      .toHaveLength(1);
    const lockIndex = statements.findIndex(({ sql }) =>
      sql.includes("FROM community_replies reply") && sql.includes("FOR UPDATE OF post")
    );
    const updateIndex = statements.findIndex(({ sql }) => sql.startsWith("UPDATE community_replies"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(lockIndex);
  });

  it("sets an explicit like state and reports the database count", async () => {
    const { pool, statements } = poolWith((sql) => {
      if (sql.includes("FROM community_posts post") && sql.includes("deleted_at IS NULL")) {
        return { rows: [{ post_id: "post_001" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO community_post_likes")) return { rows: [], rowCount: 1 };
      if (sql.includes("COUNT(*)::text AS like_count")) return { rows: [{ like_count: "4" }], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const service = new PostgresCommunity(pool);

    await expect(service.setPostLike("student_001", "post_001", true))
      .resolves.toEqual({ liked: true, like_count: 4 });
    expect(statements.some(({ sql }) => sql.includes("DELETE FROM community_post_likes"))).toBe(false);
    const activePostSql = statements.find(({ sql }) => sql.includes("FROM community_posts post") && sql.includes("deleted_at IS NULL"))?.sql ?? "";
    expect(activePostSql).toContain("JOIN community_circles");
    expect(activePostSql).toContain("JOIN users");
  });
});
