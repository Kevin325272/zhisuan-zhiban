import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseSourceDocument } from "./course-source-page";

const page = { page_id: "012345abcdef-p128", print_page: 114, physical_page: 128,
  title: "数据结构", width: 1488, height: 2200,
  image_url: `/api/v1/408/courses/data-structures/source-pages/012345abcdef-p128?v=${"a".repeat(64)}` };
const sources = [{ chunk_id: "ds_k0114", print_page: 114, chunk_offset: 0 }, { chunk_id: "ds_k0115", print_page: 115, chunk_offset: 1 }];
afterEach(() => vi.restoreAllMocks());
describe("CourseSourceDocument", () => {
  it("renders the original image and navigates within the knowledge point's actual source references", () => {
    const select = vi.fn();
    const { container } = render(<CourseSourceDocument page={page} paragraphCount={9} chunkId="ds_k0114" sources={sources} onSelectSource={select} />);
    expect(screen.getByRole("img", { name: "数据结构 · 第 114 页原文" })).toHaveAttribute("src", page.image_url);
    expect(container.querySelectorAll("[data-reading-paragraph]")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "上一原文页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一原文页" }));
    expect(select).toHaveBeenCalledWith(1);
  });
  it("shows a retry action on image failure without reverting to corrupted OCR", () => {
    render(<CourseSourceDocument page={page} paragraphCount={9} chunkId="ds_k0114" sources={sources} onSelectSource={vi.fn()} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert")).toHaveTextContent("原文页加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载原文" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", `${page.image_url}&retry=1`);
  });
  it("lets the student retry a failed enlarged page from inside the dialog", () => {
    const { container } = render(<CourseSourceDocument page={page} paragraphCount={9} chunkId="ds_k0114" sources={sources} onSelectSource={vi.fn()} />);
    const nativeDialog = container.querySelector("dialog")!;
    nativeDialog.showModal = () => nativeDialog.setAttribute("open", "");
    fireEvent.click(screen.getByRole("button", { name: "放大原文" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.error(within(dialog).getByRole("img"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("原文页加载失败");
    fireEvent.click(within(dialog).getByRole("button", { name: "重新加载原文" }));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", `${page.image_url}&retry=1`);
  });

  it("opens the unchanged full page when a lesson excerpt is displayed", () => {
    const { container } = render(<CourseSourceDocument page={page} paragraphCount={1} chunkId="ds_k0114" sources={sources} onSelectSource={vi.fn()} excerpt={{ top: 0.815, bottom: 1 }} />);
    const nativeDialog = container.querySelector("dialog")!;
    nativeDialog.showModal = () => nativeDialog.setAttribute("open", "");
    const inline = screen.getByRole("img", { name: /本节节选/ });
    expect(inline).toHaveAttribute("src", page.image_url);
    expect(inline).toHaveStyle({ position: "absolute" });
    fireEvent.click(screen.getByRole("button", { name: "查看整页" }));
    const original = within(screen.getByRole("dialog")).getByRole("img");
    expect(original).toHaveAttribute("src", page.image_url);
    expect(original.style.transform).toBe("");
    expect(original).toHaveAttribute("height", String(page.height));
    expect(original).not.toHaveAccessibleName(/节选/);
  });

  it("falls back to the full original when excerpt bounds are invalid", () => {
    const { container } = render(<CourseSourceDocument page={page} paragraphCount={9} chunkId="ds_k0114" sources={sources} onSelectSource={vi.fn()} excerpt={{ top: 1, bottom: 0 }} />);
    expect(screen.getByRole("button", { name: "放大原文" })).toBeEnabled();
    expect(container.querySelector(".source-document-sheet")).not.toHaveAttribute("data-source-excerpt");
  });
});
