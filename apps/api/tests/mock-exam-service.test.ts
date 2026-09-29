import { describe, expect, it } from "vitest";

import type {
  AnswerSubmission,
  QuestionDto,
} from "@xuetu/contracts";

import type {
  SqlClient,
  SqlQueryResult,
  SqlQueryablePool,
} from "../src/database/client.js";
import {
  evaluateStoredQuestion,
  type QuestionEvaluationBundle,
  type StoredQuestion,
} from "../src/services/question-bank/question-bank.js";
import {
  MockExamError,
} from "../src/services/question-bank/mock-exam.js";
import {
  PostgresMockExam,
  type TransactionalQuestionEvaluator,
} from "../src/services/question-bank/postgres-mock-exam.js";

const now = new Date("2026-08-24T06:00:00.000Z");
const source = {
  provider: "csgraduates.com",
  dataset_id: "408_json_data",
  source_url: "https://www.csgraduates.com/study_methods/408quiz/2023/",
  license_status: "unverified" as const,
  usage_scope: "local_demo_only" as const,
};

function publicQuestion(id: string, number: number, type: "choice" | "subjective"): QuestionDto {
  return {
    id,
    year: 2023,
    number,
    subject: number <= 13 ? "数据结构" : "操作系统",
    type,
    multiple: false,
    question: `2023 年第 ${number} 题`,
    options: type === "choice"
      ? [
          { option_id: "A", text: "选项 A", assets: [] },
          { option_id: "B", text: "选项 B", assets: [] },
        ]
      : [],
    tags: ["408真题"],
    assets: [],
    content_format: "plain_text",
    source,
  };
}

const questions = [
  publicQuestion("2023-01", 1, "choice"),
  publicQuestion("2023-02", 2, "choice"),
  publicQuestion("2023-41", 41, "subjective"),
];

const storedQuestions = new Map<string, StoredQuestion>(questions.map((question) => [
  question.id,
  {
    courseId: "course_408_001",
    question,
    correctOptionIds: question.type === "choice" ? ["A"] : [],
    explanation: question.type === "choice" ? "选择 A。" : null,
    referenceSolution: question.type === "subjective" ? "参考解法。" : null,
    answerAssets: [],
  },
]));

function questionRow(question: QuestionDto) {
  return {
    question_id: question.id,
    year: question.year,
    number: question.number,
    subject: question.subject,
    question_type: question.type,
    multiple: question.multiple,
    question_text: question.question,
    options: question.options,
    tags: question.tags,
    assets: question.assets,
    source_provider: question.source.provider,
    dataset_id: question.source.dataset_id,
    source_url: question.source.source_url,
    license_status: question.source.license_status,
    usage_scope: question.source.usage_scope,
    source_type: "past_exam",
    allowed_modes: ["targeted", "past_exam", "mock_exam"],
    paper_year: question.year,
    protect_full_paper: true,
    importance: "core",
    content_review_status: "pending_teacher_review",
  };
}

function snapshotRow(question: QuestionDto, index: number) {
  return {
    question_id: question.id,
    question_type: question.type,
    ordinal: index + 1,
    question_payload: {
      question,
      learning_metadata: {
        source_type: "past_exam",
        allowed_modes: ["targeted", "past_exam", "mock_exam"],
        paper_year: 2023,
        protect_full_paper: true,
        importance: "core",
        content_review_status: "pending_teacher_review",
      },
      ranking: null,
    },
    evaluation_payload: {
      course_id: "course_408_001",
      answer_key: question.type === "choice" ? ["A"] : [],
      explanation: question.type === "choice" ? "选择 A。" : null,
      reference_solution: question.type === "subjective" ? "参考解法。" : null,
      answer_assets: [],
    },
  };
}

function result<Row = Record<string, unknown>>(rows: Row[] = [], rowCount = rows.length): SqlQueryResult<Row> {
  return { rows, rowCount };
}

function createPool(
  handler: (sql: string, parameters: readonly unknown[]) => SqlQueryResult | Promise<SqlQueryResult>,
) {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async <Row = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> => {
    calls.push({ sql, parameters });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result() as SqlQueryResult<Row>;
    return await handler(sql, parameters) as SqlQueryResult<Row>;
  };
  const client: SqlClient = { query, release() {} };
  const pool: SqlQueryablePool = { query, async connect() { return client; } };
  return { pool, client, calls };
}

function evaluator() {
  const calls: Array<{
    client: SqlClient;
    userId: string;
    submission: AnswerSubmission;
    idempotencyKey: string;
  }> = [];
  const service: TransactionalQuestionEvaluator = {
    courseId: "course_408_001",
    async evaluateInTransaction(client, userId, submission, idempotencyKey) {
      calls.push({ client, userId, submission, idempotencyKey });
      const stored = storedQuestions.get(submission.question_id);
      if (!stored) throw new Error(`Missing stored question: ${submission.question_id}`);
      return evaluateStoredQuestion(stored, submission, {
        userId,
        now: () => now,
        createId: (prefix) => `${prefix}_${submission.question_id}`,
        persistenceStatus: "persisted",
      }) as QuestionEvaluationBundle;
    },
    async evaluateSnapshotInTransaction(client, userId, submission, idempotencyKey, snapshot) {
      calls.push({ client, userId, submission, idempotencyKey });
      return evaluateStoredQuestion({
        courseId: snapshot.courseId,
        question: snapshot.question,
        correctOptionIds: snapshot.correctOptionIds,
        explanation: snapshot.explanation,
        referenceSolution: snapshot.referenceSolution,
        answerAssets: snapshot.answerAssets,
      }, submission, {
        userId,
        now: () => now,
        createId: (prefix) => `${prefix}_${submission.question_id}`,
        persistenceStatus: "persisted",
      });
    },
  };
  return { service, calls };
}

function activeSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "exam_session_001",
    user_id: "student_001",
    course_id: "course_408_001",
    paper_year: 2023,
    status: "active",
    duration_minutes: 180,
    question_count: 3,
    objective_count: 2,
    subjective_count: 1,
    started_at: now,
    expires_at: new Date(now.getTime() + 180 * 60_000),
    submitted_at: null,
    submission_key_hash: null,
    result_payload: null,
    ...overrides,
  };
}

describe("PostgresMockExam", () => {
  it("starts a reviewed self-authored stage mock with a duration derived from its question count", async () => {
    const authoredRows = Array.from({ length: 8 }, (_, index) => questionRow({
      ...publicQuestion(`practice-408-v1-${String(index + 1).padStart(2, "0")}`, index + 1, "choice"),
      year: null,
      source: {
        provider: "xuetu_self_authored",
        dataset_id: "xuetu_self_authored_practice_408_v1",
        source_url: "https://xuetu.local/sources/practice/408-v1",
        license_status: "verified",
        usage_scope: "authorized_product_use",
      },
    })).map((row) => ({
      ...row,
      source_type: "self_authored_practice",
      allowed_modes: ["targeted", "mock_exam"],
      paper_year: 2026,
      protect_full_paper: false,
      content_review_status: "teacher_verified",
    }));
    const { service: questionEvaluator } = evaluator();
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) return result();
      if (sql.includes("FROM questions q")) return result(authoredRows);
      return result([], 1);
    });

    const session = await new PostgresMockExam(pool, questionEvaluator, {
      now: () => now,
      createId: () => "exam_session_stage_001",
    }).start("student_001", { year: 2026 });

    expect(session.duration_minutes).toBe(40);
    expect(session.questions).toHaveLength(8);
    expect(session.questions.every((item) => item.question.year === null)).toBe(true);
    const paperQuery = calls.find((call) => call.sql.includes("FROM questions q"));
    expect(paperQuery?.sql).toContain("'self_authored_practice'");
    expect(paperQuery?.sql).toContain("q.review_status = 'approved'");
    expect(paperQuery?.sql).toContain("meta.content_review_status = 'teacher_verified'");
    const sessionInsert = calls.find((call) => call.sql.includes("INSERT INTO practice_exam_sessions"));
    expect(sessionInsert?.parameters).toContain(40);
  });

  it("starts an explicit full paper, freezes paper order, and releases no answers", async () => {
    const { service: questionEvaluator } = evaluator();
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) return result();
      if (sql.includes("FROM questions q")) return result(questions.map(questionRow));
      return result([], 1);
    });

    const session = await new PostgresMockExam(pool, questionEvaluator, {
      now: () => now,
      createId: () => "exam_session_001",
    }).start("student_001", { year: 2023 });

    expect(session).toMatchObject({
      session_id: "exam_session_001",
      year: 2023,
      status: "active",
      duration_minutes: 180,
      server_now: now.toISOString(),
      started_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 180 * 60_000).toISOString(),
      submitted_at: null,
      resumed: false,
    });
    expect(session.questions.map((item) => item.question.id)).toEqual(["2023-01", "2023-02", "2023-41"]);
    expect(session.questions.every((item) => item.ranking === null)).toBe(true);
    expect(JSON.stringify(session)).not.toMatch(/answer_key|correct_option_ids|reference_solution/u);
    const paperQuery = calls.find((call) => call.sql.includes("FROM questions q"));
    expect(paperQuery?.sql).toContain("ORDER BY meta.paper_year, q.number, q.question_id");
    expect(paperQuery?.sql).toContain("q.usage_scope = 'authorized_product_use'");
    expect(paperQuery?.sql).toContain("q.license_status = 'verified'");
    expect(paperQuery?.sql).toContain("jsonb_array_elements(q.assets)");
    expect(paperQuery?.sql).toContain("'question', 'option'");
    expect(calls.filter((call) => call.sql.includes("INSERT INTO practice_exam_session_questions"))).toHaveLength(3);
  });

  it("chooses the latest unfinished year when omitted", async () => {
    const { service: questionEvaluator } = evaluator();
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) return result();
      if (sql.includes("SELECT meta.paper_year")) return result([{ paper_year: 2023 }]);
      if (sql.includes("FROM questions q")) return result(questions.map(questionRow));
      return result([], 1);
    });

    const session = await new PostgresMockExam(pool, questionEvaluator, {
      now: () => now,
      createId: () => "exam_session_default",
    }).start("student_001", {});

    expect(session.year).toBe(2023);
    const yearQuery = calls.find((call) => call.sql.includes("SELECT meta.paper_year"));
    expect(yearQuery?.sql).toContain("submitted");
    expect(yearQuery?.sql).toContain("ORDER BY meta.paper_year DESC");
    expect(yearQuery?.sql).toContain("q.usage_scope = 'authorized_product_use'");
    expect(yearQuery?.sql).toContain("jsonb_array_elements(q.assets)");
  });

  it("resumes an unexpired active session without creating another session", async () => {
    const { service: questionEvaluator } = evaluator();
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) {
        return result([activeSession()]);
      }
      if (sql.includes("FROM practice_exam_session_questions")) {
        return result(questions.map(snapshotRow));
      }
      return result([], 1);
    });

    const session = await new PostgresMockExam(pool, questionEvaluator, {
      now: () => now,
      createId: () => "must_not_be_used",
    }).start("student_001", { year: 2023 });

    expect(session.resumed).toBe(true);
    expect(session.session_id).toBe("exam_session_001");
    const snapshotQuery = calls.find((call) => call.sql.includes("FROM practice_exam_session_questions"));
    expect(snapshotQuery?.sql).not.toContain("JOIN questions q");
    expect(snapshotQuery?.sql).not.toContain("JOIN question_learning_metadata meta");
    expect(snapshotQuery?.sql).toContain("WHERE snapshot.session_id = $1");
    expect(calls.some((call) => call.sql.includes("INSERT INTO practice_exam_sessions"))).toBe(false);
  });

  it("resumes from the immutable snapshot when the source question is later withdrawn", async () => {
    const { service: questionEvaluator } = evaluator();
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) {
        return result([activeSession()]);
      }
      if (sql.includes("FROM practice_exam_session_questions")) {
        // The source question has since been withdrawn. A frozen exam must not
        // need the live questions or learning metadata rows to resume.
        if (sql.includes("JOIN questions") || sql.includes("JOIN question_learning_metadata")) {
          return result([]);
        }
        return result(questions.map(snapshotRow));
      }
      return result([], 1);
    });

    const session = await new PostgresMockExam(pool, questionEvaluator, { now: () => now })
      .start("student_001", { year: 2023 });

    expect(session.resumed).toBe(true);
    expect(session.questions).toHaveLength(3);
    const snapshotQuery = calls.find((call) => call.sql.includes("FROM practice_exam_session_questions"));
    expect(snapshotQuery?.sql).not.toContain("JOIN questions");
    expect(snapshotQuery?.sql).not.toContain("JOIN question_learning_metadata");
  });

  it("submits from the frozen evaluation snapshot when the source question is withdrawn", async () => {
    let liveEvaluationCalled = false;
    let snapshotEvaluationCalled = false;
    const snapshotEvaluator = {
      courseId: "course_408_001",
      async evaluateInTransaction() {
        liveEvaluationCalled = true;
        throw new Error("the withdrawn source question must not be read during submit");
      },
      async evaluateSnapshotInTransaction(
        _client: SqlClient,
        userId: string,
        submission: AnswerSubmission,
        _idempotencyKey: string,
        frozen: {
          courseId: string;
          question: QuestionDto;
          correctOptionIds: string[];
          explanation: string | null;
          referenceSolution: string | null;
          answerAssets: [];
        },
      ) {
        snapshotEvaluationCalled = true;
        return evaluateStoredQuestion({
          courseId: frozen.courseId,
          question: frozen.question,
          correctOptionIds: frozen.correctOptionIds,
          explanation: frozen.explanation,
          referenceSolution: frozen.referenceSolution,
          answerAssets: frozen.answerAssets,
        }, submission, {
          userId,
          now: () => now,
          createId: (prefix) => `${prefix}_${submission.question_id}`,
          persistenceStatus: "persisted",
        });
      },
    } as unknown as TransactionalQuestionEvaluator;
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) {
        return result([activeSession()]);
      }
      if (sql.includes("FROM practice_exam_session_questions")) {
        return result(questions.map(snapshotRow));
      }
      return result([], 1);
    });

    const submitted = await new PostgresMockExam(pool, snapshotEvaluator, { now: () => now })
      .submit("student_001", "exam_session_001", {
        answers: [{
          question_id: "2023-01",
          answer_type: "choice",
          selected_option_ids: ["A"],
        }],
      }, "withdrawn-source-submit");

    expect(submitted.answered_count).toBe(1);
    expect(snapshotEvaluationCalled).toBe(true);
    expect(liveEvaluationCalled).toBe(false);
  });

  it("returns a stable business error when a legacy snapshot has no grading payload", async () => {
    const { service: questionEvaluator, calls: evaluationCalls } = evaluator();
    const legacySnapshots = questions.map(snapshotRow).map((snapshot, index) => (
      index === 0 ? { ...snapshot, evaluation_payload: null } : snapshot
    ));
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) {
        return result([activeSession()]);
      }
      if (sql.includes("FROM practice_exam_session_questions")) {
        return result(legacySnapshots);
      }
      return result([], 1);
    });

    await expect(new PostgresMockExam(pool, questionEvaluator, { now: () => now })
      .submit("student_001", "exam_session_001", {
        answers: [{
          question_id: "2023-01",
          answer_type: "choice",
          selected_option_ids: ["A"],
        }],
      }, "legacy-snapshot-submit")).rejects.toMatchObject({
      name: "MockExamError",
      code: "MOCK_EXAM_EVALUATION_SNAPSHOT_UNAVAILABLE",
      status: 409,
      message: "本次模考缺少可用的评分快照，暂时无法交卷。",
    } satisfies Partial<MockExamError>);

    expect(evaluationCalls).toHaveLength(0);
    expect(calls.some((call) => call.sql === "ROLLBACK")).toBe(true);
    expect(calls.some((call) => call.sql.includes("INSERT INTO practice_exam_session_attempts"))).toBe(false);
  });

  it("restarts an expired active session with its frozen paper and a fresh server timer", async () => {
    const { service: questionEvaluator } = evaluator();
    const expired = activeSession({
      started_at: new Date(now.getTime() - 181 * 60_000),
      expires_at: new Date(now.getTime() - 60_000),
    });
    const { pool, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) {
        return result([expired]);
      }
      if (sql.includes("FROM practice_exam_session_questions")) {
        return result(questions.map(snapshotRow));
      }
      return result([], 1);
    });

    const session = await new PostgresMockExam(pool, questionEvaluator, {
      now: () => now,
      createId: () => "must_not_be_used",
    }).start("student_001", { year: 2023 });

    expect(session).toMatchObject({
      session_id: "exam_session_001",
      server_now: now.toISOString(),
      started_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 180 * 60_000).toISOString(),
      resumed: false,
    });
    expect(session.questions.map((item) => item.question.id)).toEqual(["2023-01", "2023-02", "2023-41"]);
    expect(calls.some((call) => call.sql.includes("UPDATE practice_exam_sessions") && call.sql.includes("started_at"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("INSERT INTO practice_exam_sessions"))).toBe(false);
  });

  it("submits once, grades in one transaction, and returns a truthful partial result", async () => {
    const { service: questionEvaluator, calls: evaluationCalls } = evaluator();
    const { pool, client, calls } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) {
        return result([activeSession()]);
      }
      if (sql.includes("FROM practice_exam_session_questions")) {
        return result(questions.map(snapshotRow));
      }
      return result([], 1);
    });
    const repository = new PostgresMockExam(pool, questionEvaluator, { now: () => now });

    const submission = await repository.submit("student_001", "exam_session_001", {
      answers: [
        { question_id: "2023-01", answer_type: "choice", selected_option_ids: ["A"] },
        { question_id: "2023-41", answer_type: "subjective", response_text: "作答过程" },
      ],
    }, "submit-key-001");

    expect(submission).toMatchObject({
      session_id: "exam_session_001",
      year: 2023,
      status: "submitted",
      question_count: 3,
      answered_count: 2,
      unanswered_count: 1,
      objective: {
        question_count: 2,
        answered_count: 1,
        correct_count: 1,
        score: 2,
        max_score: 4,
      },
      subjective: {
        question_count: 1,
        submitted_count: 1,
        pending_review_count: 1,
      },
      score_status: "partial_pending_subjective_review",
    });
    expect(submission).not.toHaveProperty("total_score");
    expect(evaluationCalls).toHaveLength(2);
    expect(evaluationCalls.every((call) => call.client === client)).toBe(true);
    expect(evaluationCalls.map((call) => call.idempotencyKey)).toEqual([
      "mock:exam_session_001:2023-01",
      "mock:exam_session_001:2023-41",
    ]);
    expect(calls.filter((call) => call.sql.includes("INSERT INTO practice_exam_session_attempts"))).toHaveLength(2);
    const completion = calls.find((call) => call.sql.includes("UPDATE practice_exam_sessions"));
    expect(completion?.sql).toContain("result_payload");
    expect(completion?.parameters).not.toContain("submit-key-001");
    expect(completion?.parameters.some((value) => (
      typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ))).toBe(true);
  });

  it("rejects another student's session, expired sessions, cross-paper answers, and duplicates", async () => {
    const { service: questionEvaluator, calls: evaluationCalls } = evaluator();
    let session = activeSession({ user_id: "student_002" });
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM practice_exam_sessions") && sql.includes("FOR UPDATE")) return result([session]);
      if (sql.includes("FROM practice_exam_session_questions")) {
        return result(questions.map(snapshotRow));
      }
      return result([], 1);
    });
    const repository = new PostgresMockExam(pool, questionEvaluator, { now: () => now });

    await expect(repository.submit("student_001", "exam_session_001", { answers: [] }, "key"))
      .rejects.toMatchObject({ code: "MOCK_EXAM_ACCESS_DENIED" } satisfies Partial<MockExamError>);

    session = activeSession({ expires_at: new Date(now.getTime() - 1) });
    await expect(repository.submit("student_001", "exam_session_001", { answers: [] }, "key"))
      .rejects.toMatchObject({ code: "MOCK_EXAM_EXPIRED" } satisfies Partial<MockExamError>);

    session = activeSession();
    const foreignAnswer = {
      question_id: "2022-01",
      answer_type: "choice" as const,
      selected_option_ids: ["A"],
    };
    await expect(repository.submit("student_001", "exam_session_001", { answers: [foreignAnswer] }, "key"))
      .rejects.toMatchObject({ code: "MOCK_EXAM_QUESTION_MISMATCH" } satisfies Partial<MockExamError>);

    const duplicate = {
      question_id: "2023-01",
      answer_type: "choice" as const,
      selected_option_ids: ["A"],
    };
    await expect(repository.submit("student_001", "exam_session_001", { answers: [duplicate, duplicate] }, "key"))
      .rejects.toMatchObject({ code: "MOCK_EXAM_DUPLICATE_QUESTION" } satisfies Partial<MockExamError>);
    expect(evaluationCalls).toHaveLength(0);
  });
});
