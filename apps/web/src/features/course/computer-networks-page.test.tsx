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

import { ComputerNetworksPage } from "./computer-networks-page";

describe("ComputerNetworksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get408Courses.mockResolvedValue({
      courses: [{
        course_id: "course_408_cn", slug: "computer-networks", course_code: "CS408-CN",
        title: "计算机网络", summary: "协议分层、报文传输、路由与端到端通信。", question_subject: "计算机网络",
        display_order: 4, question_count: 207, material_status: "available",
        knowledge_chunk_count: 112, core_concept_count: 50, qa_example_count: 0, chapter_count: 9,
        source_boundary: { usage_scope: "local_demo_only", license_status: "unverified", provenance_status: "source_unknown_unverified", notice: "本地演示" },
      }], recommended_start: null, generated_at: "2026-08-02T00:00:00.000Z",
    });
    apiMocks.getCourseCurriculumMap.mockResolvedValue({
      course_id: "course_408_cn", course_slug: "computer-networks", title: "课程知识地图",
      curation_method: "source_constrained_course_design",
      chapters: [{ chapter_id: "cn_ch01", source_chapter: "第1章", title: "概述", ordinal: 1,
        modules: [{ module_id: "cn_m01_01", title: "互联网组成与交换", ordinal: 1, concepts: [{
          concept_id: "cn_c01_01", title: "网络、互连网与互联网", learning_objective: "区分网络、互连网和互联网，并能识别主机、链路与路由器的角色。",
          prerequisite_concept_ids: [], key_terms: ["网络", "互连网", "路由器"], learning_note: { kind: "reminder", text: "先判断对象是单个网络还是由路由器连接的多个网络。" },
          learning_content: { explanation: ["网络由节点和链路组成；路由器把多个网络互连，形成可跨网络通信的互连网。"], case_prompt: "标出校园网连接互联网时的主机、链路和路由器。", practice_tags: ["计算机网络", "互联网概述"] },
          practice_question_count: 2,
          sources: [{ chunk_id: "cn_k0004", print_page: 4, chunk_offset: 3 }], importance: "core", review_status: "verified", ordinal: 1,
          figure_guidance: { primary: { figure_label: "图1.1", caption: "简单的网络和由网络构成的互连网", storage_ref: "/api/v1/408/courses/computer-networks/source-figures/cn_v8_fig_1_1", mime_type: "image/webp", pixel_width: 901, pixel_height: 272 }, related: [] },
        }] }],
      }], concept_count: 1, traceability: { source_reference_count: 1, valid_source_reference_count: 1, rate: 1 }, generated_at: "2026-08-02T00:00:00.000Z",
    });
    apiMocks.getCourseKnowledge.mockResolvedValue({ course_slug: "computer-networks", items: [{
      chunk_id: "cn_k0004", source_item_id: "4", chapter: "第1章", page: 4,
      text: "计算机网络由节点和链路组成。\n\n路由器把多个网络互连起来。", content_format: "plain_text",
      source_boundary: { usage_scope: "local_demo_only", license_status: "unverified", provenance_status: "source_unknown_unverified", notice: "本地演示" },
    }], total: 1, limit: 1, offset: 3 });
    apiMocks.getCourseReadingProgress.mockResolvedValue({ progress: null });
    apiMocks.saveCourseReadingProgress.mockResolvedValue({ course_slug: "computer-networks", chapter: "第1章", chunk_id: "cn_k0004", chunk_offset: 3, paragraph_index: 0, source_expanded: false, updated_at: "2026-08-02T00:00:00.000Z" });
    apiMocks.getCourseConceptVideos.mockResolvedValue({
      course_slug: "computer-networks", concept_id: "cn_c01_01", external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
      items: [{ episode_id: "video_cn_1", series_title: "计算机网络课程", episode_title: "互联网概述", episode_number: 1, duration: "00:16:00", duration_seconds: 960, uploader: "课程UP主", external_url: "https://www.bilibili.com/video/BVTEST?p=1", display_role: "primary", ordinal: 1, platform: "bilibili" }],
    });
  });

  it("renders the network three-level map and concise lesson", async () => {
    render(<MemoryRouter><ComputerNetworksPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "计算机网络" })).toBeInTheDocument();
    expect(screen.queryByText("COURSE READING")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "全部视频资源" })).not.toBeInTheDocument();
    const map = screen.getByRole("navigation", { name: "计算机网络课程知识地图" });
    expect(within(map).getByRole("button", { name: /第1章/ })).toHaveAttribute("data-node-level", "chapter");
    expect(within(map).getByRole("button", { name: /互联网组成与交换/ })).toHaveAttribute("data-node-level", "module");
    expect(within(map).getByRole("button", { name: /网络、互连网与互联网/ })).toHaveAttribute("data-node-level", "concept");
    expect(await screen.findByRole("heading", { name: "本节学习目标" })).toBeInTheDocument();
    expect(screen.getByText("标出校园网连接互联网时的主机、链路和路由器。", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "相关图示" })).toBeInTheDocument();
    expect(screen.getByText("图1.1", { exact: true })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "相关视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /观看讲解视频：互联网概述/ })).toBeInTheDocument();
    expect(document.querySelector("#cn-source-original")?.querySelector("mark")).toBeNull();
    expect(apiMocks.getCourseConceptVideos).toHaveBeenCalledWith("computer-networks", "cn_c01_01");
    expect(screen.getByRole("link", { name: /进入计算机网络课程训练/ })).toHaveAttribute(
      "href", "/student/practice?subject=%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%BD%91%E7%BB%9C&concept_id=cn_c01_01",
    );
    expect(screen.queryByText(/来源切片|图片切片|SOURCE INDEX|hash|裁切|human_verified|license_status/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/不是 AI|课程资料边界|已导入的本地课程资料|确定性判定/iu)).not.toBeInTheDocument();
  });

  it("keeps the network directory collapsible without removing the training action", async () => {
    render(<MemoryRouter><ComputerNetworksPage /></MemoryRouter>);
    const map = await screen.findByRole("navigation", { name: "计算机网络课程知识地图" });
    fireEvent.click(within(map).getByRole("button", { name: "收起课程目录" }));
    expect(map).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByRole("link", { name: /进入计算机网络课程训练/ })).toBeInTheDocument();
  });
  it("opens an explicitly linked concept before an older saved reading location", async () => {
    const map = structuredClone(await apiMocks.getCourseCurriculumMap());
    const first = map.chapters[0].modules[0].concepts[0];
    const requested = { ...first, concept_id: "cn_requested", title: "公式页", sources: [{ chunk_id: "cn_formula", print_page: 47, chunk_offset: 1 }] };
    map.chapters[0].modules[0].concepts.push(requested);
    apiMocks.getCourseCurriculumMap.mockResolvedValue(map);
    apiMocks.getCourseReadingProgress.mockResolvedValue({ progress: { chapter: "第1章", chunk_id: first.sources[0].chunk_id, chunk_offset: 0, paragraph_index: 0, source_expanded: false } });
    const content = structuredClone(await apiMocks.getCourseKnowledge());
    content.items[0].chunk_id = "cn_formula";
    apiMocks.getCourseKnowledge.mockResolvedValue(content);
    render(<MemoryRouter initialEntries={["?concept_id=cn_requested"]}><ComputerNetworksPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "公式页" })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getCourseKnowledge).toHaveBeenLastCalledWith("computer-networks", { chapter: map.chapters[0].source_chapter, limit: 1, offset: 1 }));
  });

});
