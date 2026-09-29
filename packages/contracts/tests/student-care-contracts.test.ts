import { describe, expect, it } from "vitest";

import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  aiWorkflowInvocationSchema,
  aiWorkflowRequestSchema,
  studentCarePreferenceReadSchema,
  studentCarePreferenceUpdateSchema,
  studentCareRespondRequestSchema,
  studentCareResponseResultSchema,
  studentCareStatusSchema,
} from "../src/index.js";

const invitation = {
  kind: "invitation" as const,
  preference_enabled: true,
  interaction_id: "care_001",
  signal_code: "accuracy_shift" as const,
  greeting: "最近这部分学习好像比平时更费力，要按原计划继续，还是今天轻一点？",
  reason_summary: "最近一周同一门课的确定性作答比个人基线更费力。",
  actions: ["continue", "lighten", "talk", "dismiss", "disable"] as const,
  presented_at: "2026-08-21T08:00:00.000Z",
  expires_at: "2026-08-22T08:00:00.000Z",
};

const lightSession = {
  kind: "light_session" as const,
  preference_enabled: true,
  interaction_id: "care_001",
  signal_code: "accuracy_shift" as const,
  message: "今天先完成一个更轻的步骤，原任务和学习路径都不会被改写。",
  step: {
    task_id: "task_ds_read_001",
    task_type: "course_reading" as const,
    course_id: "course_408_ds",
    course_title: "数据结构",
    title: "回到上次阅读位置",
    detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
    estimated_minutes: 10,
    href: "/student/courses/data-structures?concept_id=ds_c01",
  },
  expires_at: "2026-08-21T15:59:59.999Z",
};

describe("student care contracts", () => {
  it("accepts only the three public care states", () => {
    expect(studentCareStatusSchema.parse({
      kind: "none",
      preference_enabled: true,
    })).toEqual({ kind: "none", preference_enabled: true });
    const parsedInvitation = studentCareStatusSchema.parse(invitation);
    expect(parsedInvitation.kind).toBe("invitation");
    if (parsedInvitation.kind !== "invitation") throw new Error("Expected an invitation state.");
    expect(parsedInvitation.actions).toHaveLength(5);

    const parsedLightSession = studentCareStatusSchema.parse(lightSession);
    expect(parsedLightSession.kind).toBe("light_session");
    if (parsedLightSession.kind !== "light_session") throw new Error("Expected a light-session state.");
    expect(parsedLightSession.step.estimated_minutes).toBe(10);
    expect(studentCareStatusSchema.safeParse({
      kind: "conversation",
      preference_enabled: true,
    }).success).toBe(false);
  });

  it("keeps invitation and light-step payloads strict and browser-safe", () => {
    expect(studentCareStatusSchema.safeParse({
      ...invitation,
      raw_answers: ["A", "C"],
    }).success).toBe(false);
    expect(studentCareStatusSchema.safeParse({
      ...lightSession,
      step: { ...lightSession.step, href: "https://untrusted.example/task" },
    }).success).toBe(false);
    expect(JSON.stringify(studentCareStatusSchema.parse(invitation))).not.toMatch(
      /evidence_id|attempt_id|score|psychological|prompt/iu,
    );
  });

  it("accepts exactly five response actions and a strict preference update", () => {
    for (const action of ["continue", "lighten", "talk", "dismiss", "disable"] as const) {
      expect(studentCareRespondRequestSchema.parse({ action })).toEqual({ action });
    }
    expect(studentCareRespondRequestSchema.safeParse({ action: "complete_task" }).success).toBe(false);
    expect(studentCareRespondRequestSchema.safeParse({ action: "talk", user_id: "other" }).success).toBe(false);
    expect(studentCarePreferenceUpdateSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(studentCarePreferenceUpdateSchema.safeParse({ enabled: true, reason: "private" }).success).toBe(false);
  });

  it("represents an untouched default preference without inventing an update timestamp", () => {
    expect(studentCarePreferenceReadSchema).toBeDefined();
    if (!studentCarePreferenceReadSchema) return;
    expect(studentCarePreferenceReadSchema.parse({
      enabled: true,
      updated_at: null,
    })).toEqual({ enabled: true, updated_at: null });
    expect(studentCarePreferenceReadSchema.safeParse({
      enabled: true,
      updated_at: null,
      invitation_id: "care_hidden_001",
    }).success).toBe(false);
  });

  it("returns a talk descriptor with one server-owned fallback step", () => {
    const result = studentCareResponseResultSchema.parse({
      action: "talk",
      idempotent: false,
      status: { kind: "none", preference_enabled: true },
      talk: {
        capability: "care",
        course_id: "course_408_ds",
        conversation_id: "care_001",
        fallback_step: lightSession.step,
      },
    });
    expect(result.talk).toEqual({
      capability: "care",
      course_id: "course_408_ds",
      conversation_id: "care_001",
      fallback_step: lightSession.step,
    });
    expect(studentCareResponseResultSchema.safeParse({
      ...result,
      talk: {
        ...result.talk,
        fallback_step: { ...lightSession.step, href: "https://untrusted.example/task" },
      },
    }).success).toBe(false);
    expect(studentCareResponseResultSchema.safeParse({
      ...result,
      evidence_summary: { recent_incorrect: 8 },
    }).success).toBe(false);
  });

  it("maps care to its own slot and requires an active text message", () => {
    expect(AI_WORKFLOW_SLOT_BY_CAPABILITY.care).toBe("supportive_check_in");
    expect(aiWorkflowInvocationSchema.parse({
      contract_version: "0.2",
      capability: "care",
      course_id: "course_408_ds",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      conversation_id: "care_001",
      user_message: "我今天有点学不进去，先做哪一步？",
    }).capability).toBe("care");
    expect(aiWorkflowInvocationSchema.safeParse({
      contract_version: "0.2",
      capability: "care",
      course_id: "course_408_ds",
      concept_id: "ds_c01",
      qa_id: null,
      attempt_id: null,
      conversation_id: null,
      user_message: null,
    }).success).toBe(false);
    expect(aiWorkflowInvocationSchema.safeParse({
      contract_version: "0.2",
      capability: "care",
      course_id: "course_408_ds",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      user_message: "继续聊聊。",
    }).success).toBe(false);
  });

  it("accepts only a sanitized consent-gated care workflow context", () => {
    const request = {
      contract_version: "0.2" as const,
      request_id: "workflow_care_001",
      capability: "care" as const,
      slot: "supportive_check_in" as const,
      user_id: "student_001",
      course_id: "course_408_ds",
      concept_id: null,
      source_chunk_ids: [],
      attempt_id: null,
      learning_evidence: [],
      user_message: "我想先把今天的节奏稳下来。",
      context: {
        student: { user_id: "student_001" },
        course: {
          course_id: "course_408_ds",
          title: "数据结构",
          discipline: "计算机科学与技术",
        },
        concept: null,
        source_chunks: [],
        reading_progress: null,
        qa_case: null,
        attempt: null,
        evaluation: null,
        care_check_in: {
          conversation_id: "care_001",
          recent_turns: [
            { role: "user" as const, content: "我今天很难开始。" },
            { role: "assistant" as const, content: "可以先选一个十分钟内能完成的步骤。" },
          ],
          signal_code: "rhythm_drop" as const,
          reason_summary: "最近一周完成学习任务的天数比个人节奏少。",
          consented_at: "2026-08-21T08:05:00.000Z",
          current_task: {
            task_id: "task_ds_read_001",
            task_type: "course_reading" as const,
            course_id: "course_408_ds",
            course_title: "数据结构",
            concept_title: "线性表",
            title: "继续线性表阅读",
            estimated_minutes: 25,
            href: "/student/courses/data-structures?concept_id=ds_c01",
          },
        },
      },
    };
    expect(aiWorkflowRequestSchema.parse(request).context.care_check_in?.signal_code)
      .toBe("rhythm_drop");
    expect(aiWorkflowRequestSchema.parse(request).context.care_check_in?.recent_turns)
      .toHaveLength(2);
    expect(aiWorkflowRequestSchema.safeParse({
      ...request,
      context: {
        ...request.context,
        care_check_in: {
          ...request.context.care_check_in,
          raw_answers: ["A"],
        },
      },
    }).success).toBe(false);
    expect(aiWorkflowRequestSchema.safeParse({
      ...request,
      context: {
        ...request.context,
        care_check_in: {
          ...request.context.care_check_in,
          recent_turns: Array.from({ length: 7 }, (_, index) => ({
            role: index % 2 === 0 ? "user" as const : "assistant" as const,
            content: `turn ${index}`,
          })),
        },
      },
    }).success).toBe(false);
  });
});
