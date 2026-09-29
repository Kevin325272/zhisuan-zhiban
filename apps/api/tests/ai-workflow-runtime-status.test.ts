import { describe, expect, it } from "vitest";

import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  type AiWorkflowResponse,
} from "@xuetu/contracts";

import { AiWorkflowRuntimeStatusTracker } from "../src/services/ai-workflow/runtime-status.js";

function readyDiagnose(): AiWorkflowResponse {
  return {
    contract_version: "0.2",
    request_id: "workflow_runtime_001",
    capability: "diagnose",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
    status: "ready",
    display_blocks: [{
      block_id: "workflow_runtime_feedback",
      kind: "feedback",
      title: "错因反馈",
      content: "需要重新区分两个概念。",
    }, {
      block_id: "workflow_runtime_hint",
      kind: "hint",
      title: "下一步提示",
      content: "先回顾当前知识点定义。",
    }],
    citations: [{
      citation_id: "workflow_runtime_citation",
      source_chunk_id: "synthetic_chunk_001",
      label: "合成联调来源",
      locator: null,
    }],
    evidence_refs: [],
    next_actions: [{
      action_id: "workflow_runtime_action",
      kind: "continue_learning",
      label: "继续复习",
      target: null,
    }],
    failure: null,
  };
}

describe("AI workflow runtime status tracker", () => {
  it("keeps runtime health isolated by capability", () => {
    const tracker = new AiWorkflowRuntimeStatusTracker();

    tracker.record(readyDiagnose());

    expect(tracker.status("diagnose")).toMatchObject({ state: "available" });
    for (const capability of ["plan", "explain", "coach"] as const) {
      expect(tracker.status(capability)).toMatchObject({
        state: "configured",
        checked_at: null,
      });
    }
  });

  it("expires observed health back to configured", () => {
    let now = Date.parse("2026-08-20T06:00:00.000Z");
    const tracker = new AiWorkflowRuntimeStatusTracker({
      ttlMs: 1_000,
      now: () => now,
    });

    tracker.record(readyDiagnose());
    expect(tracker.status("diagnose")).toMatchObject({
      state: "available",
      checked_at: "2026-08-20T06:00:00.000Z",
    });

    now += 1_001;
    expect(tracker.status("diagnose")).toMatchObject({
      state: "configured",
      checked_at: null,
    });
  });
});
