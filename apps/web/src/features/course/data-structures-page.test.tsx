import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { DataStructuresPage } from "./data-structures-page";

const apiMocks = vi.hoisted(() => ({
  get408Courses: vi.fn(),
  getCourseCurriculumMap: vi.fn(),
  getCourseKnowledge: vi.fn(),
  getCourseReadingProgress: vi.fn(),
  saveCourseReadingProgress: vi.fn(),
  getCourseConceptVideos: vi.fn(),
  activateStudentLearningTask: vi.fn(),
  completeStudentLearningTask: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

describe("DataStructuresPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get408Courses.mockResolvedValue({
      courses: [{
        course_id: "course_408_ds", slug: "data-structures", course_code: "CS408-DS",
        title: "数据结构", summary: "结构理解、算法实现与复杂度分析。", question_subject: "数据结构",
        display_order: 1, question_count: 406, material_status: "available",
        knowledge_chunk_count: 406, core_concept_count: 48, qa_example_count: 0, chapter_count: 8,
        source_boundary: { usage_scope: "local_demo_only", license_status: "unverified", provenance_status: "source_unknown_unverified", notice: "本地演示" },
      }], recommended_start: null, generated_at: "2026-08-02T00:00:00.000Z",
    });
    apiMocks.getCourseCurriculumMap.mockResolvedValue({
      course_id: "course_408_ds", course_slug: "data-structures", title: "课程知识地图",
      curation_method: "source_constrained_course_design",
      chapters: [{ chapter_id: "ds_ch01", source_chapter: "第1章绪论", title: "绪论", ordinal: 1,
        modules: [{ module_id: "ds_m01_01", title: "基础", ordinal: 1, concepts: [{
          concept_id: "ds_c01_01", title: "数据与数据元素", learning_objective: "理解数据在程序中的表示形式，并区分数据元素与数据项。",
          prerequisite_concept_ids: [], key_terms: ["数据", "数据元素"], learning_note: { kind: "reminder", text: "先明确对象，再选择组织方式。" },
          learning_content: { explanation: ["数据是信息在程序中的表示形式。"], case_prompt: "把学生名册拆成数据元素和数据项。", practice_tags: ["数据结构"] },
          practice_question_count: 0,
          sources: [{ chunk_id: "ds_k0002", print_page: 2, chunk_offset: 0 }], importance: "core", review_status: "verified", ordinal: 1,
          figure_guidance: { primary: null, related: [] },
        }, {
          concept_id: "ds_c06_03", title: "广度优先搜索与连通分量", learning_objective: "理解 BFS 的队列推进过程和 visited 标记时机。",
          prerequisite_concept_ids: [], key_terms: ["BFS", "visited"], learning_note: { kind: "misconception", text: "不要等到出队才标记 visited。" },
          learning_content: { explanation: ["BFS 按层扩展邻接顶点。"], case_prompt: "比较入队前后标记 visited 的差异。", practice_tags: ["图"] },
          practice_question_count: 1,
          sources: [{ chunk_id: "ds_k0305", print_page: 152, chunk_offset: 305 }], importance: "core", review_status: "verified", ordinal: 2,
          figure_guidance: { primary: null, related: [] },
        }] }],
      }], concept_count: 2, traceability: { source_reference_count: 2, valid_source_reference_count: 2, rate: 1 }, generated_at: "2026-08-02T00:00:00.000Z",
    });
    apiMocks.getCourseKnowledge.mockResolvedValue({ course_slug: "data-structures", items: [{
      chunk_id: "ds_k0002", source_item_id: "2", chapter: "第1章绪论", page: 2,
      text: "数据是信息在程序中的表示形式。\n\n数据元素是计算机处理或访问的基本单位。", content_format: "plain_text",
      source_boundary: { usage_scope: "local_demo_only", license_status: "unverified", provenance_status: "source_unknown_unverified", notice: "本地演示" },
    }], total: 1, limit: 1, offset: 0 });
    apiMocks.getCourseReadingProgress.mockResolvedValue({ progress: null });
    apiMocks.saveCourseReadingProgress.mockResolvedValue({ course_slug: "data-structures", chapter: "第1章绪论", chunk_id: "ds_k0002", chunk_offset: 0, paragraph_index: 0, source_expanded: false, updated_at: "2026-08-02T00:00:00.000Z" });
    apiMocks.getCourseConceptVideos.mockResolvedValue({
      course_slug: "data-structures", concept_id: "ds_c01_01", external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
      items: [{ episode_id: "video_ds_1", series_title: "数据结构课程", episode_title: "数据与数据元素", episode_number: 4, duration: "00:18:20", duration_seconds: 1100, uploader: "课程UP主", external_url: "https://www.bilibili.com/video/BVTEST?p=4", display_role: "primary", ordinal: 1, platform: "bilibili" }],
    });
    apiMocks.activateStudentLearningTask.mockResolvedValue({ task_id: "live_read_ds_c01", activated_at: "2026-08-13T08:00:00.000Z", idempotent: false });
    apiMocks.completeStudentLearningTask.mockResolvedValue({
      task_id: "live_read_ds_c01",
      completed_at: "2026-08-13T08:05:00.000Z",
      evidence_refs: ["reading:course_408_ds:ds_k0002:2"],
      idempotent: false,
      next_task_id: null,
      settlement: {
        version: "challenge_settlement_v1",
        task_type: "course_reading",
        course_id: "course_408_ds",
        course_title: "数据结构",
        concept_id: "ds_c01_01",
        concept_title: "数据与数据元素",
        outcome: "completed",
        result_title: "本关已完成",
        result_detail: "本关完成条件已由服务端学习证据核验。",
        evidence_update: { added_count: 1, objective_total: 1, summary: "新增 1 条课程阅读进度。" },
        profile_update: {
          kind: "learning_progress",
          title: "数据与数据元素学习进度已更新",
          detail: "本关已有服务端核验的完成证据，后续任务会据此继续编排。",
        },
        review_update: {
          status: "not_applicable",
          mistake_id: null,
          next_review_at: null,
          summary: "本关不产生选择题错题状态。",
        },
        plan_progress: { tracked: true, completed_task_count: 1, total_task_count: 7, completion_percent: 14 },
        next_task: null,
      },
    });
  });

  it("renders the three-level tree and a concise lesson instead of a source index", async () => {
    render(<MemoryRouter><DataStructuresPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "数据结构" })).toBeInTheDocument();
    expect(screen.queryByText("COURSE READING")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "全部视频资源" })).not.toBeInTheDocument();
    const map = screen.getByRole("navigation", { name: "数据结构课程知识地图" });
    expect(within(map).getByRole("button", { name: /第1章绪论/ })).toHaveAttribute("data-node-level", "chapter");
    expect(within(map).getByRole("button", { name: /基础/ })).toHaveAttribute("data-node-level", "module");
    expect(within(map).getByRole("button", { name: /数据与数据元素/ })).toHaveAttribute("data-node-level", "concept");
    expect(await screen.findByRole("heading", { name: "本节学习目标" })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "数据是信息在程序中的表示形式。" && element.tagName === "P")).toBeInTheDocument();
    expect(screen.getByText("把学生名册拆成数据元素和数据项。", { exact: true })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "相关视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /观看讲解视频：数据与数据元素/ })).toBeInTheDocument();
    expect(document.querySelector("#ds-source-original")?.querySelector("mark")).toBeNull();
    expect(apiMocks.getCourseConceptVideos).toHaveBeenCalledWith("data-structures", "ds_c01_01");
    expect(screen.queryByText(/来源切片|图片切片|SOURCE INDEX/)).not.toBeInTheDocument();
    expect(screen.queryByText(/不是 AI|课程资料边界|已导入的本地课程资料|确定性判定/iu)).not.toBeInTheDocument();
  });

  it("keeps course training primary and supports collapsing the map without promoting the lone BFS sample", async () => {
    render(<MemoryRouter><DataStructuresPage /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: /进入 BFS 编程实验/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Judge0 隔离沙箱/)).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /进入数据结构课程训练/ })).toHaveAttribute(
      "href", "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84",
    );
    const map = screen.getByRole("navigation", { name: "数据结构课程知识地图" });
    fireEvent.click(within(map).getByRole("button", { name: "收起课程目录" }));
    expect(map).toHaveAttribute("data-collapsed", "true");
    await waitFor(() => expect(apiMocks.getCourseKnowledge).toHaveBeenCalled());
  });

  it("ignores a delayed save failure for a knowledge point that has already been left", async () => {
    let rejectOldSave!: (error: Error) => void;
    apiMocks.saveCourseReadingProgress.mockImplementationOnce(() => new Promise((_, reject) => { rejectOldSave = reject; }));
    const firstKnowledge = await apiMocks.getCourseKnowledge();
    apiMocks.getCourseKnowledge.mockImplementation(async (_slug, query) => ({
      ...firstKnowledge,
      items: [{ ...firstKnowledge.items[0], chunk_id: query.offset === 305 ? "ds_k0305" : "ds_k0002" }],
    }));
    render(<MemoryRouter><DataStructuresPage /></MemoryRouter>);
    await screen.findByRole("heading", { name: "本节学习目标" });
    await screen.findByText((_, element) => element?.textContent === "数据是信息在程序中的表示形式。" && element.tagName === "P");
    const map = screen.getByRole("navigation", { name: "数据结构课程知识地图" });
    fireEvent.click(within(map).getByRole("button", { name: /广度优先搜索与连通分量/ }));
    await waitFor(() => expect(apiMocks.saveCourseReadingProgress).toHaveBeenCalledWith(
      "data-structures", expect.objectContaining({ chunk_id: "ds_k0002" }), expect.anything(),
    ));
    await screen.findByText("理解 BFS 的队列推进过程和 visited 标记时机。");
    await act(async () => { rejectOldSave(new Error("delayed offline failure")); });
    expect(screen.queryByText("本次阅读位置暂未保存")).not.toBeInTheDocument();
  });

  async function useStringSource(withPage: boolean) {
    const curriculum = structuredClone(await apiMocks.getCourseCurriculumMap());
    const chapter = curriculum.chapters[0];
    chapter.source_chapter = "第4章";
    const concept = chapter.modules[0].concepts[0];
    concept.concept_id = "ds_c04_04";
    concept.title = "字符串的表示与基本操作";
    concept.sources = [{ chunk_id: "ds_k0125", print_page: 125, chunk_offset: 0 }];
    apiMocks.getCourseCurriculumMap.mockResolvedValue(curriculum);
    const knowledge = structuredClone(await apiMocks.getCourseKnowledge());
    Object.assign(knowledge.items[0], {
      chunk_id: "ds_k0125", source_item_id: "ds_k0125", chapter: "第4章", page: 125,
      text: "正交链表需要附加许多指针和标识信息。\n\n4.4字符串\n\n字符串是一串文字和符号的序列。",
      source_page: withPage ? {
        page_id: "5b7373571eb2-p139", print_page: 125, physical_page: 139,
        title: "数据结构", width: 1489, height: 2221,
        image_url: "/api/v1/408/courses/data-structures/source-pages/5b7373571eb2-p139?v=bd7a56346fa246c3c48561b5bc1dc7957838c750de23fc85b7e6edd75a43a756",
      } : null,
    });
    apiMocks.getCourseKnowledge.mockResolvedValue(knowledge);
  }

  it("starts the string text fallback at its own section, even when an old bookmark points past it", async () => {
    await useStringSource(false);
    apiMocks.getCourseReadingProgress.mockResolvedValue({ progress: {
      chapter: "第4章", chunk_id: "ds_k0125", chunk_offset: 0,
      paragraph_index: 7, source_expanded: true, updated_at: "2026-09-10T00:00:00.000Z",
    } });
    render(<MemoryRouter><DataStructuresPage /></MemoryRouter>);
    expect(await screen.findByText("继续上次阅读", { exact: true })).toBeInTheDocument();
    const source = document.querySelector("#ds-source-original")!;
    expect(source.textContent).toMatch(/^4\.4字符串/u);
    expect(source).not.toHaveTextContent("正交链表");
    expect(source.querySelectorAll("[data-reading-paragraph]")).toHaveLength(1);
    expect(apiMocks.completeStudentLearningTask).not.toHaveBeenCalled();
  });

  it("shows the string section as an excerpt while keeping the complete original available", async () => {
    await useStringSource(true);
    render(<MemoryRouter initialEntries={["/student/courses/data-structures?concept_id=ds_c04_04"]}><DataStructuresPage /></MemoryRouter>);
    const source = await screen.findByRole("region", { name: "讲义原文" });
    expect(within(source).getByRole("button", { name: "查看整页" })).toBeEnabled();
    expect(source.querySelector(".source-document-sheet")).toHaveAttribute("data-source-excerpt", "true");
    expect(source.querySelectorAll("[data-reading-paragraph]")).toHaveLength(1);
  });

  it("validates a returned concept id and positions the matching lesson", async () => {
    render(<MemoryRouter initialEntries={["/student/courses/data-structures?concept_id=ds_c06_03"]}><DataStructuresPage /></MemoryRouter>);

    const map = await screen.findByRole("navigation", { name: "数据结构课程知识地图" });
    expect(within(map).getByRole("button", { name: /广度优先搜索与连通分量/ })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("理解 BFS 的队列推进过程和 visited 标记时机。")).toBeInTheDocument();
    expect(apiMocks.getCourseKnowledge).toHaveBeenCalledWith("data-structures", expect.objectContaining({ offset: 305 }));
    await waitFor(() => expect(apiMocks.getCourseConceptVideos).toHaveBeenCalledWith("data-structures", "ds_c06_03"));
  });

  it("settles the active reading task after the expanded first reading segment is persisted", async () => {
    apiMocks.getCourseKnowledge.mockResolvedValue({
      course_slug: "data-structures",
      items: [{
        chunk_id: "ds_k0002",
        source_item_id: "2",
        chapter: "第1章绪论",
        page: 2,
        text: "第一句。第二句。第三句。第四句。第五句。第六句。第七句。第八句。",
        content_format: "plain_text",
        source_boundary: {
          usage_scope: "local_demo_only",
          license_status: "unverified",
          provenance_status: "source_unknown_unverified",
          notice: "本地演示",
        },
      }],
      total: 1,
      limit: 1,
      offset: 0,
    });

    render(
      <MemoryRouter initialEntries={["/student/courses/data-structures?orchestration_task_id=live_read_ds_c01"]}>
        <DataStructuresPage />
      </MemoryRouter>,
    );

    const expandButton = await screen.findByRole("button", { name: /继续阅读原文/ });
    await waitFor(() => expect(apiMocks.activateStudentLearningTask).toHaveBeenCalledWith("live_read_ds_c01"));
    fireEvent.click(expandButton);

    await waitFor(() => expect(apiMocks.saveCourseReadingProgress).toHaveBeenCalledWith(
      "data-structures",
      expect.objectContaining({ paragraph_index: 2, source_expanded: true }),
      expect.anything(),
    ));
    await waitFor(() => expect(apiMocks.completeStudentLearningTask).toHaveBeenCalledWith("live_read_ds_c01"));
  });
});
