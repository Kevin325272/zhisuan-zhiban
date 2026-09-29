import type { NotebookEntry, NotebookWrite } from "@xuetu/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ getNotebookEntry: vi.fn(), saveNotebookEntry: vi.fn(), removeNotebookEntry: vi.fn() }));
vi.mock("../../api/client", () => api);
import { NotebookEditor } from "./notebook-editor";
import { listNotebookDrafts, readNotebookDraft, writeNotebookDraft } from "./notebook-draft";

const input: NotebookWrite = { title: "Cache地址分解", content: "先算块内偏移。", subject: "组成原理", question_id: null, bookmarked: false, version: 0 };
const stored: NotebookEntry = { ...input, id: "note:test", question: null, version: 1, created_at: "2026-09-09T00:00:00.000Z", updated_at: "2026-09-09T00:00:00.000Z" };
function mount(owner = "student-A") { return render(<MemoryRouter><NotebookEditor id="note:test" owner={owner} /></MemoryRouter>); }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); api.getNotebookEntry.mockResolvedValue({ entry: null }); api.saveNotebookEntry.mockResolvedValue({ entry: stored }); });
describe("private notebook editing", () => {
  it("clears the submitted draft even if navigation happens before the save finishes", async () => {
    let finish!: (value: { entry: NotebookEntry }) => void;
    api.saveNotebookEntry.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    writeNotebookDraft("student-A", "note:test", input);
    const editor = mount();
    await screen.findByLabelText("笔记正文");
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    editor.unmount();
    await act(async () => { finish({ entry: stored }); });
    expect(readNotebookDraft("student-A", "note:test")).toBeNull();
  });
  it("does not erase a newer draft from another tab when the old save finishes", async () => {
    let finish!: (value: { entry: NotebookEntry }) => void;
    api.saveNotebookEntry.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    writeNotebookDraft("student-A", "note:test", input);
    mount(); await screen.findByLabelText("笔记正文");
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    const newer = { ...input, content: "另一个页面里刚写的推导" };
    writeNotebookDraft("student-A", "note:test", newer);
    await act(async () => { finish({ entry: stored }); });
    expect(readNotebookDraft("student-A", "note:test")).toEqual(newer);
  });
  it("saves to the server and only then reports the record as saved", async () => {
    mount(); const title = await screen.findByRole("textbox", { name: "笔记标题" });
    fireEvent.change(title, { target: { value: input.title } });
    fireEvent.change(screen.getByLabelText("笔记学科"), { target: { value: input.subject } });
    fireEvent.change(screen.getByRole("textbox", { name: "笔记正文" }), { target: { value: input.content } });
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    expect(await screen.findByText("笔记已保存")).toBeInTheDocument();
    expect(api.saveNotebookEntry).toHaveBeenCalledWith("note:test", input);
    expect(readNotebookDraft("student-A", "note:test")).toBeNull();
  });
  it("keeps an unsaved draft after a failed save and navigation", async () => {
    api.saveNotebookEntry.mockRejectedValue(new Error("网络断开"));
    const first = mount(); await screen.findByRole("textbox", { name: "笔记标题" });
    fireEvent.change(screen.getByLabelText("笔记标题"), { target: { value: input.title } });
    fireEvent.change(screen.getByLabelText("笔记正文"), { target: { value: input.content } });
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络断开");
    expect(screen.queryByText("笔记已保存")).not.toBeInTheDocument(); first.unmount(); mount();
    expect(await screen.findByLabelText("笔记正文")).toHaveValue(input.content);
    expect(screen.getByText("已恢复未保存的草稿")).toBeInTheDocument();
  });
  it("preserves a draft even before its title is written and isolates accounts", () => {
    writeNotebookDraft("student-A", "note:test", { ...input, title: "" });
    expect(readNotebookDraft("student-A", "note:test")?.content).toBe(input.content);
    expect(listNotebookDrafts("student-A")).toEqual([{ id: "note:test", title: "未命名草稿" }]);
    expect(listNotebookDrafts("student-B")).toEqual([]);
    expect(readNotebookDraft("student-B", "note:test")).toBeNull();
  });
  it("does not overwrite a newer version when a restored draft is stale", async () => {
    writeNotebookDraft("student-A", "note:test", input);
    api.getNotebookEntry.mockResolvedValue({ entry: { ...stored, version: 3 } });
    api.saveNotebookEntry.mockRejectedValue(new Error("这条笔记已在另一个页面更新"));
    mount(); await screen.findByLabelText("笔记正文"); fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    await screen.findByRole("alert");
    expect(api.saveNotebookEntry).toHaveBeenCalledWith("note:test", expect.objectContaining({ version: 0, content: input.content }));
    expect(readNotebookDraft("student-A", "note:test")?.content).toBe(input.content);
  });
  it("does not enable a write after the initial read failed", async () => {
    api.getNotebookEntry.mockRejectedValue(new Error("读取失败")); mount();
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "保存笔记" })).toBeDisabled();
    expect(api.saveNotebookEntry).not.toHaveBeenCalled();
  });
  it("preserves the note when removing the question bookmark", async () => {
    const source = { id: "q1", year: 2024, number: 1, subject: "数据结构", type: "choice" as const, excerpt: "链表的指针变化", tags: [], href: "/student/practice?question_id=q1" };
    api.getNotebookEntry.mockResolvedValue({ entry: { ...stored, question_id: "q1", question: source, bookmarked: true } });
    api.saveNotebookEntry.mockResolvedValue({ entry: { ...stored, question_id: "q1", question: source, bookmarked: false, version: 2 } });
    mount(); await screen.findByRole("button", { name: "已收藏" });
    fireEvent.click(screen.getByRole("button", { name: "已收藏" }));
    await waitFor(() => expect(api.saveNotebookEntry).toHaveBeenCalledWith("note:test", expect.objectContaining({ content: input.content, bookmarked: false })));
    expect(await screen.findByText("已取消收藏，笔记保留")).toBeInTheDocument();
  });
});
