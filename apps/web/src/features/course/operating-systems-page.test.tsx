import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const apiMocks = vi.hoisted(() => ({
  get408Courses: vi.fn(),
  getCourseCurriculumMap: vi.fn(),
  getCourseKnowledge: vi.fn(),
  getCourseReadingProgress: vi.fn(),
  saveCourseReadingProgress: vi.fn(),
  getCourseConceptVideos: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { OperatingSystemsPage } from "./operating-systems-page";

describe("OperatingSystemsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get408Courses.mockResolvedValue({
      courses: [{
        course_id: "course_408_os", slug: "operating-systems", course_code: "CS408-OS",
        title: "操作系统", summary: "进程、内存、文件与设备管理。", question_subject: "操作系统",
        display_order: 2, question_count: 407, material_status: "available",
        knowledge_chunk_count: 407, core_concept_count: 60, qa_example_count: 0, chapter_count: 12,
        source_boundary: { usage_scope: "local_demo_only", license_status: "unverified", provenance_status: "source_unknown_unverified", notice: "本地演示" },
      }], recommended_start: null, generated_at: "2026-08-02T00:00:00.000Z",
    });
    apiMocks.getCourseCurriculumMap.mockResolvedValue({
      course_id: "course_408_os", course_slug: "operating-systems", title: "课程知识地图",
      curation_method: "source_constrained_course_design",
      chapters: [{ chapter_id: "os_ch01", source_chapter: "第1章", title: "操作系统引论", ordinal: 1,
        modules: [{ module_id: "os_m01_01", title: "系统角色", ordinal: 1, concepts: [{
          concept_id: "os_c01_01", title: "操作系统的作用", learning_objective: "理解操作系统如何向应用提供受保护的系统服务。",
          prerequisite_concept_ids: [], key_terms: ["系统调用", "资源管理"], learning_note: { kind: "reminder", text: "先区分用户程序与系统服务的边界。" },
          learning_content: { explanation: ["操作系统把硬件资源组织为可调用的服务。"], case_prompt: "把一次文件读取请求拆成三个边界清楚的步骤。", practice_tags: ["系统调用"] },
          practice_question_count: 0,
          sources: [{ chunk_id: "os_k0002", print_page: 2 }], importance: "core", review_status: "verified", ordinal: 1,
          figure_guidance: { primary: { figure_label: "图1.5", caption: "单道程序的运行情况", storage_ref: "/api/v1/408/courses/operating-systems/source-figures/os_v4_fig_1_5", mime_type: "image/webp", pixel_width: 772, pixel_height: 218 }, related: [] },
        }] }],
      }], concept_count: 1, traceability: { source_reference_count: 1, valid_source_reference_count: 1, rate: 1 }, generated_at: "2026-08-02T00:00:00.000Z",
    });
    apiMocks.getCourseKnowledge.mockResolvedValue({ course_slug: "operating-systems", items: [{
      chunk_id: "os_k0002", source_item_id: "2", chapter: "第1章", page: 2,
      text: "操作系统通过系统调用向用户程序提供服务。\n\n资源管理需要保持边界清楚。", content_format: "plain_text",
      source_boundary: { usage_scope: "local_demo_only", license_status: "unverified", provenance_status: "source_unknown_unverified", notice: "本地演示" },
    }], total: 1, limit: 1, offset: 0 });
    apiMocks.getCourseReadingProgress.mockResolvedValue({ progress: null });
    apiMocks.saveCourseReadingProgress.mockResolvedValue({ course_slug: "operating-systems", chapter: "第1章", chunk_id: "os_k0002", chunk_offset: 0, paragraph_index: 0, source_expanded: false, updated_at: "2026-08-02T00:00:00.000Z" });
    apiMocks.getCourseConceptVideos.mockResolvedValue({
      course_slug: "operating-systems", concept_id: "os_c01_01", external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
      items: [{ episode_id: "video_os_1", series_title: "操作系统课程", episode_title: "操作系统概念", episode_number: 1, duration: "00:20:00", duration_seconds: 1200, uploader: "课程UP主", external_url: "https://www.bilibili.com/video/BVTEST?p=1", display_role: "primary", ordinal: 1, platform: "bilibili" }],
    });
  });

  it("renders the operating-systems three-level map and concise lesson", async () => {
    render(<MemoryRouter><OperatingSystemsPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "操作系统" })).toBeInTheDocument();
    expect(screen.queryByText("COURSE READING")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "全部视频资源" })).not.toBeInTheDocument();
    const map = screen.getByRole("navigation", { name: "操作系统课程知识地图" });
    expect(within(map).getByRole("button", { name: /第1章/ })).toHaveAttribute("data-node-level", "chapter");
    expect(within(map).getByRole("button", { name: /系统角色/ })).toHaveAttribute("data-node-level", "module");
    expect(within(map).getByRole("button", { name: /操作系统的作用/ })).toHaveAttribute("data-node-level", "concept");
    expect(await screen.findByRole("heading", { name: "本节学习目标" })).toBeInTheDocument();
    expect(screen.getByText("把一次文件读取请求拆成三个边界清楚的步骤。", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "相关图示" })).toBeInTheDocument();
    expect(screen.getByText("图1.5", { exact: true })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "相关视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /观看讲解视频：操作系统概念/ })).toBeInTheDocument();
    expect(document.querySelector("#os-source-original")?.querySelector("mark")).toBeNull();
    expect(apiMocks.getCourseConceptVideos).toHaveBeenCalledWith("operating-systems", "os_c01_01");
    expect(screen.getByRole("link", { name: /进入操作系统课程训练/ })).toHaveAttribute(
      "href", "/student/practice?subject=%E6%93%8D%E4%BD%9C%E7%B3%BB%E7%BB%9F",
    );
    expect(screen.queryByText(/来源切片|图片切片|SOURCE INDEX|hash|裁切|human_verified/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/不是 AI|课程资料边界|已导入的本地课程资料|确定性判定/iu)).not.toBeInTheDocument();
  });

  it("keeps the directory collapsible without removing the training action", async () => {
    render(<MemoryRouter><OperatingSystemsPage /></MemoryRouter>);
    const map = await screen.findByRole("navigation", { name: "操作系统课程知识地图" });
    fireEvent.click(within(map).getByRole("button", { name: "收起课程目录" }));
    expect(map).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByRole("link", { name: /进入操作系统课程训练/ })).toBeInTheDocument();
  });
  it("opens an explicitly linked concept before an older saved reading location", async () => {
    const map = structuredClone(await apiMocks.getCourseCurriculumMap());
    const first = map.chapters[0].modules[0].concepts[0];
    const requested = { ...first, concept_id: "os_requested", title: "公式页", sources: [{ chunk_id: "os_formula", print_page: 47, chunk_offset: 1 }] };
    map.chapters[0].modules[0].concepts.push(requested);
    apiMocks.getCourseCurriculumMap.mockResolvedValue(map);
    apiMocks.getCourseReadingProgress.mockResolvedValue({ progress: { chapter: "第1章", chunk_id: first.sources[0].chunk_id, chunk_offset: 0, paragraph_index: 0, source_expanded: false } });
    const content = structuredClone(await apiMocks.getCourseKnowledge());
    content.items[0].chunk_id = "os_formula";
    apiMocks.getCourseKnowledge.mockResolvedValue(content);
    render(<MemoryRouter initialEntries={["?concept_id=os_requested"]}><OperatingSystemsPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "公式页" })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getCourseKnowledge).toHaveBeenLastCalledWith("operating-systems", { chapter: map.chapters[0].source_chapter, limit: 1, offset: 1 }));
  });

});
