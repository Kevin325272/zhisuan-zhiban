import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/client", () => ({
  ApiError: class ApiError extends Error {},
  createCommunityPost: vi.fn(),
  createCommunityReply: vi.fn(),
  deleteCommunityPost: vi.fn(),
  deleteCommunityReply: vi.fn(),
  getCommunityCircles: vi.fn(),
  getCommunityPost: vi.fn(),
  getCommunityPosts: vi.fn(),
  setCommunityPostLike: vi.fn(),
  updateCommunityPost: vi.fn(),
  updateCommunityReply: vi.fn(),
}));

import {
  createCommunityPost,
  createCommunityReply,
  getCommunityCircles,
  getCommunityPost,
  getCommunityPosts,
  setCommunityPostLike,
} from "../../api/client";
import { CommunityPage } from "./community-page";

const now = "2026-08-27T02:00:00.000Z";
const circles = {
  current_target_circle_id: "circle_xju",
  circles: [
    { circle_id: "circle_all_408", school_name: "408 备考交流", description: "四门课与备考节奏", member_count: 288, post_count: 32, is_my_target: false },
    { circle_id: "circle_xju", school_name: "新疆大学", description: "目标新疆大学的同学", member_count: 36, post_count: 4, is_my_target: true },
  ],
};
const post = {
  post_id: "post_001",
  circle: { circle_id: "circle_xju", school_name: "新疆大学" },
  topic: "备考规划" as const,
  title: "一轮复习如何安排四门课",
  excerpt: "我每天大约有四小时，想听听大家怎么分配。",
  author: { display_name: "许泽宇", avatar_label: "许", is_self: false },
  reply_count: 2,
  like_count: 3,
  view_count: 18,
  liked_by_me: false,
  created_at: now,
  updated_at: now,
  last_activity_at: now,
  content_origin: "sample" as const,
};

describe("CommunityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCommunityCircles).mockResolvedValue(circles);
    vi.mocked(getCommunityPosts).mockResolvedValue({ items: [post], page: 1, page_size: 12, total: 1, total_pages: 1 });
    vi.mocked(getCommunityPost).mockResolvedValue({
      post: { ...post, body: "我每天大约有四小时，想听听大家怎么分配。" },
      replies: [],
      reply_page: 1,
      reply_page_size: 30,
      reply_total: 0,
      reply_total_pages: 0,
    });
  });

  function renderPage(entry = "/student/community") {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/student/community" element={<CommunityPage />} />
          <Route path="/student/community/:postId" element={<CommunityPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("highlights the target-school circle while keeping the existing student palette", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "院校圈" })).toBeInTheDocument();
    const target = screen.getByRole("button", { name: /新疆大学/ });
    expect(target).toHaveAttribute("data-target", "true");
    expect(screen.getByRole("article", { name: "一轮复习如何安排四门课" })).toBeInTheDocument();
    expect(screen.queryByText(/平台准备的示例讨论/u)).not.toBeInTheDocument();
  });

  it("filters by a school circle and uses explicit recent/popular tabs", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "院校圈" });

    fireEvent.click(screen.getByRole("button", { name: /新疆大学/ }));
    fireEvent.click(screen.getByRole("button", { name: "热门" }));

    await waitFor(() => expect(getCommunityPosts).toHaveBeenLastCalledWith(expect.objectContaining({
      circle_id: "circle_xju",
      sort: "popular",
    })));
  });

  it("creates a post with a stable idempotency key and refreshes the list", async () => {
    vi.mocked(createCommunityPost).mockResolvedValue(post);
    renderPage();
    await screen.findByRole("heading", { name: "院校圈" });

    fireEvent.click(screen.getByRole("button", { name: "发布讨论" }));
    const dialog = screen.getByRole("dialog", { name: "发布讨论" });
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "计组和操作系统怎么穿插复习" } });
    fireEvent.change(within(dialog).getByLabelText("正文"), { target: { value: "我目前每天能学四小时，想把两门课穿插起来复习，大家会怎么安排？" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(createCommunityPost).toHaveBeenCalledWith(
      expect.objectContaining({ circle_id: expect.any(String), title: "计组和操作系统怎么穿插复习" }),
      expect.stringMatching(/^community-post-/u),
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "发布讨论" })).not.toBeInTheDocument());
  });

  it("switches to the circle where the new discussion was published", async () => {
    vi.mocked(createCommunityPost).mockResolvedValue({
      ...post,
      circle: { circle_id: "circle_all_408", school_name: "408 备考交流" },
    });
    renderPage();
    await screen.findByRole("heading", { name: "院校圈" });

    const trigger = screen.getByRole("button", { name: "发布讨论" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "发布讨论" });
    fireEvent.change(within(dialog).getByLabelText("院校圈"), { target: { value: "circle_all_408" } });
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "四门课复习节奏交流" } });
    fireEvent.change(within(dialog).getByLabelText("正文"), { target: { value: "想和大家交流四门课的复习节奏与每天时间分配。" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /408 备考交流/ }))
      .toHaveAttribute("aria-pressed", "true"));
  });

  it("closes the compose dialog with Escape and restores focus", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "院校圈" });

    const trigger = screen.getByRole("button", { name: "发布讨论" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "发布讨论" });
    await waitFor(() => expect(within(dialog).getByLabelText("院校圈")).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "发布讨论" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("reuses the post idempotency key after an uncertain failure", async () => {
    vi.mocked(createCommunityPost)
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(post);
    renderPage();
    await screen.findByRole("heading", { name: "院校圈" });

    fireEvent.click(screen.getByRole("button", { name: "发布讨论" }));
    const dialog = screen.getByRole("dialog", { name: "发布讨论" });
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "计组和操作系统怎么穿插复习" } });
    fireEvent.change(within(dialog).getByLabelText("正文"), { target: { value: "我目前每天能学四小时，想把两门课穿插起来复习，大家会怎么安排？" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("网络中断");
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(createCommunityPost).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createCommunityPost).mock.calls[0]?.[1])
      .toBe(vi.mocked(createCommunityPost).mock.calls[1]?.[1]);
  });

  it("starts a new post request when the draft changes after a failed attempt", async () => {
    vi.mocked(createCommunityPost)
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(post);
    renderPage();
    await screen.findByRole("heading", { name: "院校圈" });

    fireEvent.click(screen.getByRole("button", { name: "发布讨论" }));
    const dialog = screen.getByRole("dialog", { name: "发布讨论" });
    const title = within(dialog).getByLabelText("标题");
    fireEvent.change(title, { target: { value: "计组和操作系统怎么穿插复习" } });
    fireEvent.change(within(dialog).getByLabelText("正文"), { target: { value: "我目前每天能学四小时，想把两门课穿插起来复习，大家会怎么安排？" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("网络中断");

    fireEvent.change(title, { target: { value: "计组和操作系统怎样穿插复习" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(createCommunityPost).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createCommunityPost).mock.calls[0]?.[1])
      .not.toBe(vi.mocked(createCommunityPost).mock.calls[1]?.[1]);
  });

  it("opens a post, replies, and sets rather than toggles the like state", async () => {
    vi.mocked(createCommunityReply).mockResolvedValue({
      reply_id: "reply_001",
      body: "我会按天交替，再留一天做混合复盘。",
      author: { display_name: "程嘉树", avatar_label: "程", is_self: true },
      created_at: now,
      updated_at: now,
      content_origin: "member",
    });
    vi.mocked(setCommunityPostLike).mockResolvedValue({ liked: true, like_count: 4 });
    renderPage("/student/community/post_001");

    expect(await screen.findByRole("heading", { name: "一轮复习如何安排四门课" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "赞同这篇讨论" }));
    await waitFor(() => expect(setCommunityPostLike).toHaveBeenCalledWith("post_001", true));

    fireEvent.change(screen.getByLabelText("回复内容"), { target: { value: "我会按天交替，再留一天做混合复盘。" } });
    fireEvent.click(screen.getByRole("button", { name: "发表回复" }));
    await waitFor(() => expect(createCommunityReply).toHaveBeenCalledWith(
      "post_001",
      { body: "我会按天交替，再留一天做混合复盘。" },
      expect.stringMatching(/^community-reply-/u),
    ));
  });

  it("reuses the reply idempotency key after an uncertain failure", async () => {
    vi.mocked(createCommunityReply)
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce({
        reply_id: "reply_001",
        body: "我会按天交替，再留一天做混合复盘。",
        author: { display_name: "程嘉树", avatar_label: "程", is_self: true },
        created_at: now,
        updated_at: now,
        content_origin: "member",
      });
    renderPage("/student/community/post_001");
    await screen.findByRole("heading", { name: "一轮复习如何安排四门课" });
    fireEvent.change(screen.getByLabelText("回复内容"), { target: { value: "我会按天交替，再留一天做混合复盘。" } });

    fireEvent.click(screen.getByRole("button", { name: "发表回复" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络中断");
    fireEvent.click(screen.getByRole("button", { name: "发表回复" }));

    await waitFor(() => expect(createCommunityReply).toHaveBeenCalledTimes(2));
    const firstKey = vi.mocked(createCommunityReply).mock.calls[0]?.[2];
    const secondKey = vi.mocked(createCommunityReply).mock.calls[1]?.[2];
    expect(firstKey).toBe(secondKey);
  });

  it("does not let a slow obsolete list request overwrite the selected circle", async () => {
    let resolveInitial: ((value: Awaited<ReturnType<typeof getCommunityPosts>>) => void) | null = null;
    let resolveTarget: ((value: Awaited<ReturnType<typeof getCommunityPosts>>) => void) | null = null;
    const otherPost = { ...post, post_id: "post_old", title: "不属于当前圈子的旧结果" };
    vi.mocked(getCommunityPosts).mockImplementation((query) => new Promise((resolve) => {
      if (query?.circle_id === "circle_xju") resolveTarget = resolve;
      else resolveInitial = resolve;
    }));
    renderPage();

    await screen.findByRole("button", { name: /新疆大学/ });
    await waitFor(() => expect(resolveInitial).not.toBeNull());
    await waitFor(() => expect(resolveTarget).not.toBeNull());
    await act(async () => {
      resolveTarget?.({ items: [post], page: 1, page_size: 12, total: 1, total_pages: 1 });
    });
    expect(await screen.findByRole("article", { name: post.title })).toBeInTheDocument();
    await act(async () => {
      resolveInitial?.({ items: [otherPost], page: 1, page_size: 12, total: 1, total_pages: 1 });
    });

    expect(screen.getByRole("article", { name: post.title })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: otherPost.title })).not.toBeInTheDocument();
  });

  it("aligns a directly opened post with its own circle instead of the target circle", async () => {
    vi.mocked(getCommunityPost).mockResolvedValueOnce({
      post: {
        ...post,
        circle: { circle_id: "circle_all_408", school_name: "408 备考交流" },
        body: "我每天大约有四小时，想听听大家怎么分配。",
      },
      replies: [],
      reply_page: 1,
      reply_page_size: 30,
      reply_total: 0,
      reply_total_pages: 0,
    });
    renderPage("/student/community/post_001");

    await screen.findByRole("heading", { name: post.title });
    await waitFor(() => expect(screen.getByRole("button", { name: /408 备考交流/ }))
      .toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: /新疆大学/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("loads later reply pages instead of hiding replies beyond the first thirty", async () => {
    vi.mocked(getCommunityPost).mockResolvedValue({
      post: { ...post, body: "我每天大约有四小时，想听听大家怎么分配。" },
      replies: [],
      reply_page: 1,
      reply_page_size: 30,
      reply_total: 31,
      reply_total_pages: 2,
    });
    renderPage("/student/community/post_001");
    await screen.findByRole("heading", { name: post.title });

    fireEvent.click(screen.getByRole("button", { name: "下一页回复" }));

    await waitFor(() => expect(getCommunityPost).toHaveBeenLastCalledWith(
      "post_001",
      { reply_page: 2, reply_page_size: 30 },
    ));
  });

  it("shows a newly created thirty-first reply on the new last page", async () => {
    vi.mocked(getCommunityPost)
      .mockResolvedValueOnce({
        post: { ...post, body: "我每天大约有四小时，想听听大家怎么分配。" },
        replies: [],
        reply_page: 1,
        reply_page_size: 30,
        reply_total: 30,
        reply_total_pages: 1,
      })
      .mockResolvedValue({
        post: { ...post, body: "我每天大约有四小时，想听听大家怎么分配。" },
        replies: [],
        reply_page: 2,
        reply_page_size: 30,
        reply_total: 31,
        reply_total_pages: 2,
      });
    vi.mocked(createCommunityReply).mockResolvedValue({
      reply_id: "reply_031",
      body: "补充一条新的复习建议。",
      author: { display_name: "程嘉树", avatar_label: "程", is_self: true },
      created_at: now,
      updated_at: now,
      content_origin: "member",
    });
    renderPage("/student/community/post_001");
    await screen.findByRole("heading", { name: post.title });
    fireEvent.change(screen.getByLabelText("回复内容"), { target: { value: "补充一条新的复习建议。" } });
    fireEvent.click(screen.getByRole("button", { name: "发表回复" }));

    await waitFor(() => expect(getCommunityPost).toHaveBeenLastCalledWith(
      "post_001",
      { reply_page: 2, reply_page_size: 30 },
    ));
  });

  it("returns to the last valid reply page when replies are removed concurrently", async () => {
    vi.mocked(getCommunityPost).mockImplementation((_postId, query) => {
      const requestedPage = query?.reply_page ?? 1;
      return Promise.resolve({
        post: { ...post, body: "我每天大约有四小时，想听听大家怎么分配。" },
        replies: [],
        reply_page: requestedPage,
        reply_page_size: 30,
        reply_total: requestedPage === 2 ? 30 : 31,
        reply_total_pages: requestedPage === 2 ? 1 : 2,
      });
    });
    renderPage("/student/community/post_001");
    await screen.findByRole("heading", { name: post.title });

    fireEvent.click(screen.getByRole("button", { name: "下一页回复" }));

    await waitFor(() => expect(getCommunityPost).toHaveBeenLastCalledWith(
      "post_001",
      { reply_page: 1, reply_page_size: 30 },
    ));
  });

  it("returns to the last valid discussion page when the result set shrinks", async () => {
    vi.mocked(getCommunityPosts).mockImplementation((query) => Promise.resolve(
      query?.page === 2
        ? { items: [], page: 2, page_size: 12, total: 1, total_pages: 1 }
        : { items: [post], page: 1, page_size: 12, total: 13, total_pages: 2 },
    ));
    renderPage();
    await screen.findByRole("article", { name: post.title });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() => expect(getCommunityPosts).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    ));
  });
});
