import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applyConceptEvidence,
  emptyConceptEvidence,
  type ConceptEvidenceInput,
} from "../src/services/question-bank/concept-evidence.js";
import {
  validateQuestionPair,
  type QuestionPairCandidate,
} from "../src/services/question-bank/question-pair-governance.js";

function evidence(overrides: Partial<ConceptEvidenceInput> = {}): ConceptEvidenceInput {
  return {
    outcome: "correct",
    question_id: "q-contrast-1",
    attempt_id: "attempt-1",
    evaluated_at: "2026-08-01T08:00:00.000Z",
    question_role: "contrast",
    independent: true,
    eligible: true,
    ...overrides,
  };
}

function pair(overrides: Partial<QuestionPairCandidate> = {}): QuestionPairCandidate {
  return {
    pair_group_id: "pair-1",
    course_id: "course_408_co",
    concept_id: "co-c-01",
    question_id: "q-anchor",
    contrast_question_id: "q-contrast",
    hypothesis_code: "concept_definition",
    surface_difference: "题干情境和干扰项结构不同",
    question_role: "contrast",
    content_review_status: "teacher_verified",
    status: "active",
    algorithm_version: "evidence_probe_v1",
    anchor_course_id: "course_408_co",
    anchor_concept_id: "co-c-01",
    anchor_question_type: "choice",
    anchor_review_status: "approved",
    anchor_content_review_status: "teacher_verified",
    anchor_allowed_modes: ["targeted"],
    anchor_protect_full_paper: false,
    anchor_source_type: "self_authored_practice",
    anchor_usage_scope: "authorized_product_use",
    anchor_license_status: "verified",
    anchor_assets_complete: true,
    contrast_question_type: "choice",
    contrast_review_status: "approved",
    contrast_content_review_status: "teacher_verified",
    contrast_allowed_modes: ["targeted"],
    contrast_protect_full_paper: false,
    contrast_source_type: "self_authored_practice",
    contrast_usage_scope: "authorized_product_use",
    contrast_license_status: "verified",
    contrast_assets_complete: true,
    contrast_course_id: "course_408_co",
    contrast_concept_id: "co-c-01",
    ...overrides,
  } as QuestionPairCandidate;
}

describe("evidence-driven learning loop migration", () => {
  it("defines governed question pairs, probe sessions, and immutable evidence events", () => {
    const migrationPath = fileURLToPath(new URL(
      "../src/database/migrations/049_evidence_driven_learning_loop.sql",
      import.meta.url,
    ));
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE learning_question_pairs");
    expect(sql).toContain("content_review_status IN ('pending_teacher_review', 'teacher_verified', 'disabled')");
    expect(sql).toContain("CREATE TABLE student_learning_probe_sessions");
    expect(sql).toContain("CREATE TABLE student_learning_probe_events");
    expect(sql).toContain("UNIQUE (user_id, idempotency_key)");
    expect(sql).toContain("CREATE TABLE student_concept_evidence");
    expect(sql).toContain("status IN ('signal', 'developing', 'provisionally_stable', 'transfer_validated')");
    expect(sql).toContain("result_payload jsonb NULL");
    expect(sql).toContain("student_learning_probe_events");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+TABLE\b/iu);
  });

  it("documents the replay source on the result column that 049 actually creates", () => {
    const migrationPath = fileURLToPath(new URL(
      "../src/database/migrations/050_clarify_probe_result_authority.sql",
      import.meta.url,
    ));
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("COMMENT ON COLUMN student_learning_probe_events.result_payload");
    expect(sql).not.toContain("COMMENT ON COLUMN student_learning_probe_sessions.result_payload");
  });
});

describe("question pair governance", () => {
  it("rejects a pair when the questions are the same, cross-course, or not teacher verified", () => {
    expect(validateQuestionPair(pair({ question_id: "q-1", contrast_question_id: "q-1" })).ok).toBe(false);
    expect(validateQuestionPair(pair({
      anchor_course_id: "course_408_ds",
    } as Partial<QuestionPairCandidate>))).toEqual({ ok: false, reason: "cross_course" });
    expect(validateQuestionPair(pair({
      anchor_concept_id: "co-c-02",
    } as Partial<QuestionPairCandidate>))).toEqual({ ok: false, reason: "cross_concept" });
    expect(validateQuestionPair(pair({ contrast_course_id: "course_408_ds" })).ok).toBe(false);
    expect(validateQuestionPair(pair({ contrast_concept_id: "co-c-02" })).ok).toBe(false);
    expect(validateQuestionPair(pair({ content_review_status: "pending_teacher_review" })).ok).toBe(false);
    expect(validateQuestionPair(pair({ status: "disabled" })).ok).toBe(false);
    expect(validateQuestionPair(pair({ question_role: "anchor" }))).toEqual({
      ok: false,
      reason: "invalid_role",
    });
  });

  it("accepts only a distinct, same-course, same-concept verified contrast question", () => {
    expect(validateQuestionPair(pair())).toEqual({ ok: true });
  });

  it("accepts a shared 408 anchor when its subject catalog maps to the governed course", () => {
    expect(validateQuestionPair(pair({
      anchor_course_id: "course_408_001",
      ...({ anchor_catalog_course_id: "course_408_co" } as Partial<QuestionPairCandidate>),
    }))).toEqual({ ok: true });
  });

  it("rejects a pair when either governed question is not fully reviewed", () => {
    expect(validateQuestionPair(pair({
      anchor_review_status: "pending_review",
    } as Partial<QuestionPairCandidate>))).toEqual({ ok: false, reason: "not_verified" });
    expect(validateQuestionPair(pair({ contrast_review_status: "pending_review" }))).toEqual({
      ok: false,
      reason: "not_verified",
    });
  });

  it("requires both product-use authorization and a verified license for non-self-authored questions", () => {
    expect(validateQuestionPair(pair({
      contrast_source_type: "past_exam",
      contrast_usage_scope: "local_demo_only",
      contrast_license_status: "verified",
    } as Partial<QuestionPairCandidate>))).toEqual({ ok: false, reason: "not_student_visible" });
    expect(validateQuestionPair(pair({
      contrast_source_type: "past_exam",
      contrast_usage_scope: "authorized_product_use",
      contrast_license_status: "unverified",
    } as Partial<QuestionPairCandidate>))).toEqual({ ok: false, reason: "not_student_visible" });
    expect(validateQuestionPair(pair({
      contrast_source_type: "self_authored_practice",
      contrast_usage_scope: "local_demo_only",
      contrast_license_status: "unverified",
    } as Partial<QuestionPairCandidate>))).toEqual({ ok: true });
  });
});

describe("concept evidence state machine", () => {
  it("keeps a first incorrect answer as a signal and ignores duplicate same-question correctness", () => {
    const signalled = applyConceptEvidence(
      emptyConceptEvidence("co-c-01"),
      evidence({ outcome: "incorrect", question_id: "q-anchor", attempt_id: "a-anchor", question_role: "anchor" }),
    );
    expect(signalled.status).toBe("signal");

    const duplicate = applyConceptEvidence(
      signalled,
      evidence({ question_id: "q-anchor", attempt_id: "a-retry", evaluated_at: "2026-08-02T08:00:00.000Z", question_role: "anchor" }),
    );
    expect(duplicate.correct_question_ids).toEqual([]);
    expect(duplicate.status).toBe("signal");
  });

  it("requires independent questions and seven days before provisional stability", () => {
    let state = emptyConceptEvidence("co-c-01");
    state = applyConceptEvidence(state, evidence({ outcome: "incorrect", question_id: "q-anchor", attempt_id: "a0", question_role: "anchor", evaluated_at: "2026-08-01T08:00:00.000Z" }));
    state = applyConceptEvidence(state, evidence({ question_id: "q-contrast", attempt_id: "a1", evaluated_at: "2026-08-02T08:00:00.000Z" }));
    expect(state.status).toBe("developing");
    state = applyConceptEvidence(state, evidence({ question_id: "q-contrast-2", attempt_id: "a2", evaluated_at: "2026-08-05T08:00:00.000Z" }));
    expect(state.status).toBe("developing");
    state = applyConceptEvidence(state, evidence({ question_id: "q-contrast-3", attempt_id: "a3", evaluated_at: "2026-08-09T08:00:00.000Z" }));
    expect(state.status).toBe("provisionally_stable");
  });

  it("does not update state for skipped or pending-review evidence", () => {
    const state = emptyConceptEvidence("co-c-01");
    expect(applyConceptEvidence(state, evidence({ outcome: "skipped", eligible: false })).status).toBe("signal");
    expect(applyConceptEvidence(state, evidence({ outcome: "pending_review", eligible: false })).status).toBe("signal");
  });

  it("resolves at most one pending incorrect signal per independent correct answer", () => {
    let state = emptyConceptEvidence("co-c-01");
    state = applyConceptEvidence(state, evidence({
      outcome: "incorrect",
      question_id: "q-anchor-1",
      attempt_id: "a-error-1",
      question_role: "anchor",
    }));
    state = applyConceptEvidence(state, evidence({
      outcome: "incorrect",
      question_id: "q-anchor-2",
      attempt_id: "a-error-2",
      question_role: "anchor",
    }));
    state = applyConceptEvidence(state, evidence({
      question_id: "q-contrast-1",
      attempt_id: "a-correct-1",
    }));

    expect(state.incorrect_attempt_ids).toEqual(["a-error-2"]);
    expect(state.status).toBe("signal");
  });

  it("does not let a transfer question bypass the stability evidence window", () => {
    let state = emptyConceptEvidence("co-c-01");
    state = applyConceptEvidence(state, evidence({ question_id: "q-1", attempt_id: "a-1", evaluated_at: "2026-08-01T08:00:00.000Z" }));
    state = applyConceptEvidence(state, evidence({ question_id: "q-2", attempt_id: "a-2", evaluated_at: "2026-08-02T08:00:00.000Z" }));
    state = applyConceptEvidence(state, evidence({
      question_id: "q-transfer",
      attempt_id: "a-transfer",
      question_role: "transfer",
      evaluated_at: "2026-08-03T08:00:00.000Z",
    }));

    expect(state.status).not.toBe("transfer_validated");
    expect(state.status).toBe("developing");
  });

  it("downgrades a previously validated concept when a new reliable incorrect arrives", () => {
    const validated: ReturnType<typeof emptyConceptEvidence> = {
      ...emptyConceptEvidence("co-c-01"),
      status: "transfer_validated",
      correct_question_ids: ["q-1", "q-2", "q-transfer"],
      correct_attempt_ids: ["a-1", "a-2", "a-transfer"],
      first_correct_at: "2026-08-01T08:00:00.000Z",
      last_correct_at: "2026-08-10T08:00:00.000Z",
    };
    const next = applyConceptEvidence(validated, evidence({
      outcome: "incorrect",
      question_id: "q-new-error",
      attempt_id: "a-new-error",
      question_role: "ordinary",
      evaluated_at: "2026-08-11T08:00:00.000Z",
    }));

    expect(next.status).toBe("signal");
    expect(next.incorrect_attempt_ids).toEqual(["a-new-error"]);
  });
});
