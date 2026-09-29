import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PilotManagementReport,
  PilotStudentStudy,
} from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import {
  PilotStudyError,
  type PilotStudyService,
} from "../src/services/pilot-study/pilot-study.js";

const enrolledStudy: PilotStudentStudy = {
  kind: "enrolled",
  study: {
    study_id: "pilot_408_queue_v1",
    title: "队列知识点三阶段试用",
    notice_version: "pilot_notice_v1",
    notice_text: "知情说明",
  },
  participant: {
    participant_code: "P001",
    role_label: "2023级计算机科学与技术专业学生",
    participant_kind: "real_trial",
    consent_notice_version: null,
    consented_at: null,
    baseline_confidence: null,
    completed_at: null,
  },
  tasks: [],
  feedback: null,
};

const report: PilotManagementReport = {
  study: enrolledStudy.study,
  generated_at: "2026-08-22T10:00:00.000Z",
  data_scope: "real_trial_only",
  claim_boundary: "small_sample_observational",
  summary: {
    real_participants: 1,
    synthetic_participants: 0,
    consented_real_participants: 0,
    completed_real_participants: 0,
    baseline_evaluated_count: 0,
    baseline_correct_count: 0,
    transfer_evaluated_count: 0,
    transfer_correct_count: 0,
    baseline_correct_rate: null,
    transfer_correct_rate: null,
    observed_change_percentage_points: null,
    average_completion_minutes: null,
    average_ease_of_use: null,
    average_guidance_helpfulness: null,
    average_confidence_before: null,
    average_confidence_after: null,
    average_confidence_change: null,
    average_continued_use_intent: null,
  },
  participants: [],
};

function access() {
  return {
    async getActor(userId: string) {
      const role = userId.startsWith("admin")
        ? "admin"
        : userId.startsWith("teacher") ? "teacher" : "student";
      return {
        user: {
          user_id: userId,
          display_name: userId,
          account_status: "active" as const,
          auth_source: "local_development" as const,
          created_at: "2026-08-22T00:00:00.000Z",
          updated_at: "2026-08-22T00:00:00.000Z",
        },
        roles: [role],
      };
    },
    async isCourseAssigned() { return true; },
  };
}

function service(overrides: Partial<PilotStudyService> = {}): PilotStudyService {
  return {
    async getStudentStudy() { return enrolledStudy; },
    async enrollParticipant(_adminUserId, input) {
      return {
        participant_code: input.participant_code,
        role_label: input.role_label,
        participant_kind: input.participant_kind,
        consent_notice_version: null,
        consented_at: null,
        baseline_confidence: null,
        completed_at: null,
      };
    },
    async recordConsent() { return enrolledStudy; },
    async startTask() { return enrolledStudy; },
    async completeTask() { return enrolledStudy; },
    async evaluateChoiceTask() {
      return {
        task_id: "pilot_queue_baseline_v1",
        attempt_id: "attempt_001",
        question_id: "2010-02",
        outcome: "correct" as const,
        score: 100,
        grading_mode: "deterministic_choice" as const,
        evidence_at: "2026-08-22T09:02:30.000Z",
        task_completed: true as const,
      };
    },
    async submitFeedback() { return enrolledStudy; },
    async getManagementReport() { return report; },
    ...overrides,
  };
}

describe("pilot study routes", () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("reads and mutates only the authenticated student's pilot record", async () => {
    const getStudentStudy = vi.fn(async () => enrolledStudy);
    const recordConsent = vi.fn(async () => enrolledStudy);
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: access(),
      pilotStudy: service({ getStudentStudy, recordConsent }),
    } as never);

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/student/pilot-study",
      headers: { "x-dev-user-id": "student_001" },
    });
    const consent = await app.inject({
      method: "POST",
      url: "/api/v1/student/pilot-study/consent",
      headers: { "x-dev-user-id": "student_001" },
      payload: {
        accepted: true,
        notice_version: "pilot_notice_v1",
        baseline_confidence: 3,
      },
    });

    expect(read.statusCode).toBe(200);
    expect(consent.statusCode).toBe(200);
    expect(getStudentStudy).toHaveBeenCalledWith("student_001");
    expect(recordConsent).toHaveBeenCalledWith("student_001", {
      accepted: true,
      notice_version: "pilot_notice_v1",
      baseline_confidence: 3,
    });
  });

  it("rejects forged outcomes and maps missing evidence to a stable conflict", async () => {
    const completeTask = vi.fn(async () => {
      throw new PilotStudyError(
        "PILOT_EVIDENCE_NOT_FOUND",
        "没有找到当前任务的客观作答证据。",
      );
    });
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: access(),
      pilotStudy: service({ completeTask }),
    } as never);

    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/student/pilot-study/tasks/task_001/complete",
      headers: { "x-dev-user-id": "student_001" },
      payload: { attempt_id: "attempt_001", is_correct: true, score: 100 },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/student/pilot-study/tasks/task_001/complete",
      headers: { "x-dev-user-id": "student_001" },
      payload: { attempt_id: "attempt_001" },
    });

    expect(forged.statusCode).toBe(400);
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe("PILOT_EVIDENCE_NOT_FOUND");
    expect(completeTask).toHaveBeenCalledTimes(1);
  });

  it("uses the server-bound pilot evaluation route and redacts answer-bearing fields", async () => {
    const evaluateChoiceTask = vi.fn(async () => ({
      task_id: "pilot_queue_baseline_v1",
      attempt_id: "attempt_001",
      question_id: "2010-02",
      outcome: "incorrect" as const,
      score: 0,
      grading_mode: "deterministic_choice" as const,
      evidence_at: "2026-08-22T09:02:30.000Z",
      task_completed: true as const,
    }));
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: access(),
      pilotStudy: service({ evaluateChoiceTask } as never),
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/pilot-study/tasks/pilot_queue_baseline_v1/evaluate",
      headers: {
        "x-dev-user-id": "student_001",
        "idempotency-key": "pilot-evaluation-001",
      },
      payload: { selected_option_ids: ["A"] },
    });

    expect(response.statusCode).toBe(200);
    expect(evaluateChoiceTask).toHaveBeenCalledWith(
      "student_001",
      "pilot_queue_baseline_v1",
      ["A"],
      "pilot-evaluation-001",
    );
    expect(response.json().data).toMatchObject({ task_completed: true, outcome: "incorrect" });
    expect(response.body).not.toMatch(/correct_option_ids|explanation|reference_solution/iu);
  });

  it("allows only administrators to enroll and read participant feedback", async () => {
    const enrollParticipant = vi.fn(service().enrollParticipant);
    const getManagementReport = vi.fn(async () => report);
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: access(),
      pilotStudy: service({ enrollParticipant, getManagementReport }),
    } as never);

    const teacher = await app.inject({
      method: "GET",
      url: "/api/v1/manage/pilot-study",
      headers: { "x-dev-user-id": "teacher_001" },
    });
    const enrolled = await app.inject({
      method: "POST",
      url: "/api/v1/manage/pilot-study/participants",
      headers: { "x-dev-user-id": "admin_001" },
      payload: {
        username: "trial_student_01",
        participant_code: "P001",
        role_label: "2023级计算机科学与技术专业学生",
        participant_kind: "real_trial",
      },
    });

    expect(teacher.statusCode).toBe(403);
    expect(enrolled.statusCode).toBe(201);
    expect(enrollParticipant).toHaveBeenCalledWith("admin_001", expect.objectContaining({
      participant_code: "P001",
    }));
    expect(getManagementReport).not.toHaveBeenCalledWith(true);
  });

  it("exports anonymous JSON and spreadsheet-safe CSV with attachment headers", async () => {
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: access(),
      pilotStudy: service(),
    } as never);

    const json = await app.inject({
      method: "GET",
      url: "/api/v1/manage/pilot-study/export.json",
      headers: { "x-dev-user-id": "admin_001" },
    });
    const csv = await app.inject({
      method: "GET",
      url: "/api/v1/manage/pilot-study/export.csv",
      headers: { "x-dev-user-id": "admin_001" },
    });

    expect(json.statusCode).toBe(200);
    expect(json.headers["content-disposition"]).toContain("attachment");
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");
    expect(csv.body).toContain("small_sample_observational");
    expect(`${json.body}\n${csv.body}`).not.toMatch(
      /user_id|username|display_name|password|session/iu,
    );
  });
});
