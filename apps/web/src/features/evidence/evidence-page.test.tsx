import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ getLearningRecord: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  ...apiMocks,
}));

import { EvidencePage } from "./evidence-page";

describe("EvidencePage", () => {
  beforeEach(() => {
    apiMocks.getLearningRecord.mockReset().mockResolvedValue({
      generated_at: "2026-08-02T00:00:00.000Z",
      courses: [{
        course_id: "course_408_ds",
        title: "数据结构",
        concept_count: 2,
        started_concept_count: 1,
        practice_attempt_count: 2,
        correct_count: 1,
        incorrect_count: 1,
        needs_review_count: 1,
        mastered_count: 0,
        concepts: [
          { concept_id: "ds_c02_02", title: "顺序表的存储表示", status: "needs_review", attempt_count: 2, correct_count: 1, incorrect_count: 1, mistake_count: 1 },
          { concept_id: "ds_c02_03", title: "链式存储", status: "not_started", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0 },
        ],
      }],
    });
  });

  it("renders stored course and concept progress instead of a fabricated evidence timeline", async () => {
    render(
      <MemoryRouter>
        <EvidencePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /学习记录/ })).toBeInTheDocument();
    expect(screen.getByText("数据结构")).toBeInTheDocument();
    expect(screen.getByText("顺序表的存储表示")).toBeInTheDocument();
    expect(screen.getByText("待复习")).toBeInTheDocument();
    expect(screen.queryByText("BFS 掌握证据链")).not.toBeInTheDocument();
    expect(screen.queryByText(/未接入 AI 的诊断/)).not.toBeInTheDocument();
    const page = screen.getByRole("heading", { name: "学习记录" }).closest(".learning-record-page");
    expect(page).toHaveTextContent("阅读、练习和待复习情况");
    expect(page).not.toHaveTextContent(/PostgreSQL|API|AI 输出|确定性|真实评测|STORED EVIDENCE/iu);
    expect(apiMocks.getLearningRecord).toHaveBeenCalled();
  });

  it("uses student-facing loading copy", () => {
    apiMocks.getLearningRecord.mockReturnValue(new Promise(() => undefined));

    render(
      <MemoryRouter>
        <EvidencePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在整理学习记录");
    expect(screen.getByRole("status")).not.toHaveTextContent(/PostgreSQL|API/iu);
  });

  it("gives a retry without exposing storage details when loading fails", async () => {
    apiMocks.getLearningRecord.mockRejectedValue(new Error("offline"));

    render(
      <MemoryRouter>
        <EvidencePage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("学习记录暂时无法读取，请稍后重试");
    expect(alert).not.toHaveTextContent(/PostgreSQL|API/iu);
  });

  it("uses course practice when a learning-record concept has no reliable questions", async () => {
    apiMocks.getLearningRecord.mockResolvedValue({
      generated_at: "2026-08-06T00:00:00.000Z",
      courses: [{
        course_id: "course_408_ds",
        title: "数据结构",
        concept_count: 2,
        started_concept_count: 1,
        practice_attempt_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        needs_review_count: 0,
        mastered_count: 0,
        concepts: [
          { concept_id: "ds_c02_01", title: "线性表的定义与相邻关系", status: "reading", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 0 },
          { concept_id: "ds_c02_02", title: "顺序表的存储表示", status: "not_started", attempt_count: 0, correct_count: 0, incorrect_count: 0, mistake_count: 0, practice_question_count: 3 },
        ],
      }],
    });

    render(
      <MemoryRouter>
        <EvidencePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("线性表的定义与相邻关系")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入数据结构综合训练" })).toHaveAttribute(
      "href",
      "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84",
    );
    expect(screen.getByRole("link", { name: "练习该知识点" })).toHaveAttribute(
      "href",
      "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02",
    );
  });
});
