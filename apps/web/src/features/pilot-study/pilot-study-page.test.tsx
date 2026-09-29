import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PilotStudentStudy, PilotTask } from "@xuetu/contracts";

const apiMocks = vi.hoisted(() => ({
  getPilotStudy: vi.fn(),
  recordPilotConsent: vi.fn(),
  startPilotTask: vi.fn(),
  completePilotTask: vi.fn(),
  submitPilotFeedback: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { PilotStudyPage } from "./pilot-study-page";

const taskDefinitions = [
  {
    task_id: "pilot_task_baseline",
    ordinal: 1,
    stage: "baseline" as const,
    evidence_kind: "verified_choice_attempt" as const,
    title: "独立完成基线题",
    instructions: "独立作答，不使用平台讲解。",
    course_id: "course_408_ds",
    concept_id: "ds_c03_02",
    question_id: "2010-02",
    href: "/student/practice?subject=数据结构&concept_id=ds_c03_02&question_id=2010-02",
    assistance_policy: "independent" as const,
  },
  {
    task_id: "pilot_task_guided",
    ordinal: 2,
    stage: "guided" as const,
    evidence_kind: "verified_course_reading" as const,
    title: "阅读队列概念讲解",
    instructions: "展开课程来源并完成阅读。",
    course_id: "course_408_ds",
    concept_id: "ds_c03_02",
    question_id: null,
    href: "/student/courses/data-structures?concept_id=ds_c03_02",
    assistance_policy: "platform_guidance" as const,
  },
  {
    task_id: "pilot_task_transfer",
    ordinal: 3,
    stage: "transfer" as const,
    evidence_kind: "verified_choice_attempt" as const,
    title: "独立完成迁移题",
    instructions: "独立作答迁移题。",
    course_id: "course_408_ds",
    concept_id: "ds_c03_02",
    question_id: "2021-02",
    href: "/student/practice?subject=数据结构&concept_id=ds_c03_02&question_id=2021-02",
    assistance_policy: "independent" as const,
  },
];

function task(index: number, status: PilotTask["status"]): PilotTask {
  const definition = taskDefinitions[index]!;
  const completed = status === "completed";
  const started = status === "started" || completed;
  return {
    ...definition,
    status,
    started_at: started ? `2026-08-22T10:0${index}:00.000Z` : null,
    completed_at: completed ? `2026-08-22T10:0${index + 1}:00.000Z` : null,
    result: completed
      ? {
          outcome: definition.evidence_kind === "verified_course_reading" ? "read" : "correct",
          score: definition.evidence_kind === "verified_course_reading" ? null : 100,
          grading_mode: definition.evidence_kind === "verified_course_reading"
            ? "course_reading"
            : "deterministic_choice",
          evidence_at: `2026-08-22T10:0${index + 1}:00.000Z`,
        }
      : null,
  };
}

function enrolled(
  statuses: PilotTask["status"][],
  options: { consented?: boolean; feedback?: boolean } = {},
): PilotStudentStudy {
  return {
    kind: "enrolled",
    study: {
      study_id: "pilot_408_queue_v1",
      title: "队列知识点三阶段试用",
      notice_version: "pilot_notice_v1",
      notice_text: "本次试用记录匿名编号、任务状态、作答结果与自愿反馈。",
    },
    participant: {
      participant_code: "P001",
      role_label: "2023级计算机科学与技术专业学生",
      participant_kind: "real_trial",
      consent_notice_version: options.consented ? "pilot_notice_v1" : null,
      consented_at: options.consented ? "2026-08-22T10:00:00.000Z" : null,
      baseline_confidence: options.consented ? 3 : null,
      completed_at: statuses.every((status) => status === "completed")
        ? "2026-08-22T10:10:00.000Z"
        : null,
    },
    tasks: statuses.map((status, index) => task(index, status)),
    feedback: options.feedback
      ? {
          ease_of_use: 4,
          guidance_helpfulness: 4,
          confidence_after: 4,
          continued_use_intent: 4,
          open_feedback: "流程清楚。",
          submitted_at: "2026-08-22T10:12:00.000Z",
        }
      : null,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/student/pilot-study"]}>
      <PilotStudyPage />
    </MemoryRouter>,
  );
}

describe("PilotStudyPage", () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
  });

  it("shows an honest non-enrolled state without exposing another participant", async () => {
    apiMocks.getPilotStudy.mockResolvedValue({ kind: "not_enrolled" });
    renderPage();

    expect(await screen.findByRole("heading", { name: "当前账户尚未登记" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "这不是日常课程任务" })).toBeInTheDocument();
    expect(screen.getByText(/课程试点.*不是日常课程任务/)).toBeInTheDocument();
    expect(screen.getByText(/管理员登记.*匿名编号/)).toBeInTheDocument();
    expect(screen.getByText(/基线题.*引导阅读.*迁移题/)).toBeInTheDocument();
    expect(screen.getByText(/请联系现场管理员使用匿名编号登记/)).toBeInTheDocument();
    expect(screen.queryByText("P001")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "先看一个课程试点示例" })).toHaveAttribute(
      "href",
      "/student/pilot-study?pilot_preview=1",
    );
  });

  it("offers a local interactive preview without reading or writing pilot records", async () => {
    render(
      <MemoryRouter initialEntries={["/student/pilot-study?pilot_preview=1"]}>
        <PilotStudyPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "课程试点流程示例" })).toBeInTheDocument();
    expect(screen.queryByText(/不会写入|数据边界|接口|模型/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续下一步" }));
    expect(screen.getByRole("heading", { name: "引导阅读" })).toBeInTheDocument();
    expect(apiMocks.getPilotStudy).not.toHaveBeenCalled();
    expect(apiMocks.startPilotTask).not.toHaveBeenCalled();
    expect(apiMocks.completePilotTask).not.toHaveBeenCalled();
  });

  it("records explicit consent and baseline confidence before unlocking task one", async () => {
    apiMocks.getPilotStudy.mockResolvedValue(enrolled(["locked", "locked", "locked"]));
    apiMocks.recordPilotConsent.mockResolvedValue(
      enrolled(["ready", "locked", "locked"], { consented: true }),
    );
    renderPage();

    expect(await screen.findByText("本次试用记录匿名编号、任务状态、作答结果与自愿反馈。")).toBeInTheDocument();
    expect(screen.getByText("408 · 课程试点")).toBeInTheDocument();
    expect(screen.getByText(/课程试点流程只用于观察可用性与任务变化/)).toBeInTheDocument();
    expect(screen.getByText("未解锁")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "同意参加本次课程试点" }));
    fireEvent.click(screen.getByRole("radio", { name: "3 分" }));
    fireEvent.click(screen.getByRole("button", { name: "同意并开始课程试点" }));

    await waitFor(() => expect(apiMocks.recordPilotConsent).toHaveBeenCalledWith({
      accepted: true,
      notice_version: "pilot_notice_v1",
      baseline_confidence: 3,
    }));
    expect(await screen.findByRole("button", { name: "开始独立完成基线题" })).toBeInTheDocument();
    expect(screen.getByText("等待前序任务")).toBeInTheDocument();
  });

  it("records reading completion and only then unlocks the transfer task", async () => {
    apiMocks.getPilotStudy.mockResolvedValue(
      enrolled(["completed", "started", "locked"], { consented: true }),
    );
    apiMocks.completePilotTask.mockResolvedValue(
      enrolled(["completed", "completed", "ready"], { consented: true }),
    );
    renderPage();

    expect(await screen.findByText("完成指定阅读位置")).toBeInTheDocument();
    const page = screen.getByText("完成指定阅读位置").closest(".pilot-study-page");
    expect(page).not.toHaveTextContent(/PostgreSQL|API|服务端|确定性|来源曝光|证据核验/iu);
    fireEvent.click(await screen.findByRole("button", { name: "记录阅读完成" }));

    await waitFor(() => expect(apiMocks.completePilotTask).toHaveBeenCalledWith(
      "pilot_task_guided",
      {},
    ));
    expect(await screen.findByRole("button", { name: "开始独立完成迁移题" })).toBeInTheDocument();
  });

  it("shows the current notice again when a participant consented to an old version", async () => {
    const stale = enrolled(["locked", "locked", "locked"], { consented: true });
    if (stale.kind !== "enrolled") throw new Error("test fixture must be enrolled");
    stale.participant.consent_notice_version = "pilot_notice_old";
    apiMocks.getPilotStudy.mockResolvedValue(stale);
    renderPage();

    expect(await screen.findByRole("heading", { name: "阅读知情说明" })).toBeInTheDocument();
    expect(screen.getByText("知情说明版本已更新，请重新确认当前版本。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始独立完成基线题" })).not.toBeInTheDocument();
  });

  it("collects bounded final feedback with a clear personal-data warning", async () => {
    const completed = enrolled(["completed", "completed", "completed"], { consented: true });
    apiMocks.getPilotStudy.mockResolvedValue(completed);
    apiMocks.submitPilotFeedback.mockResolvedValue({
      ...completed,
      feedback: {
        ease_of_use: 4,
        guidance_helpfulness: 5,
        confidence_after: 4,
        continued_use_intent: 4,
        open_feedback: "讲解后迁移题更容易定位约束。",
        submitted_at: "2026-08-22T10:12:00.000Z",
      },
    });
    renderPage();

    expect(await screen.findByText("请勿填写姓名、学号、联系方式或密钥。"))
      .toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("流程易用性"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("讲解帮助程度"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("完成后的信心"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("继续使用意愿"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("补充反馈"), {
      target: { value: "讲解后迁移题更容易定位约束。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交匿名反馈" }));

    await waitFor(() => expect(apiMocks.submitPilotFeedback).toHaveBeenCalledWith({
      ease_of_use: 4,
      guidance_helpfulness: 5,
      confidence_after: 4,
      continued_use_intent: 4,
      open_feedback: "讲解后迁移题更容易定位约束。",
    }));
    expect(await screen.findByText("反馈已记录")) .toBeInTheDocument();
  });
});
