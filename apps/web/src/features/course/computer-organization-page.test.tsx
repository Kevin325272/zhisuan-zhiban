import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  get408Courses: vi.fn(),
  getCourseChapters: vi.fn(),
  getCourseCurriculumMap: vi.fn(),
  getCourseKnowledge: vi.fn(),
  getCourseQaExamples: vi.fn(),
  getCourseReadingProgress: vi.fn(),
  saveCourseReadingProgress: vi.fn(),
  invokeAiWorkflow: vi.fn(),
  getCourseConceptVideos: vi.fn(),
}));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { ComputerOrganizationPage } from "./computer-organization-page";

const boundary = {
  usage_scope: "local_demo_only",
  license_status: "unverified",
  provenance_status: "source_unknown_unverified",
  notice: "原始资料未提供作者、版本或授权信息，仅限本地挑战杯演示。",
};

const curriculumMap = {
  course_id: "course_408_co",
  course_slug: "computer-organization",
  title: "课程知识地图",
  curation_method: "source_constrained_course_design",
  chapters: [
    {
      chapter_id: "co_ch01",
      source_chapter: "1 计算机系统概论",
      title: "计算机系统概论",
      ordinal: 1,
      modules: [
        {
          module_id: "co_m01_01",
          title: "计算机系统与层次",
          ordinal: 1,
          concepts: [
            {
              concept_id: "co_c01_01",
              title: "硬件、软件与计算机系统",
              learning_objective: "区分硬件与软件，并说明二者如何共同构成计算机系统。",
              prerequisite_concept_ids: [],
              key_terms: ["硬件", "软件", "计算机系统"],
              learning_note: {
                kind: "misconception",
                text: "不要把计算机系统只理解为看得见的硬件设备。",
              },
              practice_question_count: 0,
              sources: [{ chunk_id: "co_k_1", print_page: 3, chunk_offset: 0 }],
              importance: "core",
              review_status: "verified",
              ordinal: 1,
            },
            {
              concept_id: "co_c01_02",
              title: "程序翻译与机器层次",
              learning_objective: "说明源程序如何转为机器可执行的目标程序，并辨认机器层次。",
              prerequisite_concept_ids: ["co_c01_01"],
              key_terms: ["源程序", "目标程序", "机器语言"],
              learning_note: {
                kind: "reminder",
                text: "高级语言程序不能被硬件直接执行，需要经过翻译。",
              },
              sources: [{ chunk_id: "co_chunk_k0013", print_page: 4, chunk_offset: 1 }],
              importance: "core",
              review_status: "verified",
              ordinal: 2,
            },
          ],
        },
      ],
    },
    {
      chapter_id: "co_ch03",
      source_chapter: "3 系统总线",
      title: "系统总线",
      ordinal: 3,
      modules: [
        {
          module_id: "co_m03_01",
          title: "总线基础",
          ordinal: 1,
          concepts: [
            {
              concept_id: "co_c03_01",
              title: "总线连接与共享传输",
              learning_objective: "说明总线连接如何替代部件间分散连线。",
              prerequisite_concept_ids: ["co_c01_01"],
              key_terms: ["总线", "分散连接"],
              learning_note: {
                kind: "reminder",
                text: "共享线路也需要配套的占用与时序控制。",
              },
              sources: [{ chunk_id: "co_k_21", print_page: 41, chunk_offset: 0 }],
              importance: "core",
              review_status: "verified",
              ordinal: 1,
            },
          ],
        },
      ],
    },
  ],
  concept_count: 3,
  traceability: {
    source_reference_count: 3,
    valid_source_reference_count: 3,
    rate: 1,
  },
  generated_at: "2026-07-28T00:00:00.000Z",
} as const;

describe("ComputerOrganizationPage", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    apiMocks.get408Courses.mockResolvedValue({
      courses: [{
        course_id: "course_408_co", slug: "computer-organization", course_code: "CS408-CO",
        title: "计算机组成原理", summary: "数据表示、存储、指令与控制。", question_subject: "组成原理",
        display_order: 2, question_count: 217, material_status: "available",
        knowledge_chunk_count: 504, core_concept_count: 3,
        qa_example_count: 123, chapter_count: 2, source_boundary: boundary,
      }],
      recommended_start: null,
      generated_at: "2026-07-28T00:00:00.000Z",
    });
    apiMocks.getCourseChapters.mockResolvedValue({
      course_slug: "computer-organization",
      items: [
        {
          chapter: "前言、目录或参考资料",
          chunk_count: 11,
          page_start: 1,
          page_end: 2,
          first_chunk_id: "co_frontmatter_1",
        },
        { chapter: "1 计算机系统概论", chunk_count: 20, page_start: 3, page_end: 18, first_chunk_id: "co_k_1" },
        { chapter: "3 系统总线", chunk_count: 30, page_start: 45, page_end: 70, first_chunk_id: "co_k_21" },
      ],
    });
    apiMocks.getCourseCurriculumMap.mockResolvedValue(curriculumMap);
    apiMocks.getCourseKnowledge.mockResolvedValue({
      course_slug: "computer-organization",
      items: [{
        chunk_id: "co_k_1", source_item_id: "1", chapter: "1 计算机系统概论", page: 3,
        text: "计算机系统由硬件和软件共同组成。", content_format: "plain_text", source_boundary: boundary,
      }], total: 20, limit: 1, offset: 0,
    });
    apiMocks.getCourseQaExamples.mockResolvedValue({
      course_slug: "computer-organization",
      items: [{
        qa_id: "co_q_1", source_item_id: "1", chapter: null, page: null,
        question: "什么是机器字长？", answer: "CPU 一次能处理的二进制位数。",
        content_format: "plain_text", source_boundary: boundary,
      }], total: 123, limit: 3, offset: 0,
    });
    apiMocks.getCourseReadingProgress.mockResolvedValue({ progress: null });
    apiMocks.saveCourseReadingProgress.mockResolvedValue({
      course_slug: "computer-organization",
      chapter: "1 计算机系统概论",
      chunk_id: "co_k_1",
      chunk_offset: 0,
      paragraph_index: 0,
      source_expanded: false,
      updated_at: "2026-07-28T09:00:00.000Z",
    });
    apiMocks.getCourseConceptVideos.mockResolvedValue({
      course_slug: "computer-organization", concept_id: "co_c01_01", external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
      items: [{ episode_id: "video_co_1", series_title: "组成原理课程", episode_title: "计算机系统概述", episode_number: 1, duration: "00:22:00", duration_seconds: 1320, uploader: "课程UP主", external_url: "https://www.bilibili.com/video/BVTEST?p=1", display_role: "primary", ordinal: 1, platform: "bilibili" }],
    });
    apiMocks.invokeAiWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "workflow_course_001",
      capability: "explain",
      slot: "contextual_explanation",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "WORKFLOW_NOT_CONNECTED",
        message: "AI workflow service is not configured.",
        retryable: true,
        fallback_message: "AI 服务待连接，课程讲解与案例仍可正常使用。",
      },
    });
  });

  it("forms a real explanation, example and training learning flow", async () => {
    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "计算机组成原理" })).toBeInTheDocument();
    expect(screen.queryByText(/COURSE READING|COURSE EXAMPLES/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "全部视频资源" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "组成原理知识地图" })).toBeInTheDocument();
    const lesson = screen.getByRole("region", { name: "课程讲解" });
    expect(await within(lesson).findByText((_, element) => (
      element?.tagName === "P" && element.textContent === "计算机系统由硬件和软件共同组成。"
    ))).toBeInTheDocument();
    expect(within(lesson).queryByText("第 3 页")).not.toBeInTheDocument();
    const examples = screen.getByRole("region", { name: "课程案例问答" });
    expect(within(examples).getByText("什么是机器字长？")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /进入组成原理课程训练/ })).toHaveAttribute(
      "href", "/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86",
    );
    expect(screen.queryByText(/当前知识点暂未关联可用题目/)).not.toBeInTheDocument();
    expect(screen.queryByText(/不是 AI|资料与 AI 边界|未用于模型训练|服务端工作流|已入库问答|AI 服务待连接/iu)).not.toBeInTheDocument();
    const generateInterpretation = within(examples).getByRole("button", { name: "生成学习解读" });
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
    fireEvent.click(within(lesson).getByRole("button", { name: "讲解这个知识点" }));
    expect(generateInterpretation).toBeInTheDocument();
    fireEvent.click(generateInterpretation);
    expect(within(lesson).queryByRole("heading", { name: "相关图示" })).not.toBeInTheDocument();
    expect(await within(lesson).findByRole("heading", { name: "相关视频" })).toBeInTheDocument();
    expect(within(lesson).getByRole("link", { name: /观看讲解视频：计算机系统概述/ })).toBeInTheDocument();
    expect(document.querySelector("#lesson-source-original")?.querySelector("mark")).toBeNull();
    expect(apiMocks.getCourseConceptVideos).toHaveBeenCalledWith("computer-organization", "co_c01_01");
    await waitFor(() => {
      expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledWith(expect.objectContaining({
        contract_version: "0.2",
        capability: "explain",
        course_id: "course_408_co",
        concept_id: "co_c01_01",
      }));
      expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledWith(expect.objectContaining({
        contract_version: "0.2",
        capability: "coach",
        course_id: "course_408_co",
        concept_id: "co_c01_01",
        qa_id: "co_q_1",
      }));
    });
  });

  it("filters non-learning front matter and defaults to the first real chapter", async () => {
    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);

    const map = await screen.findByRole("navigation", { name: "组成原理知识地图" });
    expect(within(map).queryByText("前言、目录或参考资料")).not.toBeInTheDocument();
    expect(within(map).getByText("2 章")).toBeInTheDocument();
    expect(within(map).getByText("3 个知识点")).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getCourseKnowledge).toHaveBeenCalledWith(
      "computer-organization", { chapter: "1 计算机系统概论", limit: 1, offset: 0 },
    ));
  });

  it("expands the curated chapter-module-concept tree and opens a concept source", async () => {
    const chapterChunks = [
      {
        chunk_id: "co_k_1", source_item_id: "1", chapter: "1 计算机系统概论", page: 3,
        text: "计算机系统由硬件和软件共同组成。", content_format: "plain_text",
        figure_references: [], source_boundary: boundary,
      },
      {
        chunk_id: "co_k_2", source_item_id: "2", chapter: "1 计算机系统概论", page: 4,
        text: "中央处理器负责执行指令并控制程序运行。", content_format: "plain_text",
        figure_references: [], source_boundary: boundary,
      },
    ];
    apiMocks.getCourseKnowledge.mockImplementation(async (_slug, query) => ({
      course_slug: "computer-organization",
      items: chapterChunks.slice(query.offset, query.offset + query.limit),
      total: chapterChunks.length,
      limit: query.limit,
      offset: query.offset,
    }));

    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);

    const map = await screen.findByRole("navigation", { name: "组成原理知识地图" });
    const chapter = within(map).getByRole("button", { name: /1 计算机系统概论/ });
    expect(chapter).toHaveAttribute("aria-expanded", "true");
    const module = within(map).getByRole("button", { name: /计算机系统与层次/ });
    expect(module).toHaveAttribute("aria-expanded", "true");
    const secondConcept = within(map).getByRole("button", {
      name: /程序翻译与机器层次/,
    });
    fireEvent.click(secondConcept);

    await waitFor(() => expect(apiMocks.getCourseKnowledge).toHaveBeenCalledWith(
      "computer-organization", { chapter: "1 计算机系统概论", limit: 1, offset: 1 },
    ));
    expect(secondConcept).toHaveAttribute("aria-current", "page");
    expect(secondConcept).toHaveTextContent("当前");
    expect(within(map).getByRole("button", {
      name: /硬件、软件与计算机系统/,
    })).toHaveTextContent("已阅读");

    fireEvent.click(module);
    expect(module).toHaveAttribute("aria-expanded", "false");
    expect(within(map).queryByRole("button", {
      name: /程序翻译与机器层次/,
    })).not.toBeInTheDocument();
  });

  it("exposes distinct chapter, module, and concept levels for the visual knowledge tree", async () => {
    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);

    const map = await screen.findByRole("navigation", { name: "组成原理知识地图" });
    const chapter = within(map).getByRole("button", { name: /1 计算机系统概论/ });
    expect(chapter).toHaveClass("curriculum-chapter-toggle");
    expect(chapter).toHaveAttribute("data-node-level", "chapter");
    expect(within(chapter).getByText("01")).toHaveClass("curriculum-chapter-index");

    const moduleList = within(map).getByRole("list", {
      name: "计算机系统概论学习模块",
    });
    const module = within(moduleList).getByRole("button", { name: /计算机系统与层次/ });
    expect(module).toHaveClass("curriculum-module-toggle");
    expect(module).toHaveAttribute("data-node-level", "module");

    const conceptList = within(moduleList).getByRole("list", {
      name: "计算机系统与层次核心知识点",
    });
    const concept = within(conceptList).getByRole("button", {
      name: /硬件、软件与计算机系统/,
    });
    expect(concept).toHaveClass("curriculum-concept-button");
    expect(concept).toHaveAttribute("data-node-level", "concept");
    expect(concept.querySelector(".curriculum-concept-marker")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("turns long source text into a layered beginner reading flow without inventing an AI summary", async () => {
    apiMocks.getCourseKnowledge.mockResolvedValue({
      course_slug: "computer-organization",
      items: [{
        chunk_id: "co_k_1", source_item_id: "1", chapter: "1 计算机系统概论", page: 3,
        text: [
          "计算机系统由硬件和软件共同组成。硬件是可以看见的实体部分，软件是程序和数据。",
          "系统软件负责管理计算机资源，应用软件面向用户的具体任务。",
          "主存和辅存承担不同层次的存储职责。",
          "指令系统描述处理器能够执行的操作。",
          "输入设备把信息送入计算机，输出设备把处理结果提供给用户。",
          "理解这些概念之间的关系后，可以进入课程训练检验本节内容。",
        ].join("\n\n"),
        content_format: "plain_text", source_boundary: boundary,
      }], total: 20, limit: 1, offset: 0,
    });

    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);

    const lesson = await screen.findByRole("region", { name: "课程讲解" });
    expect(await within(lesson).findByRole("heading", { name: "本节学习目标" })).toBeInTheDocument();
    expect(within(lesson).queryByText(/课程编排已关联原始教材来源|非 AI 实时生成/)).not.toBeInTheDocument();
    expect(within(lesson).queryAllByText("硬件", { selector: "mark" })).toHaveLength(0);
    expect(within(lesson).getByText("本节重点")).toBeInTheDocument();
    expect(within(lesson).getByText("思考题")).toBeInTheDocument();
    expect(within(lesson).getByRole("link", { name: "查看解析" })).toHaveAttribute(
      "href", "#course-example-co_q_1",
    );
    expect(within(lesson).getByRole("link", { name: /进入课程训练/ })).toHaveAttribute(
      "href", "/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86",
    );

    expect(within(lesson).queryByText(/理解这些概念之间的关系后/)).not.toBeInTheDocument();
    fireEvent.click(within(lesson).getByRole("button", { name: /继续阅读原文/ }));
    expect(within(lesson).getByText(/理解这些概念之间的关系后/)).toBeInTheDocument();
    expect(within(lesson).getByRole("button", { name: "收起原文" })).toBeInTheDocument();

    await waitFor(() => expect(apiMocks.getCourseQaExamples).toHaveBeenCalledWith(
      "computer-organization", { limit: 20, offset: 0 },
    ));
  });

  it("renders one primary and collapsible related figures from the selected concept", async () => {
    const figure = (number: string, caption: string, height: number) => ({
      figure_label: `图${number}`,
      caption,
      storage_ref: `/course-assets/computer-organization/k0013/figure-${number.replace(".", "-")}.png`,
      mime_type: "image/png",
      pixel_width: 760,
      pixel_height: height,
    });
    const curriculumWithFigures = structuredClone(curriculumMap) as unknown as {
      chapters: Array<{
        modules: Array<{
          concepts: Array<Record<string, unknown>>;
        }>;
      }>;
    };
    curriculumWithFigures.chapters[0]!.modules[0]!.concepts[0]!.figure_guidance = {
      primary: figure("1.1", "计算机的解题过程", 245),
      related: [
        figure("1.2", "实际机器 M₁", 215),
        figure("1.3", "具有两级层次结构的计算机系统", 300),
      ],
    };
    apiMocks.getCourseCurriculumMap.mockResolvedValue(curriculumWithFigures);
    apiMocks.getCourseKnowledge.mockResolvedValue({
      course_slug: "computer-organization",
      items: [{
        chunk_id: "co_chunk_k0013",
        source_item_id: "k0013",
        chapter: "1 计算机系统概论",
        page: 4,
        text: [
          "机器自动运行目标程序，其过程如图1.1所示。",
          "直接执行机器语言的机器称为实际机器M1，如图1.2所示。",
          "整个计算机系统具有两级层次结构，如图1.3所示。",
        ].join("\n\n"),
        content_format: "plain_text",
        figure_references: [],
        source_boundary: boundary,
      }],
      total: 19,
      limit: 1,
      offset: 1,
    });

    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);

    const lesson = await screen.findByRole("region", { name: "课程讲解" });
    expect(await within(lesson).findByRole("heading", { name: "相关图示" })).toBeInTheDocument();
    expect(await within(lesson).findByRole("img", { name: "图1.1 计算机的解题过程" })).toHaveAttribute(
      "src",
      "/course-assets/computer-organization/k0013/figure-1-1.png",
    );
    expect(within(lesson).getByRole("img", { name: "图1.2 实际机器 M₁" })).toBeInTheDocument();
    expect(within(lesson).getByRole("img", { name: "图1.3 具有两级层次结构的计算机系统" })).toBeInTheDocument();
    const figureNodes = lesson.querySelectorAll("figure");
    expect(figureNodes).toHaveLength(3);
    expect(figureNodes[0]).toHaveTextContent(/^图1\.1计算机的解题过程$/);
    expect(figureNodes[1]).toHaveTextContent(/^图1\.2实际机器 M₁$/);
    expect(figureNodes[2]).toHaveTextContent(/^图1\.3具有两级层次结构的计算机系统$/);
    const related = within(lesson).getByText("更多相关图示（2）").closest("details");
    expect(related).not.toHaveAttribute("open");
    const studentCopy = document.body.textContent ?? "";
    for (const forbidden of [
      "印刷页",
      "PDF 物理页",
      "human_verified",
      "local_demo_only",
      "license_status",
      "授权未核验",
      "裁切",
      "SHA256",
      "ISBN",
      "已核验",
      "人工核验",
      "映射",
      "页码",
      "TRACEABLE SOURCE",
      "VERIFIED FIGURES",
      "PostgreSQL",
      "training.json",
      "题目接口",
    ]) {
      expect(studentCopy).not.toContain(forbidden);
    }
    expect(studentCopy).not.toMatch(/第\s*\d+\s*页|\d+–\d+\s*页/u);
    expect(within(lesson).getByText("图1.1")).toBeInTheDocument();
    expect(within(lesson).getByText("计算机的解题过程")).toBeInTheDocument();

    const catalog = screen.getByRole("navigation", { name: "组成原理知识地图" });
    fireEvent.click(within(catalog).getByRole("button", { name: "收起课程目录" }));
    expect(catalog).toHaveAttribute("data-collapsed", "true");
    expect(within(catalog).getByRole("button", { name: "展开课程目录" })).toBeInTheDocument();
  });

  it("opens the explicitly linked concept instead of an unrelated saved position", async () => {
    apiMocks.getCourseReadingProgress.mockResolvedValue({ progress: {
      course_slug: "computer-organization", chapter: "1 计算机系统概论", chunk_id: "co_k_1",
      chunk_offset: 0, paragraph_index: 0, source_expanded: false, updated_at: "2026-07-28T09:00:00.000Z",
    } });
    render(<MemoryRouter initialEntries={["/student/courses/computer-organization?concept_id=co_c03_01"]}><ComputerOrganizationPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "总线连接与共享传输" })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getCourseKnowledge).toHaveBeenCalledWith("computer-organization", {
      chapter: "3 系统总线", limit: 1, offset: 0,
    }));
    expect(screen.queryByText("继续上次阅读", { exact: true })).not.toBeInTheDocument();
  });

  it("restores the saved chunk and expanded paragraph position from the course API", async () => {
    apiMocks.getCourseReadingProgress.mockResolvedValue({
      progress: {
        course_slug: "computer-organization",
        chapter: "1 计算机系统概论",
        chunk_id: "co_chunk_k0013",
        chunk_offset: 1,
        paragraph_index: 2,
        source_expanded: true,
        updated_at: "2026-07-28T09:00:00.000Z",
      },
    });
    const restoredChunks = [
      {
        chunk_id: "co_k_1",
        source_item_id: "1",
        chapter: "1 计算机系统概论",
        page: 3,
        text: "课程导论说明计算机系统的学习范围。",
        content_format: "plain_text",
        figure_references: [],
        source_boundary: boundary,
      },
      {
        chunk_id: "co_chunk_k0013",
        source_item_id: "k0013",
        chapter: "1 计算机系统概论",
        page: 4,
        text: [
          "第一段介绍计算机系统。",
          "第二段说明硬件与软件。",
          "第三段解释机器语言。",
          "第四段说明层次结构。",
          "第五段介绍翻译程序。",
          "第六段说明执行过程。",
        ].join("\n\n"),
        content_format: "plain_text",
        figure_references: [],
        source_boundary: boundary,
      },
    ];
    apiMocks.getCourseKnowledge.mockImplementation(async (_slug, query) => ({
      course_slug: "computer-organization",
      items: restoredChunks.slice(query.offset, query.offset + query.limit),
      total: restoredChunks.length,
      limit: query.limit,
      offset: query.offset,
    }));

    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);

    const resumeStatus = (await screen.findByText(/继续上次阅读/)).closest('[role="status"]');
    expect(resumeStatus).toHaveTextContent("上次阅读位置");
    expect(apiMocks.getCourseKnowledge).toHaveBeenCalledWith(
      "computer-organization",
      { chapter: "1 计算机系统概论", limit: 1, offset: 1 },
    );
    expect(await screen.findByText(/第五段介绍翻译程序/)).toBeInTheDocument();
    const map = screen.getByRole("navigation", { name: "组成原理知识地图" });
    const resumedConcept = within(map).getByRole("button", {
      name: /程序翻译与机器层次/,
    });
    expect(resumedConcept).toHaveAttribute("aria-current", "page");
    expect(resumedConcept).toHaveTextContent("继续");
  });

  it("falls back to the first chunk when saved progress cannot be loaded", async () => {
    apiMocks.getCourseReadingProgress.mockRejectedValue(new Error("offline"));

    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);

    expect(await screen.findByText(/未能读取上次进度/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "计算机组成原理" })).toBeInTheDocument();
    expect(apiMocks.getCourseKnowledge).toHaveBeenLastCalledWith(
      "computer-organization",
      { chapter: "1 计算机系统概论", limit: 1, offset: 0 },
    );
  });

  it("saves the expanded reading position instead of using browser session storage", async () => {
    apiMocks.getCourseKnowledge.mockResolvedValue({
      course_slug: "computer-organization",
      items: [{
        chunk_id: "co_k_1",
        source_item_id: "1",
        chapter: "1 计算机系统概论",
        page: 3,
        text: [
          "第一段介绍计算机系统。",
          "第二段说明硬件与软件。",
          "第三段解释机器语言。",
          "第四段说明层次结构。",
          "第五段介绍翻译程序。",
          "第六段说明执行过程。",
        ].join("\n\n"),
        content_format: "plain_text",
        figure_references: [],
        source_boundary: boundary,
      }],
      total: 19,
      limit: 1,
      offset: 0,
    });

    render(<MemoryRouter><ComputerOrganizationPage /></MemoryRouter>);
    const expandButton = await screen.findByRole("button", { name: /继续阅读原文/ });
    fireEvent.click(expandButton);

    await waitFor(() => expect(apiMocks.saveCourseReadingProgress).toHaveBeenCalledWith(
      "computer-organization",
      expect.objectContaining({
        chapter: "1 计算机系统概论",
        chunk_id: "co_k_1",
        paragraph_index: 2,
        source_expanded: true,
      }),
      expect.any(Object),
    ));
  });
});
