import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

import { createDemoSession, readDemoSession } from "../features/auth/demo-session";
import { AppShell } from "./app-shell";

const defaultAuth = {
  isProviderMounted: false,
  status: "unauthenticated",
  account: null,
  loginNotice: null,
  error: null,
  logout: async () => undefined,
};

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    useAuthMock.mockReturnValue(defaultAuth);
  });

  it("exposes the three student agent entries through the main navigation", () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "移动导航" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /智能伴学中枢/ })).toHaveAttribute(
      "href",
      "/student/courses",
    );
    expect(screen.getByText("Tutor-Agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /3D 具身仿真沙盒/ })).toHaveAttribute(
      "href",
      "/student/programming-experiments",
    );
    expect(screen.getByText("Lab-Agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /认知记忆管理/ })).toHaveAttribute(
      "href",
      "/student/memory-cards",
    );
    expect(screen.getByText("Memory-Agent")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /教师教研中枢/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /学习面板/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /408 课程/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /题库练习/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /学习分析/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /院校圈/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /实验中心/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /错题复习/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /复习笔记/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开我的学习" })).toHaveAttribute(
      "href",
      "/student/profile",
    );
    expect(screen.getByRole("link", { name: "账户设置" })).toHaveAttribute("href", "/student/account");
    expect(screen.queryByText("XUETU · CS")).not.toBeInTheDocument();
    expect(screen.queryByText("知识库已同步")).not.toBeInTheDocument();
    expect(screen.queryByText(/本周目标/)).not.toBeInTheDocument();
    expect(screen.queryByText("学习榜")).not.toBeInTheDocument();
    expect(screen.queryByText("教师端")).not.toBeInTheDocument();
  });

  it("shows the Decision-Agent entry only for teacher-role accounts", () => {
    useAuthMock.mockReturnValue({
      ...defaultAuth,
      account: { user_id: "teacher_001", display_name: "王老师", roles: ["teacher"] },
    });
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /教师教研中枢/ })).toHaveAttribute("href", "/teacher");
    expect(screen.getByText("Decision-Agent")).toBeInTheDocument();
  });

  it("highlights the lab agent instead of the tutor agent on a nested experiment route", () => {
    render(
      <MemoryRouter initialEntries={["/student/courses/data-structures/experiments/ds-bfs-visited-v1"]}>
        <AppShell />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(navigation).toHaveTextContent("智能伴学中枢");
    expect(navigation).toHaveTextContent("3D 具身仿真沙盒");
    expect(navigation).toHaveTextContent("认知记忆管理");
    expect(within(navigation).getAllByRole("link")).toHaveLength(3);
    expect(within(navigation).getByRole("link", { name: /3D 具身仿真沙盒/ })).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByRole("link", { name: /智能伴学中枢/ })).not.toHaveAttribute("aria-current");
  });

  it("closes the compact navigation after choosing a destination and on Escape", () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: "展开主导航" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("link", { name: /认知记忆管理/ }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("gives coding tasks more horizontal space and hides the global agent", () => {
    render(
      <MemoryRouter initialEntries={["/student/tasks/task_bfs_bug_001"]}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-workspace", "focused");
    expect(screen.queryByRole("button", { name: "打开 408 专家 Agent" })).not.toBeInTheDocument();
  });

  it("gives the real programming experiment the same focused workspace", () => {
    render(
      <MemoryRouter initialEntries={["/student/courses/data-structures/experiments/ds-bfs-visited-v1"]}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-workspace", "focused");
    expect(screen.queryByRole("button", { name: "打开 408 专家 Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /智能伴学中枢/ })).toHaveAttribute(
      "href",
      "/student/courses",
    );
  });

  it.each([
    "/student/test-lab",
    "/student/courses",
    "/student/courses/data-structures",
    "/student/courses/operating-systems",
    "/student/courses/computer-networks",
    "/student/courses/computer-organization",
    "/student/course-map",
    "/student/memory-cards",
    "/student/profile",
    "/student/practice",
    "/student/exam-papers",
    "/student/programming-experiments",
  ])("keeps one global 408 agent available on a normal student page: %s", (entry) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("button", { name: "打开 408 专家 Agent" })).toHaveLength(1);
  });

  it("keeps the homepage agent available without covering the dashboard on entry", () => {
    render(
      <MemoryRouter initialEntries={["/student/home"]}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("complementary", { name: "408 专家 Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开 408 专家 Agent" })).toBeInTheDocument();
  });

  it("clears the local demo session from the student shell", () => {
    createDemoSession("student");
    render(
      <MemoryRouter initialEntries={["/student/practice"]}>
        <AppShell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "退出登录" }));
    expect(readDemoSession()).toBeNull();
  });

  it("does not present a fixed BFS notification as a student's learning reminder", () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /查看通知/ }));

    expect(screen.getByRole("region", { name: "学习通知" })).toBeInTheDocument();
    expect(screen.getByText("暂无未读通知")).toBeInTheDocument();
    expect(screen.queryByText(/BFS 错因复习已到期/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看通知/ })).toHaveAccessibleName(
      "查看通知，无未读",
    );
  });
});
