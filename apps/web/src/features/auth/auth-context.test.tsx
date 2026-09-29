import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  loginAccount: vi.fn(),
  logoutAccount: vi.fn(),
  registerAccount: vi.fn(),
  registerStudentAccount: vi.fn(),
  changeAccountPassword: vi.fn(),
}));
const ownerMocks = vi.hoisted(() => ({
  setLearningOutputOwner: vi.fn(),
  setCodeDraftOwner: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));
vi.mock("../../lib/learning-output-store", () => ({
  setLearningOutputOwner: ownerMocks.setLearningOutputOwner,
}));
vi.mock("../../lib/code-draft-store", () => ({
  setCodeDraftOwner: ownerMocks.setCodeDraftOwner,
}));

import { ApiError } from "../../api/client";
import { AuthProvider, useAuth } from "./auth-context";

const account = {
  user_id: "student_a",
  username: "student_a",
  display_name: "学生 A",
  account_status: "active" as const,
  roles: ["student" as const],
  auth_source: "local_development" as const,
  account_origin: "registered" as const,
  data_boundary: "local_account" as const,
  must_change_password: false,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  last_login_at: null,
};

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="account">{auth.account?.user_id ?? "none"}</span>
      <span data-testid="error">{auth.error ?? "none"}</span>
      <button onClick={() => void auth.refresh()} type="button">刷新会话</button>
      <button onClick={() => void auth.logout()} type="button">退出登录</button>
      <button onClick={() => void auth.register({
        role: "teacher",
        username: "teacher_apply_01",
        display_name: "申请教师",
        password: "StrongPassword123",
        password_confirmation: "StrongPassword123",
      })} type="button">提交教师申请</button>
    </div>
  );
}

describe("AuthProvider session refresh", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    Object.values(ownerMocks).forEach((mock) => mock.mockReset());
    apiMocks.getAuthSession.mockResolvedValue({ account });
  });

  it("retains exam drafts on refresh and removes them on logout", async () => {
    const key = "xuetu.mock-exam-draft.v1:student_a";
    window.sessionStorage.setItem(key, "draft");
    window.sessionStorage.setItem("unrelated-setting", "keep");
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(window.sessionStorage.getItem(key)).toBe("draft");
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(window.sessionStorage.getItem("unrelated-setting")).toBe("keep");
  });

  it("uses the optional session lookup during provider initialization", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(apiMocks.getAuthSession).toHaveBeenCalledWith({ optional: true });
  });

  it("preserves the authenticated account when a refresh fails transiently", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    apiMocks.getAuthSession.mockRejectedValueOnce(new Error("network offline"));

    fireEvent.click(screen.getByRole("button", { name: "刷新会话" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("network offline"));

    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("account")).toHaveTextContent("student_a");
  });

  it("clears the account only when the server explicitly rejects the session", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    apiMocks.getAuthSession.mockRejectedValueOnce(
      new ApiError("请先登录", "AUTHENTICATION_REQUIRED", false, {}),
    );

    fireEvent.click(screen.getByRole("button", { name: "刷新会话" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));

    expect(screen.getByTestId("account")).toHaveTextContent("none");
    expect(ownerMocks.setCodeDraftOwner).toHaveBeenLastCalledWith(null);
  });

  it("does not authenticate a pending teacher registration", async () => {
    apiMocks.getAuthSession.mockRejectedValueOnce(
      new ApiError("请先登录", "AUTHENTICATION_REQUIRED", false, {}),
    );
    const result = {
      account: {
        ...account,
        user_id: "teacher_pending",
        username: "teacher_apply_01",
        display_name: "申请教师",
        account_status: "pending_approval" as const,
        roles: ["teacher" as const],
      },
      authenticated: false,
      next_step: "await_teacher_approval" as const,
    };
    apiMocks.registerAccount.mockResolvedValue(result);
    apiMocks.registerStudentAccount.mockResolvedValue(result);

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    fireEvent.click(screen.getByRole("button", { name: "提交教师申请" }));

    await waitFor(() => expect(apiMocks.registerAccount).toHaveBeenCalledOnce());
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("account")).toHaveTextContent("none");
  });
});
