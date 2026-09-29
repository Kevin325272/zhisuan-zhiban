import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getStudentLearningOrchestration: vi.fn() }));
vi.mock("../../api/client", () => api);
import { PlanPage } from "./plan-page";

const task = { task_id: "plan-co-1", day_index: 1, task_date: "2026-09-09", course_id: "course_408_co", course_title: "计算机组成原理", title: "学习存储层次", estimated_minutes: 20, href: "/student/courses/computer-organization?concept_id=co-storage", status: "pending" };
const snapshot = {
  generated_at: "2026-09-09T08:00:00.000Z",
  current_task: { ...task, source: "initial_plan" },
  plan_progress: { plan_id: "real-plan", completed_task_count: 1, total_task_count: 2, completion_percent: 50, tasks: [task, { ...task, task_id: "plan-co-2", day_index: 2, task_date: "2026-09-10", title: "练习Cache地址分解", status: "completed" }] },
};
const mount = () => render(<MemoryRouter><PlanPage /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); api.getStudentLearningOrchestration.mockResolvedValue(snapshot); });
describe("current seven-day learning plan", () => {
  it("shows persisted task dates and completion without claiming mastery", async () => {
    mount();
    const progress = await screen.findByRole("progressbar", { name: "七日计划完成进度" });
    expect(progress).toHaveAttribute("aria-valuenow", "50");
    const completed = screen.getByTestId("plan-task-plan-co-2");
    expect(completed).toHaveTextContent("练习Cache地址分解");
    expect(completed).toHaveTextContent("已完成");
    expect(screen.queryByText(/已掌握/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续当前任务" })).toHaveAttribute("href", task.href + "&orchestration_task_id=plan-co-1");
    expect(within(completed).getByRole("link", { name: "查看内容" })).toHaveAttribute("href", task.href);
  });
  it("offers a retry after loading fails", async () => {
    api.getStudentLearningOrchestration.mockRejectedValueOnce(new Error("暂时无法连接"));
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法连接");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByTestId("plan-task-plan-co-1")).toBeInTheDocument();
  });
  it("keeps the last saved plan if a refresh fails", async () => {
    mount(); await screen.findByTestId("plan-task-plan-co-1");
    api.getStudentLearningOrchestration.mockRejectedValueOnce(new Error("暂时无法连接"));
    fireEvent.click(screen.getByRole("button", { name: "刷新学习计划" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("仍显示上次读取的计划");
    expect(screen.getByTestId("plan-task-plan-co-1")).toBeInTheDocument();
  });
  it("shows an actionable empty state instead of fabricating a seven-day schedule", async () => {
    api.getStudentLearningOrchestration.mockResolvedValue({ ...snapshot, plan_progress: { plan_id: null, tasks: [], total_task_count: 0, completed_task_count: 0, completion_percent: 0 } });
    mount();
    expect(await screen.findByText("还没有七日学习计划")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置学习目标" })).toHaveAttribute("href", "/student/onboarding");
  });
});
