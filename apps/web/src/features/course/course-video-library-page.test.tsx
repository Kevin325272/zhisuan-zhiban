import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getCourseVideoSeries: vi.fn(),
  getCourseVideoSeriesEpisodes: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { CourseVideoLibraryPage } from "./course-video-library-page";

const seriesPage = {
  course_slug: "data-structures",
  course_title: "数据结构",
  external_only: true as const,
  notice: "外部视频来源索引，元数据未逐集人工复核，打开后将在哔哩哔哩播放。",
  query: "",
  kind: "all" as const,
  total_series: 2,
  total_episodes: 60,
  page: 1,
  page_size: 10,
  total_pages: 1,
  items: [
    {
      series_id: "course_video_series_BVTEST0",
      series_title: "数据结构基础课程",
      uploader: "课程UP主",
      video_kind: "teaching" as const,
      total_duration: "10:00:00",
      total_seconds: 36_000,
      episode_count: 48,
      canonical_url: "https://www.bilibili.com/video/BVTEST0",
      platform: "bilibili" as const,
    },
    {
      series_id: "course_video_series_BVTEST1",
      series_title: "数据结构习题精讲",
      uploader: "习题UP主",
      video_kind: "question_explanation" as const,
      total_duration: "02:00:00",
      total_seconds: 7200,
      episode_count: 12,
      canonical_url: "https://www.bilibili.com/video/BVTEST1",
      platform: "bilibili" as const,
    },
  ],
};

const episodePage = {
  course_slug: "data-structures",
  series: seriesPage.items[0],
  external_only: true as const,
  notice: seriesPage.notice,
  page: 1,
  page_size: 30,
  total_pages: 2,
  total_episodes: 48,
  items: [{
    episode_id: "course_video_episode_BVTEST0_0001",
    episode_title: "栈的定义",
    episode_number: 1,
    duration: "00:10:00",
    duration_seconds: 600,
    external_url: "https://www.bilibili.com/video/BVTEST0?p=1",
    platform: "bilibili" as const,
  }],
};

function renderPage(entry = "/student/courses/data-structures/videos") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/student/courses/:courseSlug/videos" element={<CourseVideoLibraryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CourseVideoLibraryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getCourseVideoSeries.mockResolvedValue(seriesPage);
    apiMocks.getCourseVideoSeriesEpisodes.mockResolvedValue(episodePage);
  });

  it("renders the course totals and continuous series ledger", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "数据结构视频资源" })).toBeInTheDocument();
    const overview = screen.getByLabelText("视频资源概况");
    expect(within(overview).getByText("2")).toBeInTheDocument();
    expect(within(overview).getByText("60")).toBeInTheDocument();
    const ledger = screen.getByRole("region", { name: "视频系列" });
    expect(within(ledger).getByText("数据结构基础课程")).toBeInTheDocument();
    expect(within(ledger).getByText("数据结构习题精讲")).toBeInTheDocument();
    expect(screen.getByText("视频链接将在哔哩哔哩打开。")).toBeInTheDocument();
    expect(screen.queryByText(/来源索引|元数据未逐集人工复核/u)).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索视频" })).toHaveAttribute("name", "q");
    expect(screen.getByRole("searchbox", { name: "搜索视频" })).toHaveAttribute("autocomplete", "off");
    expect(screen.getByRole("searchbox", { name: "搜索视频" })).toHaveAttribute(
      "placeholder", "搜索系列、UP 主或分集标题…",
    );
    expect(apiMocks.getCourseVideoSeries).toHaveBeenCalledWith("data-structures", {
      q: "",
      kind: "all",
      page: 1,
      pageSize: 10,
    });
  });

  it("searches series and switches the video kind without losing the query", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "数据结构视频资源" });

    const searchbox = screen.getByRole("searchbox", { name: "搜索视频" });
    fireEvent.change(searchbox, { target: { value: " 栈 " } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(apiMocks.getCourseVideoSeries).toHaveBeenLastCalledWith(
      "data-structures",
      { q: "栈", kind: "all", page: 1, pageSize: 10 },
    ));

    fireEvent.click(screen.getByRole("radio", { name: "习题讲解" }));
    await waitFor(() => expect(apiMocks.getCourseVideoSeries).toHaveBeenLastCalledWith(
      "data-structures",
      { q: "栈", kind: "question_explanation", page: 1, pageSize: 10 },
    ));
  });

  it("moves through series pages independently from episode pagination", async () => {
    apiMocks.getCourseVideoSeries.mockResolvedValue({
      ...seriesPage,
      total_series: 12,
      total_pages: 2,
    });
    renderPage();
    await screen.findByRole("heading", { name: "数据结构视频资源" });

    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(apiMocks.getCourseVideoSeries).toHaveBeenLastCalledWith(
      "data-structures",
      { q: "", kind: "all", page: 2, pageSize: 10 },
    ));
  });

  it("loads and paginates episodes only after a series is expanded", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "数据结构视频资源" });

    fireEvent.click(screen.getByRole("button", { name: "展开分集：数据结构基础课程" }));
    await waitFor(() => expect(apiMocks.getCourseVideoSeriesEpisodes).toHaveBeenCalledWith(
      "data-structures",
      "course_video_series_BVTEST0",
      { page: 1, pageSize: 30 },
    ));

    const episodes = await screen.findByRole("region", { name: "数据结构基础课程分集" });
    const externalLink = within(episodes).getByRole("link", { name: "观看第 1 集：栈的定义" });
    expect(externalLink).toHaveAttribute("href", "https://www.bilibili.com/video/BVTEST0?p=1");
    expect(externalLink).toHaveAttribute("target", "_blank");
    expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(within(episodes).getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(apiMocks.getCourseVideoSeriesEpisodes).toHaveBeenLastCalledWith(
      "data-structures",
      "course_video_series_BVTEST0",
      { page: 2, pageSize: 30 },
    ));
    expect(apiMocks.getCourseVideoSeries).toHaveBeenCalledTimes(1);
  });

  it("recovers from a course-level request failure", async () => {
    apiMocks.getCourseVideoSeries
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(seriesPage);
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("视频资源暂时无法读取");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByRole("heading", { name: "数据结构视频资源" })).toBeInTheDocument();
    expect(apiMocks.getCourseVideoSeries).toHaveBeenCalledTimes(2);
  });

  it("shows a directional empty state for filters with no matching series", async () => {
    apiMocks.getCourseVideoSeries.mockResolvedValue({
      ...seriesPage,
      total_series: 0,
      total_episodes: 0,
      total_pages: 0,
      items: [],
    });
    renderPage("/student/courses/data-structures/videos?q=%E4%B8%8D%E5%AD%98%E5%9C%A8");

    expect(await screen.findByText("没有找到匹配的视频系列")).toBeInTheDocument();
    expect(screen.getByText("可以更换关键词或切回全部类型。")).toBeInTheDocument();
  });

  it("retries one failed series without replacing the course library", async () => {
    apiMocks.getCourseVideoSeriesEpisodes
      .mockRejectedValueOnce(new Error("episode offline"))
      .mockResolvedValueOnce(episodePage);
    renderPage();
    await screen.findByRole("heading", { name: "数据结构视频资源" });

    fireEvent.click(screen.getByRole("button", { name: "展开分集：数据结构基础课程" }));
    const episodes = await screen.findByRole("region", { name: "数据结构基础课程分集" });
    expect(await within(episodes).findByRole("alert")).toHaveTextContent("该系列分集暂时无法读取");
    fireEvent.click(within(episodes).getByRole("button", { name: "重新读取本系列" }));

    expect(await within(episodes).findByRole("link", { name: "观看第 1 集：栈的定义" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "数据结构视频资源" })).toBeInTheDocument();
  });

  it("retries the failed episode page without resetting to page one", async () => {
    apiMocks.getCourseVideoSeriesEpisodes
      .mockResolvedValueOnce(episodePage)
      .mockRejectedValueOnce(new Error("page two offline"))
      .mockResolvedValueOnce({
        ...episodePage,
        page: 2,
        items: [{ ...episodePage.items[0], episode_number: 31 }],
      });
    renderPage();
    await screen.findByRole("heading", { name: "数据结构视频资源" });

    fireEvent.click(screen.getByRole("button", { name: "展开分集：数据结构基础课程" }));
    const episodes = await screen.findByRole("region", { name: "数据结构基础课程分集" });
    await within(episodes).findByRole("link", { name: "观看第 1 集：栈的定义" });
    fireEvent.click(within(episodes).getByRole("button", { name: "下一页" }));
    await within(episodes).findByRole("alert");
    fireEvent.click(within(episodes).getByRole("button", { name: "重新读取本系列" }));

    expect(await within(episodes).findByRole("link", { name: "观看第 31 集：栈的定义" })).toBeInTheDocument();
    expect(apiMocks.getCourseVideoSeriesEpisodes).toHaveBeenLastCalledWith(
      "data-structures",
      "course_video_series_BVTEST0",
      { page: 2, pageSize: 30 },
    );
  });

  it("invalidates an in-flight episode request when course filters change", async () => {
    let resolveEpisodes!: (value: typeof episodePage) => void;
    let resolveFilteredSeries!: (value: typeof seriesPage) => void;
    apiMocks.getCourseVideoSeriesEpisodes.mockImplementationOnce(() => new Promise((resolve) => {
      resolveEpisodes = resolve;
    }));
    apiMocks.getCourseVideoSeries
      .mockResolvedValueOnce(seriesPage)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFilteredSeries = resolve;
      }));
    renderPage();
    await screen.findByRole("heading", { name: "数据结构视频资源" });

    fireEvent.click(screen.getByRole("button", { name: "展开分集：数据结构基础课程" }));
    await waitFor(() => expect(apiMocks.getCourseVideoSeriesEpisodes).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("radio", { name: "习题讲解" }));
    await waitFor(() => expect(apiMocks.getCourseVideoSeries).toHaveBeenLastCalledWith(
      "data-structures",
      { q: "", kind: "question_explanation", page: 1, pageSize: 10 },
    ));
    expect(await screen.findByText("正在读取课程视频资源…")).toBeInTheDocument();

    resolveEpisodes(episodePage);
    resolveFilteredSeries(seriesPage);
    await screen.findByRole("heading", { name: "数据结构视频资源" });
    await waitFor(() => expect(
      screen.queryByRole("region", { name: "数据结构基础课程分集" }),
    ).not.toBeInTheDocument());
  });
});
