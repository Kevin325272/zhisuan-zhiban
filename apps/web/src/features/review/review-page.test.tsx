import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { addGeneratedReviewCard } from "../../lib/learning-output-store";
import { ReviewPage } from "./review-page";

describe("ReviewPage", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows a spaced-review calendar and updates the selected day", () => {
    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /复习日历/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今日复习队列" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "7 月 25 日，2 个复习任务" }));
    expect(screen.getByRole("heading", { name: "7 月 25 日" })).toBeInTheDocument();
    expect(screen.getByText("BFS 边界用例复核")).toBeInTheDocument();
  });

  it("moves between months and loads that month's review tasks", () => {
    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "下个月" }));

    expect(screen.getByRole("heading", { name: "2026 年 8 月" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "8 月 3 日" })).toBeInTheDocument();
    expect(screen.getByText("BFS 稳定性回访")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    expect(screen.getByRole("heading", { name: "2026 年 7 月" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "7 月 23 日" })).toBeInTheDocument();
  });

  it("includes material learning cards in the real review queue", () => {
    addGeneratedReviewCard({
      id: "material-card-textbook",
      sourceId: "textbook",
      title: "广度优先遍历中的访问标记学习卡",
      course: "数据结构",
      minutes: 8,
      reason: "来源：教材 · P143",
      href: "/student/materials?source=textbook",
      scheduledFor: "2026-07-23",
    });

    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("4 项 · 46 分钟")).toBeInTheDocument();
    expect(screen.getAllByText("广度优先遍历中的访问标记学习卡")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "打开广度优先遍历中的访问标记学习卡" }))
      .toHaveAttribute("href", "/student/materials?source=textbook");
  });

  it("uses mastery feedback to reschedule the same review item", () => {
    const view = render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "将 BFS 重复入队错因复盘 标记为模糊",
      }),
    );
    expect(screen.getByText("已重新安排至 7 月 26 日")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "7 月 26 日，1 个复习任务" }));
    expect(screen.getByRole("heading", { name: "7 月 26 日" })).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "所选日期复习任务" })).getByText("BFS 重复入队错因复盘")).toBeInTheDocument();

    view.unmount();
    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "7 月 26 日，1 个复习任务" }));
    expect(within(screen.getByRole("complementary", { name: "所选日期复习任务" })).getByText("BFS 重复入队错因复盘")).toBeInTheDocument();
  });
});
