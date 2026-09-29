import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  activateStudentLearningTask: vi.fn(),
  completeStudentLearningTask: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { useStudentTaskProgress } from "./student-task-progress";

describe("useStudentTaskProgress", () => {
  beforeEach(() => {
    apiMocks.activateStudentLearningTask.mockReset();
    apiMocks.completeStudentLearningTask.mockReset();
  });

  it("activates a task and settles it through the server-owned evidence API", async () => {
    apiMocks.activateStudentLearningTask.mockResolvedValue({
      task_id: "live_practice_ds_c01",
      activated_at: "2026-08-13T08:00:00.000Z",
      idempotent: false,
    });
    apiMocks.completeStudentLearningTask.mockResolvedValue({
      task_id: "live_practice_ds_c01",
      completed_at: "2026-08-13T08:05:00.000Z",
      evidence_refs: ["evidence:e1"],
      idempotent: false,
      next_task_id: "live_read_co_c01",
      settlement: {
        version: "challenge_settlement_v1",
        task_type: "choice_practice",
        course_id: "course_408_ds",
        course_title: "数据结构",
        concept_id: "ds_c01",
        concept_title: "算法复杂度",
        outcome: "correct",
        result_title: "本关已完成",
        result_detail: "本次选择题已按题库标准答案完成确定性判分。",
        evidence_update: { added_count: 1, objective_total: 2, summary: "新增 1 次确定性选择题作答。" },
        profile_update: {
          kind: "practice_correct",
          title: "算法复杂度新增一次正确作答",
          detail: "本次结果已计入画像，仍需后续证据观察是否稳定掌握。",
        },
        review_update: {
          status: "not_required",
          mistake_id: null,
          next_review_at: null,
          summary: "本次正确作答未新增待复习记录。",
        },
        plan_progress: { tracked: true, completed_task_count: 1, total_task_count: 7, completion_percent: 14 },
        next_task: {
          task_id: "live_read_co_c01",
          task_type: "course_reading",
          title: "继续组成原理课程学习",
          reason: "按当前七日路径继续下一项任务。",
          estimated_minutes: 20,
          href: "/student/courses/computer-organization",
          course_id: "course_408_co",
          concept_id: "co_c01",
        },
      },
    });

    const { result } = renderHook(() => useStudentTaskProgress("live_practice_ds_c01"));
    await waitFor(() => expect(result.current.status).toBe("active"));

    let completion: unknown;
    await act(async () => {
      completion = await result.current.complete();
    });

    expect(apiMocks.activateStudentLearningTask).toHaveBeenCalledWith("live_practice_ds_c01");
    expect(apiMocks.completeStudentLearningTask).toHaveBeenCalledWith("live_practice_ds_c01");
    expect(result.current.status).toBe("completed");
    expect(completion).toMatchObject({ next_task_id: "live_read_co_c01" });
  });

  it("does not call the server when a page has no orchestration task", async () => {
    const { result } = renderHook(() => useStudentTaskProgress(null));
    expect(result.current.status).toBe("idle");
    await act(async () => { await result.current.complete(); });
    expect(apiMocks.activateStudentLearningTask).not.toHaveBeenCalled();
    expect(apiMocks.completeStudentLearningTask).not.toHaveBeenCalled();
  });
});
