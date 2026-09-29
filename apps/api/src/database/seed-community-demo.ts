import type { SqlPool } from "./client.js";
import { withTransaction } from "./client.js";
import {
  COMMUNITY_DEMO_LIKES,
  COMMUNITY_DEMO_POSTS,
  COMMUNITY_DEMO_REPLIES,
} from "./community-demo-content.js";

export async function seedCommunityDemo(
  pool: SqlPool,
  now: () => Date = () => new Date(),
) {
  const referenceTime = now().getTime();
  return withTransaction(pool, async (client) => {
    for (const post of COMMUNITY_DEMO_POSTS) {
      const createdAt = new Date(referenceTime - post.ageHours * 3_600_000).toISOString();
      await client.query(
        `INSERT INTO community_posts(
           post_id, circle_id, author_user_id, topic, title, body,
           content_origin, idempotency_key, view_count, created_at,
           updated_at, last_activity_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'sample',$7,$8,$9,$9,$9)
         ON CONFLICT (post_id) DO UPDATE
         SET circle_id = EXCLUDED.circle_id,
             author_user_id = EXCLUDED.author_user_id,
             topic = EXCLUDED.topic,
             title = EXCLUDED.title,
             body = EXCLUDED.body,
             content_origin = 'sample',
             view_count = GREATEST(community_posts.view_count, EXCLUDED.view_count),
             updated_at = EXCLUDED.updated_at
         WHERE community_posts.content_origin = 'sample'`,
        [
          post.postId,
          post.circleId,
          post.authorUserId,
          post.topic,
          post.title,
          post.body,
          `seed:${post.postId}`,
          post.viewCount,
          createdAt,
        ],
      );
    }

    for (const reply of COMMUNITY_DEMO_REPLIES) {
      const createdAt = new Date(referenceTime - reply.ageHours * 3_600_000).toISOString();
      await client.query(
        `INSERT INTO community_replies(
           reply_id, post_id, author_user_id, body, content_origin,
           idempotency_key, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'sample',$5,$6,$6)
         ON CONFLICT (reply_id) DO UPDATE
         SET author_user_id = EXCLUDED.author_user_id,
             body = EXCLUDED.body,
             content_origin = 'sample',
             updated_at = EXCLUDED.updated_at
         WHERE community_replies.content_origin = 'sample'`,
        [
          reply.replyId,
          reply.postId,
          reply.authorUserId,
          reply.body,
          `seed:${reply.replyId}`,
          createdAt,
        ],
      );
    }

    for (const like of COMMUNITY_DEMO_LIKES) {
      await client.query(
        `INSERT INTO community_post_likes(post_id, user_id)
         VALUES ($1,$2)
         ON CONFLICT (post_id, user_id) DO NOTHING`,
        [like.postId, like.userId],
      );
    }

    await client.query(`
      UPDATE community_posts post
      SET last_activity_at = GREATEST(
        post.created_at,
        COALESCE((
          SELECT MAX(reply.created_at)
          FROM community_replies reply
          WHERE reply.post_id = post.post_id AND reply.deleted_at IS NULL
        ), post.created_at)
      )
      WHERE post.content_origin = 'sample'
    `);

    return {
      posts: COMMUNITY_DEMO_POSTS.length,
      replies: COMMUNITY_DEMO_REPLIES.length,
      likes: COMMUNITY_DEMO_LIKES.length,
    };
  });
}
