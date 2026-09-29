import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  get408Courses: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  get408Courses: apiMocks.get408Courses,
}));

import { CoursesPage } from "./courses-page";

const catalog = {
  courses: [
    { course_id: "course_408_ds", slug: "data-structures", course_code: "CS408-DS", title: "数据结构", summary: "结构与算法", question_subject: "数据结构", display_order: 1, question_count: 201, material_status: "available" as const, knowledge_chunk_count: 406, core_concept_count: 46, qa_example_count: 0, chapter_count: 8, source_boundary: { usage_scope: "local_demo_only" as const, license_status: "unverified" as const, provenance_status: "source_unknown_unverified" as const, notice: "资料授权待核验。" } },
    { course_id: "course_408_co", slug: "computer-organization", course_code: "CS408-CO", title: "计算机组成原理", summary: "数据表示、存储、指令与控制", question_subject: "组成原理", display_order: 2, question_count: 217, material_status: "available" as const, knowledge_chunk_count: 504, core_concept_count: 46, qa_example_count: 123, chapter_count: 11, source_boundary: { usage_scope: "local_demo_only" as const, license_status: "unverified" as const, provenance_status: "source_unknown_unverified" as const, notice: "资料授权待核验。" } },
    { course_id: "course_408_os", slug: "operating-systems", course_code: "CS408-OS", title: "操作系统", summary: "进程、内存与文件", question_subject: "操作系统", display_order: 3, question_count: 221, material_status: "available" as const, knowledge_chunk_count: 407, core_concept_count: 45, qa_example_count: 0, chapter_count: 5, source_boundary: { usage_scope: "local_demo_only" as const, license_status: "unverified" as const, provenance_status: "source_unknown_unverified" as const, notice: "资料授权待核验。" } },
    { course_id: "course_408_cn", slug: "computer-networks", course_code: "CS408-CN", title: "计算机网络", summary: "协议与网络", question_subject: "计算机网络", display_order: 4, question_count: 207, material_status: "available" as const, knowledge_chunk_count: 409, core_concept_count: 47, qa_example_count: 0, chapter_count: 7, source_boundary: { usage_scope: "local_demo_only" as const, license_status: "unverified" as const, provenance_status: "source_unknown_unverified" as const, notice: "资料授权待核验。" } },
  ],
  recommended_start: null,
  generated_at: "2026-08-12T00:00:00.000Z",
};

describe("CoursesPage", () => {
  beforeEach(() => {
    apiMocks.get408Courses.mockReset().mockResolvedValue(catalog);
  });

  it("renders the four courses as an agent-driven hub", async () => {
    render(<MemoryRouter><CoursesPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "四科专家智能体中枢" })).toBeInTheDocument();
    const courseDomain = screen.getByRole("region", { name: "408 课程域" });
    expect(courseDomain.querySelectorAll("article")).toHaveLength(4);
    expect(screen.getByText("计算机组成原理")).toBeInTheDocument();
    expect(screen.getByText("操作系统")).toBeInTheDocument();
    expect(screen.getByText("计算机网络")).toBeInTheDocument();
    expect(screen.queryByText("数据库系统")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "启动具身研学" })).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "启动具身研学" })[0]).toHaveAttribute(
      "href",
      "/student/courses/data-structures",
    );
    expect(screen.getByRole("link", { name: "进入 3D 仿真" })).toHaveAttribute(
      "href",
      "/student/programming-experiments",
    );
    expect(screen.getByRole("link", { name: "进入课程" })).toHaveAttribute(
      "href",
      "/student/courses/computer-networks",
    );
    expect(screen.getAllByText("[Agent 驱动]")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: "视频资源" })).not.toBeInTheDocument();
    expect(screen.queryByText(/PostgreSQL|真实学习证据|两类证据/iu)).not.toBeInTheDocument();
  });

  it("routes the knowledge graph to the course map and opens the global agent for Q&A", async () => {
    render(<MemoryRouter><CoursesPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "四科专家智能体中枢" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /知识图谱/ })).toHaveAttribute(
      "href",
      "/student/course-map",
    );
    expect(screen.getByRole("button", { name: /AI 学伴答疑/ })).toBeInTheDocument();
  });

  it("shows a student-facing loading state while course data is pending", () => {
    apiMocks.get408Courses.mockReturnValue(new Promise(() => undefined));
    render(<MemoryRouter><CoursesPage /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载 408 课程");
    expect(screen.getByRole("status")).not.toHaveTextContent(/PostgreSQL|API/iu);
  });

  it("recovers from a course API failure without leaving the page", async () => {
    apiMocks.get408Courses
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(catalog);
    render(<MemoryRouter><CoursesPage /></MemoryRouter>);

    expect(await screen.findByRole("alert")).toHaveTextContent("课程总览暂时无法读取");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/PostgreSQL|API/iu);
    fireEvent.click(screen.getByRole("button", { name: "重新加载课程" }));
    expect(await screen.findByRole("heading", { name: "四科专家智能体中枢" })).toBeInTheDocument();
    expect(apiMocks.get408Courses).toHaveBeenCalledTimes(2);
  });
});
