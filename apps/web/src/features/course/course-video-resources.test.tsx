import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getCourseConceptVideos: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { CourseVideoResources } from "./course-video-resources";

describe("CourseVideoResources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a clear watch-video action with safe new-window behavior", async () => {
    apiMocks.getCourseConceptVideos.mockResolvedValue({
      course_slug: "data-structures",
      concept_id: "ds_c01_01",
      external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
      items: [
        {
          episode_id: "episode_1",
          series_title: "数据结构基础课程",
          episode_title: "数据与数据元素",
          episode_number: 4,
          duration: "00:18:20",
          duration_seconds: 1100,
          uploader: "课程UP主",
          external_url: "https://www.bilibili.com/video/BVTEST0?p=4",
          display_role: "primary",
          ordinal: 1,
          platform: "bilibili",
        },
        {
          episode_id: "episode_2",
          series_title: "数据结构课程",
          episode_title: "相关示例",
          episode_number: 5,
          duration: "00:12:10",
          duration_seconds: 730,
          uploader: "课程UP主",
          external_url: "https://www.bilibili.com/video/BVTEST0?p=5",
          display_role: "related",
          ordinal: 2,
          platform: "bilibili",
        },
      ],
    });

    render(
      <MemoryRouter>
        <CourseVideoResources conceptId="ds_c01_01" courseSlug="data-structures" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在读取相关视频");
    expect(await screen.findByRole("heading", { name: "相关视频" })).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    const watchLinks = links.filter((link) => link.getAttribute("target") === "_blank");
    expect(watchLinks).toHaveLength(2);
    expect(watchLinks[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(watchLinks[0]).toHaveAttribute("href", "https://www.bilibili.com/video/BVTEST0?p=4");
    expect(watchLinks[0]).toHaveAccessibleName("观看讲解视频：数据与数据元素（在哔哩哔哩打开）");
    expect(screen.getByText("数据与数据元素")).toBeInTheDocument();
    expect(screen.queryByText("本知识点显示最多 2 条精选关联视频，完整课程视频请进入视频资源库。"))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看本课程全部视频" })).toHaveAttribute(
      "href", "/student/courses/data-structures/videos",
    );
    expect(document.body.textContent).not.toMatch(/hash|license|review|confidence|裁切|审核/iu);
  });

  it("renders no empty resource card when the concept has no reviewed match", async () => {
    apiMocks.getCourseConceptVideos.mockResolvedValue({
      course_slug: "data-structures",
      concept_id: "ds_c01_02",
      external_only: true,
      notice: "外部视频资源，打开后将在哔哩哔哩播放。",
      items: [],
    });

    const { container } = render(
      <CourseVideoResources conceptId="ds_c01_02" courseSlug="data-structures" />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("degrades to one quiet status line when video loading fails", async () => {
    apiMocks.getCourseConceptVideos.mockRejectedValue(new Error("network"));
    render(
      <MemoryRouter>
        <CourseVideoResources conceptId="ds_c01_01" courseSlug="data-structures" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("相关视频暂时无法读取，不影响当前课程学习。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "相关视频" })).not.toBeInTheDocument();
  });
});
