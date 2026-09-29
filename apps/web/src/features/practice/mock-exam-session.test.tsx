import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ userId: "student_a" }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ account: { user_id: identity.userId } }),
}));

const apiMocks = vi.hoisted(() => ({
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
  provider: "xuetu_self_authored",
  dataset_id: "xuetu_self_authored_practice_408_v1",
  source_url: "https://xuetu.local/sources/practice/408-v1",
  license_status: "verified" as const,
  usage_scope: "authorized_product_use" as const,
};

function question(id: string, number: number, type: "choice" | "subjective") {
  return {
    id,
    year: 2026,
    number,
    subject: number < 41 ? "数据结构" : "操作系统",
    type,
    multiple: false,
    question: `平台自编第 ${number} 题题干`,
    options: type === "choice"
      ? [
          { option_id: "A", text: "选项 A", assets: [] },
          { option_id: "B", text: "选项 B", assets: [] },
        ]
      : [],
    tags: ["408综合练习"],
    assets: [],
    content_format: "plain_text" as const,
    source,
  };
}

function practiceItem(value: ReturnType<typeof question>) {
  return {
    question: value,
    learning_metadata: {
      source_type: "self_authored_practice" as const,
      allowed_modes: ["targeted", "mock_exam"] as const,
      paper_year: 2026,
      protect_full_paper: false,
      importance: "core" as const,
      content_review_status: "teacher_verified" as const,
    },
    ranking: null,
  };
}

const mockQuestions = [
  practiceItem(question("practice-408-v1-01", 1, "choice")),
  practiceItem(question("practice-408-v1-02", 2, "choice")),
  practiceItem(question("practice-408-v1-08", 8, "subjective")),
];

function activeSession(expiresAt = new Date(Date.now() + 40 * 60_000).toISOString()) {
  return {
    session_id: "exam_session_001",
    year: 2026,
    status: "active" as const,
    duration_minutes: 40,
    server_now: new Date().toISOString(),
    started_at: new Date().toISOString(),
    expires_at: expiresAt,
    submitted_at: null,
    resumed: false,
    questions: mockQuestions,
  };
}

const submittedResult = {
  session_id: "exam_session_001",
  year: 2026,
  status: "submitted" as const,
  submitted_at: new Date().toISOString(),
  question_count: 3,
  answered_count: 2,
  unanswered_count: 1,
  objective: {
    question_count: 2,
    answered_count: 1,
    correct_count: 1,
    score: 2,
    max_score: 4,
  },
  subjective: {
    question_count: 1,
    submitted_count: 1,
    pending_review_count: 1,
  },
  score_status: "partial_pending_subjective_review" as const,
  evaluations: [],
};

function renderMockExam() {
  return render(
    <MemoryRouter initialEntries={["/student/practice?mode=mock_exam"]}>
      <PracticePage />
    </MemoryRouter>,
  );
}

describe("PracticePage timed self-authored mock exam", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    identity.userId = "student_a";
    apiMocks.getQuestionBankQuestions.mockReset();
    apiMocks.startMockExam.mockReset();
    apiMocks.submitMockExam.mockReset();
    apiMocks.startMockExam.mockResolvedValue(activeSession());
    apiMocks.submitMockExam.mockResolvedValue(submittedResult);
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts a server-timed 40-minute self-authored set without exposing answers", async () => {
    renderMockExam();

    expect(screen.getByRole("heading", { name: "408 限时模考" })).toBeInTheDocument();
    expect(screen.getByText(/题量与时长/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "408 限时模考" }).closest(".mock-exam-start-sheet"))
      .not.toHaveTextContent(/PostgreSQL|API|服务端/iu);
    expect(screen.queryByLabelText("模考年份")).not.toBeInTheDocument();
    expect(apiMocks.getQuestionBankQuestions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));

    expect(apiMocks.startMockExam).toHaveBeenCalledWith({});
    expect(await screen.findByRole("heading", { name: "平台自编综合卷" })).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "剩余时间" })).toHaveTextContent(/^00:39:|^00:40:00$/);
    expect(screen.getByText("平台自编第 1 题题干")).toBeInTheDocument();
    expect(screen.queryByText(/正确答案|参考答案|题目解析/)).not.toBeInTheDocument();
  });

  it("labels a past-paper mock from its actual source and server duration", async () => {
    apiMocks.startMockExam.mockResolvedValue({
      ...activeSession(new Date(Date.now() + 180 * 60_000).toISOString()),
      duration_minutes: 180,
      questions: mockQuestions.map(item => ({ ...item, learning_metadata: { ...item.learning_metadata, source_type: "past_exam" } })),
    });
    renderMockExam();
    expect(screen.queryAllByText(/共 8 道题|40:00/)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    expect(await screen.findByRole("heading", { name: "2026 年 408 真题模考" })).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "剩余时间" })).toHaveTextContent(/^02:59:|^03:00:00$/);
  });

  it("uses the server clock when the browser clock is one hour fast", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-24T07:00:00.000Z").getTime());
    apiMocks.startMockExam.mockResolvedValue({
      ...activeSession("2026-08-24T06:40:00.000Z"),
      server_now: "2026-08-24T06:00:00.000Z",
      started_at: "2026-08-24T06:00:00.000Z",
    });
    renderMockExam();

    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));

    expect(await screen.findByRole("timer", { name: "剩余时间" })).toHaveTextContent("00:40:00");
    dateNow.mockRestore();
  });

  it("keeps drafts locally, confirms unanswered questions, and submits once", async () => {
    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "平台自编综合卷" });

    fireEvent.click(screen.getByRole("radio", { name: "A. 选项 A" }));
    fireEvent.click(screen.getByRole("button", { name: "第 3 题" }));
    fireEvent.change(screen.getByLabelText("第 3 题作答"), {
      target: { value: "先写出页面置换过程，再计算缺页次数。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "交卷" }));

    const confirmation = screen.getByRole("dialog", { name: "确认交卷" });
    expect(confirmation).toHaveTextContent("还有 1 道题未作答");
    fireEvent.click(within(confirmation).getByRole("button", { name: "确认交卷" }));

    await waitFor(() => expect(apiMocks.submitMockExam).toHaveBeenCalledTimes(1));
    expect(apiMocks.submitMockExam).toHaveBeenCalledWith(
      "exam_session_001",
      {
        answers: [
          { question_id: "practice-408-v1-01", answer_type: "choice", selected_option_ids: ["A"] },
          {
            question_id: "practice-408-v1-08",
            answer_type: "subjective",
            response_text: "先写出页面置换过程，再计算缺页次数。",
          },
        ],
      },
      expect.any(String),
    );
    const result = await screen.findByRole("region", { name: "模考结果" });
    expect(result).toHaveTextContent(/客观题\s*2 \/ 4 分/);
    expect(result).toHaveTextContent(/主观题\s*1 道待审核/);
    expect(result).toHaveTextContent("1 道未作答");
    expect(result).not.toHaveTextContent("150 分");
  });

  it("retains one submission key and offers a retry after a network failure", async () => {
    apiMocks.submitMockExam
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(submittedResult);
    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "平台自编综合卷" });

    fireEvent.click(screen.getByRole("radio", { name: "A. 选项 A" }));
    fireEvent.click(screen.getByRole("button", { name: "交卷" }));
    fireEvent.click(screen.getByRole("button", { name: "确认交卷" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("交卷失败");
    const firstKey = apiMocks.submitMockExam.mock.calls[0]?.[2];

    fireEvent.click(screen.getByRole("button", { name: "重新交卷" }));

    await waitFor(() => expect(apiMocks.submitMockExam).toHaveBeenCalledTimes(2));
    expect(apiMocks.submitMockExam.mock.calls[1]?.[2]).toBe(firstKey);
    expect(await screen.findByRole("region", { name: "模考结果" })).toBeInTheDocument();
  });

  it("locks an already expired server session", async () => {
    apiMocks.startMockExam
      .mockResolvedValueOnce(activeSession(new Date(Date.now() - 1_000).toISOString()))
      .mockResolvedValueOnce(activeSession());
    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("本场模考时间已结束");
    expect(screen.queryByRole("button", { name: "交卷" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A. 选项 A" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "重新开始本场" }));

    await waitFor(() => expect(apiMocks.startMockExam).toHaveBeenLastCalledWith({ year: 2026 }));
    expect(screen.getByRole("radio", { name: "A. 选项 A" })).toBeEnabled();
  });

  it("restores choice, subjective answer and current position when resuming after a remount", async () => {
    const session = activeSession();
    apiMocks.startMockExam.mockResolvedValue({ ...session, resumed: true });
    const first = renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "平台自编综合卷" });
    fireEvent.click(screen.getByRole("radio", { name: "A. 选项 A" }));
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "刷新前的推导过程" } });
    first.unmount();

    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    expect(await screen.findByRole("textbox")).toHaveValue("刷新前的推导过程");
    expect(screen.getByText("已答 2 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "第 1 题" }));
    expect(screen.getByRole("radio", { name: "A. 选项 A" })).toBeChecked();
  });

  it("assigns unique exam ordinals to questions with duplicate source numbers", async () => {
    apiMocks.startMockExam.mockResolvedValue({ ...activeSession(), questions: [
      mockQuestions[0],
      { ...mockQuestions[1], question: { ...mockQuestions[1]!.question, number: 1 }, learning_metadata: { ...mockQuestions[1]!.learning_metadata, source_type: "past_exam" } },
      mockQuestions[2],
    ] });
    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "408 综合模考" });
    const navigation = screen.getByLabelText("题号导航");
    expect(within(navigation).getAllByRole("button").map(button => button.textContent)).toEqual(["1", "2", "3"]);
    fireEvent.click(within(navigation).getByRole("button", { name: "第 2 题" }));
    expect(screen.getByText(/真题.*原题号 1/)).toBeInTheDocument();
  });

  it("does not restore another account's drafts", async () => {
    const first = renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "平台自编综合卷" });
    fireEvent.click(screen.getByRole("radio", { name: "A. 选项 A" }));
    first.unmount();
    identity.userId = "student_b";
    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    expect(await screen.findByRole("radio", { name: "A. 选项 A" })).not.toBeChecked();
    expect(screen.getByText("已答 0 / 3")).toBeInTheDocument();
  });

  it("clears an old draft when the same session id starts a new exam round", async () => {
    const session = activeSession();
    apiMocks.startMockExam.mockResolvedValue(session);
    const first = renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "平台自编综合卷" });
    fireEvent.click(screen.getByRole("radio", { name: "A. 选项 A" }));
    first.unmount();
    apiMocks.startMockExam.mockResolvedValue({ ...session, started_at: new Date(Date.parse(session.started_at) + 1000).toISOString() });
    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    expect(await screen.findByRole("radio", { name: "A. 选项 A" })).not.toBeChecked();
  });

  it("preserves the submission key through reload after an uncertain network response", async () => {
    apiMocks.submitMockExam.mockRejectedValueOnce(new Error("response lost"));
    const first = renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "平台自编综合卷" });
    fireEvent.click(screen.getByRole("radio", { name: "A. 选项 A" }));
    fireEvent.click(screen.getByRole("button", { name: "交卷" }));
    fireEvent.click(screen.getByRole("button", { name: "确认交卷" }));
    await screen.findByRole("alert");
    const firstRequest = apiMocks.submitMockExam.mock.calls[0];
    first.unmount();
    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "平台自编综合卷" });
    fireEvent.click(screen.getByRole("button", { name: "交卷" }));
    fireEvent.click(screen.getByRole("button", { name: "确认交卷" }));
    await screen.findByRole("region", { name: "模考结果" });
    expect(apiMocks.submitMockExam.mock.calls[1]).toEqual(firstRequest);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("warns when browser storage is unavailable while allowing answers in memory", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota", "QuotaExceededError"); });
    renderMockExam();
    fireEvent.click(screen.getByRole("button", { name: "开始限时模考" }));
    await screen.findByRole("heading", { name: "平台自编综合卷" });
    fireEvent.click(screen.getByRole("radio", { name: "A. 选项 A" }));
    expect(screen.getByText(/草稿仅保留在当前页面，刷新会丢失/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A. 选项 A" })).toBeChecked();
  });
});
