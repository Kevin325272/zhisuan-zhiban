import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProgrammingExperimentHubPage } from "./programming-experiment-hub-page";
describe("experiment catalog", () => {
  it("offers four real routes per course and keeps subjects separate", () => {
    render(<MemoryRouter><ProgrammingExperimentHubPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "仿真实验中心" })).toBeInTheDocument();
    const network = screen.getByRole("region", { name: "计算机网络实验列表" });
    expect(within(network).getAllByRole("link", { name: /进入实验/u })).toHaveLength(4);
    expect(within(network).getByRole("heading", { name: "跨网段通信" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /计算机组成原理/u }));
    const co = screen.getByRole("region", { name: "计算机组成原理实验列表" });
    expect(within(co).getAllByRole("link", { name: /进入实验/u })).toHaveLength(4);
    expect(within(co).getByRole("heading", { name: "Cache 映射与替换" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /操作系统/u }));
    expect(screen.getByRole("heading", { name: "页面置换" })).toBeInTheDocument();
    expect(screen.queryByText("修复 BFS 重复入队问题")).not.toBeInTheDocument();
  });
});
