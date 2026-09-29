import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseReaderWorkspace } from "./course-reader-workspace";
import { CourseReaderHeading } from "./course-reader-heading";

function Reader() {
  return <><a href="/student/home">外部导航</a><CourseReaderWorkspace collapsed={false}>
    <nav><button>目录项目</button></nav>
    <section className="course-lesson-panel">
      <CourseReaderHeading chapter="绪论" module="基本概念" title="数据与数据元素" />
      <div className="lesson-reading-body"><p>课程正文</p><a href="#worked-example">查看解析</a></div>
      <footer className="lesson-pagination"><button>下一知识点</button></footer>
    </section>
  </CourseReaderWorkspace><article id="worked-example">解析正文</article></>;
}

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("course reader controls", () => {
  it("enters focus reading and restores the page and focus with Escape", () => {
    render(<Reader />);
    const focus = screen.getByRole("button", { name: "专注阅读" });
    focus.focus();
    fireEvent.click(focus);
    expect(screen.getByRole("dialog", { name: "课程专注阅读" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByText("外部导航").inert).toBe(true);
    screen.getByRole("button", { name: "放大正文字号" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "放大正文字号" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByText("外部导航").inert).toBe(false);
    expect(focus).toHaveFocus();
  });

  it("keeps keyboard navigation inside focus reading and unlocks on unmount", () => {
    const { unmount } = render(<Reader />);
    fireEvent.click(screen.getByRole("button", { name: "专注阅读" }));
    screen.getByRole("button", { name: "下一知识点" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "目录项目" })).toHaveFocus();
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("remembers text size across courses without reloading content", () => {
    const first = render(<Reader />);
    fireEvent.click(screen.getByRole("button", { name: "放大正文字号" }));
    expect(screen.getByRole("button", { name: "恢复默认字号" })).toHaveTextContent("20");
    expect(screen.getByText("课程正文")).toBeInTheDocument();
    first.unmount();
    render(<Reader />);
    expect(screen.getByRole("button", { name: "恢复默认字号" })).toHaveTextContent("20");
    fireEvent.click(screen.getByRole("button", { name: "恢复默认字号" }));
    expect(screen.getByRole("button", { name: "恢复默认字号" })).toHaveTextContent("18");
  });

  it("leaves focus reading when opening an example elsewhere on the page", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<Reader />);
    fireEvent.click(screen.getByRole("button", { name: "专注阅读" }));
    fireEvent.click(screen.getByRole("link", { name: "查看解析" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("解析正文")).toHaveFocus();
    expect(screen.getByText("解析正文").inert).toBe(false);
  });
});
