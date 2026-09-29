import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  LearningProbeOffer,
  LearningProbeResult,
  LearningProbeSession,
} from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import type { LearningProbeService } from "../src/services/question-bank/learning-probe-service.js";

const offer = {
  probe_session_id: "probe_1",
  course_id: "course_408_co",
  concept_id: "co_c_01",
  concept_title: "指令系统",
  source_attempt_id: "attempt_anchor",
  anchor_question_id: "q_anchor",
  question: {
    question: {
      id: "q_contrast",
      year: 2024,
      number: 2,
      subject: "组成原理",
      type: "choice",
      multiple: false,
      question: "哪项描述正确？",
      options: [
        { option_id: "A", text: "正确项", assets: [] },
        { option_id: "B", text: "干扰项", assets: [] },
      ],
      tags: ["指令系统"],
      assets: [],
      content_format: "plain_text",
      source: {
        provider: "local",
        dataset_id: "demo",
        source_url: "https://example.com/q",
        license_status: "unverified",
        usage_scope: "local_demo_only",
      },
    },
    learning_metadata: {
      source_type: "self_authored_practice",
      allowed_modes: ["targeted"],
      paper_year: null,
      protect_full_paper: false,
      importance: "core",
      content_review_status: "teacher_verified",
    },
    ranking: null,
  },
  hypothesis_code: "concept_definition",
  surface_difference: "题干情境和干扰项结构不同",
  status: "offered",
  fallback: false,
  fallback_reason: null,
} satisfies LearningProbeOffer;

const session = {
  probe_session_id: "probe_1",
  status: "started",
  question_id: "q_contrast",
  course_id: "course_408_co",
  concept_id: "co_c_01",
  evidence: {
    status: "signal",
    status_label: "待确认",
    statement: "先确认一下这部分是否需要补强。",
    independent_correct_count: 0,
    distinct_correct_question_count: 0,
    first_correct_at: null,
    last_correct_at: null,
    unknowns: ["还需要不同题面的独立证据"],
  },
  next_review_at: null,
  completed_at: null,
} satisfies LearningProbeSession;

const result = {
  session: { ...session, status: "completed", completed_at: "2026-08-29T02:00:00.000Z" },
  evaluation: {
    evaluation_id: "evaluation_1",
    submission_id: "attempt_2",
    question_id: "q_contrast",
    grading_mode: "deterministic_choice",
    status: "correct",
    is_correct: true,
    score: 100,
    correct_option_ids: ["A"],
    explanation: "依据课程规则。",
    reference_solution: null,
    answer_assets: [],
    review_required: false,
    created_at: "2026-08-29T02:00:00.000Z",
    source: offer.question.question.source,
  },
  evidence_kind: "concept_evidence",
  evidence_statement: "新增一条不同题面的正确证据，当前仍需继续观察。",
  next_task: null,
} satisfies LearningProbeResult;

function platformAccess() {
  return {
    async getActor(userId: string) {
      return {
        user: {
          user_id: userId,
          display_name: userId,
          account_status: "active" as const,
          auth_source: "local_development" as const,
          created_at: "2026-08-29T00:00:00.000Z",
          updated_at: "2026-08-29T00:00:00.000Z",
        },
        roles: ["student" as const],
      };
    },
    async isCourseAssigned() { return true; },
  };
}

function service(overrides: Partial<LearningProbeService> = {}): LearningProbeService {
  return {
    async offerForAttempt() { return offer; },
    async getOffer() { return offer; },
    async start() { return offer; },
    async skip() { return session; },
    async submit() { return result; },
    async getSession() { return session; },
    ...overrides,
  };
}

describe("student learning probe routes", () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => { await app?.close(); });

  it("keeps probe reads and writes bound to the authenticated student", async () => {
    const offerForAttempt = vi.fn(async () => offer);
    const start = vi.fn(async () => offer);
    const skip = vi.fn(async () => session);
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      learningProbes: service({ offerForAttempt, start, skip }),
    } as never);

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/student/learning-probes/offer?attempt_id=attempt_anchor",
      headers: { "x-dev-user-id": "student_1" },
    });
    const started = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-probes/probe_1/start",
      headers: { "x-dev-user-id": "student_1" },
    });
    const skipped = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-probes/probe_1/skip",
      headers: { "x-dev-user-id": "student_1" },
    });

    expect(read.statusCode).toBe(200);
    expect(started.statusCode).toBe(200);
    expect(skipped.statusCode).toBe(200);
    expect(offerForAttempt).toHaveBeenCalledWith("student_1", "attempt_anchor");
    expect(start).toHaveBeenCalledWith("student_1", "probe_1");
    expect(skip).toHaveBeenCalledWith("student_1", "probe_1");
  });

  it("reads an offered probe without changing its status", async () => {
    const getOffer = vi.fn(async () => offer);
    const app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      learningProbes: service({ getOffer }),
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/learning-probes/probe_1/offer",
      headers: { "x-dev-user-id": "student_1" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(offer);
    expect(getOffer).toHaveBeenCalledWith("student_1", "probe_1");
  });

  it("requires an idempotency key for probe submissions and passes only server-bound fields", async () => {
    const submit = vi.fn(async () => result);
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      learningProbes: service({ submit }),
    } as never);

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-probes/probe_1/submit",
      headers: { "x-dev-user-id": "student_1" },
      payload: { question_id: "q_contrast", answer_type: "choice", selected_option_ids: ["A"] },
    });
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-probes/probe_1/submit",
      headers: { "x-dev-user-id": "student_1", "idempotency-key": "probe-submit-1" },
      payload: { question_id: "q_contrast", answer_type: "choice", selected_option_ids: ["A"] },
    });

    expect(missing.statusCode).toBe(400);
    expect(accepted.statusCode).toBe(201);
    expect(submit).toHaveBeenCalledWith("student_1", "probe_1", {
      question_id: "q_contrast",
      answer_type: "choice",
      selected_option_ids: ["A"],
    }, "probe-submit-1");
  });

  it("returns replayed probe submissions as 200 with an explicit replay header", async () => {
    const submit = vi.fn(async () => ({ ...result, idempotency_replayed: true }));
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      learningProbes: service({ submit }),
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-probes/probe_1/submit",
      headers: { "x-dev-user-id": "student_1", "idempotency-key": "probe-replay-1" },
      payload: { question_id: "q_contrast", answer_type: "choice", selected_option_ids: ["A"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["idempotency-replayed"]).toBe("true");
    expect(response.json().data).not.toHaveProperty("idempotency_replayed");
  });
});
