import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getPastExamCatalog: vi.fn(),
  getQuestionBankQuestions: vi.fn(),
  startMockExam: vi.fn(),
  submitMockExam: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { PracticePage } from "./practice-page";

const source = {
  provider: "csgraduates.com",
  dataset_id: "408_json_data",
  source_url: "https://www.csgraduates.com/question/2023-01",
  license_status: "unverified" as const,
  usage_scope: "local_demo_only" as const,
};

const question = {
  id: "2023-01",
  year: 2023,
  number: 1,
  subject: "数据结构",
  type: "choice" as const,
  multiple: false,
  question: "顺序表访问第 i 个元素的时间复杂度是？",
  options: [
    { option_id: "A", text: "O(1)", assets: [] },
    { option_id: "B", text: "O(n)", assets: [] },
  ],
  tags: ["线性表"],
  assets: [],
  content_format: "plain_text" as const,
  source,
};

const learningMetadata = {
  source_type: "past_exam" as const,
  allowed_modes: ["targeted", "past_exam", "mock_exam"] as const,
  paper_year: 2023,
  protect_full_paper: false,
  importance: "core" as const,
  content_review_status: "teacher_verified" as const,
};

const limitedRanking = {
  algorithm_version: "fsrs_v6_weighted_v1" as const,
  priority_score: 58,
  evidence_level: "limited" as const,
  components: {
    memory_risk: 0.35,
    concept_weakness: 0,
    repeated_error: 0,
    importance: 1,
    novelty: 1,
  },
  reason_lines: ["作答证据较少，当前按中性记忆风险参与排序。", "核心知识点优先进入本轮练习。"],
};

function practiceItem(ranking = limitedRanking) {
  return { question, learning_metadata: learningMetadata, ranking };
}

function renderPractice(initialEntry = "/student/practice") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PracticePage />
    </MemoryRouter>,
  );
}

describe("PracticePage training modes", () => {
  beforeEach(() => {
    apiMocks.getPastExamCatalog.mockReset();
    apiMocks.getQuestionBankQuestions.mockReset();
    apiMocks.startMockExam.mockReset();
    apiMocks.submitMockExam.mockReset();
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem()],
      total: 1,
      limit: 1,
      offset: 0,
    });
    apiMocks.getPastExamCatalog.mockResolvedValue({
      items: [{
        year: 2023,
        question_count: 47,
        choice_count: 40,
        subjective_count: 7,
        subjects: [
          { subject: "数据结构", question_count: 11 },
          { subject: "组成原理", question_count: 12 },
          { subject: "操作系统", question_count: 12 },
          { subject: "计算机网络", question_count: 12 },
        ],
        attempted_count: 0,
        next_question_number: 1,
        is_complete: true,
      }],
    });
  });

  it("shows all five modes and makes targeted practice the default", async () => {
    renderPractice();

    await screen.findByText(question.question);
    const modeNavigation = screen.getByRole("navigation", { name: "训练模式" });
    expect(within(modeNavigation).getByRole("link", { name: "起步筛查" })).toHaveAttribute(
      "href",
      "/student/onboarding",
    );
    expect(within(modeNavigation).getByRole("link", { name: "专项练习" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(modeNavigation).getByRole("link", { name: "历年真题" })).toHaveAttribute(
      "href",
      "/student/practice?mode=past_exam",
    );
    expect(within(modeNavigation).getByRole("link", { name: "限时模考" })).toBeInTheDocument();
    expect(within(modeNavigation).getByRole("link", { name: "错题复练" })).toBeInTheDocument();
    expect(screen.queryByLabelText("年份")).not.toBeInTheDocument();
    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledWith(expect.objectContaining({
      mode: "targeted",
    }));
  });

  it("waits for the server-selected paper before describing its source and duration", async () => {
    renderPractice("/student/practice?mode=mock_exam&subject=数据结构");

    expect(await screen.findByRole("heading", { name: "408 限时模考" })).toBeInTheDocument();
    expect(screen.getByText(/开始后显示本场题量与时长/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始限时模考" })).toBeInTheDocument();
    expect(screen.queryByLabelText("模考年份")).not.toBeInTheDocument();
    const mockSheet = screen.getByRole("region", { name: "408 限时模考" });
    expect(within(mockSheet).queryByText(/平台自编综合卷|原题号|历年真题|全真/u)).not.toBeInTheDocument();
  });

  it("starts past-exam practice from the year catalog", async () => {
    renderPractice("/student/practice?mode=past_exam");

    await screen.findByRole("region", { name: "历年真题目录" });
    expect(screen.getByText("按年份与原题号顺序练习，提交后逐题查看结果与解析。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2023 年真题" })).toBeInTheDocument();
    expect(apiMocks.getPastExamCatalog).toHaveBeenCalledTimes(1);
    expect(apiMocks.getQuestionBankQuestions).not.toHaveBeenCalled();
  });

  it("requests only the signed-in student's unresolved mistakes", async () => {
    renderPractice("/student/practice?mode=mistake_review&subject=数据结构");

    await screen.findByText(question.question);
    expect(screen.getByText("集中练习你尚未完成复习的错题。")).toBeInTheDocument();
    expect(screen.queryByLabelText("年份")).not.toBeInTheDocument();
    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledWith(expect.objectContaining({
      mode: "mistake_review",
    }));
    expect(apiMocks.getQuestionBankQuestions.mock.calls[0]?.[0]).not.toHaveProperty("user_id");
  });

  it("explains why a question was recommended without exposing its scoring algorithm", async () => {
    renderPractice();

    await screen.findByText(question.question);
    const explanation = screen.getByRole("note", { name: "本题推荐依据" });
    expect(explanation).toHaveTextContent("为什么推荐这道题");
    expect(explanation).toHaveTextContent(limitedRanking.reason_lines[0]!);
    expect(explanation).not.toHaveTextContent(/FSRS|有限证据|55%|优先分|精准|难度等级|能力等级/iu);
  });

  it("keeps storage and content-governance details out of the practice workspace", async () => {
    renderPractice();

    await screen.findByText(question.question);
    expect(screen.queryByText(/PostgreSQL|题目来源与边界|公开分发授权未核验|本地挑战杯演示/iu)).not.toBeInTheDocument();
  });

  it("switches modes through URL state instead of leaking a client user id", async () => {
    renderPractice();
    await screen.findByText(question.question);

    fireEvent.click(screen.getByRole("link", { name: "历年真题" }));

    await waitFor(() => expect(apiMocks.getPastExamCatalog).toHaveBeenCalledTimes(1));
    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledTimes(1);
    expect(apiMocks.getPastExamCatalog.mock.calls[0]).toEqual([]);
  });
});
