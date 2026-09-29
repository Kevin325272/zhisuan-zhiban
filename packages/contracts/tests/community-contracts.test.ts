import { describe, expect, it } from "vitest";

import {
  communityPostCreateRequestSchema,
  communityPostListQuerySchema,
  communityPostUpdateRequestSchema,
  communityReplyCreateRequestSchema,
  communityReplyUpdateRequestSchema,
} from "../src/index.js";

describe("community contracts", () => {
  it("normalizes safe member-authored post text without accepting extra fields", () => {
    const parsed = communityPostCreateRequestSchema.parse({
      circle_id: "circle_xju",
      topic: "备考规划",
      title: "  一轮复习如何安排四门课  ",
      body: "  我每天大约有四小时，想听听大家怎么分配。\r\n尤其是计组和操作系统。  ",
    });

    expect(parsed.title).toBe("一轮复习如何安排四门课");
    expect(parsed.body).toBe("我每天大约有四小时，想听听大家怎么分配。\n尤其是计组和操作系统。");
    expect(() => communityPostCreateRequestSchema.parse({ ...parsed, author_user_id: "someone-else" }))
      .toThrow();
  });

  it("bounds post and reply content", () => {
    expect(() => communityPostCreateRequestSchema.parse({
      circle_id: "circle_xju",
      topic: "课程讨论",
      title: "短",
      body: "内容也太短",
    })).toThrow();
    expect(() => communityReplyCreateRequestSchema.parse({ body: "x".repeat(1_001) })).toThrow();
  });

  it("requires an actual field for partial edits", () => {
    expect(() => communityPostUpdateRequestSchema.parse({})).toThrow();
    expect(() => communityReplyUpdateRequestSchema.parse({})).toThrow();
  });

  it("coerces and bounds list pagination", () => {
    expect(communityPostListQuerySchema.parse({ page: "2", page_size: "20" }))
      .toMatchObject({ page: 2, page_size: 20, sort: "recent" });
    expect(() => communityPostListQuerySchema.parse({ page: "0", page_size: "100" }))
      .toThrow();
  });
});
