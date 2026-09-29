import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCourseReaderPosition } from "./use-course-reader-position";

function Harness({ resume = false, focused = false }: { resume?: boolean; focused?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(2);
  useCourseReaderPosition({ bodyRef: ref, chunkId: "chunk-1", paragraphIndex: index, paragraphCount: 4, resumeApplied: resume, sourceExpanded: true, onParagraphChange: setIndex });
  return <section data-reading-focus={focused} className="course-reader-workspace"><div className="course-lesson-panel">
    <header className="course-reader-heading">标题</header>
    <div ref={ref} className="lesson-reading-body" data-testid="body">
      {[0, 1, 2, 3].map((i) => <p key={i} data-reading-paragraph={i}>段落 {i}</p>)}
    </div><footer className="lesson-pagination" />
    <output aria-label="当前段落">{index}</output>
  </div></section>;
}

function geometry() {
  let offset = 0;
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top, toJSON() {} });
  const body = screen.getByTestId("body");
  vi.spyOn(body, "getBoundingClientRect").mockImplementation(() => rect(80, 600));
  vi.spyOn(document.querySelector(".course-reader-heading")!, "getBoundingClientRect").mockImplementation(() => rect(0, 80));
  vi.spyOn(document.querySelector(".lesson-pagination")!, "getBoundingClientRect").mockImplementation(() => rect(680, 60));
  body.querySelectorAll("p").forEach((p, i) => vi.spyOn(p, "getBoundingClientRect").mockImplementation(() => rect(100 + i * 160 - offset, 140)));
  return { body, scrollTo: (value: number) => { offset = value; } };
}

afterEach(() => vi.restoreAllMocks());

describe("course reading position", () => {
  it("restores once instead of pulling the reader back after subsequent scrolling", async () => {
    const scrolling = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<Harness resume />);
    const { scrollTo } = geometry();
    await waitFor(() => expect(scrolling).toHaveBeenCalledTimes(1));
    scrollTo(480);
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByLabelText("当前段落")).toHaveTextContent("3"));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(scrolling).toHaveBeenCalledTimes(1);
  });

  it("tracks backwards in the document and in focus reading", async () => {
    const { rerender } = render(<Harness />);
    const scene = geometry();
    scene.scrollTo(480);
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByLabelText("当前段落")).toHaveTextContent("3"));
    scene.scrollTo(0);
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByLabelText("当前段落")).toHaveTextContent("0"));
    rerender(<Harness focused />);
    scene.scrollTo(320);
    fireEvent.scroll(scene.body);
    await waitFor(() => expect(screen.getByLabelText("当前段落")).toHaveTextContent("2"));
  });
});
