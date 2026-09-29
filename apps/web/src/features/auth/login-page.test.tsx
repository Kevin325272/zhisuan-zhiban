import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { readDemoSession } from "./demo-session";
import { LoginPage } from "./login-page";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/student/home" element={<p>student course home</p>} />
        <Route path="/admin" element={<p>admin governance</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("presents one focused local demonstration identity flow", () => {
    const view = renderLogin();

    expect(view.container.querySelector("main")).toHaveAttribute("data-visual-system", "ochre-serif");
    expect(screen.getByRole("heading", { name: "进入智算智伴" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "选择身份" })).toBeInTheDocument();
    expect(screen.queryByText(/选择要演示/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "以学生身份进入课程首页" })).toBeInTheDocument();
  });

  it("keeps the entry screen focused on signing in instead of implementation explanations", () => {
    renderLogin();

    expect(screen.getByRole("heading", { name: "进入智算智伴" })).toBeInTheDocument();
    expect(screen.queryByText(/PostgreSQL|RBAC|数据边界|身份认证/)).not.toBeInTheDocument();
  });

  it("enters the student course home with the predefined student identity", () => {
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "以学生身份进入课程首页" }));

    expect(screen.getByText("student course home")).toBeInTheDocument();
    expect(readDemoSession()).toMatchObject({ role: "student", userId: "user_student_001" });
  });

  it("switches the same form to the administrator workspace", () => {
    renderLogin();
    fireEvent.click(screen.getByRole("radio", { name: "管理员" }));
    fireEvent.click(screen.getByRole("button", { name: "以管理员身份进入工作台" }));

    expect(screen.getByText("admin governance")).toBeInTheDocument();
    expect(readDemoSession()).toMatchObject({ role: "admin", userId: "user_admin_001" });
  });
});
