import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthAccount, PilotManagementReport } from "@xuetu/contracts";

const apiMocks = vi.hoisted(() => ({
  getPilotManagementReport: vi.fn(),
  enrollPilotParticipant: vi.fn(),
  downloadPilotReport: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { PilotStudyGovernance } from "./pilot-study-governance";

const accounts: AuthAccount[] = [
  {
    user_id: "user_student_001",
    username: "trial_student_01",
    display_name: "试用学生 01",
    account_status: "active",
    roles: ["student"],
    auth_source: "local_development",
    account_origin: "registered",
    data_boundary: "local_account",
    must_change_password: false,
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
    last_login_at: null,
  },
  {
    user_id: "user_admin_001",
    username: "admin_local",
    display_name: "管理员",
    account_status: "active",
    roles: ["admin"],
    auth_source: "local_development",
    account_origin: "seeded_admin",
    data_boundary: "local_account",
    must_change_password: false,
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
    last_login_at: null,
  },
];

function report(realParticipants = 0): PilotManagementReport {
  const hasReal = realParticipants > 0;
  return {
    study: {
      study_id: "pilot_408_queue_v1",
      title: "队列知识点三阶段试用",
      notice_version: "pilot_notice_v1",
      notice_text: "知情说明",
    },
    generated_at: "2026-08-22T10:00:00.000Z",
    data_scope: "real_and_synthetic",
    claim_boundary: "small_sample_observational",
    summary: {
      real_participants: realParticipants,
      synthetic_participants: 1,
      consented_real_participants: hasReal ? 1 : 0,
      completed_real_participants: hasReal ? 1 : 0,
      baseline_evaluated_count: hasReal ? 1 : 0,
      baseline_correct_count: 0,
      transfer_evaluated_count: hasReal ? 1 : 0,
      transfer_correct_count: hasReal ? 1 : 0,
      baseline_correct_rate: hasReal ? 0 : null,
      transfer_correct_rate: hasReal ? 100 : null,
      observed_change_percentage_points: hasReal ? 100 : null,
      average_completion_minutes: hasReal ? 12.5 : null,
      average_ease_of_use: hasReal ? 4 : null,
      average_guidance_helpfulness: hasReal ? 5 : null,
      average_confidence_before: hasReal ? 3 : null,
      average_confidence_after: hasReal ? 4 : null,
      average_confidence_change: hasReal ? 1 : null,
      average_continued_use_intent: hasReal ? 4 : null,
    },
    participants: hasReal
      ? [{
          participant_code: "P001",
          role_label: "2023级计算机科学与技术专业学生",
          participant_kind: "real_trial",
          consent_notice_version: "pilot_notice_v1",
          consented_at: "2026-08-22T09:00:00.000Z",
          baseline_confidence: 3,
          completed_at: "2026-08-22T09:12:30.000Z",
          tasks: [
            {
              task_id: "pilot_task_baseline",
              ordinal: 1,
              stage: "baseline",
              title: "独立完成基线题",
              started_at: "2026-08-22T09:00:00.000Z",
              completed_at: "2026-08-22T09:02:00.000Z",
              result: {
                outcome: "incorrect",
                score: 0,
                grading_mode: "deterministic_choice",
                evidence_at: "2026-08-22T09:02:00.000Z",
              },
            },
            {
              task_id: "pilot_task_transfer",
              ordinal: 3,
              stage: "transfer",
              title: "独立完成迁移题",
              started_at: "2026-08-22T09:10:00.000Z",
              completed_at: "2026-08-22T09:12:30.000Z",
              result: {
                outcome: "correct",
                score: 100,
                grading_mode: "deterministic_choice",
                evidence_at: "2026-08-22T09:12:30.000Z",
              },
            },
          ],
          feedback: {
            ease_of_use: 4,
            guidance_helpfulness: 5,
            confidence_after: 4,
            continued_use_intent: 4,
            open_feedback: "讲解清楚。",
            submitted_at: "2026-08-22T09:14:00.000Z",
          },
        }]
      : [],
  };
}

describe("PilotStudyGovernance", () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
  });

  it("separates real-trial emptiness from synthetic verification counts", () => {
    render(<PilotStudyGovernance accounts={accounts} initialReport={report()} />);

    expect(screen.getByText("0 名试用学生")).toBeInTheDocument();
    expect(screen.getByText("1 个演示账户")).toBeInTheDocument();
    expect(screen.getByText("尚无试用记录")).toBeInTheDocument();
    expect(screen.getByText("小样本观察，不作统计显著性结论")).toBeInTheDocument();
  });

  it("enrolls an existing active student and refreshes only the pilot report", async () => {
    apiMocks.enrollPilotParticipant.mockResolvedValue({ participant_code: "P002" });
    apiMocks.getPilotManagementReport.mockResolvedValue(report(1));
    render(<PilotStudyGovernance accounts={accounts} initialReport={report()} />);

    fireEvent.change(screen.getByLabelText("学生账户"), {
      target: { value: "trial_student_01" },
    });
    fireEvent.change(screen.getByLabelText("匿名编号"), { target: { value: "P002" } });
    fireEvent.change(screen.getByLabelText("身份角色标签"), {
      target: { value: "2023级计算机科学与技术专业学生" },
    });
    fireEvent.change(screen.getByLabelText("参与类型"), {
      target: { value: "real_trial" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登记参与者" }));

    await waitFor(() => expect(apiMocks.enrollPilotParticipant).toHaveBeenCalledWith({
      username: "trial_student_01",
      participant_code: "P002",
      role_label: "2023级计算机科学与技术专业学生",
      participant_kind: "real_trial",
    }));
    expect(apiMocks.getPilotManagementReport).toHaveBeenCalledWith(true);
    expect(await screen.findByText("1 名试用学生")).toBeInTheDocument();
  });

  it("uses a user-facing error when participant enrollment cannot be completed", async () => {
    apiMocks.enrollPilotParticipant.mockRejectedValue(new Error("network offline"));
    render(<PilotStudyGovernance accounts={accounts} initialReport={report()} />);

    fireEvent.change(screen.getByLabelText("学生账户"), {
      target: { value: "trial_student_01" },
    });
    fireEvent.change(screen.getByLabelText("匿名编号"), { target: { value: "P002" } });
    fireEvent.change(screen.getByLabelText("身份角色标签"), {
      target: { value: "2023级计算机科学与技术专业学生" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登记参与者" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("试用记录暂时无法更新，请稍后重试。");
    expect(alert).not.toHaveTextContent(/API|PostgreSQL/iu);
  });

  it("renders observational metrics and anonymous participant records", () => {
    render(<PilotStudyGovernance accounts={accounts} initialReport={report(1)} />);

    expect(screen.getByText(/汇总任务完成情况与使用反馈/)).toBeInTheDocument();
    expect(screen.queryByText(/服务端证据/)).not.toBeInTheDocument();
    expect(screen.getByText("基线正确率 0%")) .toBeInTheDocument();
    expect(screen.getByText("迁移正确率 100%")) .toBeInTheDocument();
    expect(screen.getByText("观察变化 +100 个百分点")) .toBeInTheDocument();
    const table = screen.getByRole("table", { name: "匿名试用记录" });
    expect(within(table).getByText("P001")).toBeInTheDocument();
    expect(within(table).getByText("试用学生")).toBeInTheDocument();
    expect(within(table).queryByText("trial_student_01")).not.toBeInTheDocument();
    expect(within(table).queryByText("试用学生 01")).not.toBeInTheDocument();
  });

  it("downloads real-trial JSON and CSV through the browser export helper", async () => {
    apiMocks.downloadPilotReport.mockResolvedValue(undefined);
    render(<PilotStudyGovernance accounts={accounts} initialReport={report(1)} />);

    fireEvent.click(screen.getByRole("button", { name: "下载 JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "下载 CSV" }));

    await waitFor(() => expect(apiMocks.downloadPilotReport).toHaveBeenCalledTimes(2));
    expect(apiMocks.downloadPilotReport).toHaveBeenNthCalledWith(1, "json", false);
    expect(apiMocks.downloadPilotReport).toHaveBeenNthCalledWith(2, "csv", false);
  });
});
