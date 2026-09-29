import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getSourceCourseOutline: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { SourceCoursePage } from "./source-course-page";

const outline = {
  course_id: "course_408_ds",
  course_slug: "data-structures",
  course_code: "CS408-DS",
  title: "数据结构",
  summary: "结构理解、算法实现与复杂度分析。",
  question_subject: "数据结构",
  source_title: "数据结构（C语言版·第2版）",
  source_edition: "第2版",
  curriculum_status: "source_structure_available_curriculum_pending",
  notice: "课程结构已接入，讲解内容待课程化整理。",
  chapter_count: 2,
  source_entry_count: 78,
  displayable_figure_count: 1,
  chapters: [
    {
      chapter: "第1章 绪论",
      ordinal: 0,
      source_entry_count: 42,
      page_start: 1,
      page_end: 28,
      entries: [{
        entry_id: "ds_k0001",
        title: "数据结构的基本概念",
        print_page: 1,
        keywords: ["数据结构", "逻辑结构"],
        figure: {
          figure_label: "图1.1",
          caption: "数据结构的研究内容",
          image_url: "/api/v1/408/courses/data-structures/source-figures/ds_fig_1_1",
          mime_type: "image/webp",
          pixel_width: 960,
          pixel_height: 540,
        },
      }],
    },
    {
      chapter: "第2章 线性表",
      ordinal: 1,
      source_entry_count: 36,
      page_start: 29,
      page_end: 64,
      entries: [{
        entry_id: "ds_k0043",
        title: "线性表的定义与基本操作",
        print_page: 29,
        keywords: ["线性表"],
        figure: null,
      }],
    },
  ],
} as const;

describe("SourceCoursePage", () => {
  beforeEach(() => {
    apiMocks.getSourceCourseOutline.mockReset();
    apiMocks.getSourceCourseOutline.mockResolvedValue(outline);
  });

  it("presents a chapter-first source index and only a matched figure", async () => {
    render(<MemoryRouter><SourceCoursePage courseSlug="data-structures" /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "数据结构" })).toBeInTheDocument();
    expect(screen.getByText("课程结构已接入，讲解内容待课程化整理。")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "数据结构课程章节" });
    expect(within(navigation).getByRole("button", { name: /第1章 绪论/ })).toHaveAttribute("aria-current", "page");
    const figure = screen.getByRole("figure", { name: "图1.1 数据结构的研究内容" });
    expect(within(figure).getByRole("img", { name: "图1.1 数据结构的研究内容" })).toHaveAttribute(
      "src",
      "/api/v1/408/courses/data-structures/source-figures/ds_fig_1_1",
    );
    expect(screen.getByRole("link", { name: /进入数据结构课程训练/ })).toHaveAttribute(
      "href",
      "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84",
    );
    expect(document.body.textContent).not.toMatch(/human_verified|needs_human_review|SHA256|裁切|OCR 原文/);
  });

  it("switches chapters without rendering an empty figure placeholder", async () => {
    render(<MemoryRouter><SourceCoursePage courseSlug="data-structures" /></MemoryRouter>);
    await screen.findByRole("heading", { name: "数据结构" });

    fireEvent.click(screen.getByRole("button", { name: /第2章 线性表/ }));

    expect(screen.getByRole("heading", { name: "第2章 线性表" })).toBeInTheDocument();
    expect(screen.getByText("线性表的定义与基本操作")).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("describes loading and retry states without infrastructure jargon", async () => {
    apiMocks.getSourceCourseOutline.mockReturnValueOnce(new Promise(() => {}));
    const loadingView = render(
      <MemoryRouter><SourceCoursePage courseSlug="data-structures" /></MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在读取课程结构…");
    expect(document.body.textContent).not.toMatch(/PostgreSQL|本地 API/u);
    loadingView.unmount();

    apiMocks.getSourceCourseOutline.mockRejectedValueOnce(new Error("database unavailable"));
    render(<MemoryRouter><SourceCoursePage courseSlug="data-structures" /></MemoryRouter>);

    expect(await screen.findByRole("alert")).toHaveTextContent("课程结构暂时无法读取，请稍后重试。");
    expect(document.body.textContent).not.toMatch(/PostgreSQL|本地 API/u);
  });
});
