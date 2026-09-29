CREATE TABLE community_circles (
  circle_id text PRIMARY KEY,
  school_name text NOT NULL CHECK (length(school_name) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 180),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX community_circles_school_lower_idx
  ON community_circles (lower(school_name));

CREATE TABLE community_posts (
  post_id text PRIMARY KEY,
  circle_id text NOT NULL REFERENCES community_circles(circle_id) ON DELETE RESTRICT,
  author_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  topic text NOT NULL CHECK (topic IN ('择校交流', '备考规划', '课程讨论', '经验复盘')),
  title text NOT NULL CHECK (length(title) BETWEEN 5 AND 80),
  body text NOT NULL CHECK (length(body) BETWEEN 10 AND 5000),
  content_origin text NOT NULL DEFAULT 'member' CHECK (content_origin IN ('member', 'sample')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (author_user_id, idempotency_key)
);

CREATE INDEX community_posts_active_circle_idx
  ON community_posts(circle_id, pinned DESC, last_activity_at DESC, post_id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX community_posts_active_author_idx
  ON community_posts(author_user_id, last_activity_at DESC, post_id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX community_posts_active_topic_idx
  ON community_posts(topic, last_activity_at DESC, post_id DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE community_replies (
  reply_id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES community_posts(post_id) ON DELETE CASCADE,
  author_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 2 AND 1000),
  content_origin text NOT NULL DEFAULT 'member' CHECK (content_origin IN ('member', 'sample')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (author_user_id, idempotency_key)
);

CREATE INDEX community_replies_active_post_idx
  ON community_replies(post_id, created_at, reply_id)
  WHERE deleted_at IS NULL;

CREATE INDEX community_replies_active_author_idx
  ON community_replies(author_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE community_post_likes (
  post_id text NOT NULL REFERENCES community_posts(post_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX community_post_likes_user_idx
  ON community_post_likes(user_id, created_at DESC);

CREATE TABLE community_post_views (
  post_id text NOT NULL REFERENCES community_posts(post_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX student_onboarding_target_school_lower_idx
  ON student_onboarding_states(lower(target_school))
  WHERE target_school IS NOT NULL;

INSERT INTO community_circles(
  circle_id, school_name, description, sort_order
) VALUES
  ('circle_all_408', '408 备考交流', '四门专业课、复习节奏与真题复盘', 0),
  ('circle_xju', '新疆大学', '目标新疆大学的择校与备考讨论', 10),
  ('circle_zzu', '郑州大学', '目标郑州大学的择校与备考讨论', 20),
  ('circle_ustc', '中国科学技术大学', '目标中国科学技术大学的择校与备考讨论', 30),
  ('circle_bupt', '北京邮电大学', '目标北京邮电大学的择校与备考讨论', 40),
  ('circle_xidian', '西安电子科技大学', '目标西安电子科技大学的择校与备考讨论', 50),
  ('circle_hdu', '杭州电子科技大学', '目标杭州电子科技大学的择校与备考讨论', 60),
  ('circle_njupt', '南京邮电大学', '目标南京邮电大学的择校与备考讨论', 70),
  ('circle_cqupt', '重庆邮电大学', '目标重庆邮电大学的择校与备考讨论', 80)
ON CONFLICT (circle_id) DO UPDATE
SET school_name = EXCLUDED.school_name,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    active = true,
    updated_at = now();
