import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const changePasswordMock = vi.hoisted(() => vi.fn());
const getAccountCourseScopeMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  getAccountCourseScope: getAccountCourseScopeMock,
}));

vi.mock("./auth-context", () => ({
  useAuth: () => ({
    account: {
      user_id: "student_temp",
      username: "student_temp",
      display_name: "临时密码学生",
      account_status: "active",
      roles: ["student"],
      auth_source: "local_development",
      account_origin: "registered",
      data_boundary: "local_account",
      must_change_password: true,
      created_at: "2026-08-19T00:00:00.000Z",
      updated_at: "2026-08-19T00:00:00.000Z",
      last_login_at: null,
    },
    changePassword: changePasswordMock,
  }),
}));

import { AccountPage } from "./account-page";

function LoginDestination() {
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  return <>{notice === "password_changed" ? <p role="status">密码已更新</p> : null}<p>login destination</p></>;
}

describe("AccountPage password-change completion", () => {
  it("keeps a single main landmark and skip-link target when embedded in the student shell", async () => {
    render(<MemoryRouter><main id="main-content"><AccountPage embedded /></main></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "首次登录，请先修改密码" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(document.querySelectorAll("#main-content")).toHaveLength(1);
  });
  beforeEach(() => {
    changePasswordMock.mockReset();
    changePasswordMock.mockResolvedValue({ user_id: "student_temp" });
    getAccountCourseScopeMock.mockReset();
    getAccountCourseScopeMock.mockResolvedValue({
      items: [{ course_id: "course_408_ds", course_code: "CS408-DS", title: "数据结构" }],
      visibility: "active_memberships_only",
    });
  });

  it("redirects to login with a visible one-time success notice", async () => {
    render(
      <MemoryRouter initialEntries={["/account/password"]}>
        <Routes>
          <Route path="/account/password" element={<AccountPage />} />
          <Route path="/login" element={<LoginDestination />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "TemporaryPassword123" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "NewStrongPassword456" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "NewStrongPassword456" } });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));

    expect(await screen.findByText("login destination")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("密码已更新");
    expect(changePasswordMock).toHaveBeenCalledWith({
      current_password: "TemporaryPassword123",
      new_password: "NewStrongPassword456",
      new_password_confirmation: "NewStrongPassword456",
    });
  });

  it("shows assigned courses without exposing membership implementation details", async () => {
    render(
      <MemoryRouter initialEntries={["/account/password"]}>
        <Routes><Route path="/account/password" element={<AccountPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("数据结构")).toBeInTheDocument();
    expect(screen.queryByText("教师仅可查看所带课程和班级的学习情况。")).not.toBeInTheDocument();
    expect(screen.queryByText(/active|匿名学习证据|数据边界|LOCAL DEMO/iu)).not.toBeInTheDocument();
    expect(getAccountCourseScopeMock).toHaveBeenCalledTimes(1);
  });

  it("accepts six-character replacement passwords in the browser", async () => {
    render(
      <MemoryRouter initialEntries={["/account/password"]}>
        <Routes><Route path="/account/password" element={<AccountPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("新密码")).toHaveAttribute("minlength", "6");
    expect(screen.getByLabelText("确认新密码")).toHaveAttribute("minlength", "6");
  });
});
