import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loginMock = vi.hoisted(() => vi.fn());
const getOnboardingStateMock = vi.hoisted(() => vi.fn());
const consumeLoginNoticeMock = vi.hoisted(() => vi.fn());

vi.mock("./auth-context", () => ({
  useAuth: () => ({
    isProviderMounted: true,
    login: loginMock,
    loginNotice: null,
    consumeLoginNotice: consumeLoginNoticeMock,
  }),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  getStudentOnboardingState: getOnboardingStateMock,
}));

import { LoginPage } from "./login-page";

function LocationStateProbe() {
  const location = useLocation();
  return <div data-testid="location-state">{JSON.stringify(location.state)}</div>;
}

function renderLogin(initialEntry: string | { pathname: string; state?: unknown } = "/login") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<><LoginPage /><LocationStateProbe /></>} />
        <Route path="/student/onboarding" element={<p>student onboarding</p>} />
        <Route path="/student/home" element={<p>student home</p>} />
        <Route path="/admin" element={<p>admin governance</p>} />
        <Route path="/account/password" element={<p>required password change</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function submitLogin() {
  fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "student" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Password1234" } });
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
}

describe("account LoginPage onboarding routing", () => {
  beforeEach(() => {
    loginMock.mockReset();
    getOnboardingStateMock.mockReset();
    consumeLoginNoticeMock.mockReset();
  });

  it("routes an incomplete student straight to home while onboarding is skipped", async () => {
    loginMock.mockResolvedValue({ user_id: "student_new", roles: ["student"] });
    getOnboardingStateMock.mockResolvedValue({ status: "in_progress" });
    renderLogin();
    submitLogin();

    expect(await screen.findByText("student home")).toBeInTheDocument();
    expect(getOnboardingStateMock).not.toHaveBeenCalled();
  });

  it("uses browser-friendly names for the account fields", () => {
    renderLogin();

    expect(screen.getByLabelText("用户名")).toHaveAttribute("name", "username");
    expect(screen.getByLabelText("用户名")).toHaveAttribute("spellcheck", "false");
    expect(screen.getByLabelText("密码")).toHaveAttribute("name", "password");
  });

  it("submits login only once while authentication is pending", async () => {
    let resolveLogin: ((value: { user_id: string; roles: ["admin"] }) => void) | undefined;
    loginMock.mockReturnValue(new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    renderLogin();
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "admin_local" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Password1234" } });
    const form = screen.getByRole("button", { name: "登录" }).closest("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "正在登录…" })).toBeDisabled();
    fireEvent.submit(form!);
    expect(loginMock).toHaveBeenCalledTimes(1);

    resolveLogin?.({ user_id: "admin_001", roles: ["admin"] });
    expect(await screen.findByText("admin governance")).toBeInTheDocument();
  });

  it("keeps a migrated completed student on the existing home route", async () => {
    loginMock.mockResolvedValue({ user_id: "student_existing", roles: ["student"] });
    getOnboardingStateMock.mockResolvedValue({ status: "completed" });
    renderLogin();
    submitLogin();

    expect(await screen.findByText("student home")).toBeInTheDocument();
  });

  it("leaves the administrator route and onboarding service untouched", async () => {
    loginMock.mockResolvedValue({ user_id: "admin_001", roles: ["admin"] });
    renderLogin();
    submitLogin();

    expect(await screen.findByText("admin governance")).toBeInTheDocument();
    expect(getOnboardingStateMock).not.toHaveBeenCalled();
  });

  it("routes a temporary-password account to the required password change", async () => {
    loginMock.mockResolvedValue({
      user_id: "student_temp",
      roles: ["student"],
      must_change_password: true,
    });
    renderLogin();
    submitLogin();

    expect(await screen.findByText("required password change")).toBeInTheDocument();
    expect(getOnboardingStateMock).not.toHaveBeenCalled();
  });

  it("shows a password-change notice once and removes it from navigation state", async () => {
    renderLogin({
      pathname: "/login",
      state: { notice: "password_changed" },
    });

    expect(screen.getByRole("status")).toHaveTextContent("密码已更新");
    expect(await screen.findByTestId("location-state")).toHaveTextContent("null");
    expect(consumeLoginNoticeMock).toHaveBeenCalledOnce();
  });
});
