import { describe, expect, it, vi } from "vitest";

import type { QuestionPracticeItem } from "@xuetu/contracts";

import type {
  SqlClient,
  SqlQueryResult,
  SqlQueryablePool,
} from "../src/database/client.js";
import { PostgresLearningProbe } from "../src/services/question-bank/postgres-learning-probe.js";
import type {
  QuestionBankService,
  QuestionEvaluationBundle,
} from "../src/services/question-bank/question-bank.js";

const practiceItem: QuestionPracticeItem = {
  question: {
    id: "q_contrast",
    year: null,
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
      provider: "self_authored",
      dataset_id: "co_probe_v1",
      source_url: "https://example.com/q",
      license_status: "verified",
      usage_scope: "authorized_product_use",
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
};

const evaluation: QuestionEvaluationBundle = {
  attempt: {
    attempt_id: "attempt_contrast",
    user_id: "student_1",
    course_id: "course_408_001",
    question_id: "q_contrast",
    concept_id: "co_c_01",
    answer_type: "choice",
    selected_option_ids: ["A"],
    response_text: null,
    status: "evaluated",
    submitted_at: "2026-08-29T02:00:00.000Z",
  },
  evaluation: {
    evaluation_id: "evaluation_contrast",
    submission_id: "attempt_contrast",
    question_id: "q_contrast",
    grading_mode: "deterministic_choice",
    status: "correct",
    is_correct: true,
    score: 100,
    correct_option_ids: ["A"],
    explanation: "课程规则解释",
    reference_solution: null,
    answer_assets: [],
    review_required: false,
    created_at: "2026-08-29T02:00:00.000Z",
    source: practiceItem.question.source,
  },
  evidence: {
    evidence_id: "evidence_contrast",
    evaluation_id: "evaluation_contrast",
    submission_id: "attempt_contrast",
    question_id: "q_contrast",
    concept_id: "co_c_01",
    subject: "组成原理",
    year: null,
    question_type: "choice",
    outcome: "correct",
    grading_mode: "deterministic_choice",
    selected_option_ids: ["A"],
    response_present: false,
    tags: ["指令系统"],
    review_required: false,
    eligible_for_learning_state_update: true,
    persistence_status: "persisted",
    created_at: "2026-08-29T02:00:00.000Z",
    source: practiceItem.question.source,
  },
};

function questionBank(courseId = "course_408_001") {
  return {
    courseId,
    listPastExamPapers: vi.fn(),
    openAsset: vi.fn(),
    select: vi.fn(async () => ({ items: [practiceItem], total: 1, limit: 1, offset: 0 })),
    get: vi.fn(),
    evaluate: vi.fn(async () => evaluation),
  } satisfies QuestionBankService;
}

function poolWithQuery(query: SqlQueryablePool["query"]): SqlQueryablePool {
  const client: SqlClient = {
    query,
    release() {},
  };
  return { query, async connect() { return client; } };
}

function concurrentSubmissionPool() {
  let sessionStatus: "started" | "completed" = "started";
  let lockTail = Promise.resolve();
  const replayPayloads = new Map<string, unknown>();

  const query = async <Row>(
    sql: string,
    values: readonly unknown[] = [],
    transaction?: { releaseLock?: (() => void) | undefined },
  ): Promise<SqlQueryResult<Row>> => {
    if (sql === "BEGIN") return { rows: [], rowCount: null };
    if (sql === "COMMIT" || sql === "ROLLBACK") {
      transaction?.releaseLock?.();
      if (transaction) transaction.releaseLock = undefined;
      return { rows: [], rowCount: null };
    }
    if (sql.includes("pg_advisory_xact_lock")) {
      const previous = lockTail;
      let releaseLock = () => {};
      lockTail = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      await previous;
      if (transaction) transaction.releaseLock = releaseLock;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM student_learning_probe_events") && sql.includes("result_payload")) {
      const payload = replayPayloads.get(String(values[1]));
      return {
        rows: payload === undefined ? [] : [{
          probe_session_id: "probe_1",
          event_type: "submitted",
          result_payload: payload,
        } as Row],
        rowCount: payload === undefined ? 0 : 1,
      };
    }
    if (sql.includes("FROM student_learning_probe_sessions session")) {
      return { rows: [{
        probe_session_id: "probe_1", user_id: "student_1", status: sessionStatus, pair_id: "pair_1",
        course_id: "course_408_co", concept_id: "co_c_01", concept_title: "指令系统",
        source_attempt_id: "attempt_anchor", anchor_question_id: "q_anchor",
        contrast_question_id: "q_contrast", question_role: "contrast", data_origin: "local_demo",
        started_at: "2026-08-29T01:30:00.000Z",
        completed_at: sessionStatus === "completed" ? "2026-08-29T02:00:00.000Z" : null,
        skipped_at: null,
      } as Row], rowCount: 1 };
    }
    if (sql.includes("UPDATE student_learning_probe_sessions") && sql.includes("status = 'completed'")) {
      if (sessionStatus !== "started") return { rows: [], rowCount: 0 };
      sessionStatus = "completed";
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM student_concept_evidence_events")) {
      return { rows: [{
        outcome: "correct", question_id: "q_contrast", attempt_id: "attempt_contrast",
        created_at: "2026-08-29T02:00:00.000Z", question_role: "contrast",
        independent: true, eligible_for_learning_state_update: true,
      } as Row], rowCount: 1 };
    }
    if (sql.includes("UPDATE student_learning_probe_events") && sql.includes("result_payload")) {
      replayPayloads.set(String(values[1]), JSON.parse(String(values[2])));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };

  const pool: SqlQueryablePool = {
    query: (sql, values) => query(sql, values),
    async connect() {
      const transaction: { releaseLock?: (() => void) | undefined } = {};
      return {
        query: (sql, values) => query(sql, values, transaction),
        release() {
          transaction.releaseLock?.();
          transaction.releaseLock = undefined;
        },
      };
    },
  };
  return pool;
}

describe("PostgresLearningProbe", () => {
  it("records the reliable anchor signal but falls back when no verified pair exists", async () => {
    const statements: string[] = [];
    const parameters: Array<readonly unknown[]> = [];
    const pool = poolWithQuery(async <Row>(
      sql: string,
      values: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> => {
      statements.push(sql);
      parameters.push(values);
      if (sql.includes("FROM practice_attempts anchor_attempt")) {
        return { rows: [{
          attempt_id: "attempt_anchor", evaluation_id: "evaluation_anchor",
          question_id: "q_anchor", course_id: "course_408_co", concept_id: "co_c_01",
          concept_title: "指令系统", subject: "组成原理", created_at: "2026-08-29T01:00:00.000Z",
        } as Row], rowCount: 1 };
      }
      if (sql.includes("FROM learning_question_pairs pair")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM student_concept_evidence_events")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const bank = questionBank();

    const offer = await new PostgresLearningProbe(pool, bank, {
      now: () => new Date("2026-08-29T02:00:00.000Z"),
      createId: (prefix) => `${prefix}_1`,
    }).offerForAttempt("student_1", "attempt_anchor");

    expect(offer).toBeNull();
    expect(bank.select).not.toHaveBeenCalled();
    expect(statements.some((sql) => sql.includes("INSERT INTO student_concept_evidence_events"))).toBe(true);
    expect(statements.some((sql) => sql.includes("INSERT INTO student_concept_evidence"))).toBe(true);
    const anchorSql = statements.find((sql) => sql.includes("FROM practice_attempts anchor_attempt")) ?? "";
    expect(anchorSql).toContain("participant.participant_kind = 'real_trial'");
    expect(anchorSql).toMatch(/THEN 'real_trial'[\s\S]*ELSE 'local_demo'/u);
    const eventIndex = statements.findIndex((sql) => sql.includes("INSERT INTO student_concept_evidence_events"));
    expect(parameters[eventIndex]?.[12]).toBe("local_demo");
  });

  it("offers only the server-selected contrast question from a verified pair", async () => {
    const statements: string[] = [];
    const pool = poolWithQuery(async <Row>(sql: string): Promise<SqlQueryResult<Row>> => {
      statements.push(sql);
      if (sql.includes("FROM practice_attempts anchor_attempt")) {
        return { rows: [{
          attempt_id: "attempt_anchor", evaluation_id: "evaluation_anchor",
          question_id: "q_anchor", course_id: "course_408_co", concept_id: "co_c_01",
          concept_title: "指令系统", subject: "组成原理", created_at: "2026-08-29T01:00:00.000Z",
          data_origin: "local_demo",
        } as Row], rowCount: 1 };
      }
      if (sql.includes("FROM learning_question_pairs pair")) {
        return { rows: [{
          pair_id: "pair_1", pair_group_id: "group_1", question_id: "q_anchor",
          contrast_question_id: "q_contrast", hypothesis_code: "concept_definition",
          surface_difference: "题干情境和干扰项结构不同", question_role: "contrast",
           course_id: "course_408_co", concept_id: "co_c_01",
           anchor_course_id: "course_408_001", anchor_concept_id: "co_c_01",
           anchor_catalog_course_id: "course_408_co",
           anchor_question_type: "choice", anchor_review_status: "approved",
           anchor_content_review_status: "teacher_verified", anchor_allowed_modes: ["targeted"],
           anchor_protect_full_paper: false, anchor_source_type: "self_authored_practice",
           anchor_usage_scope: "authorized_product_use", anchor_license_status: "verified",
           anchor_assets_complete: true,
           contrast_course_id: "course_408_co", contrast_concept_id: "co_c_01",
           contrast_question_type: "choice", contrast_review_status: "approved",
           contrast_content_review_status: "teacher_verified", contrast_allowed_modes: ["targeted"],
           contrast_protect_full_paper: false, contrast_source_type: "self_authored_practice",
           contrast_usage_scope: "authorized_product_use", contrast_license_status: "verified",
           contrast_assets_complete: true,
           content_review_status: "teacher_verified", status: "active",
          algorithm_version: "evidence_probe_v1", source_provenance: "teacher_verified",
        } as Row], rowCount: 1 };
      }
      if (sql.includes("RETURNING probe_session_id")) {
        return { rows: [{ probe_session_id: "probe_1", status: "offered" } as Row], rowCount: 1 };
      }
      if (sql.includes("FROM student_concept_evidence_events")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const bank = questionBank();

    const offer = await new PostgresLearningProbe(pool, bank, {
      now: () => new Date("2026-08-29T02:00:00.000Z"),
      createId: (prefix) => `${prefix}_1`,
    }).offerForAttempt("student_1", "attempt_anchor");

    expect(offer).toMatchObject({
      probe_session_id: "probe_1",
      anchor_question_id: "q_anchor",
      question: { question: { id: "q_contrast" } },
      fallback: false,
    });
    expect(bank.select).toHaveBeenCalledWith("student_1", expect.objectContaining({
      mode: "targeted",
      concept_id: "co_c_01",
      question_id: "q_contrast",
      subject: "组成原理",
    }));
    const pairSql = statements.find((sql) => sql.includes("FROM learning_question_pairs pair")) ?? "";
    expect(pairSql).toContain("JOIN course_catalog_entries contrast_catalog");
    expect(pairSql).toContain("anchor_catalog.course_id AS anchor_catalog_course_id");
    expect(pairSql).toContain("JOIN question_learning_metadata anchor_meta");
    expect(pairSql).toContain("anchor_meta.content_review_status = 'teacher_verified'");
    expect(pairSql).toContain("anchor_link.concept_id IS NOT NULL");
    expect(pairSql).toContain("contrast_catalog.question_subject = contrast.subject");
    expect(pairSql).toContain("contrast.question_type = 'choice'");
    expect(pairSql).toContain("pair.question_role IN ('contrast', 'transfer')");
    expect(pairSql).toContain("contrast_meta.protect_full_paper = false");
    expect(statements.some((sql) => sql.includes("INSERT INTO student_concept_evidence"))).toBe(true);
  });

  it("resolves the question bank for the pair course instead of using the aggregate bank", async () => {
    const pool = poolWithQuery(async <Row>(sql: string): Promise<SqlQueryResult<Row>> => {
      if (sql.includes("FROM practice_attempts anchor_attempt")) {
        return { rows: [{
          attempt_id: "attempt_anchor", evaluation_id: "evaluation_anchor",
          question_id: "q_anchor", course_id: "course_408_co", concept_id: "co_c_01",
          concept_title: "指令系统", subject: "组成原理", created_at: "2026-08-29T01:00:00.000Z",
          data_origin: "local_demo",
        } as Row], rowCount: 1 };
      }
      if (sql.includes("FROM learning_question_pairs pair")) {
        return { rows: [{
          pair_id: "pair_1", pair_group_id: "group_1", question_id: "q_anchor",
          contrast_question_id: "q_contrast", hypothesis_code: "concept_definition",
          surface_difference: "题干情境和干扰项结构不同", question_role: "contrast",
          course_id: "course_408_co", concept_id: "co_c_01",
          anchor_course_id: "course_408_co", anchor_concept_id: "co_c_01",
          anchor_question_type: "choice", anchor_review_status: "approved",
          anchor_content_review_status: "teacher_verified", anchor_allowed_modes: ["targeted"],
          anchor_protect_full_paper: false, anchor_source_type: "self_authored_practice",
          anchor_usage_scope: "authorized_product_use", anchor_license_status: "verified",
          anchor_assets_complete: true,
          contrast_course_id: "course_408_co", contrast_concept_id: "co_c_01",
          contrast_question_type: "choice", contrast_review_status: "approved",
          contrast_content_review_status: "teacher_verified", contrast_allowed_modes: ["targeted"],
          contrast_protect_full_paper: false, contrast_source_type: "self_authored_practice",
          contrast_usage_scope: "authorized_product_use", contrast_license_status: "verified",
          contrast_assets_complete: true,
          content_review_status: "teacher_verified", status: "active",
          algorithm_version: "evidence_probe_v1", source_provenance: "teacher_verified",
        } as Row], rowCount: 1 };
      }
      if (sql.includes("RETURNING probe_session_id")) {
        return { rows: [{ probe_session_id: "probe_1", status: "offered" } as Row], rowCount: 1 };
      }
      if (sql.includes("FROM student_concept_evidence_events")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const aggregateBank = questionBank("course_408_001");
    aggregateBank.select.mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 });
    const courseBank = questionBank("course_408_co");

    const offer = await new PostgresLearningProbe(pool, aggregateBank, {
      questionBankForCourse: (courseId) => courseId === "course_408_co" ? courseBank : null,
      now: () => new Date("2026-08-29T02:00:00.000Z"),
      createId: (prefix) => `${prefix}_1`,
    }).offerForAttempt("student_1", "attempt_anchor");

    expect(offer?.question.question.id).toBe("q_contrast");
    expect(aggregateBank.select).not.toHaveBeenCalled();
    expect(courseBank.select).toHaveBeenCalledWith("student_1", expect.objectContaining({
      question_id: "q_contrast",
      subject: "组成原理",
    }));
  });

  it("persists a submitted probe event before storing its replay payload", async () => {
    const statements: string[] = [];
    const pool = poolWithQuery(async <Row>(sql: string): Promise<SqlQueryResult<Row>> => {
      statements.push(sql);
      if (sql.includes("FROM student_learning_probe_events") && sql.includes("result_payload")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM student_learning_probe_sessions session")) {
        return { rows: [{
          probe_session_id: "probe_1", user_id: "student_1", status: "started", pair_id: "pair_1",
          course_id: "course_408_co", concept_id: "co_c_01", concept_title: "指令系统",
          source_attempt_id: "attempt_anchor", anchor_question_id: "q_anchor",
          contrast_question_id: "q_contrast", question_role: "contrast", data_origin: "local_demo",
          started_at: "2026-08-29T01:30:00.000Z", completed_at: null, skipped_at: null,
        } as Row], rowCount: 1 };
      }
      if (sql.includes("FROM student_concept_evidence_events")) {
        return { rows: [{
          outcome: "correct", question_id: "q_contrast", attempt_id: "attempt_contrast",
          created_at: "2026-08-29T02:00:00.000Z", question_role: "contrast",
          independent: true, eligible_for_learning_state_update: true,
        } as Row], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await new PostgresLearningProbe(pool, questionBank(), {
      now: () => new Date("2026-08-29T02:00:00.000Z"),
      createId: (prefix) => `${prefix}_1`,
    }).submit("student_1", "probe_1", {
      question_id: "q_contrast",
      answer_type: "choice",
      selected_option_ids: ["A"],
    }, "probe-submit-1");

    expect(result.session.status).toBe("completed");
    const insertIndex = statements.findIndex((sql) => (
      sql.includes("INSERT INTO student_learning_probe_events") && sql.includes("'submitted'")
    ));
    const payloadUpdateIndex = statements.findIndex((sql) => (
      sql.includes("UPDATE student_learning_probe_events") && sql.includes("result_payload")
    ));
    expect(insertIndex).toBeGreaterThan(-1);
    expect(payloadUpdateIndex).toBeGreaterThan(insertIndex);
  });

  it("evaluates a probe only once when different idempotency keys submit concurrently", async () => {
    const bank = questionBank();
    bank.evaluate.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return evaluation;
    });
    const service = new PostgresLearningProbe(concurrentSubmissionPool(), bank, {
      now: () => new Date("2026-08-29T02:00:00.000Z"),
      createId: (prefix) => `${prefix}_1`,
    });
    const input = {
      question_id: "q_contrast",
      answer_type: "choice" as const,
      selected_option_ids: ["A"],
    };

    const outcomes = await Promise.allSettled([
      service.submit("student_1", "probe_1", input, "probe-submit-a"),
      service.submit("student_1", "probe_1", input, "probe-submit-b"),
    ]);

    expect(bank.evaluate).toHaveBeenCalledTimes(1);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { code: "LEARNING_PROBE_NOT_ACTIVE" },
    });
  });

  it("uses the question-bank transaction when the concrete bank provides one", async () => {
    const bank = questionBank();
    const evaluateInTransaction = vi.fn(async () => evaluation);
    bank.evaluate.mockImplementation(async () => {
      throw new Error("standalone evaluation must not be used");
    });
    Object.assign(bank, { evaluateInTransaction });
    const service = new PostgresLearningProbe(concurrentSubmissionPool(), bank, {
      now: () => new Date("2026-08-29T02:00:00.000Z"),
      createId: (prefix) => `${prefix}_1`,
    });

    await expect(service.submit("student_1", "probe_1", {
      question_id: "q_contrast",
      answer_type: "choice",
      selected_option_ids: ["A"],
    }, "probe-transaction-1")).resolves.toMatchObject({
      session: { status: "completed" },
    });
    expect(evaluateInTransaction).toHaveBeenCalledTimes(1);
    expect(bank.evaluate).not.toHaveBeenCalled();
  });

  it("rejects a forged contrast question before evaluating it", async () => {
    const pool = poolWithQuery(async <Row>(sql: string): Promise<SqlQueryResult<Row>> => {
      if (sql.includes("FROM student_learning_probe_sessions session")) {
        return { rows: [{
          probe_session_id: "probe_1", status: "started", pair_id: "pair_1",
          course_id: "course_408_co", concept_id: "co_c_01", concept_title: "指令系统",
          anchor_question_id: "q_anchor", contrast_question_id: "q_contrast",
          question_role: "contrast", data_origin: "local_demo",
        } as Row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const bank = questionBank();
    const service = new PostgresLearningProbe(pool, bank);

    await expect(service.submit("student_1", "probe_1", {
      question_id: "q_forged",
      answer_type: "choice",
      selected_option_ids: ["A"],
    }, "probe-key-1")).rejects.toMatchObject({ code: "LEARNING_PROBE_QUESTION_MISMATCH" });
    expect(bank.evaluate).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key that belongs to a different probe session", async () => {
    const bank = questionBank();
    const pool = poolWithQuery(async <Row>(sql: string): Promise<SqlQueryResult<Row>> => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("pg_advisory_xact_lock")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM student_learning_probe_events") && sql.includes("result_payload")) {
        return {
          rows: [{
            probe_session_id: "probe_other",
            event_type: "submitted",
            result_payload: {},
          } as Row],
          rowCount: 1,
        };
      }
      throw new Error("a cross-session idempotency key must be rejected before loading the session");
    });

    await expect(new PostgresLearningProbe(pool, bank).submit(
      "student_1",
      "probe_1",
      {
        question_id: "q_contrast",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
      "probe-key-reused",
    )).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(bank.evaluate).not.toHaveBeenCalled();
  });

  it("keeps an expired probe terminal instead of allowing skip", async () => {
    const pool = poolWithQuery(async <Row>(sql: string): Promise<SqlQueryResult<Row>> => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM student_learning_probe_sessions session")) {
        return {
          rows: [{
            probe_session_id: "probe_expired",
            user_id: "student_1",
            status: "expired",
            pair_id: "pair_1",
            course_id: "course_408_co",
            concept_id: "co_c_01",
            concept_title: "指令系统",
            source_attempt_id: "attempt_anchor",
            anchor_question_id: "q_anchor",
            contrast_question_id: "q_contrast",
            question_role: "contrast",
            data_origin: "local_demo",
            started_at: null,
            completed_at: null,
            skipped_at: null,
          } as Row],
          rowCount: 1,
        };
      }
      throw new Error("an expired probe must not be updated");
    });

    await expect(new PostgresLearningProbe(pool, questionBank()).skip(
      "student_1",
      "probe_expired",
    )).rejects.toMatchObject({ code: "LEARNING_PROBE_NOT_ACTIVE" });
  });
});
