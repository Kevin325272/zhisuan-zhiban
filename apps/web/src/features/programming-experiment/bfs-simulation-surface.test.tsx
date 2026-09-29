import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { BfsSimulationSurface } from "./bfs-simulation-surface";

describe("BfsSimulationSurface", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the graph, queue and current step", () => {
    render(<BfsSimulationSurface experimentId="ds-bfs-visited-v1" title="修复 BFS 重复入队问题" learningObjective="理解发现顶点、标记 visited 与加入队列之间的时序。" />);

    expect(screen.getByRole("heading", { name: "广度优先遍历仿真" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /七节点菱形图/ })).toBeInTheDocument();
    expect(screen.getByText("Queue")).toBeInTheDocument();
    expect(screen.getByText("初始化起点")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存本次轨迹" })).toBeDisabled();
  });

  it("rebuilds the trace when the start node changes", () => {
    render(<BfsSimulationSurface experimentId="ds-bfs-visited-v1" title="BFS" learningObjective="理解 BFS" />);

    fireEvent.change(screen.getByLabelText("起点节点"), { target: { value: "2" } });

    expect(screen.getByText("节点 2 入队")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /节点 2：已入队/ })).toBeInTheDocument();
  });

  it("advances, pauses autoplay and saves only after completion", () => {
    render(<BfsSimulationSurface experimentId="ds-bfs-visited-v1" title="BFS" learningObjective="理解 BFS" />);

    const next = screen.getByRole("button", { name: "下一步" });
    const save = screen.getByRole("button", { name: "保存本次轨迹" });
    fireEvent.click(next);
    expect(screen.getByText("取出节点 1")).toBeInTheDocument();
    expect(save).toBeDisabled();

    const autoplay = screen.getByRole("button", { name: "自动播放" });
    fireEvent.click(autoplay);
    expect(screen.getByRole("button", { name: "暂停自动播放" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "暂停自动播放" }));
    expect(screen.getByRole("button", { name: "自动播放" })).toBeInTheDocument();

    while (!(next as HTMLButtonElement).disabled) fireEvent.click(next);
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(screen.getByRole("status")).toHaveTextContent("已保存本机轨迹");
    expect(screen.getByText(/本机轨迹 1 次/)).toBeInTheDocument();
  });
});
