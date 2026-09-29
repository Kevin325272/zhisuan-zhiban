import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ExternalQuestionDetail } from "@xuetu/contracts";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  uploadExternalQuestion: vi.fn(),
  retryExternalQuestionRecognition: vi.fn(),
  confirmExternalQuestion: vi.fn(),
  explainExternalQuestion: vi.fn(),
  saveExternalQuestion: vi.fn(),
  getExternalQuestions: vi.fn(),
  getExternalQuestion: vi.fn(),
  deleteExternalQuestion: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { ApiError } from "../../api/client";
import { PhotoTutorPage } from "./photo-tutor-page";

const recognition = {
  status: "recognized" as const,
  subject: "data_structures" as const,
  question_type: "choice" as const,
  question_text: "队列遵循什么原则？",
  options: [
    { label: "A", text: "先进先出" },
    { label: "B", text: "先进后出" },
  ],
  formulae: [],
  diagram_description: null,
  knowledge_keywords: ["队列"],
  warnings: ["请核对选项 B 的末尾文字。"],
};

const confirmation = {
  subject: "data_structures" as const,
  question_type: "choice" as const,
  question_text: recognition.question_text,
  options: recognition.options,
  formulae: [],
  diagram_description: null,
};

function detail(overrides: Partial<ExternalQuestionDetail> = {}): ExternalQuestionDetail {
  return {
    external_question_id: "external_question_001",
    status: "recognized",
    content_revision: 0,
    image_url: "/api/v1/student/external-questions/external_question_001/image",
    recognition,
    confirmation: null,
    concept_candidates: [],
    explanations: [],
    saved_at: null,
    expires_at: "2026-08-25T08:00:00.000Z",
    created_at: "2026-08-24T08:00:00.000Z",
    updated_at: "2026-08-24T08:00:00.000Z",
    ...overrides,
  };
}

function confirmedDetail(overrides: Partial<ExternalQuestionDetail> = {}) {
  return detail({
    status: "confirmed",
    content_revision: 1,
    confirmation,
    concept_candidates: [{
      concept_id: "ds_c01",
      course_id: "course_408_ds",
      course_slug: "data-structures",
      title: "队列",
      reason: "题干涉及队列的出入顺序",
      reading_href: "/student/courses/data-structures?concept_id=ds_c01",
      practice_href: "/student/practice?subject=数据结构&concept_id=ds_c01",
    }],
    ...overrides,
  });
}

function explainedDetail(depth: "direction" | "steps" | "complete") {
  return confirmedDetail({
    explanations: [{
      explanation_id: `explanation_${depth}`,
      content_revision: 1,
      depth,
      summary: "先判断队列的基本操作约束。",
      knowledge_points: [{
        concept_id: "ds_c01",
        title: "队列",
        reason: "题干直接涉及队列",
      }],
      approach: ["比较元素进入与离开的先后顺序"],
      steps: depth === "direction" ? [] : ["先标出入队顺序", "再核对出队顺序"],
      self_check: "最先进入的元素何时离开？",
      final_answer: depth === "complete" ? "A. 先进先出" : null,
      uncertainty: null,
      created_at: "2026-08-24T08:05:00.000Z",
    }],
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/student/practice/photo-tutor"]}>
      <PhotoTutorPage />
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("PhotoTutorPage", () => {
  const createObjectUrl = vi.fn(() => "blob:question-preview");
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getExternalQuestions.mockResolvedValue({ items: [] });
    apiMocks.deleteExternalQuestion.mockResolvedValue({ deleted: true });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the file chooser from the upload surface with Enter or Space", () => {
    renderPage();
    const input = screen.getByLabelText("选择题目图片");
    const inputClick = vi.spyOn(input, "click");
    const uploadSurface = screen.getByRole("button", { name: "打开题目图片选择器" });

    fireEvent.keyDown(uploadSurface, { key: "Enter" });
    expect(inputClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(uploadSurface, { key: " " });
    expect(inputClick).toHaveBeenCalledTimes(2);
  });

  it("reserves stable dimensions for the uploaded image preview", () => {
    renderPage();
    const image = new File(["png"], "queue.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("选择题目图片"), { target: { files: [image] } });

    expect(screen.getByAltText("待识别题目预览")).toHaveAttribute("width", "1600");
    expect(screen.getByAltText("待识别题目预览")).toHaveAttribute("height", "1200");
  });

  it("accepts one PNG, JPEG or WebP from selection, drop or clipboard and cleans previews", async () => {
    const { unmount } = renderPage();
    const input = screen.getByLabelText("选择题目图片");
    const dropZone = screen.getByRole("button", { name: "打开题目图片选择器" });
    const png = new File(["png"], "queue.png", { type: "image/png" });
    const jpeg = new File(["jpeg"], "graph.jpg", { type: "image/jpeg" });
    const webp = new File(["webp"], "cache.webp", { type: "image/webp" });

    fireEvent.change(input, { target: { files: [png] } });
    expect(screen.getByAltText("待识别题目预览")).toHaveAttribute("src", "blob:question-preview");

    createObjectUrl.mockReturnValueOnce("blob:dropped-preview");
    fireEvent.drop(dropZone, { dataTransfer: { files: [jpeg] } });
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:question-preview");
    expect(screen.getByText("graph.jpg")).toBeInTheDocument();

    createObjectUrl.mockReturnValueOnce("blob:pasted-preview");
    fireEvent.paste(dropZone, { clipboardData: { files: [webp] } });
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:dropped-preview");
    expect(screen.getByText("cache.webp")).toBeInTheDocument();

    fireEvent.drop(dropZone, { dataTransfer: { files: [png, jpeg] } });
    expect(screen.getByRole("alert")).toHaveTextContent("一次只能选择一张题目图片");

    const pdf = new File(["pdf"], "question.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(screen.getByRole("alert")).toHaveTextContent("仅支持 PNG、JPEG 或 WebP");
    expect(apiMocks.uploadExternalQuestion).not.toHaveBeenCalled();

    const oversized = new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      "oversized.png",
      { type: "image/png" },
    );
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByRole("alert")).toHaveTextContent("不能超过 5 MiB");

    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:pasted-preview");
  });

  it("requires confirmation before requesting three bounded explanation depths", async () => {
    apiMocks.uploadExternalQuestion.mockResolvedValue(detail());
    apiMocks.confirmExternalQuestion.mockImplementation(
      async (_id, input) => confirmedDetail({ confirmation: input }),
    );
    apiMocks.explainExternalQuestion
      .mockResolvedValueOnce(explainedDetail("direction"))
      .mockResolvedValueOnce(explainedDetail("complete"));
    apiMocks.saveExternalQuestion.mockResolvedValue(confirmedDetail({
      saved_at: "2026-08-24T08:10:00.000Z",
    }));
    renderPage();
    const image = new File(["png"], "queue.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("选择题目图片"), { target: { files: [image] } });
    fireEvent.click(screen.getByRole("button", { name: "识别题目" }));

    expect(await screen.findByText("请核对选项 B 的末尾文字。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "核对识别结果" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只给方向" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("题干"), {
      target: { value: "队列的基本操作遵循什么原则？" },
    });
    fireEvent.change(screen.getByLabelText("选项 B"), {
      target: { value: "后进先出" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认题目" }));

    await waitFor(() => expect(apiMocks.confirmExternalQuestion).toHaveBeenCalledWith(
      "external_question_001",
      expect.objectContaining({
        question_text: "队列的基本操作遵循什么原则？",
        options: expect.arrayContaining([{ label: "B", text: "后进先出" }]),
      }),
      expect.stringMatching(/^external-confirm-/u),
      expect.any(AbortSignal),
    ));
    expect(screen.getByRole("button", { name: "只给方向" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "分步讲解" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "完整解析" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "只给方向" }));
    const direction = await screen.findByRole("region", { name: "题目讲解" });
    expect(direction).toHaveTextContent("先判断队列的基本操作约束");
    expect(within(direction).queryByText("最终答案")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "完整解析" }));
    expect(await screen.findByText("A. 先进先出")).toBeInTheDocument();
    expect(screen.getByText("最终答案")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存到个人题目" }));
    await waitFor(() => expect(apiMocks.saveExternalQuestion).toHaveBeenCalledWith(
      "external_question_001",
      expect.stringMatching(/^external-save-/u),
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText("已保存到个人题目")).toBeInTheDocument();
  });

  it("reopens a private saved image, keeps verified practice links and deletes the item", async () => {
    apiMocks.getExternalQuestions.mockResolvedValue({
      items: [{
        external_question_id: "saved_question_001",
        status: "confirmed",
        subject: "data_structures",
        question_excerpt: "队列遵循什么原则？",
        image_url: "/api/v1/student/external-questions/saved_question_001/image",
        saved_at: "2026-08-24T08:10:00.000Z",
        expires_at: "2026-08-25T08:00:00.000Z",
        updated_at: "2026-08-24T08:10:00.000Z",
      }],
    });
    apiMocks.getExternalQuestion.mockResolvedValue(confirmedDetail({
      external_question_id: "saved_question_001",
      image_url: "/api/v1/student/external-questions/saved_question_001/image",
      saved_at: "2026-08-24T08:10:00.000Z",
    }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /队列遵循什么原则/u }));
    expect(await screen.findByAltText("题目原图")).toHaveAttribute(
      "src",
      "/api/v1/student/external-questions/saved_question_001/image",
    );
    expect(screen.getByRole("link", { name: "练习关联题" })).toHaveAttribute(
      "href",
      "/student/practice?subject=数据结构&concept_id=ds_c01",
    );

    fireEvent.click(screen.getByRole("button", { name: "删除题目" }));
    await waitFor(() => expect(apiMocks.deleteExternalQuestion).toHaveBeenCalledWith(
      "saved_question_001",
      expect.stringMatching(/^external-delete-/u),
      expect.any(AbortSignal),
    ));
    expect(screen.getByRole("heading", { name: "上传一张 408 题图" })).toBeInTheDocument();
  });

  it("keeps the private item retryable when the relay is temporarily unavailable", async () => {
    apiMocks.uploadExternalQuestion.mockRejectedValue(new ApiError(
      "AI 服务暂时不可用。",
      "UPSTREAM_UNAVAILABLE",
      true,
      { external_question_id: "external_question_retry_001" },
    ));
    apiMocks.retryExternalQuestionRecognition.mockResolvedValue(detail({
      external_question_id: "external_question_retry_001",
      image_url: "/api/v1/student/external-questions/external_question_retry_001/image",
    }));
    renderPage();
    const image = new File(["png"], "queue.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("选择题目图片"), { target: { files: [image] } });
    fireEvent.click(screen.getByRole("button", { name: "识别题目" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI 服务暂时不可用");

    fireEvent.click(screen.getByRole("button", { name: "重新识别" }));
    expect(await screen.findByRole("heading", { name: "核对识别结果" })).toBeInTheDocument();
    expect(apiMocks.retryExternalQuestionRecognition).toHaveBeenCalledWith(
      "external_question_retry_001",
      expect.stringMatching(/^external-recognize-/u),
      expect.any(AbortSignal),
    );
  });

  it("aborts an in-flight recognition request when the page unmounts", async () => {
    let requestSignal: AbortSignal | undefined;
    apiMocks.uploadExternalQuestion.mockImplementation(
      async (_image: File, _key: string, signal?: AbortSignal) => {
        requestSignal = signal;
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        throw new Error("unreachable");
      },
    );
    const { unmount } = renderPage();
    const image = new File(["png"], "queue.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("选择题目图片"), { target: { files: [image] } });
    fireEvent.click(screen.getByRole("button", { name: "识别题目" }));
    await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });

  it("aborts recognition when a replacement image is selected", async () => {
    let requestSignal: AbortSignal | undefined;
    apiMocks.uploadExternalQuestion.mockImplementation(
      async (_image: File, _key: string, signal?: AbortSignal) => {
        requestSignal = signal;
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        throw new Error("unreachable");
      },
    );
    renderPage();
    const input = screen.getByLabelText("选择题目图片");
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.click(screen.getByRole("button", { name: "识别题目" }));
    await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

    fireEvent.change(input, { target: { files: [second] } });

    expect(requestSignal?.aborted).toBe(true);
    expect(screen.getByText("second.png")).toBeInTheDocument();
  });

  it("ignores a late response from a cancelled recognition request", async () => {
    const firstRequest = deferred<ExternalQuestionDetail>();
    const secondRequest = deferred<ExternalQuestionDetail>();
    apiMocks.uploadExternalQuestion.mockImplementation(
      (image: File) => image.name === "first.png" ? firstRequest.promise : secondRequest.promise,
    );
    renderPage();
    const input = screen.getByLabelText("选择题目图片");
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.click(screen.getByRole("button", { name: "识别题目" }));
    await waitFor(() => expect(apiMocks.uploadExternalQuestion).toHaveBeenCalledOnce());

    fireEvent.change(input, { target: { files: [second] } });
    fireEvent.click(screen.getByRole("button", { name: "识别题目" }));
    await waitFor(() => expect(apiMocks.uploadExternalQuestion).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstRequest.resolve(detail({
        external_question_id: "first-question",
        recognition: { ...recognition, question_text: "旧题目" },
      }));
      await firstRequest.promise;
    });
    expect(screen.queryByDisplayValue("旧题目")).not.toBeInTheDocument();

    await act(async () => {
      secondRequest.resolve(detail({
        external_question_id: "second-question",
        recognition: { ...recognition, question_text: "新题目" },
      }));
      await secondRequest.promise;
    });
    expect(await screen.findByDisplayValue("新题目")).toBeInTheDocument();
  });
});
