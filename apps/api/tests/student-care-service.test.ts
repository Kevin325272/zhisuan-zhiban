import type { StudentCareResponseAction } from "@xuetu/contracts";
import { describe, expect, it, vi } from "vitest";

import { readStudentCareConfig } from "../src/config/student-care.js";
import type { StudentLearningOrchestrationService } from "../src/services/orchestration/learning-orchestration-service.js";
import {
  DeterministicStudentCareService,
  type StoredStudentCareInteraction,
  type StudentCareRepository,
} from "../src/services/student-care/student-care-service.js";

const now = new Date("2026-08-21T08:00:00.000Z");
const config = readStudentCareConfig({ STUDENT_CARE_ENABLED: "true" });

function interaction(
  overrides: Partial<StoredStudentCareInteraction> = {},
): StoredStudentCareInteraction {
  return {
    interactionId: "care_001",
    userId: "student_001",
    signalCode: "accuracy_shift",
    ruleVersion: "student_care_v1",
    status: "presented",
    evidenceSummary: { recent_attempt_count: 8 },
    reasonSummary: "最近这部分学习比平时更费力。",
    response: null,
    presentedAt: "2026-08-21T07:00:00.000Z",
    respondedAt: null,
    expiresAt: "2026-08-22T07:00:00.000Z",
    cooldownUntil: null,
    lightSessionExpiresAt: null,
    lightStep: null,
    talkCourseId: null,
    talkFallbackStep: null,
    ...overrides,
  };
}

const talkFallbackStep = {
  task_id: "live_practice_ds_c01",
  task_type: "choice_practice" as const,
  course_id: "course_408_ds",
  course_title: "数据结构",
  title: "只完成这一项可靠练习",
  detail: "今天先做这一项，原任务的判定标准和学习路径保持不变。",
  estimated_minutes: 10,
  href: "/student/practice?subject=数据结构&concept_id=ds_c01",
};

function repository(
  overrides: Partial<StudentCareRepository> = {},
): StudentCareRepository {
  return {
    async getRuleEvidence() {
      return {
        activeLearningDates: [],
        lastLearningAt: null,
        sessionStartedAt: [],
        accuracyByCourse: [],
        rhythm: {
          baselineCompletedDayCount: 0,
          recentCompletedDayCount: 0,
          hasPendingTask: false,
          hasDueReview: false,
        },
      };
    },
    async getPreference() { return { enabled: true, updatedAt: null }; },
    async setPreference(_userId, enabled, updatedAt) {
      return { enabled, updatedAt: updatedAt.toISOString() };
    },
    async expirePendingInvitations() {},
    async expireAllPendingInvitations() {},
    async findInteraction() { return interaction(); },
    async findPendingInvitation() { return null; },
    async findActiveLightSession() { return null; },
    async findCooldownUntil() { return null; },
    async createInvitation() { return interaction(); },
    async respondToInteraction(_userId, _interactionId, action, input) {
      return {
        ...interaction({
          status: "responded",
          response: action,
          respondedAt: input.respondedAt.toISOString(),
          cooldownUntil: input.cooldownUntil?.toISOString() ?? null,
          lightSessionExpiresAt: input.lightSessionExpiresAt?.toISOString() ?? null,
          lightStep: input.lightStep,
          talkCourseId: input.talkCourseId,
          talkFallbackStep: input.talkFallbackStep,
        }),
        idempotent: false,
      };
    },
    async findRecentTalkConsent() { return null; },
    ...overrides,
  };
}

function orchestration(overrides: Record<string, unknown> = {}) {
  return {
    async getSnapshot() {
      return {
        current_task: {
          task_id: "live_practice_ds_c01",
          task_type: "choice_practice",
          course_id: "course_408_ds",
          course_title: "数据结构",
          concept_id: "ds_c01",
          concept_title: "算法复杂度",
          title: "完成算法复杂度练习",
          estimated_minutes: 20,
          href: "/student/practice?subject=数据结构&concept_id=ds_c01",
          practice_question_count: 3,
          ...overrides,
        },
      };
    },
    async activateTask() { throw new Error("not used"); },
    async completeTask() { throw new Error("not used"); },
  } as unknown as StudentLearningOrchestrationService;
}

describe("DeterministicStudentCareService", () => {
  it("reads the care preference without evaluating or mutating invitation state", async () => {
    const repo = repository({
      async getPreference() { return { enabled: true, updatedAt: null }; },
    });
    const getRuleEvidence = vi.spyOn(repo, "getRuleEvidence");
    const expirePendingInvitations = vi.spyOn(repo, "expirePendingInvitations");
    const createInvitation = vi.spyOn(repo, "createInvitation");
    const service = new DeterministicStudentCareService(repo, orchestration(), config, () => now);

    await expect(service.getPreference("student_001")).resolves.toEqual({
      enabled: true,
      updated_at: null,
    });
    expect(getRuleEvidence).not.toHaveBeenCalled();
    expect(expirePendingInvitations).not.toHaveBeenCalled();
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("returns none without sufficient evidence and never asks the model", async () => {
    const repo = repository();
    const createInvitation = vi.spyOn(repo, "createInvitation");
    const service = new DeterministicStudentCareService(repo, orchestration(), config, () => now);

    await expect(service.getStatus("student_001")).resolves.toEqual({
      kind: "none",
      preference_enabled: true,
    });
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("reuses a pending invitation before evaluating new evidence", async () => {
    const getRuleEvidence = vi.fn(async () => { throw new Error("must not evaluate"); });
    const repo = repository({
      getRuleEvidence,
      async findPendingInvitation() { return interaction(); },
    });
    const service = new DeterministicStudentCareService(repo, orchestration(), config, () => now);

    await expect(service.getStatus("student_001")).resolves.toMatchObject({
      kind: "invitation",
      interaction_id: "care_001",
      signal_code: "accuracy_shift",
      actions: ["continue", "lighten", "talk", "dismiss", "disable"],
    });
    expect(getRuleEvidence).not.toHaveBeenCalled();
  });

  it("creates one reviewed invitation from a qualifying deterministic signal", async () => {
    const createInvitation = vi.fn(async () => interaction());
    const repo = repository({
      async getRuleEvidence() {
        return {
          activeLearningDates: [],
          lastLearningAt: null,
          sessionStartedAt: [],
          accuracyByCourse: [{
            courseId: "course_408_ds",
            recentAttemptCount: 8,
            recentIncorrectCount: 5,
            recentConceptCount: 2,
            baselineAttemptCount: 20,
            baselineIncorrectCount: 7,
          }],
          rhythm: {
            baselineCompletedDayCount: 0,
            recentCompletedDayCount: 0,
            hasPendingTask: false,
            hasDueReview: false,
          },
        };
      },
      createInvitation,
    });
    const service = new DeterministicStudentCareService(repo, orchestration(), config, () => now);

    const status = await service.getStatus("student_001");

    expect(status).toMatchObject({
      kind: "invitation",
      greeting: expect.stringContaining("今天轻一点"),
      reason_summary: "最近这部分学习比平时更费力。",
    });
    expect(createInvitation).toHaveBeenCalledWith(
      "student_001",
      expect.objectContaining({ signalCode: "accuracy_shift" }),
      expect.objectContaining({ ruleVersion: "student_care_v1" }),
    );
  });

  it("hides an invitation when the student disables care during evaluation", async () => {
    let preferenceReads = 0;
    const expireAllPendingInvitations = vi.fn(async () => {});
    const repo = repository({
      async getPreference() {
        preferenceReads += 1;
        return {
          enabled: preferenceReads === 1,
          updatedAt: preferenceReads === 1 ? null : now.toISOString(),
        };
      },
      async getRuleEvidence() {
        return {
          activeLearningDates: [],
          lastLearningAt: null,
          sessionStartedAt: [],
          accuracyByCourse: [{
            courseId: "course_408_ds",
            recentAttemptCount: 8,
            recentIncorrectCount: 5,
            recentConceptCount: 2,
            baselineAttemptCount: 20,
            baselineIncorrectCount: 7,
          }],
          rhythm: {
            baselineCompletedDayCount: 0,
            recentCompletedDayCount: 0,
            hasPendingTask: false,
            hasDueReview: false,
          },
        };
      },
      async createInvitation() { return interaction(); },
      expireAllPendingInvitations,
    });
    const service = new DeterministicStudentCareService(repo, orchestration(), config, () => now);

    await expect(service.getStatus("student_001")).resolves.toEqual({
      kind: "none",
      preference_enabled: false,
    });
    expect(expireAllPendingInvitations).toHaveBeenCalledWith("student_001", now);
  });

  it("derives a ten-minute light step from the current legal task without completing it", async () => {
    const calls: Array<{ action: StudentCareResponseAction; input: unknown }> = [];
    const repo = repository({
      async respondToInteraction(_userId, _interactionId, action, input) {
        calls.push({ action, input });
        return {
          ...interaction({
            status: "responded",
            response: action,
            respondedAt: input.respondedAt.toISOString(),
            cooldownUntil: input.cooldownUntil?.toISOString() ?? null,
            lightSessionExpiresAt: input.lightSessionExpiresAt?.toISOString() ?? null,
            lightStep: input.lightStep,
          }),
          idempotent: false,
        };
      },
    });
    const learning = orchestration();
    const completeTask = vi.spyOn(learning, "completeTask");
    const service = new DeterministicStudentCareService(repo, learning, config, () => now);

    const result = await service.respond("student_001", "care_001", "lighten");

    expect(result).toMatchObject({
      action: "lighten",
      status: {
        kind: "light_session",
        step: {
          task_id: "live_practice_ds_c01",
          estimated_minutes: 10,
          href: "/student/practice?subject=数据结构&concept_id=ds_c01",
        },
      },
      talk: null,
    });
    expect(calls[0]).toMatchObject({ action: "lighten" });
    expect(completeTask).not.toHaveBeenCalled();
  });

  it("falls back from unlinked precise practice to course reading", async () => {
    const service = new DeterministicStudentCareService(
      repository(),
      orchestration({ concept_id: null, concept_title: null, practice_question_count: 0 }),
      config,
      () => now,
    );

    const result = await service.respond("student_001", "care_001", "lighten");

    expect(result.status).toMatchObject({
      kind: "light_session",
      step: {
        task_type: "course_reading",
        title: "继续数据结构课程阅读",
        href: "/student/courses/data-structures",
      },
    });
  });

  it("replays a persisted light step without rebuilding the current task", async () => {
    const storedLightStep = {
      task_id: "task_ds_read",
      task_type: "course_reading" as const,
      course_id: "course_408_ds",
      course_title: "数据结构",
      title: "回到上次阅读位置",
      detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
      estimated_minutes: 10,
      href: "/student/courses/data-structures",
    };
    const repo = repository({
      async findInteraction() {
        return interaction({
          status: "responded",
          response: "lighten",
          respondedAt: now.toISOString(),
          cooldownUntil: "2026-08-28T08:00:00.000Z",
          lightSessionExpiresAt: "2026-08-21T15:59:59.999Z",
          lightStep: storedLightStep,
        });
      },
      async respondToInteraction() {
        return {
          ...interaction({
            status: "responded",
            response: "lighten",
            respondedAt: now.toISOString(),
            cooldownUntil: "2026-08-28T08:00:00.000Z",
            lightSessionExpiresAt: "2026-08-21T15:59:59.999Z",
            lightStep: storedLightStep,
          }),
          idempotent: true,
        };
      },
    });
    const learning = orchestration();
    const getSnapshot = vi.spyOn(learning, "getSnapshot")
      .mockRejectedValue(new Error("orchestration unavailable"));
    const service = new DeterministicStudentCareService(repo, learning, config, () => now);

    await expect(service.respond("student_001", "care_001", "lighten")).resolves.toMatchObject({
      action: "lighten",
      idempotent: true,
      status: { kind: "light_session", step: storedLightStep },
    });
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("replays the persisted talk course without rebuilding the current task", async () => {
    const storedTalk = {
      ...interaction({
        status: "responded",
        response: "talk",
        respondedAt: now.toISOString(),
        cooldownUntil: "2026-08-28T08:00:00.000Z",
      }),
      talkCourseId: "course_408_ds",
      talkFallbackStep,
    };
    const repo = repository({
      async findInteraction() { return storedTalk; },
      async respondToInteraction() { throw new Error("must not persist twice"); },
    });
    const learning = orchestration();
    const getSnapshot = vi.spyOn(learning, "getSnapshot")
      .mockRejectedValue(new Error("orchestration unavailable"));
    const service = new DeterministicStudentCareService(repo, learning, config, () => now);

    await expect(service.respond("student_001", "care_001", "talk")).resolves.toMatchObject({
      action: "talk",
      idempotent: true,
      status: { kind: "none", preference_enabled: true },
      talk: {
        capability: "care",
        course_id: "course_408_ds",
        conversation_id: "care_001",
        fallback_step: talkFallbackStep,
      },
    });
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("persists a server-owned light fallback with first-time talk consent", async () => {
    const calls: unknown[] = [];
    const repo = repository({
      async respondToInteraction(_userId, _interactionId, action, input) {
        calls.push(input);
        return {
          ...interaction({
            status: "responded",
            response: action,
            respondedAt: input.respondedAt.toISOString(),
            cooldownUntil: input.cooldownUntil?.toISOString() ?? null,
            talkCourseId: input.talkCourseId,
            talkFallbackStep: input.talkFallbackStep,
          }),
          idempotent: false,
        };
      },
    });
    const service = new DeterministicStudentCareService(repo, orchestration(), config, () => now);

    await expect(service.respond("student_001", "care_001", "talk")).resolves.toMatchObject({
      action: "talk",
      talk: {
        capability: "care",
        course_id: "course_408_ds",
        conversation_id: "care_001",
        fallback_step: talkFallbackStep,
      },
    });
    expect(calls[0]).toMatchObject({
      lightStep: null,
      talkCourseId: "course_408_ds",
      talkFallbackStep,
    });
  });
});
