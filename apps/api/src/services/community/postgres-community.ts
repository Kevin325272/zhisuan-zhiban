import { randomUUID } from "node:crypto";

import type {
  CommunityCircleOverview,
  CommunityContentOrigin,
  CommunityPostCreateRequest,
  CommunityPostDetailResponse,
  CommunityPostList,
  CommunityPostListQuery,
  CommunityPostSummary,
  CommunityPostUpdateRequest,
  CommunityReply,
  CommunityReplyCreateRequest,
  CommunityReplyListQuery,
  CommunityReplyUpdateRequest,
  CommunityTopic,
} from "@xuetu/contracts";

import type { SqlClient, SqlQueryablePool } from "../../database/client.js";
import { withTransaction } from "../../database/client.js";
import {
  CommunityError,
  type CommunityService,
} from "./community.js";

type Queryable = Pick<SqlQueryablePool, "query"> | Pick<SqlClient, "query">;

interface PostRow {
  post_id: string;
  circle_id: string;
  school_name: string;
  topic: CommunityTopic;
  title: string;
  body: string;
  excerpt: string;
  author_user_id: string;
  display_name: string;
  reply_count: string | number;
  like_count: string | number;
  view_count: string | number;
  liked_by_me: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  last_activity_at: string | Date;
  content_origin: CommunityContentOrigin;
  pinned: boolean;
}

interface ReplyRow {
  reply_id: string;
  post_id: string;
  author_user_id: string;
  display_name: string;
  body: string;
  created_at: string | Date;
  updated_at: string | Date;
  content_origin: CommunityContentOrigin;
}

function asCount(value: string | number | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function avatarLabel(displayName: string) {
  return Array.from(displayName.trim())[0] ?? "学";
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function mapPost(row: PostRow, viewerUserId: string): CommunityPostSummary {
  return {
    post_id: row.post_id,
    circle: { circle_id: row.circle_id, school_name: row.school_name },
    topic: row.topic,
    title: row.title,
    excerpt: row.excerpt,
    author: {
      display_name: row.display_name,
      avatar_label: avatarLabel(row.display_name),
      is_self: row.author_user_id === viewerUserId,
    },
    reply_count: asCount(row.reply_count),
    like_count: asCount(row.like_count),
    view_count: asCount(row.view_count),
    liked_by_me: row.liked_by_me,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    last_activity_at: asIso(row.last_activity_at),
    content_origin: row.content_origin,
  };
}

function mapReply(row: ReplyRow, viewerUserId: string): CommunityReply {
  return {
    reply_id: row.reply_id,
    body: row.body,
    author: {
      display_name: row.display_name,
      avatar_label: avatarLabel(row.display_name),
      is_self: row.author_user_id === viewerUserId,
    },
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    content_origin: row.content_origin,
  };
}

const POST_ROW_SELECT = `
  SELECT p.post_id,
         p.circle_id,
         c.school_name,
         p.topic,
         p.title,
         p.body,
         left(regexp_replace(p.body, '\\s+', ' ', 'g'), 200) AS excerpt,
         p.author_user_id,
         u.display_name,
         replies.reply_count,
         likes.like_count,
         p.view_count,
         EXISTS (
           SELECT 1 FROM community_post_likes viewer_like
           WHERE viewer_like.post_id = p.post_id AND viewer_like.user_id = $1
         ) AS liked_by_me,
         p.created_at,
         p.updated_at,
         p.last_activity_at,
         p.content_origin,
         p.pinned
  FROM community_posts p
  JOIN community_circles c ON c.circle_id = p.circle_id AND c.active = true
  JOIN users u ON u.user_id = p.author_user_id AND u.account_status = 'active'
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS reply_count
    FROM community_replies r
    JOIN users reply_author ON reply_author.user_id = r.author_user_id
                           AND reply_author.account_status = 'active'
    WHERE r.post_id = p.post_id AND r.deleted_at IS NULL
  ) replies ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS like_count
    FROM community_post_likes l
    JOIN users liker ON liker.user_id = l.user_id
                    AND liker.account_status = 'active'
    WHERE l.post_id = p.post_id
  ) likes ON true`;

export class PostgresCommunity implements CommunityService {
  constructor(private readonly pool: SqlQueryablePool) {}

  async listCircles(userId: string): Promise<CommunityCircleOverview> {
    const result = await this.pool.query<{
      circle_id: string;
      school_name: string;
      description: string;
      member_count: string | number;
      post_count: string | number;
      is_my_target: boolean;
    }>(`
      WITH current_target AS (
        SELECT COALESCE(
          (
            SELECT target.school
            FROM student_admission_targets saved
            JOIN admission_targets target ON target.target_id = saved.target_id
            WHERE saved.user_id = $1
          ),
          (
            SELECT state.target_school
            FROM student_onboarding_states state
            WHERE state.user_id = $1
          )
        ) AS school_name
      ), member_targets AS (
        SELECT target_member.user_id,
               lower(COALESCE(selected_target.school, onboarding.target_school)) AS school_key
        FROM users target_member
        JOIN user_roles target_role ON target_role.user_id = target_member.user_id
                                   AND target_role.role_key = 'student'
        LEFT JOIN student_onboarding_states onboarding
               ON onboarding.user_id = target_member.user_id
        LEFT JOIN student_admission_targets saved_target
               ON saved_target.user_id = target_member.user_id
        LEFT JOIN admission_targets selected_target
               ON selected_target.target_id = saved_target.target_id
        WHERE target_member.account_status = 'active'
          AND COALESCE(selected_target.school, onboarding.target_school) IS NOT NULL
      )
      SELECT circle.circle_id,
             circle.school_name,
             circle.description,
             CASE WHEN circle.circle_id = 'circle_all_408'
               THEN (
                 SELECT COUNT(DISTINCT role.user_id)::text
                 FROM user_roles role
                 JOIN users member ON member.user_id = role.user_id
                 WHERE role.role_key = 'student' AND member.account_status = 'active'
               )
               ELSE COUNT(DISTINCT member_targets.user_id)::text
             END AS member_count,
             (
               SELECT COUNT(*)::text
               FROM community_posts post
               JOIN users author ON author.user_id = post.author_user_id
                                AND author.account_status = 'active'
               WHERE post.circle_id = circle.circle_id AND post.deleted_at IS NULL
             ) AS post_count,
             lower(circle.school_name) = lower(current_target.school_name) AS is_my_target
      FROM community_circles circle
      CROSS JOIN current_target
      LEFT JOIN member_targets ON member_targets.school_key = lower(circle.school_name)
      WHERE circle.active = true
      GROUP BY circle.circle_id, circle.school_name, circle.description,
               circle.sort_order, current_target.school_name
      ORDER BY is_my_target DESC, circle.sort_order, circle.school_name
    `, [userId]);

    const circles = result.rows.map((row) => ({
      circle_id: row.circle_id,
      school_name: row.school_name,
      description: row.description,
      member_count: asCount(row.member_count),
      post_count: asCount(row.post_count),
      is_my_target: row.is_my_target,
    }));
    return {
      circles,
      current_target_circle_id: circles.find((circle) => circle.is_my_target)?.circle_id ?? null,
    };
  }

  async listPosts(userId: string, query: CommunityPostListQuery): Promise<CommunityPostList> {
    const parameters: unknown[] = [userId];
    const conditions = ["p.deleted_at IS NULL", "$1::text <> ''"];
    if (query.circle_id) {
      parameters.push(query.circle_id);
      conditions.push(`p.circle_id = $${parameters.length}`);
    }
    if (query.topic) {
      parameters.push(query.topic);
      conditions.push(`p.topic = $${parameters.length}`);
    }
    if (query.search) {
      parameters.push(`%${escapeLikePattern(query.search)}%`);
      conditions.push(
        `(p.title ILIKE $${parameters.length} ESCAPE E'\\\\' OR p.body ILIKE $${parameters.length} ESCAPE E'\\\\')`,
      );
    }
    if (query.sort === "mine") conditions.push("p.author_user_id = $1");
    const where = conditions.join(" AND ");

    const totalResult = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM community_posts p
       JOIN community_circles c ON c.circle_id = p.circle_id AND c.active = true
       JOIN users u ON u.user_id = p.author_user_id AND u.account_status = 'active'
       WHERE ${where}`,
      parameters,
    );
    const total = asCount(totalResult.rows[0]?.total);
    const dataParameters = [...parameters, query.page_size, (query.page - 1) * query.page_size];
    const limitParameter = `$${dataParameters.length - 1}`;
    const offsetParameter = `$${dataParameters.length}`;
    const orderBy = query.sort === "popular"
      ? "pinned DESC, (reply_count * 3 + like_count * 2 + LEAST(view_count, 100)) DESC, last_activity_at DESC, post_id DESC"
      : "pinned DESC, last_activity_at DESC, post_id DESC";
    const rows = await this.pool.query<PostRow>(`
      WITH post_rows AS (
        ${POST_ROW_SELECT}
        WHERE ${where}
      )
      SELECT * FROM post_rows
      ORDER BY ${orderBy}
      LIMIT ${limitParameter} OFFSET ${offsetParameter}
    `, dataParameters);

    return {
      items: rows.rows.map((row) => mapPost(row, userId)),
      page: query.page,
      page_size: query.page_size,
      total,
      total_pages: total === 0 ? 0 : Math.ceil(total / query.page_size),
    };
  }

  async getPost(
    userId: string,
    postId: string,
    query: CommunityReplyListQuery,
  ): Promise<CommunityPostDetailResponse> {
    return withTransaction(this.pool, async (client) => {
      const viewed = await client.query<{ post_id: string }>(
        `INSERT INTO community_post_views(post_id, user_id)
         SELECT post.post_id, $2
         FROM community_posts post
         JOIN community_circles circle ON circle.circle_id = post.circle_id AND circle.active = true
         JOIN users author ON author.user_id = post.author_user_id AND author.account_status = 'active'
         WHERE post.post_id = $1 AND post.deleted_at IS NULL
         ON CONFLICT (post_id, user_id) DO NOTHING
         RETURNING post_id`,
        [postId, userId],
      );
      if (viewed.rows.length > 0) {
        await client.query(
          `UPDATE community_posts
           SET view_count = view_count + 1
           WHERE post_id = $1`,
          [postId],
        );
      }
      const row = await this.readPostRow(client, userId, postId);
      const replyTotalResult = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM community_replies reply
         JOIN users author ON author.user_id = reply.author_user_id
                          AND author.account_status = 'active'
         WHERE reply.post_id = $1 AND reply.deleted_at IS NULL`,
        [postId],
      );
      const replyTotal = asCount(replyTotalResult.rows[0]?.total);
      const replies = await client.query<ReplyRow>(
        `SELECT reply.reply_id,
                reply.post_id,
                reply.author_user_id,
                author.display_name,
                reply.body,
                reply.created_at,
                reply.updated_at,
                reply.content_origin
         FROM community_replies reply
         JOIN users author ON author.user_id = reply.author_user_id
                            AND author.account_status = 'active'
         WHERE reply.post_id = $1 AND reply.deleted_at IS NULL
         ORDER BY reply.created_at, reply.reply_id
         LIMIT $2 OFFSET $3`,
        [postId, query.reply_page_size, (query.reply_page - 1) * query.reply_page_size],
      );
      const summary = mapPost(row, userId);
      const { excerpt: _excerpt, ...postSummary } = summary;
      return {
        post: { ...postSummary, body: row.body },
        replies: replies.rows.map((reply) => mapReply(reply, userId)),
        reply_page: query.reply_page,
        reply_page_size: query.reply_page_size,
        reply_total: replyTotal,
        reply_total_pages: replyTotal === 0 ? 0 : Math.ceil(replyTotal / query.reply_page_size),
      };
    });
  }

  async createPost(
    userId: string,
    input: CommunityPostCreateRequest,
    idempotencyKey: string,
  ): Promise<CommunityPostSummary> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`community-post:${userId}`]);
      const existing = await client.query<{
        post_id: string;
        circle_id: string;
        topic: CommunityTopic;
        title: string;
        body: string;
        deleted_at: string | Date | null;
      }>(
        `SELECT post_id, circle_id, topic, title, body, deleted_at
         FROM community_posts
         WHERE author_user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey],
      );
      const prior = existing.rows[0];
      if (prior) {
        const sameRequest = prior.circle_id === input.circle_id
          && prior.topic === input.topic
          && prior.title === input.title
          && prior.body === input.body;
        if (prior.deleted_at || !sameRequest) {
          throw new CommunityError(
            "COMMUNITY_IDEMPOTENCY_CONFLICT",
            "这次发布请求已对应其他内容，请重新发布。",
            409,
          );
        }
        return this.selectPostSummary(client, userId, prior.post_id);
      }

      const circle = await client.query<{ circle_id: string }>(
        `SELECT circle_id FROM community_circles WHERE circle_id = $1 AND active = true`,
        [input.circle_id],
      );
      if (circle.rows.length === 0) {
        throw new CommunityError("COMMUNITY_CIRCLE_NOT_FOUND", "所选院校圈不存在或已停用。", 404);
      }
      const recent = await client.query<{ recent_count: string }>(
        `SELECT COUNT(*)::text AS recent_count
         FROM community_posts
         WHERE author_user_id = $1
           AND created_at >= now() - interval '10 minutes'`,
        [userId],
      );
      if (asCount(recent.rows[0]?.recent_count) >= 5) {
        throw new CommunityError(
          "COMMUNITY_POST_RATE_LIMITED",
          "发布太频繁，请稍后再试。",
          429,
        );
      }

      const postId = `community_post_${randomUUID()}`;
      await client.query(
        `INSERT INTO community_posts(
           post_id, circle_id, author_user_id, topic, title, body,
           content_origin, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,'member',$7)`,
        [postId, input.circle_id, userId, input.topic, input.title, input.body, idempotencyKey],
      );
      return this.selectPostSummary(client, userId, postId);
    });
  }

  async updatePost(
    userId: string,
    postId: string,
    input: CommunityPostUpdateRequest,
  ): Promise<CommunityPostSummary> {
    return withTransaction(this.pool, async (client) => {
      await this.assertActivePost(client, postId);
      const updated = await client.query<{ post_id: string }>(
        `UPDATE community_posts
         SET topic = COALESCE($3, topic),
             title = COALESCE($4, title),
             body = COALESCE($5, body),
             updated_at = now()
         WHERE post_id = $1 AND author_user_id = $2 AND deleted_at IS NULL
         RETURNING post_id`,
        [postId, userId, input.topic ?? null, input.title ?? null, input.body ?? null],
      );
      if (updated.rows.length === 0) {
        await this.raisePostOwnershipError(client, userId, postId);
      }
      return this.selectPostSummary(client, userId, postId);
    });
  }

  async deletePost(userId: string, postId: string) {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.readVisiblePostOwnerForUpdate(client, postId);
      if (!existing) throw this.notFoundPost();
      if (existing.deleted_at) {
        if (existing.author_user_id === userId) return { deleted: true as const };
        throw this.notFoundPost();
      }
      if (existing.author_user_id !== userId) throw this.forbiddenPost();

      const deleted = await client.query<{ post_id: string }>(
        `UPDATE community_posts
         SET deleted_at = now(), updated_at = now()
         WHERE post_id = $1 AND author_user_id = $2 AND deleted_at IS NULL
         RETURNING post_id`,
        [postId, userId],
      );
      if (deleted.rows.length === 0) throw this.notFoundPost();
      return { deleted: true as const };
    });
  }

  async createReply(
    userId: string,
    postId: string,
    input: CommunityReplyCreateRequest,
    idempotencyKey: string,
  ): Promise<CommunityReply> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`community-reply:${userId}`]);
      const existing = await client.query<{
        reply_id: string;
        post_id: string;
        body: string;
        deleted_at: string | Date | null;
      }>(
        `SELECT reply_id, post_id, body, deleted_at
         FROM community_replies
         WHERE author_user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey],
      );
      const prior = existing.rows[0];
      if (prior) {
        if (prior.post_id !== postId || prior.body !== input.body || prior.deleted_at) {
          throw new CommunityError(
            "COMMUNITY_IDEMPOTENCY_CONFLICT",
            "这次回复请求已用于其他内容，请重新提交。",
            409,
          );
        }
        return this.selectReply(client, userId, prior.reply_id);
      }
      await this.assertActivePost(client, postId);
      const recent = await client.query<{ recent_count: string }>(
        `SELECT COUNT(*)::text AS recent_count
         FROM community_replies
         WHERE author_user_id = $1
           AND created_at >= now() - interval '10 minutes'`,
        [userId],
      );
      if (asCount(recent.rows[0]?.recent_count) >= 20) {
        throw new CommunityError(
          "COMMUNITY_REPLY_RATE_LIMITED",
          "回复太频繁，请稍后再试。",
          429,
        );
      }
      const replyId = `community_reply_${randomUUID()}`;
      await client.query(
        `INSERT INTO community_replies(
           reply_id, post_id, author_user_id, body, content_origin, idempotency_key
         ) VALUES ($1,$2,$3,$4,'member',$5)`,
        [replyId, postId, userId, input.body, idempotencyKey],
      );
      await client.query(
        `UPDATE community_posts SET last_activity_at = now() WHERE post_id = $1`,
        [postId],
      );
      return this.selectReply(client, userId, replyId);
    });
  }

  async updateReply(
    userId: string,
    replyId: string,
    input: CommunityReplyUpdateRequest,
  ): Promise<CommunityReply> {
    return withTransaction(this.pool, async (client) => {
      await this.assertActiveReplyParent(client, replyId);
      const updated = await client.query<{ reply_id: string }>(
        `UPDATE community_replies
         SET body = $3, updated_at = now()
         WHERE reply_id = $1 AND author_user_id = $2 AND deleted_at IS NULL
         RETURNING reply_id`,
        [replyId, userId, input.body],
      );
      if (updated.rows.length === 0) {
        await this.raiseReplyOwnershipError(client, userId, replyId);
      }
      return this.selectReply(client, userId, replyId);
    });
  }

  async deleteReply(userId: string, replyId: string) {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.readVisibleReplyOwnerForUpdate(client, replyId);
      if (!existing) throw this.notFoundReply();
      if (existing.deleted_at) {
        if (existing.author_user_id === userId) return { deleted: true as const };
        throw this.notFoundReply();
      }
      if (existing.author_user_id !== userId) throw this.forbiddenReply();

      const deleted = await client.query<{ reply_id: string; post_id: string }>(
        `UPDATE community_replies
         SET deleted_at = now(), updated_at = now()
         WHERE reply_id = $1 AND author_user_id = $2 AND deleted_at IS NULL
         RETURNING reply_id, post_id`,
        [replyId, userId],
      );
      const row = deleted.rows[0];
      if (!row) throw this.notFoundReply();
      await client.query(
        `UPDATE community_posts post
         SET last_activity_at = GREATEST(
           post.created_at,
           COALESCE((
              SELECT MAX(reply.created_at)
              FROM community_replies reply
              JOIN users reply_author ON reply_author.user_id = reply.author_user_id
                                     AND reply_author.account_status = 'active'
              WHERE reply.post_id = post.post_id AND reply.deleted_at IS NULL
           ), post.created_at)
         )
         WHERE post.post_id = $1`,
        [row.post_id],
      );
      return { deleted: true as const };
    });
  }

  async setPostLike(userId: string, postId: string, liked: boolean) {
    return withTransaction(this.pool, async (client) => {
      await this.assertActivePost(client, postId);
      if (liked) {
        await client.query(
          `INSERT INTO community_post_likes(post_id, user_id)
           VALUES ($1,$2)
           ON CONFLICT (post_id, user_id) DO NOTHING`,
          [postId, userId],
        );
      } else {
        await client.query(
          `DELETE FROM community_post_likes WHERE post_id = $1 AND user_id = $2`,
          [postId, userId],
        );
      }
      const count = await client.query<{ like_count: string }>(
        `SELECT COUNT(*)::text AS like_count
         FROM community_post_likes
         JOIN users liker ON liker.user_id = community_post_likes.user_id
                          AND liker.account_status = 'active'
         WHERE post_id = $1`,
        [postId],
      );
      return { liked, like_count: asCount(count.rows[0]?.like_count) };
    });
  }

  private async readPostRow(queryable: Queryable, userId: string, postId: string) {
    const result = await queryable.query<PostRow>(`
      WITH post_rows AS (
        ${POST_ROW_SELECT}
        WHERE p.post_id = $2 AND p.deleted_at IS NULL
      )
      SELECT * FROM post_rows
    `, [userId, postId]);
    const row = result.rows[0];
    if (!row) throw this.notFoundPost();
    return row;
  }

  private async selectPostSummary(queryable: Queryable, userId: string, postId: string) {
    return mapPost(await this.readPostRow(queryable, userId, postId), userId);
  }

  private async selectReply(queryable: Queryable, userId: string, replyId: string) {
    const result = await queryable.query<ReplyRow>(
      `SELECT reply.reply_id,
              reply.post_id,
              reply.author_user_id,
              author.display_name,
              reply.body,
              reply.created_at,
              reply.updated_at,
              reply.content_origin
       FROM community_replies reply
       JOIN community_posts post ON post.post_id = reply.post_id
                                AND post.deleted_at IS NULL
       JOIN community_circles circle ON circle.circle_id = post.circle_id
                                     AND circle.active = true
       JOIN users post_author ON post_author.user_id = post.author_user_id
                             AND post_author.account_status = 'active'
       JOIN users author ON author.user_id = reply.author_user_id
                          AND author.account_status = 'active'
       WHERE reply.reply_id = $1 AND reply.deleted_at IS NULL`,
      [replyId],
    );
    const row = result.rows[0];
    if (!row) throw this.notFoundReply();
    return mapReply(row, userId);
  }

  private async assertActivePost(queryable: Queryable, postId: string) {
    const result = await queryable.query<{ post_id: string }>(
      `SELECT post.post_id
       FROM community_posts post
       JOIN community_circles circle ON circle.circle_id = post.circle_id
                                      AND circle.active = true
       JOIN users author ON author.user_id = post.author_user_id
                         AND author.account_status = 'active'
       WHERE post.post_id = $1 AND post.deleted_at IS NULL
       FOR UPDATE OF post`,
      [postId],
    );
    if (result.rows.length === 0) throw this.notFoundPost();
  }

  private async assertActiveReplyParent(queryable: Queryable, replyId: string) {
    const result = await queryable.query<{ reply_id: string }>(
      `SELECT reply.reply_id
       FROM community_replies reply
       JOIN community_posts post ON post.post_id = reply.post_id
                                AND post.deleted_at IS NULL
       JOIN community_circles circle ON circle.circle_id = post.circle_id
                                     AND circle.active = true
       JOIN users post_author ON post_author.user_id = post.author_user_id
                             AND post_author.account_status = 'active'
       JOIN users reply_author ON reply_author.user_id = reply.author_user_id
                              AND reply_author.account_status = 'active'
       WHERE reply.reply_id = $1 AND reply.deleted_at IS NULL
       FOR UPDATE OF post`,
      [replyId],
    );
    if (result.rows.length === 0) throw this.notFoundReply();
  }

  private async readVisiblePostOwnerForUpdate(queryable: Queryable, postId: string) {
    const result = await queryable.query<{
      author_user_id: string;
      deleted_at: string | Date | null;
    }>(
      `SELECT post.author_user_id, post.deleted_at
       FROM community_posts post
       JOIN community_circles circle ON circle.circle_id = post.circle_id
                                     AND circle.active = true
       JOIN users author ON author.user_id = post.author_user_id
                         AND author.account_status = 'active'
       WHERE post.post_id = $1
       FOR UPDATE OF post`,
      [postId],
    );
    return result.rows[0] ?? null;
  }

  private async readVisibleReplyOwnerForUpdate(queryable: Queryable, replyId: string) {
    const result = await queryable.query<{
      author_user_id: string;
      deleted_at: string | Date | null;
    }>(
      `SELECT reply.author_user_id, reply.deleted_at
       FROM community_replies reply
       JOIN community_posts post ON post.post_id = reply.post_id
                                AND post.deleted_at IS NULL
       JOIN community_circles circle ON circle.circle_id = post.circle_id
                                     AND circle.active = true
       JOIN users post_author ON post_author.user_id = post.author_user_id
                             AND post_author.account_status = 'active'
       JOIN users reply_author ON reply_author.user_id = reply.author_user_id
                              AND reply_author.account_status = 'active'
       WHERE reply.reply_id = $1
       FOR UPDATE OF post`,
      [replyId],
    );
    return result.rows[0] ?? null;
  }

  private async readPostOwner(queryable: Queryable, postId: string) {
    const result = await queryable.query<{
      author_user_id: string;
      deleted_at: string | Date | null;
    }>("SELECT author_user_id, deleted_at FROM community_posts WHERE post_id = $1", [postId]);
    return result.rows[0] ?? null;
  }

  private async raisePostOwnershipError(
    queryable: Queryable,
    userId: string,
    postId: string,
  ): Promise<never> {
    const existing = await this.readPostOwner(queryable, postId);
    if (!existing || existing.deleted_at) throw this.notFoundPost();
    if (existing.author_user_id !== userId) throw this.forbiddenPost();
    throw this.notFoundPost();
  }

  private async readReplyOwner(queryable: Queryable, replyId: string) {
    const result = await queryable.query<{
      author_user_id: string;
      deleted_at: string | Date | null;
    }>("SELECT author_user_id, deleted_at FROM community_replies WHERE reply_id = $1", [replyId]);
    return result.rows[0] ?? null;
  }

  private async raiseReplyOwnershipError(
    queryable: Queryable,
    userId: string,
    replyId: string,
  ): Promise<never> {
    const existing = await this.readReplyOwner(queryable, replyId);
    if (!existing || existing.deleted_at) throw this.notFoundReply();
    if (existing.author_user_id !== userId) throw this.forbiddenReply();
    throw this.notFoundReply();
  }

  private notFoundPost() {
    return new CommunityError("COMMUNITY_POST_NOT_FOUND", "这篇讨论不存在或已删除。", 404);
  }

  private forbiddenPost() {
    return new CommunityError("COMMUNITY_POST_FORBIDDEN", "只能修改或删除自己发布的讨论。", 403);
  }

  private notFoundReply() {
    return new CommunityError("COMMUNITY_REPLY_NOT_FOUND", "这条回复不存在或已删除。", 404);
  }

  private forbiddenReply() {
    return new CommunityError("COMMUNITY_REPLY_FORBIDDEN", "只能修改或删除自己的回复。", 403);
  }
}
