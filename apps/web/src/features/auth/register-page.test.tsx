import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registerMock = vi.hoisted(() => vi.fn());
const policyMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  getStudentRegistrationPolicy: policyMock,
}));

vi.mock("./auth-context", () => ({
  useAuth: () => ({
    isProviderMounted: true,
    register: registerMock,
  }),
}));

import { RegisterPage } from "./register-page";

describe("RegisterPage", () => {
  beforeEach(() => {
    registerMock.mockReset();
    policyMock.mockReset();
  });

  it("keeps the student product entry primary when a school deployment controls registration", async () => {
    policyMock.mockResolvedValue({
      mode: "controlled",
      self_registration: false,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds"],
      notice: "当前试点由管理员创建账户并绑定课程，暂不开放自行注册。",
    });

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "开始你的 408 备考" })).toBeInTheDocument();
    expect(screen.getByText("本次校内试点使用邀请账号")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "选择注册身份" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /创建学习账户/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "教师申请入口" }));
    expect(screen.getByRole("heading", { name: "申请教师账户" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交教师申请" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回学生注册" })).toBeInTheDocument();
  });

  it("allows a one-character username and a simple six-character password", async () => {
    policyMock.mockResolvedValue({
      mode: "self_service",
      self_registration: true,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds"],
      notice: "注册后即可开始四门 408 课程的起步设置。",
    });
    const view = render(
      <MemoryRouter initialEntries={["/register"]}>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(view.container.querySelector("main")).toHaveClass("login-gateway", "registration-gateway");
    expect(await screen.findByRole("heading", { name: "开始你的 408 备考" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建学习账户" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "教师申请入口" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "选择注册身份" })).not.toBeInTheDocument();
    const username = screen.getByLabelText("用户名") as HTMLInputElement;
    fireEvent.input(username, { target: { value: "X" } });

    expect(screen.getByText("用户名 1–32 位，不能包含空格。")).toBeInTheDocument();
    expect(username).toHaveAttribute("pattern", "[^\\p{C}\\s]{1,32}");
    expect(username).toHaveAttribute("name", "username");
    expect(username).toHaveAttribute("spellcheck", "false");
    expect(screen.getByLabelText("姓名或昵称")).toHaveAttribute("name", "display_name");
    expect(screen.getByLabelText("密码")).toHaveAttribute("name", "password");
    expect(screen.getByLabelText("密码")).toHaveAttribute("minlength", "6");
    expect(screen.getByLabelText("确认密码")).toHaveAttribute("name", "password_confirmation");
    expect(screen.getByLabelText("确认密码")).toHaveAttribute("minlength", "6");
    expect(screen.getByText("密码至少 6 位，不能包含空格。")).toBeInTheDocument();
    expect(() => new RegExp(username.pattern, "v")).not.toThrow();
    expect(username.checkValidity()).toBe(true);
    expect(screen.queryByText(/PostgreSQL|KDF|数据边界|工作流/u)).not.toBeInTheDocument();
  });

  it("sends a newly registered student straight to the learning panel while onboarding is skipped", async () => {
    policyMock.mockResolvedValue({
      mode: "self_service",
      self_registration: true,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds"],
      notice: "注册后即可开始四门 408 课程的起步设置。",
    });
    registerMock.mockResolvedValue({
      account: { user_id: "student_new", roles: ["student"], account_status: "active" },
      authenticated: true,
      next_step: "student_onboarding",
    });
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/student/onboarding" element={<p>student onboarding</p>} />
          <Route path="/student/home" element={<p>student home</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("用户名"), { target: { value: "StudentNew" } });
    fireEvent.change(await screen.findByLabelText("姓名或昵称"), { target: { value: "新同学" } });
    fireEvent.change(await screen.findByLabelText("密码"), { target: { value: "Password1234" } });
    fireEvent.change(await screen.findByLabelText("确认密码"), { target: { value: "Password1234" } });
    fireEvent.click(await screen.findByRole("button", { name: /创建学习账户/ }));

    expect(await screen.findByText("student home")).toBeInTheDocument();
    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ role: "student" }));
  });

  it("shows an approval result after a teacher applies and does not enter the student flow", async () => {
    policyMock.mockResolvedValue({
      mode: "controlled",
      self_registration: false,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds"],
      notice: "当前试点由管理员创建学生账户。",
    });
    registerMock.mockResolvedValue({
      account: {
        user_id: "teacher_pending",
        roles: ["teacher"],
        account_status: "pending_approval",
      },
      authenticated: false,
      next_step: "await_teacher_approval",
    });
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/student/onboarding" element={<p>student onboarding</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "教师申请入口" }));
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "TeacherApply" } });
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "申请教师" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Password1234" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "Password1234" } });
    fireEvent.click(screen.getByRole("button", { name: "提交教师申请" }));

    expect(await screen.findByRole("heading", { name: "教师申请已提交" })).toBeInTheDocument();
    expect(screen.getByText(/审核通过后即可使用教师账户登录/)).toBeInTheDocument();
    expect(screen.queryByText("student onboarding")).not.toBeInTheDocument();
    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher" }));
  });

  it("submits a teacher application only once while the request is pending", async () => {
    policyMock.mockResolvedValue({
      mode: "controlled",
      self_registration: false,
      teacher_registration: "approval_required",
      course_ids: ["course_408_ds"],
      notice: "当前试点由管理员创建学生账户。",
    });
    let resolveRegistration: ((value: {
      account: {
        user_id: string;
        roles: ["teacher"];
        account_status: "pending_approval";
      };
      authenticated: false;
      next_step: "await_teacher_approval";
    }) => void) | undefined;
    registerMock.mockReturnValue(new Promise((resolve) => {
      resolveRegistration = resolve;
    }));
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <RegisterPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "教师申请入口" }));
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "TeacherApply" } });
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "申请教师" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Password1234" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "Password1234" } });
    const form = screen.getByRole("button", { name: "提交教师申请" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "正在提交…" })).toBeDisabled();
    fireEvent.submit(form!);

    expect(registerMock).toHaveBeenCalledTimes(1);
    resolveRegistration?.({
      account: {
        user_id: "teacher_pending",
        roles: ["teacher"],
        account_status: "pending_approval",
      },
      authenticated: false,
      next_step: "await_teacher_approval",
    });
    expect(await screen.findByRole("heading", { name: "教师申请已提交" })).toBeInTheDocument();
  });
});
