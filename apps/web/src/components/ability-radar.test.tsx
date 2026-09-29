import type {
  AbilityAssessmentDimension,
  AbilityAssessmentKey,
} from "@xuetu/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AbilityRadar } from "./ability-radar";

const dimensions: AbilityAssessmentDimension[] = [
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
    trend_delta: 3,
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
];

describe("AbilityRadar", () => {
  it("renders six dimensions with current and target polygons", () => {
    render(
      <AbilityRadar
        dimensions={dimensions}
        selectedKey="knowledge_understanding"
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "六维专业能力雷达图" }),
    ).toBeInTheDocument();
    expect(screen.getByText("知识理解")).toBeInTheDocument();
    expect(screen.getByText("迁移应用")).toBeInTheDocument();

    const current = screen.getByTestId("ability-current-polygon");
    const target = screen.getByTestId("ability-target-polygon");
    expect(current).toHaveAttribute("points");
    expect(target).toHaveAttribute("points");
    expect(current.getAttribute("points")).not.toBe(target.getAttribute("points"));
  });

  it("renders a compact non-interactive preview", () => {
    render(
      <AbilityRadar
        compact
        dimensions={dimensions}
        selectedKey="debugging_diagnosis"
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "六维能力雷达预览" }),
    ).toHaveAttribute("viewBox", "60 60 400 400");
    expect(
      screen.queryByRole("button", { name: "查看调试诊断能力" }),
    ).not.toBeInTheDocument();
  });

  it("selects a dimension through its vertex control", () => {
    const onSelect = vi.fn<(key: AbilityAssessmentKey) => void>();
    render(
      <AbilityRadar
        dimensions={dimensions}
        selectedKey="knowledge_understanding"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "查看调试诊断能力" }),
    );

    expect(onSelect).toHaveBeenCalledWith("debugging_diagnosis");
  });
});
