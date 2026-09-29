import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProgrammingExperimentPage } from "./programming-experiment-page";
vi.mock("../virtual-lab/lab-viewport", () => ({ LabViewport: () => <div data-testid="gpu-tested-in-browser" /> }));
function open(id: string) {
  render(<MemoryRouter initialEntries={[`/student/programming-experiments/${id}`]}><Routes><Route element={<ProgrammingExperimentPage />} path="/student/programming-experiments/:labId" /></Routes></MemoryRouter>);
}
describe("experiment workspace", () => {
  it("invalidates an old run when configuration changes", () => {
    open("network-routing");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("heading", { name: "读取设备与连接" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("主机 A · 默认网关"), { target: { value: "192.168.10.99" } });
    expect(screen.getByText("尚未运行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    const slider = screen.getByRole("slider", { name: "回放位置" });
    fireEvent.change(slider, { target: { value: slider.getAttribute("max") } });
    expect(screen.getByRole("region", { name: "实验过程与结果" })).toHaveTextContent("ARP 解析失败");
    fireEvent.click(screen.getByRole("button", { name: "重置实验" }));
    expect(screen.getByLabelText("主机 A · 默认网关")).toHaveValue("192.168.10.1");
  });
  it("rejects an occupied port and removes a connection explicitly", () => {
    open("network-routing");
    fireEvent.click(screen.getByRole("tab", { name: "接线" }));
    fireEvent.click(screen.getByRole("button", { name: "连接端口" }));
    expect(screen.getByRole("status")).toHaveTextContent("一个端口只能连接一根网线");
    fireEvent.click(screen.getAllByRole("button", { name: /^断开 /u })[0]!);
    expect(screen.getAllByRole("button", { name: /^断开 /u })).toHaveLength(3);
  });
  it("displays a computed result and prevents a misleading save on invalid input", () => {
    open("os-pages");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    const slider = screen.getByRole("slider", { name: "回放位置" });
    fireEvent.change(slider, { target: { value: slider.getAttribute("max") } });
    const result = screen.getByRole("region", { name: "实验过程与结果" });
    expect(result).toHaveTextContent("缺页次数9");
    fireEvent.change(screen.getByLabelText("可用页框数"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "运行实验" }));
    expect(screen.getByRole("alert")).toHaveTextContent("范围为 1–8");
    expect(screen.getByRole("button", { name: "保存记录" })).toBeDisabled();
  });
  it("does not silently replace a missing experiment with another course", () => {
    open("unknown");
    expect(screen.getByRole("heading", { name: "未找到这个实验" })).toBeInTheDocument();
  });
});
