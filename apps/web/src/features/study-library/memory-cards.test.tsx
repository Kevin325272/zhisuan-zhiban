import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryReviewCard } from "./memory-cards-page";
import { CardContent } from "./card-content";
import { rememberStudyQueue, readStudyQueue } from "./study-queue-storage";
afterEach(cleanup);
describe("memory recall", () => {
  it("retains queue IDs only for the current owner and expires old navigation state", () => {
    sessionStorage.clear();
    rememberStudyQueue("one", "query", [
      { id: "q1" },
      { id: "q2" },
    ] as Parameters<typeof rememberStudyQueue>[2]);
    expect(readStudyQueue("one", "query")).toEqual(["q1", "q2"]);
    expect(readStudyQueue("two", "query")).toBeNull();
    sessionStorage.setItem(
      "xuetu-study-map-queue:one:query",
      JSON.stringify({ ids: ["q1"], createdAt: Date.now() - 86_400_001 }),
    );
    expect(readStudyQueue("one", "query")).toBeNull();
  });
  it("keeps the answer absent and ratings disabled until the learner reveals it", () => {
    const onRate = vi.fn();
    render(
      <MemoryReviewCard
        busy={false}
        onRate={onRate}
        card={{
          id: "c",
          front: "地址怎么算？",
          back: "按行存储",
          subject: "数据结构",
          version: 1,
          source_note_id: null,
          reviews: 0,
          due_at: "2026-09-10T10:00:00Z",
        }}
      />,
    );
    expect(screen.queryByText("按行存储")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记得" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "翻开答案" }));
    expect(screen.getByText("按行存储")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "记得" }));
    expect(onRate).toHaveBeenCalledExactlyOnceWith("good");
  });
  it("renders a fraction as math while escaping user HTML and refusing trusted TeX commands", () => {
    const { container } = render(
      <CardContent
        text={
          "<img src=x onerror=alert(1)> $\\frac{a}{b}$ $\\href{javascript:alert(1)}{x}$"
        }
      />,
    );
    expect(container.querySelector("math")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
