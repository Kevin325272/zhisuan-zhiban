import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { CommunityError, type CommunityService } from "../src/services/community/community.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

const now = "2026-08-27T02:00:00.000Z";
const studentId = "student_001";
const teacherId = "teacher_001";

function actor(userId: string, roles: Array<"student" | "teacher" | "admin">) {
  return {
    user: {
      user_id: userId,
      display_name: roles.includes("student") ? "许泽宇" : "陈明远",
      account_status: "active" as const,
      auth_source: "local_development" as const,
      created_at: now,
      updated_at: now,
    },
    roles,
  };
}

const summary = {
  post_id: "post_001",
  circle: { circle_id: "circle_xju", school_name: "新疆大学" },
  topic: "备考规划" as const,
  title: "一轮复习如何安排四门课",
  excerpt: "我每天大约有四小时，想听听大家怎么分配。",
  author: { display_name: "许泽宇", avatar_label: "许", is_self: true },
  reply_count: 0,
  like_count: 0,
  view_count: 0,
  liked_by_me: false,
  created_at: now,
  updated_at: now,
  last_activity_at: now,
  content_origin: "member" as const,
};

describe("community routes", () => {
  let app: FastifyInstance;
  let service: Record<keyof CommunityService, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    const access: PlatformAccessService = {
      async getActor(userId) {
        if (userId === studentId) return actor(userId, ["student"]);
        if (userId === teacherId) return actor(userId, ["teacher"]);
        return null;
      },
      async isCourseAssigned() { return false; },
    };
    service = {
      listCircles: vi.fn().mockResolvedValue({ circles: [], current_target_circle_id: null }),
      listPosts: vi.fn().mockResolvedValue({ items: [summary], page: 1, page_size: 12, total: 1, total_pages: 1 }),
      getPost: vi.fn().mockResolvedValue({ post: { ...summary, body: summary.excerpt }, replies: [], reply_page: 1, reply_page_size: 30, reply_total: 0, reply_total_pages: 0 }),
      createPost: vi.fn().mockResolvedValue(summary),
      updatePost: vi.fn().mockResolvedValue(summary),
      deletePost: vi.fn().mockResolvedValue({ deleted: true }),
      createReply: vi.fn().mockResolvedValue({
        reply_id: "reply_001",
        body: "我会先把每天最清醒的时间留给计组。",
        author: { display_name: "许泽宇", avatar_label: "许", is_self: true },
        created_at: now,
        updated_at: now,
        content_origin: "member",
      }),
      updateReply: vi.fn(),
      deleteReply: vi.fn().mockResolvedValue({ deleted: true }),
      setPostLike: vi.fn().mockResolvedValue({ liked: true, like_count: 1 }),
    };
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: access,
      community: service as unknown as CommunityService,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("allows students to list circles and paginated posts", async () => {
    const headers = { "x-dev-user-id": studentId };
    const circles = await app.inject({ method: "GET", url: "/api/v1/student/community/circles", headers });
    const posts = await app.inject({
      method: "GET",
      url: "/api/v1/student/community/posts?circle_id=circle_xju&page=2&page_size=10&sort=popular",
      headers,
    });

    expect(circles.statusCode).toBe(200);
    expect(posts.statusCode).toBe(200);
    expect(service.listCircles).toHaveBeenCalledWith(studentId);
    expect(service.listPosts).toHaveBeenCalledWith(studentId, {
      circle_id: "circle_xju",
      page: 2,
      page_size: 10,
      search: undefined,
      sort: "popular",
      topic: undefined,
    });
  });

  it("derives authorship from the session and requires a retry-safe key", async () => {
    const payload = {
      circle_id: "circle_xju",
      topic: "备考规划",
      title: "一轮复习如何安排四门课",
      body: "我每天大约有四小时，想听听大家怎么分配。",
    };
    const withoutKey = await app.inject({
      method: "POST",
      url: "/api/v1/student/community/posts",
      headers: { "x-dev-user-id": studentId },
      payload,
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/student/community/posts",
      headers: { "x-dev-user-id": studentId, "idempotency-key": "post-create-001" },
      payload,
    });

    expect(withoutKey.statusCode).toBe(400);
    expect(created.statusCode).toBe(201);
    expect(service.createPost).toHaveBeenCalledWith(studentId, payload, "post-create-001");
  });

  it("rejects invalid list and content inputs before the service is called", async () => {
    const headers = { "x-dev-user-id": studentId };
    const badList = await app.inject({ method: "GET", url: "/api/v1/student/community/posts?page_size=200", headers });
    const badPost = await app.inject({
      method: "POST",
      url: "/api/v1/student/community/posts",
      headers: { ...headers, "idempotency-key": "post-create-002" },
      payload: { circle_id: "circle_xju", topic: "课程讨论", title: "短", body: "也太短" },
    });

    expect(badList.statusCode).toBe(400);
    expect(badPost.statusCode).toBe(400);
    expect(service.listPosts).not.toHaveBeenCalled();
    expect(service.createPost).not.toHaveBeenCalled();
  });

  it("keeps teacher accounts out of the student community", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/community/posts",
      headers: { "x-dev-user-id": teacherId },
    });

    expect(response.statusCode).toBe(403);
    expect(service.listPosts).not.toHaveBeenCalled();
  });

  it("maps ownership and frequency errors without hiding their status", async () => {
    service.updatePost.mockRejectedValueOnce(
      new CommunityError("COMMUNITY_POST_FORBIDDEN", "只能修改自己发布的讨论。", 403),
    );
    service.createReply.mockRejectedValueOnce(
      new CommunityError("COMMUNITY_REPLY_RATE_LIMITED", "回复太频繁，请稍后再试。", 429),
    );
    const headers = { "x-dev-user-id": studentId };
    const update = await app.inject({
      method: "PATCH",
      url: "/api/v1/student/community/posts/post_001",
      headers,
      payload: { title: "更新后的讨论标题" },
    });
    const reply = await app.inject({
      method: "POST",
      url: "/api/v1/student/community/posts/post_001/replies",
      headers: { ...headers, "idempotency-key": "reply-create-001" },
      payload: { body: "我会先把每天最清醒的时间留给计组。" },
    });

    expect(update.statusCode).toBe(403);
    expect(reply.statusCode).toBe(429);
    expect(reply.json().error.retryable).toBe(true);
  });

  it("sets an explicit like state so a retried request cannot toggle twice", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/student/community/posts/post_001/like",
      headers: { "x-dev-user-id": studentId },
      payload: { liked: true },
    });

    expect(response.statusCode).toBe(200);
    expect(service.setPostLike).toHaveBeenCalledWith(studentId, "post_001", true);
  });
});
