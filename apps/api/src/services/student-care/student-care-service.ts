import type {
  StudentCareLightStep,
  StudentCarePreferenceRead,
  StudentCareResponseAction,
  StudentCareResponseResult,
  StudentCareSignal,
  StudentCareStatus,
} from "@xuetu/contracts";
import {
  studentCarePreferenceReadSchema,
  studentCarePreferenceSchema,
  studentCareResponseResultSchema,
  studentCareStatusSchema,
} from "@xuetu/contracts";

import type { StudentCareConfig } from "../../config/student-care.js";
import type { StudentLearningOrchestrationService } from "../orchestration/learning-orchestration-service.js";
import { evaluateStudentCareSignal } from "./student-care-rules.js";
import type { StudentCareRuleEvidence, StudentCareRuleMatch } from "./student-care-rules.js";

export interface StudentCarePreferenceRecord {
  enabled: boolean;
  updatedAt: string | null;
}

export interface StoredStudentCareInteraction {
  interactionId: string;
  userId: string;
  signalCode: StudentCareSignal;
  ruleVersion: "student_care_v1";
  status: "presented" | "responded" | "expired";
  evidenceSummary: Record<string, unknown>;
  reasonSummary: string;
  response: StudentCareResponseAction | null;
  presentedAt: string;
  respondedAt: string | null;
  expiresAt: string;
  cooldownUntil: string | null;
  lightSessionExpiresAt: string | null;
  lightStep: StudentCareLightStep | null;
  talkCourseId: string | null;
  talkFallbackStep: StudentCareLightStep | null;
}

export interface StudentCareInteractionResponse extends StoredStudentCareInteraction {
  idempotent: boolean;
}

export interface StudentCareRespondPersistenceInput {
  respondedAt: Date;
  cooldownUntil: Date | null;
  lightSessionExpiresAt: Date | null;
  lightStep: StudentCareLightStep | null;
  talkCourseId: string | null;
  talkFallbackStep: StudentCareLightStep | null;
}

export interface StudentCareRepository {
  getRuleEvidence(userId: string, now: Date): Promise<StudentCareRuleEvidence>;
  getPreference(userId: string): Promise<StudentCarePreferenceRecord>;
  setPreference(userId: string, enabled: boolean, updatedAt: Date): Promise<StudentCarePreferenceRecord>;
  expirePendingInvitations(userId: string, now: Date): Promise<void>;
  expireAllPendingInvitations(userId: string, now: Date): Promise<void>;
  findInteraction(userId: string, interactionId: string): Promise<StoredStudentCareInteraction | null>;
  findPendingInvitation(userId: string, now: Date): Promise<StoredStudentCareInteraction | null>;
  findActiveLightSession(userId: string, now: Date): Promise<StoredStudentCareInteraction | null>;
  findCooldownUntil(userId: string, now: Date): Promise<string | null>;
  createInvitation(
    userId: string,
    match: StudentCareRuleMatch,
    input: { ruleVersion: "student_care_v1"; presentedAt: Date; expiresAt: Date },
  ): Promise<StoredStudentCareInteraction>;
  respondToInteraction(
    userId: string,
    interactionId: string,
    action: StudentCareResponseAction,
    input: StudentCareRespondPersistenceInput,
  ): Promise<StudentCareInteractionResponse>;
  findRecentTalkConsent(
    userId: string,
    courseId: string,
    since: Date,
  ): Promise<StoredStudentCareInteraction | null>;
}

export type StudentCareInteractionErrorCode =
  | "CARE_INTERACTION_NOT_FOUND"
  | "CARE_INTERACTION_EXPIRED"
  | "CARE_INTERACTION_ALREADY_RESPONDED";

export class StudentCareInteractionError extends Error {
  constructor(
    readonly code: StudentCareInteractionErrorCode,
    message: string,
    readonly statusCode: 404 | 409,
  ) {
    super(message);
    this.name = "StudentCareInteractionError";
  }
}

export interface StudentCareService {
  getPreference(userId: string): Promise<StudentCarePreferenceRead>;
  getStatus(userId: string): Promise<StudentCareStatus>;
  respond(
    userId: string,
    interactionId: string,
    action: StudentCareResponseAction,
  ): Promise<StudentCareResponseResult>;
  updatePreference(userId: string, enabled: boolean): Promise<{
    enabled: boolean;
    updated_at: string;
  }>;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const actions = ["continue", "lighten", "talk", "dismiss", "disable"] as const;

const greetingBySignal: Record<StudentCareSignal, string> = {
  return_after_gap: "欢迎回来。今天要按原计划继续，还是先用一个轻一点的步骤找回节奏？",
  accuracy_shift: "最近这部分学习好像比平时更费力，要按原计划继续，还是今天轻一点？",
  rhythm_drop: "最近的学习节奏慢了一些。今天照常继续，还是先完成一个轻一点的步骤？",
};

const courseReadingHref: Record<string, string> = {
  course_408_ds: "/student/courses/data-structures",
  course_408_co: "/student/courses/computer-organization",
  course_408_os: "/student/courses/operating-systems",
  course_408_cn: "/student/courses/computer-networks",
};

function invitationStatus(interaction: StoredStudentCareInteraction): StudentCareStatus {
  return studentCareStatusSchema.parse({
    kind: "invitation",
    preference_enabled: true,
    interaction_id: interaction.interactionId,
    signal_code: interaction.signalCode,
    greeting: greetingBySignal[interaction.signalCode],
    reason_summary: interaction.reasonSummary,
    actions,
    presented_at: interaction.presentedAt,
    expires_at: interaction.expiresAt,
  });
}

function lightSessionStatus(interaction: StoredStudentCareInteraction): StudentCareStatus {
  if (!interaction.lightStep || !interaction.lightSessionExpiresAt) {
    throw new Error("Active student-care light session is incomplete.");
  }
  return studentCareStatusSchema.parse({
    kind: "light_session",
    preference_enabled: true,
    interaction_id: interaction.interactionId,
    signal_code: interaction.signalCode,
    message: "今天先完成一个更轻的步骤，原任务和学习路径都不会被改写。",
    step: interaction.lightStep,
    expires_at: interaction.lightSessionExpiresAt,
  });
}

function endOfShanghaiDay(now: Date) {
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
  return new Date(Date.UTC(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate() + 1,
  ) - 8 * 60 * 60 * 1_000 - 1);
}

function deriveLightStep(
  task: Awaited<ReturnType<StudentLearningOrchestrationService["getSnapshot"]>>["current_task"],
): StudentCareLightStep {
  const estimatedMinutes = Math.max(1, Math.min(10, task.estimated_minutes));
  if (task.task_type === "choice_practice" && task.practice_question_count === 0) {
    const href = courseReadingHref[task.course_id];
    if (!href) throw new Error("No safe reading fallback exists for the current care task.");
    return {
      task_id: task.task_id,
      task_type: "course_reading",
      course_id: task.course_id,
      course_title: task.course_title,
      title: `继续${task.course_title}课程阅读`,
      detail: "当前没有可靠的精准练习关联，先回到课程阅读；原任务不会被标记完成。",
      estimated_minutes: estimatedMinutes,
      href,
    };
  }
  if (!task.href.startsWith("/student/")) {
    throw new Error("Student-care light step must use a server-owned student route.");
  }
  if (task.task_type === "course_reading") {
    return {
      task_id: task.task_id,
      task_type: task.task_type,
      course_id: task.course_id,
      course_title: task.course_title,
      title: "回到上次阅读位置",
      detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
      estimated_minutes: estimatedMinutes,
      href: task.href,
    };
  }
  return {
    task_id: task.task_id,
    task_type: task.task_type,
    course_id: task.course_id,
    course_title: task.course_title,
    title: task.task_type === "mistake_review" ? "只完成这一项错题复习" : "只完成这一项可靠练习",
    detail: "今天先做这一项，原任务的判定标准和学习路径保持不变。",
    estimated_minutes: estimatedMinutes,
    href: task.href,
  };
}

export class DeterministicStudentCareService implements StudentCareService {
  constructor(
    private readonly repository: StudentCareRepository,
    private readonly orchestration: StudentLearningOrchestrationService,
    private readonly config: StudentCareConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPreference(userId: string): Promise<StudentCarePreferenceRead> {
    const preference = await this.repository.getPreference(userId);
    return studentCarePreferenceReadSchema.parse({
      enabled: preference.enabled,
      updated_at: preference.updatedAt,
    });
  }

  async getStatus(userId: string): Promise<StudentCareStatus> {
    const preference = await this.repository.getPreference(userId);
    if (!this.config.enabled || !preference.enabled) {
      return studentCareStatusSchema.parse({
        kind: "none",
        preference_enabled: preference.enabled,
      });
    }
    const now = this.now();
    await this.repository.expirePendingInvitations(userId, now);
    const lightSession = await this.repository.findActiveLightSession(userId, now);
    if (lightSession) return lightSessionStatus(lightSession);
    const pending = await this.repository.findPendingInvitation(userId, now);
    if (pending) return invitationStatus(pending);
    if (await this.repository.findCooldownUntil(userId, now)) {
      return { kind: "none", preference_enabled: true };
    }
    const match = evaluateStudentCareSignal(
      await this.repository.getRuleEvidence(userId, now),
      this.config,
      now,
    );
    if (!match) return { kind: "none", preference_enabled: true };
    const invitation = await this.repository.createInvitation(userId, match, {
      ruleVersion: this.config.ruleVersion,
      presentedAt: now,
      expiresAt: new Date(now.getTime() + this.config.invitationTtlHours * 60 * 60 * 1_000),
    });
    const latestPreference = await this.repository.getPreference(userId);
    if (!latestPreference.enabled) {
      await this.repository.expireAllPendingInvitations(userId, now);
      return { kind: "none", preference_enabled: false };
    }
    return invitationStatus(invitation);
  }

  async respond(
    userId: string,
    interactionId: string,
    action: StudentCareResponseAction,
  ): Promise<StudentCareResponseResult> {
    const respondedAt = this.now();
    await this.repository.expirePendingInvitations(userId, respondedAt);
    const existing = await this.repository.findInteraction(userId, interactionId);
    if (!existing) {
      throw new StudentCareInteractionError(
        "CARE_INTERACTION_NOT_FOUND",
        "关怀提示不存在或不属于当前学生。",
        404,
      );
    }
    if (existing.status === "expired") {
      throw new StudentCareInteractionError(
        "CARE_INTERACTION_EXPIRED",
        "这条关怀提示已过期，请刷新当前状态。",
        409,
      );
    }
    if (existing.status === "responded") {
      if (existing.response !== action) {
        throw new StudentCareInteractionError(
          "CARE_INTERACTION_ALREADY_RESPONDED",
          "这条关怀提示已经按另一项选择处理。",
          409,
        );
      }
      if (action === "lighten") {
        return studentCareResponseResultSchema.parse({
          action,
          idempotent: true,
          status: lightSessionStatus(existing),
          talk: null,
        });
      }
      if (action === "talk") {
        if (!existing.talkCourseId || !existing.talkFallbackStep) {
          throw new Error("Persisted student-care talk consent is incomplete.");
        }
        return studentCareResponseResultSchema.parse({
          action,
          idempotent: true,
          status: { kind: "none", preference_enabled: true },
          talk: {
            capability: "care",
            course_id: existing.talkCourseId,
            conversation_id: existing.interactionId,
            fallback_step: existing.talkFallbackStep,
          },
        });
      }
      return studentCareResponseResultSchema.parse({
        action,
        idempotent: true,
        status: { kind: "none", preference_enabled: action !== "disable" },
        talk: null,
      });
    }
    const snapshot = action === "lighten" || action === "talk"
      ? await this.orchestration.getSnapshot(userId)
      : null;
    const lightStep = action === "lighten" && snapshot
      ? deriveLightStep(snapshot.current_task)
      : null;
    const talkFallbackStep = action === "talk" && snapshot
      ? deriveLightStep(snapshot.current_task)
      : null;
    const cooldownUntil = action === "disable"
      ? null
      : new Date(
          respondedAt.getTime()
          + (action === "dismiss" ? this.config.cooldownDays.dismiss : this.config.cooldownDays.standard)
            * DAY_MS,
        );
    const persisted = await this.repository.respondToInteraction(
      userId,
      interactionId,
      action,
      {
        respondedAt,
        cooldownUntil,
        lightSessionExpiresAt: action === "lighten" ? endOfShanghaiDay(respondedAt) : null,
        lightStep,
        talkCourseId: action === "talk" && snapshot ? snapshot.current_task.course_id : null,
        talkFallbackStep,
      },
    );
    const status = action === "lighten"
      ? lightSessionStatus(persisted)
      : studentCareStatusSchema.parse({
          kind: "none",
          preference_enabled: action !== "disable",
        });
    return studentCareResponseResultSchema.parse({
      action,
      idempotent: persisted.idempotent,
      status,
      talk: action === "talk" && persisted.talkCourseId
        && persisted.talkFallbackStep
        ? {
            capability: "care",
            course_id: persisted.talkCourseId,
            conversation_id: persisted.interactionId,
            fallback_step: persisted.talkFallbackStep,
          }
        : null,
    });
  }

  async updatePreference(userId: string, enabled: boolean) {
    const updatedAt = this.now();
    const preference = await this.repository.setPreference(userId, enabled, updatedAt);
    if (!enabled) await this.repository.expireAllPendingInvitations(userId, updatedAt);
    if (!preference.updatedAt) throw new Error("Updated student-care preference is missing its timestamp.");
    return studentCarePreferenceSchema.parse({
      enabled: preference.enabled,
      updated_at: preference.updatedAt,
    });
  }
}
