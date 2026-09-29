import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getStateMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  getStudentOnboardingState: getStateMock,
}));

vi.mock("../auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

import { StudentOnboardingGate } from "./student-onboarding-gate";

function renderGate() {
  return render(
    <MemoryRouter initialEntries={["/student/home"]}>
      <Routes>
        <Route path="/student/onboarding" element={<p>onboarding route</p>} />
        <Route
          path="/student/home"
          element={(
            <StudentOnboardingGate>
              <p>student home</p>
            </StudentOnboardingGate>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const completedState = {
  status: "completed",
  goals: { target_exam_year: 2027 },
  profile: { profile_id: "profile_001" },
  plan: { tasks: [{ task_id: "task_001" }] },
};

describe("StudentOnboardingGate", () => {
  beforeEach(() => {
    getStateMock.mockReset();
    useAuthMock.mockReturnValue({
      isProviderMounted: true,
      account: { user_id: "student_new", roles: ["student"] },
      status: "authenticated",
    });
  });

  // 本地复现实例缺少筛查题库数据，SKIP_ONBOARDING=true：门控整体放行且不查询状态接口。
  // 数据补齐、开关改回 false 后，需恢复下方被跳过场景的原始断言（加载/未完成/错误边界）。
  it("lets a student straight in without querying while onboarding is skipped", () => {
    getStateMock.mockReturnValue(new Promise(() => undefined));

    renderGate();

    expect(screen.getByText("student home")).toBeInTheDocument();
    expect(getStateMock).not.toHaveBeenCalled();
  });

  it("lets an incomplete student continue while onboarding is skipped", async () => {
    getStateMock.mockResolvedValueOnce({ status: "in_progress" });

    renderGate();

    expect(await screen.findByText("student home")).toBeInTheDocument();
    expect(screen.queryByText("onboarding route")).not.toBeInTheDocument();
    expect(getStateMock).not.toHaveBeenCalled();
  });

  it("lets a completed student continue while onboarding is skipped", async () => {
    getStateMock.mockResolvedValueOnce(completedState);

    renderGate();

    expect(await screen.findByText("student home")).toBeInTheDocument();
    expect(getStateMock).not.toHaveBeenCalled();
  });

  it("does not surface the onboarding error boundary while onboarding is skipped", async () => {
    getStateMock.mockRejectedValueOnce(new Error("network down"));

    renderGate();

    expect(await screen.findByText("student home")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getStateMock).not.toHaveBeenCalled();
  });

  it("does not query onboarding for a non-student role", () => {
    useAuthMock.mockReturnValue({
      isProviderMounted: true,
      account: { user_id: "admin_001", roles: ["admin"] },
      status: "authenticated",
    });

    renderGate();

    expect(screen.getByText("student home")).toBeInTheDocument();
    expect(getStateMock).not.toHaveBeenCalled();
  });
});
