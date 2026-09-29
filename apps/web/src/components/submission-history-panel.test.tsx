import type { SubmissionHistoryItem } from "@xuetu/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SubmissionHistoryPanel } from "./submission-history-panel";

const older: SubmissionHistoryItem = {
  submission_id: "sub_001",
  task_id: "task_bfs_bug_001",
  sequence: 1,
  created_at: "2026-07-22T09:31:01.000Z",
  code: {
    language: "cpp",
    source: `pending.push(start);

while (!pending.empty()) {
  visited[current] = true;
  if (!visited[next]) {
    pending.push(next);
  }
}`,
  },
  evaluation: { passed_count: 2, total_count: 4, score: 50 },
  diagnosis_id: "diag_001",
};

const newer: SubmissionHistoryItem = {
  submission_id: "sub_002",
  task_id: "task_bfs_bug_001",
  sequence: 2,
  created_at: "2026-07-22T09:31:02.000Z",
  code: {
    language: "cpp",
    source: `pending.push(start);
visited[start] = true;

while (!pending.empty()) {
  if (!visited[next]) {
    visited[next] = true;
    pending.push(next);
  }
}`,
  },
  evaluation: { passed_count: 4, total_count: 4, score: 100 },
  diagnosis_id: null,
};

const pythonSubmission: SubmissionHistoryItem = {
  ...newer,
  submission_id: "sub_003",
  sequence: 3,
  code: {
    language: "python",
    source: "def bfs(graph, start):\n    return [start]",
  },
};

describe("SubmissionHistoryPanel", () => {
  it("shows a useful empty state before the first formal submission", () => {
    render(
      <SubmissionHistoryPanel language="cpp" items={[]} onRestore={() => undefined} />,
    );

    expect(screen.getByRole("heading", { name: "提交记录" })).toBeInTheDocument();
    expect(screen.getByText("尚无正式提交")).toBeInTheDocument();
  });

  it("compares the oldest and newest snapshots and restores the target", () => {
    const onRestore = vi.fn();
    render(
      <SubmissionHistoryPanel
        language="cpp"
        items={[pythonSubmission, newer, older]}
        onRestore={onRestore}
      />,
    );

    expect(screen.getByRole("combobox", { name: "基线版本" })).toHaveValue("sub_001");
    expect(screen.getByRole("combobox", { name: "目标版本" })).toHaveValue("sub_002");
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByText("2 次提交")).toBeInTheDocument();
    expect(screen.queryByText(/版本 03/)).not.toBeInTheDocument();
    expect(screen.getByText("新增 2")).toBeInTheDocument();
    expect(screen.getByText("删除 1")).toBeInTheDocument();
    const desktopDiff = within(screen.getByRole("table", { name: "双版本代码差异" }));
    const diffCells = desktopDiff.getAllByRole("cell");
    expect(diffCells.find((cell) => cell.textContent?.includes("visited[current] = true;")))
      .toHaveClass("removed");
    expect(diffCells.find((cell) => cell.textContent?.includes("visited[next] = true;")))
      .toHaveClass("added");
    expect(screen.getByRole("table", { name: "双版本代码差异" }).querySelector(".token.keyword"))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "恢复目标版本到编辑器" }));
    expect(onRestore).toHaveBeenCalledWith(newer);
  });

  it("allows switching the comparison direction", () => {
    render(
      <SubmissionHistoryPanel
        language="cpp"
        items={[newer, older]}
        onRestore={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "交换比较版本" }));
    expect(screen.getByRole("combobox", { name: "基线版本" })).toHaveValue("sub_002");
    expect(screen.getByRole("combobox", { name: "目标版本" })).toHaveValue("sub_001");
  });
});
