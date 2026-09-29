import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getLearningProfile: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { ProfilePage } from "./profile-page";

describe("ProfilePage", () => {
  beforeEach(() => {
    apiMocks.getLearningProfile.mockReset();
    apiMocks.getLearningProfile.mockResolvedValue({
      course_id: "course_ds_001",
      updated_at: "2026-07-22T09:30:00Z",
      evidence_count: 9,
      dimensions: [
        {
          key: "conceptual_understanding",
          label: "概念理解",
          score: 82,
          summary: "能够解释 BFS 的分层访问机制。",
          evidence_count: 4,
        },
        {
          key: "code_implementation",
          label: "代码实现",
          score: 61,
          summary: "访问状态维护仍不稳定。",
          evidence_count: 3,
        },
        {
          key: "transfer_application",
          label: "迁移应用",
          score: null,
          summary: "等待独立验证结果。",
          evidence_count: 2,
        },
      ],
      trend: [
        { date: "2026-07-18", score: 56 },
        { date: "2026-07-22", score: 68 },
      ],
    });
  });

  it("shows evidence-based ability dimensions without ranking the student", async () => {
    render(<ProfilePage />);

    expect(await screen.findByRole("heading", { name: "学习档案" })).toBeInTheDocument();
    expect(screen.getByText("概念理解")).toBeInTheDocument();
    expect(screen.getByText("证据 9 条")).toBeInTheDocument();
    expect(screen.getByText("证据不足")).toBeInTheDocument();
    expect(screen.queryByText("班级排名")).not.toBeInTheDocument();
  });
});
