import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentPanel } from "./agent-panel";

function renderPanel(events: Array<Record<string, unknown>>, onRetry = vi.fn()) {
  render(
    <AgentPanel
      diagnosis={null}
      sources={[]}
      events={events as never[]}
      loading={false}
      {...({ onRetry } as Record<string, unknown>)}
    />,
  );
  return onRetry;
}

describe("AgentPanel degradation states", () => {
  it("does not show implementation-origin labels in the student diagnosis", () => {
    renderPanel([]);

    expect(screen.queryByText("AI 生成")).not.toBeInTheDocument();
  });

  it("offers objective evidence when RAG returns no sources", () => {
    renderPanel([
      {
        run_id: "run_001",
        sequence: 3,
        type: "retrieval.completed",
        payload: { citation_ids: [], confidence_level: "low", degraded: true },
      },
    ]);

    expect(screen.getByText("暂时没有匹配的课程内容")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看运行结果" })).toHaveAttribute(
      "href",
      "#evidence-heading",
    );
  });

  it("labels low-confidence retrieval separately from an empty result", () => {
    renderPanel([
      {
        run_id: "run_002",
        sequence: 3,
        type: "retrieval.completed",
        payload: {
          citation_ids: ["source_ds_book_143"],
          confidence_level: "low",
          degraded: true,
        },
      },
    ]);

    expect(screen.getByText("课程内容需要核对")).toBeInTheDocument();
    expect(screen.queryByText(/置信度/u)).not.toBeInTheDocument();
    expect(screen.queryByText("暂时没有匹配的课程内容")).not.toBeInTheDocument();
  });

  it("lets the student retry after an Agent timeout", () => {
    const retry = renderPanel([
      {
        run_id: "run_003",
        sequence: 3,
        type: "run.failed",
        payload: { error: { code: "AGENT_TIMEOUT", retryable: true } },
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "重新诊断" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
