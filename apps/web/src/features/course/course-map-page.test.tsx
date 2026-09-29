import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ getCourseCurriculumMap: vi.fn() }));
vi.mock("../../api/client", () => apiMocks);

import { CourseMapPage } from "./course-map-page";

const concept = (id: string, title: string, prerequisites: string[] = []) => ({
  concept_id: id, title, prerequisite_concept_ids: prerequisites,
  learning_objective: `理解${title}并完成练习。`, key_terms: [title],
});
const sampleMap = {
  course_id: "course_408_ds", course_slug: "data-structures", concept_count: 3,
  chapters: [
    { chapter_id: "ch_01", title: "绪论", source_chapter: "第1章", ordinal: 1,
      modules: [{ module_id: "mod_01", title: "基本概念", concepts: [
        concept("concept_a", "数据元素"), concept("concept_b", "数据结构", ["concept_a"]),
      ] }],
    },
    { chapter_id: "ch_02", title: "线性表", source_chapter: "第2章", ordinal: 2,
      modules: [{ module_id: "mod_02", title: "线性表基础", concepts: [
        concept("concept_c", "顺序表", ["concept_b"]),
      ] }],
    },
  ],
};

describe("CourseMapPage", () => {
  beforeEach(() => {
    apiMocks.getCourseCurriculumMap.mockReset().mockResolvedValue(sampleMap);
  });

  it("loads the real 408 curriculum and renders chapter dependencies", async () => {
    render(<MemoryRouter><CourseMapPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "408 知识图谱" })).toBeInTheDocument();
    expect(apiMocks.getCourseCurriculumMap).toHaveBeenCalledWith("data-structures");
    const graph = screen.getByLabelText("绪论知识图谱");
    expect(within(graph).getByRole("button", { name: /数据结构/ })).toBeInTheDocument();
    expect(graph.querySelectorAll("line")).toHaveLength(1);
    expect(screen.getByText(/不代表个人掌握度/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /学习这个知识点/ })).toHaveAttribute(
      "href", "/student/courses/data-structures?concept_id=concept_a",
    );
  });

  it("opens cross-chapter prerequisites and changes subject", async () => {
    render(<MemoryRouter><CourseMapPage /></MemoryRouter>);
    await screen.findByLabelText("绪论知识图谱");
    fireEvent.click(within(screen.getByLabelText("课程章节")).getByRole("button", { name: /线性表/ }));
    expect(screen.getByLabelText("线性表知识图谱")).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("知识点详情")).getByRole("button", { name: /数据结构/ }));
    expect(screen.getByLabelText("绪论知识图谱")).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText("选择课程")).getByRole("button", { name: "计算机网络" }));
    expect(apiMocks.getCourseCurriculumMap).toHaveBeenCalledWith("computer-networks");
  });

  it("shows a retry when a curriculum request fails", async () => {
    apiMocks.getCourseCurriculumMap.mockRejectedValueOnce(new Error("offline"));
    render(<MemoryRouter><CourseMapPage /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("知识图谱暂时无法读取");
    fireEvent.click(screen.getByRole("button", { name: /重新加载/ }));
    expect(await screen.findByLabelText("绪论知识图谱")).toBeInTheDocument();
  });
});
