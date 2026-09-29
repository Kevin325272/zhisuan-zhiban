import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getAbilityAssessment: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { AbilityPage } from "./ability-page";

const assessment = {
  student_id: "student_demo_001",
  major: "计算机科学与技术",
  course_id: "course_ds_001",
  overall_score: 68,
  confidence: 86,
  evidence_count: 27,
  updated_at: "2026-07-23T10:30:00.000Z",
  dimensions: [
    {
      key: "knowledge_understanding",
      label: "知识理解",
      score: 82,
      target_score: 85,
      trend_delta: 6,
      evidence_count: 6,
      summary: "能够准确解释核心概念。",
      recommendation: "补充复杂场景辨析。",
    },
    {
      key: "algorithmic_thinking",
      label: "算法思维",
      score: 74,
      target_score: 80,
      trend_delta: 4,
      evidence_count: 5,
      summary: "能够拆解常见算法流程。",
      recommendation: "加强复杂度比较。",
    },
    {
      key: "code_implementation",
      label: "代码实现",
      score: 61,
      target_score: 78,
      trend_delta: -2,
      evidence_count: 4,
      summary: "基础结构能够独立完成。",
      recommendation: "练习边界处理。",
    },
    {
      key: "debugging_diagnosis",
      label: "调试诊断",
      score: 68,
      target_score: 76,
      trend_delta: 8,
      evidence_count: 4,
      summary: "开始形成证据驱动的定位习惯。",
      recommendation: "先记录状态再修改代码。",
    },
    {
      key: "system_thinking",
      label: "系统思维",
      score: 56,
      target_score: 72,
      trend_delta: 2,
      evidence_count: 3,
      summary: "能够识别局部模块关系。",
      recommendation: "补齐复杂系统建模。",
    },
    {
      key: "transfer_application",
      label: "迁移应用",
      score: 64,
      target_score: 75,
      trend_delta: 5,
      evidence_count: 5,
      summary: "能够迁移到相邻题型。",
      recommendation: "增加陌生情境训练。",
    },
  ],
};

describe("AbilityPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMocks.getAbilityAssessment.mockReset();
    apiMocks.getAbilityAssessment.mockResolvedValue(assessment);
  });

  it("presents an evidence-backed six-dimensional ability workspace", async () => {
    render(
      <MemoryRouter>
        <AbilityPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "能力评估" }),
    ).toBeInTheDocument();
    expect(screen.getByText("综合能力 68")).toBeInTheDocument();
    expect(screen.getByText("当前能力")).toBeInTheDocument();
    expect(screen.getByText("目标水平")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "六维专业能力雷达图" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(7);
    expect(screen.getByText("代码实现短期回落")).toBeInTheDocument();
    expect(screen.getAllByText("-2").length).toBeGreaterThan(0);
    expect(screen.queryByText("+-2")).not.toBeInTheDocument();
  });

  it("opens the selected dimension diagnosis and its evidence route", async () => {
    render(
      <MemoryRouter>
        <AbilityPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "能力评估" });
    fireEvent.click(
      screen.getByRole("button", { name: "查看调试诊断能力" }),
    );

    expect(
      screen.getByRole("heading", { name: "调试诊断" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("调试诊断当前得分")).toHaveTextContent("68");
    expect(screen.getByText("目标 76")).toBeInTheDocument();
    expect(screen.getByText("4 条证据")).toBeInTheDocument();
    expect(screen.getByText("先记录状态再修改代码。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看学习证据" })).toHaveAttribute(
      "href",
      "/student/evidence",
    );
  });

  it("calibrates a first learning goal and keeps evidence scores separate from targets", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <AbilityPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "能力评估" });
    fireEvent.click(screen.getByRole("button", { name: "开始首次诊断" }));
    fireEvent.click(screen.getByRole("radio", { name: "能复述主要过程" }));
    fireEvent.click(screen.getByRole("radio", { name: "基本能完成但边界易错" }));
    fireEvent.click(screen.getByRole("radio", { name: "换一种题型就会卡住" }));
    fireEvent.click(screen.getByRole("button", { name: /^编程实战/ }));
    fireEvent.click(screen.getByRole("button", { name: "每周 6 小时" }));
    fireEvent.click(screen.getByRole("button", { name: "生成我的能力基线" }));

    expect(screen.getByRole("status", { name: "个性化目标" })).toHaveTextContent(
      "个性化目标已启用",
    );
    expect(screen.getByRole("status", { name: "个性化目标" })).toHaveTextContent(
      "编程实战",
    );
    expect(screen.getByRole("status", { name: "个性化目标" })).toHaveTextContent(
      "每周 6 小时",
    );
    fireEvent.click(screen.getByRole("button", { name: "查看代码实现能力" }));
    expect(screen.getByLabelText("代码实现当前得分")).toHaveTextContent("61");
    expect(screen.getByText("目标 85")).toBeInTheDocument();

    unmount();
    render(
      <MemoryRouter>
        <AbilityPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("status", { name: "个性化目标" })).toHaveTextContent(
      "编程实战",
    );
  });
});
