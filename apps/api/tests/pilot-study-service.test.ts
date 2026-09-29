import { describe, expect, it } from "vitest";

import {
  buildPilotManagementReport,
  derivePilotTaskStatuses,
  serializePilotReportCsv,
  type PilotReportParticipantInput,
} from "../src/services/pilot-study/pilot-study.js";

const study = {
  study_id: "pilot_408_queue_v1",
  title: "队列知识点三阶段试用",
  notice_version: "pilot_notice_v1",
  notice_text: "知情说明",
};

const taskRows = [
  {
    task_id: "baseline",
    ordinal: 1,
    stage: "baseline" as const,
    evidence_kind: "verified_choice_attempt" as const,
    title: "基线题",
    instructions: "独立完成",
    course_id: "course_408_ds",
    concept_id: "ds_c03_02",
    question_id: "2010-02",
    href: "/student/practice?question_id=2010-02",
    assistance_policy: "independent" as const,
    started_at: null,
    completed_at: null,
    result: null,
  },
  {
    task_id: "guided",
    ordinal: 2,
    stage: "guided" as const,
    evidence_kind: "verified_course_reading" as const,
    title: "引导学习",
    instructions: "展开来源",
    course_id: "course_408_ds",
    concept_id: "ds_c03_02",
    question_id: null,
    href: "/student/courses/data-structures?concept_id=ds_c03_02",
    assistance_policy: "platform_guidance" as const,
    started_at: null,
    completed_at: null,
    result: null,
  },
  {
    task_id: "transfer",
    ordinal: 3,
    stage: "transfer" as const,
    evidence_kind: "verified_choice_attempt" as const,
    title: "迁移题",
    instructions: "独立完成",
    course_id: "course_408_ds",
    concept_id: "ds_c03_02",
    question_id: "2021-02",
    href: "/student/practice?question_id=2021-02",
    assistance_policy: "independent" as const,
    started_at: null,
    completed_at: null,
    result: null,
  },
];

describe("pilot task sequencing", () => {
  it("locks every task before consent and exposes only the first task after consent", () => {
    expect(derivePilotTaskStatuses(taskRows, null).map((task) => task.status))
      .toEqual(["locked", "locked", "locked"]);
    expect(derivePilotTaskStatuses(taskRows, "2026-08-22T09:00:00.000Z").map((task) => task.status))
      .toEqual(["ready", "locked", "locked"]);
  });

  it("keeps exactly one next task available while preserving completed evidence", () => {
    const progressed = taskRows.map((task, index) => index === 0
      ? {
          ...task,
          started_at: "2026-08-22T09:01:00.000Z",
          completed_at: "2026-08-22T09:03:00.000Z",
          result: {
            outcome: "incorrect" as const,
            score: 0,
            grading_mode: "deterministic_choice" as const,
            evidence_at: "2026-08-22T09:02:30.000Z",
          },
        }
      : task);

    const resolved = derivePilotTaskStatuses(progressed, "2026-08-22T09:00:00.000Z");
    expect(resolved.map((task) => task.status)).toEqual(["completed", "ready", "locked"]);
    expect(resolved[0]?.result?.outcome).toBe("incorrect");
  });
});

function participant(
  participantCode: string,
  kind: "real_trial" | "synthetic_verification",
  baselineOutcome: "correct" | "incorrect",
  transferOutcome: "correct" | "incorrect",
): PilotReportParticipantInput {
  return {
    participant_code: participantCode,
    role_label: "2023级计算机科学与技术专业学生",
    participant_kind: kind,
    consent_notice_version: "pilot_notice_v1",
    consented_at: "2026-08-22T09:00:00.000Z",
    baseline_confidence: 2,
    completed_at: "2026-08-22T09:30:00.000Z",
    tasks: [
      {
        task_id: "baseline",
        ordinal: 1,
        stage: "baseline",
        title: "基线题",
        started_at: "2026-08-22T09:01:00.000Z",
        completed_at: "2026-08-22T09:04:00.000Z",
        result: { outcome: baselineOutcome, score: baselineOutcome === "correct" ? 100 : 0, grading_mode: "deterministic_choice", evidence_at: "2026-08-22T09:03:50.000Z" },
      },
      {
        task_id: "guided",
        ordinal: 2,
        stage: "guided",
        title: "引导学习",
        started_at: "2026-08-22T09:05:00.000Z",
        completed_at: "2026-08-22T09:18:00.000Z",
        result: { outcome: "read", score: null, grading_mode: "course_reading", evidence_at: "2026-08-22T09:17:30.000Z" },
      },
      {
        task_id: "transfer",
        ordinal: 3,
        stage: "transfer",
        title: "迁移题",
        started_at: "2026-08-22T09:20:00.000Z",
        completed_at: "2026-08-22T09:24:00.000Z",
        result: { outcome: transferOutcome, score: transferOutcome === "correct" ? 100 : 0, grading_mode: "deterministic_choice", evidence_at: "2026-08-22T09:23:30.000Z" },
      },
    ],
    feedback: {
      ease_of_use: 4,
      guidance_helpfulness: 5,
      confidence_after: 4,
      continued_use_intent: 4,
      open_feedback: "引导后能解释出队顺序。",
      submitted_at: "2026-08-22T09:30:00.000Z",
    },
  };
}

describe("pilot management report", () => {
  it("computes observed real-trial changes without mixing synthetic verification", () => {
    const report = buildPilotManagementReport({
      study,
      generatedAt: "2026-08-22T10:00:00.000Z",
      participants: [
        participant("P001", "real_trial", "incorrect", "correct"),
        participant("CHECK01", "synthetic_verification", "correct", "incorrect"),
      ],
    }, false);

    expect(report.data_scope).toBe("real_trial_only");
    expect(report.claim_boundary).toBe("small_sample_observational");
    expect(report.summary).toMatchObject({
      real_participants: 1,
      synthetic_participants: 1,
      completed_real_participants: 1,
      baseline_correct_rate: 0,
      transfer_correct_rate: 100,
      observed_change_percentage_points: 100,
      average_completion_minutes: 23,
      average_guidance_helpfulness: 5,
    });
    expect(report.participants.map((item) => item.participant_code)).toEqual(["P001"]);
  });

  it("serializes an anonymous spreadsheet-safe CSV", () => {
    const report = buildPilotManagementReport({
      study,
      generatedAt: "2026-08-22T10:00:00.000Z",
      participants: [participant("P001", "real_trial", "incorrect", "correct")],
    }, false);
    const csv = serializePilotReportCsv(report);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("P001");
    expect(csv).toContain("small_sample_observational");
    expect(csv).not.toMatch(/user_id|username|display_name|password|session/iu);
    expect(csv).not.toContain("=HYPERLINK");
  });

  it("uses only participants with paired baseline and transfer outcomes", () => {
    const baselineOnly = participant("P002", "real_trial", "correct", "incorrect");
    baselineOnly.tasks = baselineOnly.tasks.map((task) =>
      task.stage === "transfer"
        ? { ...task, started_at: null, completed_at: null, result: null }
        : task,
    );
    baselineOnly.completed_at = null;

    const transferOnly = participant("P003", "real_trial", "incorrect", "correct");
    transferOnly.tasks = transferOnly.tasks.map((task) =>
      task.stage === "baseline"
        ? { ...task, started_at: null, completed_at: null, result: null }
        : task,
    );
    transferOnly.completed_at = null;

    const report = buildPilotManagementReport({
      study,
      generatedAt: "2026-08-22T10:00:00.000Z",
      participants: [
        participant("P001", "real_trial", "incorrect", "correct"),
        baselineOnly,
        transferOnly,
      ],
    });

    expect(report.summary).toMatchObject({
      baseline_evaluated_count: 1,
      transfer_evaluated_count: 1,
      baseline_correct_count: 0,
      transfer_correct_count: 1,
      baseline_correct_rate: 0,
      transfer_correct_rate: 100,
      observed_change_percentage_points: 100,
    });
  });
});
