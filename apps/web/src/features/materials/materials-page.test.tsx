import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { MaterialsPage } from "./materials-page";

describe("MaterialsPage", () => {
  beforeEach(() => window.localStorage.clear());

  it("organizes sources as course materials, AI context, and a continuation point", () => {
    render(
      <MemoryRouter>
        <MaterialsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("region", { name: "资料库学习上下文" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "课程材料" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "知识关联" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近使用" })).toBeInTheDocument();
    expect(screen.getByText(/回答中引用的资料会单独列出/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/AI CONTEXT|RAG 命中/u);
    expect(screen.getByRole("link", { name: /继续阅读/ })).toHaveAttribute(
      "href",
      "#active-material-reader",
    );
  });

  it("switches the reader content with each selected source", () => {
    render(
      <MemoryRouter>
        <MaterialsPage />
      </MemoryRouter>,
    );

    const slides = screen.getByRole("button", { name: /06 图与图遍历/ });
    fireEvent.click(slides);
    expect(slides).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "课件重点定位" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "BFS 的队列状态变化" })).toBeInTheDocument();
    expect(screen.getByText("SLIDE")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "教材原文定位" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /实验五 BFS \/ DFS/ }));
    expect(screen.getByRole("heading", { name: "实验要求定位" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "BFS 输出不得包含重复顶点" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /图遍历错因笔记/ }));
    expect(screen.getByRole("heading", { name: "错因笔记定位" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "出队后标记为什么会重复入队" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/教材|课件|实验指导/).length).toBeGreaterThan(0);
  });

  it("keeps course sources traceable and turns them into review material", () => {
    render(
      <MemoryRouter>
        <MaterialsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /材料工作室/ })).toBeInTheDocument();
    expect(screen.getByText("4 项已同步材料")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "教材原文定位" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成学习卡片" }));
    expect(screen.getByText("学习卡片已加入今日复习")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /06 图与图遍历/ }));
    expect(screen.getByRole("button", { name: "生成学习卡片" })).toBeEnabled();
  });

  it("writes an editable causal-chain note into the personal notebook", () => {
    const view = render(
      <MemoryRouter>
        <MaterialsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "写入个人笔记" }));
    const editor = screen.getByRole("textbox", { name: "个人笔记内容" });
    expect((editor as HTMLTextAreaElement).value).toContain("重复边");

    fireEvent.change(editor, { target: { value: "BFS 错因：重复边会暴露 visited 标记过晚的问题。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));

    expect(screen.getByText("已写入个人笔记")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑个人笔记" })).toBeInTheDocument();

    view.unmount();
    render(
      <MemoryRouter>
        <MaterialsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("已写入个人笔记")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑个人笔记" }));
    expect(screen.getByRole("textbox", { name: "个人笔记内容" })).toHaveValue(
      "BFS 错因：重复边会暴露 visited 标记过晚的问题。",
    );
  });

  it("combines selected sources into a quiz and a visual mind map", () => {
    render(
      <MemoryRouter>
        <MaterialsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "纳入生成：06 图与图遍历" }));
    expect(screen.getByText("已选择 2 个来源")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成思维导图" }));
    const mindMap = screen.getByRole("region", { name: "BFS 标记时机思维导图" });
    expect(within(mindMap).getByRole("heading", { name: "BFS 标记时机思维导图" })).toBeInTheDocument();
    expect(within(mindMap).getByText("数据结构（C++版）")).toBeInTheDocument();
    expect(within(mindMap).getByText("06 图与图遍历")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成针对性测验" }));
    expect(screen.getByRole("heading", { name: "多来源针对性测验" })).toBeInTheDocument();
    expect(screen.getByText("2 道判断题 · 来源可回查")).toBeInTheDocument();
  });

  it("uploads a local course file into the source desk", async () => {
    render(
      <MemoryRouter>
        <MaterialsPage />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText("上传课程资料");
    const file = new File(["BFS 应在入队时标记 visited。"], "自建BFS笔记.md", {
      type: "text/markdown",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /自建BFS笔记/ })).toBeInTheDocument();
    });
    expect(screen.getByText("5 项已同步材料")).toBeInTheDocument();
  });
});
