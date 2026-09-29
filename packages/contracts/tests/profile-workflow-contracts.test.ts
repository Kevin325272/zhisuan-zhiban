import { describe, expect, it } from "vitest";

import {
  studentProfileWorkflowRequestSchema,
  studentProfileWorkflowResponseSchema,
} from "../src/index.js";

const readyResponse = {
  contract_version: "0.2",
  request_id: "profile_workflow_001",
  status: "ready",
  profile_summary: "你的作答证据正在形成，组成原理是当前优先补强方向。",
  course_progress: [{
    course_id: "course_408_co",
    course_title: "计算机组成原理",
    evidence_level: "limited",
    concept_count: 20,
    started_concept_count: 4,
    practice_attempt_count: 3,
    correct_count: 1,
    incorrect_count: 2,
    needs_review_count: 1,
  }],
  strengths: [{
    course_id: "course_408_co",
    title: "课程阅读已启动",
    detail: "你已经开始建立组成原理的知识覆盖。",
    evidence_ids: ["reading_course_408_co"],
  }],
  priority_gaps: [{
    course_id: "course_408_co",
    title: "地址寄存器概念需要复习",
    detail: "最近的确定性评测显示这个方向仍需巩固。",
    evidence_ids: ["evidence_001"],
  }],
  evidence_summary: {
    objective_evidence_count: 3,
    subjective_evidence_count: 4,
    reading_progress_count: 1,
    practice_attempt_count: 3,
    needs_review_count: 1,
    explanation: "画像只依据平台内真实学习记录和学习设置。",
  },
  next_tasks: [{
    title: "复习地址寄存器",
    reason: "先处理当前待复习证据，再继续下一知识点。",
    course_id: "course_408_co",
    concept_id: "co_c01_01",
    estimated_minutes: 20,
    evidence_ids: ["evidence_001"],
  }],
  failure: null,
} as const;

describe("student profile workflow contracts", () => {
  it("requires an explicit 408 course scope for a requested interpretation", () => {
    expect(studentProfileWorkflowRequestSchema.parse({ course_id: "course_408_co" })).toEqual({
      course_id: "course_408_co",
    });
    expect(() => studentProfileWorkflowRequestSchema.parse({ course_id: "course_unknown" })).toThrow();
  });

  it("accepts a ready response while keeping deterministic course evidence explicit", () => {
    const parsed = studentProfileWorkflowResponseSchema.parse(readyResponse);

    expect(parsed.status).toBe("ready");
    expect(parsed.course_progress[0]?.course_id).toBe("course_408_co");
    expect(parsed.next_tasks[0]?.estimated_minutes).toBe(20);
  });

  it("represents unavailable profile work without pretending the portrait is empty", () => {
    const parsed = studentProfileWorkflowResponseSchema.parse({
      ...readyResponse,
      status: "unavailable",
      profile_summary: "AI 画像解读暂不可用，确定性画像仍可查看。",
      strengths: [],
      priority_gaps: [],
      next_tasks: [],
      failure: {
        code: "WORKFLOW_NOT_CONNECTED",
        message: "画像工作流尚未连接。",
        retryable: true,
        fallback_message: "雷达图、证据和课程入口仍可继续使用。",
      },
    });

    expect(parsed.failure?.code).toBe("WORKFLOW_NOT_CONNECTED");
    expect(parsed.course_progress).toHaveLength(1);
  });

  it("rejects internal credentials or upstream-only fields from the student DTO", () => {
    expect(() => studentProfileWorkflowResponseSchema.parse({
      ...readyResponse,
      secret: "server-only-secret",
      workflow_run_id: "upstream-run",
    })).toThrow();
  });
});
