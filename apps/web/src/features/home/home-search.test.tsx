import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { HomeSearch } from "./home-search";

function LocationProbe() {
  const location = useLocation();

  return <output aria-label="当前路径">{`${location.pathname}${location.search}`}</output>;
}

function renderSearch(initialEntry = "/student/home") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <HomeSearch />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("HomeSearch", () => {
  it("filters the platform index and exposes the matching destination", () => {
    renderSearch();

    const input = screen.getByRole("searchbox", { name: "检索平台内容" });
    fireEvent.change(input, { target: { value: "能力" } });

    expect(screen.getByRole("link", { name: /我的学习/ })).toHaveAttribute(
      "href",
      "/student/profile",
    );
  });

  it("keeps an unmatched question inside the constrained course path", () => {
    renderSearch();

    const input = screen.getByRole("searchbox", { name: "检索平台内容" });
    fireEvent.change(input, { target: { value: "为什么 BFS 使用队列？" } });

    expect(screen.queryByRole("link", { name: /向 AI 提问/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /浏览课程入口/ })).toHaveAttribute(
      "href",
      "/student/courses",
    );
  });

  it("supports Ctrl+K focus and Escape without clearing the query", () => {
    renderSearch();

    const input = screen.getByRole("searchbox", { name: "检索平台内容" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "能力" } });
    expect(screen.getByRole("region", { name: "检索结果" })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "检索结果" })).not.toBeInTheDocument();
    expect(input).toHaveValue("能力");
  });

  it("opens the highlighted result with ArrowDown and Enter", () => {
    renderSearch();

    const input = screen.getByRole("searchbox", { name: "检索平台内容" });
    fireEvent.change(input, { target: { value: "能力" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByLabelText("当前路径")).toHaveTextContent("/student/profile");
  });

  it("accepts a focus handoff from the top command search", () => {
    renderSearch("/student/home?focus=search");

    expect(screen.getByRole("searchbox", { name: "检索平台内容" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "检索结果" })).toBeInTheDocument();
  });

  it("uses general learning prompts instead of making the homepage BFS-specific", () => {
    renderSearch();

    expect(screen.getByRole("button", { name: "从零理解一个知识点" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分析一道错题" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "BFS 运行轨迹" })).not.toBeInTheDocument();
  });
});
