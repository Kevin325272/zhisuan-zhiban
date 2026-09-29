import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getPracticeMistakes: vi.fn(),
  getStudentMistakeRecommendations: vi.fn(),
  reopenPracticeMistake: vi.fn(),
}));
vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  ...apiMocks,
}));

import { MistakesPage } from "./mistakes-page";

describe("MistakesPage", () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getPracticeMistakes.mockResolvedValue({ items: [] });
    apiMocks.getStudentMistakeRecommendations.mockResolvedValue({ items: [] });
  });

  it("keeps the empty state inside the shared student work surface", async () => {
    render(<MemoryRouter><MistakesPage /></MemoryRouter>);

    const heading = await screen.findByRole("heading", { name: "错题本" });
    expect(heading.closest(".mistakes-page")).toHaveClass("page-surface");
    expect(screen.getByRole("link", { name: "返回课程学习" })).toBeInTheDocument();
  });

  it("honors the home page pending-review shortcut", async () => {
    apiMocks.getPracticeMistakes.mockResolvedValue({
      items: [
        { mistake_id: "pending", status: "needs_review", course_id: "course_408_ds", course_title: "数据结构", question_id: "2026-01", subject: "数据结构", concept_title: "待复习题", concept_id: null, question_number: 1, wrong_count: 1, updated_at: "2026-08-02T00:00:00.000Z", last_incorrect_at: "2026-08-02T00:00:00.000Z" },
        { mistake_id: "mastered", status: "mastered", course_id: "course_408_ds", course_title: "数据结构", question_id: "2026-02", subject: "数据结构", concept_title: "已掌握题", concept_id: null, question_number: 2, wrong_count: 1, updated_at: "2026-08-02T00:00:00.000Z", last_incorrect_at: "2026-08-02T00:00:00.000Z" },
      ],
    });

    render(<MemoryRouter initialEntries={["/student/mistakes?status=needs_review"]}><MistakesPage /></MemoryRouter>);

    expect(await screen.findByText("待复习题")).toBeInTheDocument();
    expect(screen.queryByText("已掌握题")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "待复习" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the recommended re-practice bound to the original wrong question", async () => {
    apiMocks.getPracticeMistakes.mockResolvedValue({
      items: [{
        mistake_id: "mistake_001",
        course_id: "course_408_ds",
        course_title: "数据结构",
        question_id: "2026-01",
        question_year: 2026,
        question_number: 1,
        subject: "数据结构",
        concept_id: "ds_c02_02",
        concept_title: "顺序表的存储表示",
        matched_tag: "顺序表",
        match_method: "exact_question_tag",
        first_incorrect_attempt_id: "attempt_001",
        last_incorrect_attempt_id: "attempt_001",
        last_incorrect_evaluation_id: "evaluation_001",
        wrong_count: 1,
        status: "needs_review",
        latest_attempt_outcome: "incorrect",
        first_incorrect_at: "2026-08-02T00:00:00.000Z",
        last_incorrect_at: "2026-08-02T00:00:00.000Z",
        mastered_at: null,
        updated_at: "2026-08-02T00:00:00.000Z",
      }],
    });
    apiMocks.getStudentMistakeRecommendations.mockResolvedValue({
      algorithm_version: "evidence_weighted_v1",
      generated_at: "2026-08-16T00:00:00.000Z",
      items: [{
        mistake_id: "mistake_001",
        course_id: "course_408_ds",
        course_title: "数据结构",
        question_id: "2026-01",
        question_number: 1,
        concept_id: "ds_c02_02",
        concept_title: "顺序表的存储表示",
        priority_score: 92,
        algorithm_version: "evidence_weighted_v1",
        next_review_at: "2026-08-16T00:00:00.000Z",
        due_status: "due",
        evidence_level: "grounded",
        reason_lines: ["已到复习时间", "核心知识点"],
        evidence_refs: ["mistake:mistake_001"],
        practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=2026-01",
      }],
    });
    render(<MemoryRouter><MistakesPage /></MemoryRouter>);

    expect(await screen.findByText("顺序表的存储表示")).toBeInTheDocument();
    expect(screen.getByText("选择题 · 第 1 题")).toBeInTheDocument();
    expect(screen.getByText("建议先练")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "复习第 1 题" })).toHaveAttribute(
      "href",
      "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=2026-01",
    );
    expect(screen.getByRole("link", { name: "重练这道题" })).toHaveAttribute(
      "href",
      "/student/practice?mode=mistake_review&subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=2026-01",
    );
    expect(screen.queryByText(/避免把未接入的能力当成事实/)).not.toBeInTheDocument();
    const page = screen.getByRole("heading", { name: "错题本" }).closest(".mistakes-page");
    expect(page).not.toHaveTextContent(/PostgreSQL|API|确定性|AI 边界|AI 错因|标签关联方式|可核验|真实选择题/iu);
    expect(screen.queryByRole("button", { name: "标记已掌握" })).not.toBeInTheDocument();
    expect(screen.getByText("连续正确重练 3 次后，题目会自动标记为已掌握。")).toBeInTheDocument();
  });

  it("uses student-facing loading and failure copy", async () => {
    apiMocks.getPracticeMistakes.mockRejectedValue(new Error("offline"));

    render(<MemoryRouter><MistakesPage /></MemoryRouter>);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取错题记录");
    expect(screen.getByRole("status")).not.toHaveTextContent(/PostgreSQL|API/iu);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("错题记录暂时无法加载，请稍后重试");
    expect(alert).not.toHaveTextContent(/PostgreSQL|API/iu);
  });

  it("keeps the original mistake list usable when recommendation ranking is unavailable", async () => {
    apiMocks.getPracticeMistakes.mockResolvedValue({
      items: [{
        mistake_id: "mistake_002", course_id: "course_408_ds", course_title: "数据结构",
        question_id: "2026-02", question_year: 2026, question_number: 2, subject: "数据结构",
        concept_id: "ds_c02_02", concept_title: "顺序表的存储表示", matched_tag: "顺序表",
        match_method: "exact_question_tag", first_incorrect_attempt_id: "attempt_002",
        last_incorrect_attempt_id: "attempt_002", last_incorrect_evaluation_id: "evaluation_002",
        wrong_count: 1, status: "needs_review", latest_attempt_outcome: "incorrect",
        first_incorrect_at: "2026-08-02T00:00:00.000Z", last_incorrect_at: "2026-08-02T00:00:00.000Z",
        mastered_at: null, updated_at: "2026-08-02T00:00:00.000Z",
      }],
    });
    apiMocks.getStudentMistakeRecommendations.mockRejectedValue(new Error("offline"));

    render(<MemoryRouter><MistakesPage /></MemoryRouter>);

    expect(await screen.findByText("顺序表的存储表示")).toBeInTheDocument();
    expect(screen.getByText("优先排序暂时不可用，仍可按错题列表继续复习。")).toBeInTheDocument();
  });

  it("reopens a mastered mistake without exposing a manual mastery action", async () => {
    const mastered = {
      mistake_id: "mistake_003", course_id: "course_408_ds", course_title: "数据结构",
      question_id: "2026-03", question_year: 2026, question_number: 3, subject: "数据结构",
      concept_id: "ds_c02_02", concept_title: "顺序表的存储表示", matched_tag: "顺序表",
      match_method: "exact_question_tag", first_incorrect_attempt_id: "attempt_003",
      last_incorrect_attempt_id: "attempt_003", last_incorrect_evaluation_id: "evaluation_003",
      wrong_count: 1, status: "mastered" as const, latest_attempt_outcome: "correct" as const,
      first_incorrect_at: "2026-08-02T00:00:00.000Z", last_incorrect_at: "2026-08-02T00:00:00.000Z",
      mastered_at: "2026-08-10T00:00:00.000Z", updated_at: "2026-08-10T00:00:00.000Z",
    };
    apiMocks.getPracticeMistakes
      .mockResolvedValueOnce({ items: [mastered] })
      .mockResolvedValueOnce({ items: [{ ...mastered, status: "needs_review", mastered_at: null }] });
    apiMocks.reopenPracticeMistake.mockResolvedValue({
      mistake_id: "mistake_003", status: "needs_review", next_review_at: "2026-08-16T00:00:00.000Z",
      consecutive_success_count: 0, next_review_interval_days: 0, last_processed_attempt_id: null,
    });

    render(<MemoryRouter><MistakesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "重新加入复习" }));
    await waitFor(() => expect(apiMocks.reopenPracticeMistake).toHaveBeenCalledWith("mistake_003"));
    expect(await screen.findByText("连续正确重练 3 次后，题目会自动标记为已掌握。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "标记已掌握" })).not.toBeInTheDocument();
  });
});
