import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  AnswerSubmission,
  QuestionDto,
  QuestionSource,
} from "@xuetu/contracts";

import type {
  SqlClient,
  SqlQueryablePool,
  SqlQueryResult,
} from "../src/database/client.js";
import {
  QuestionSubmissionError,
  evaluateStoredQuestion,
  type StoredQuestion,
} from "../src/services/question-bank/question-bank.js";
import { PostgresQuestionBank } from "../src/services/question-bank/postgres-question-bank.js";

const source: QuestionSource = {
  provider: "csgraduates.com",
  dataset_id: "408_json_data",
  source_url: "https://www.csgraduates.com/study_methods/408quiz/2026/#1",
  license_status: "unverified",
  usage_scope: "local_demo_only",
};

const publicChoiceQuestion: QuestionDto = {
  id: "2026-01",
  year: 2026,
  number: 1,
  subject: "数据结构",
  type: "choice",
  multiple: false,
  question: "顺序表的哪项操作必然移动元素？",
  options: [
    { option_id: "A", text: "表头插入", assets: [] },
    { option_id: "B", text: "表尾删除", assets: [] },
    { option_id: "C", text: "表尾插入", assets: [] },
  ],
  tags: ["线性表"],
  assets: [],
  content_format: "plain_text",
  source,
};

const practiceMetadataRow = {
  source_type: "past_exam",
  allowed_modes: ["targeted", "past_exam", "mock_exam"],
  paper_year: 2026,
  protect_full_paper: false,
  importance: "core",
  content_review_status: "pending_teacher_review",
  memory_due: null,
  memory_stability: null,
  memory_difficulty: null,
  memory_elapsed_days: null,
  memory_scheduled_days: null,
  memory_reps: null,
  memory_lapses: null,
  memory_learning_steps: null,
  memory_state: null,
  memory_last_review: null,
  memory_last_attempt_id: null,
  memory_algorithm_version: null,
  attempt_count: "0",
  concept_correct_count: "0",
  concept_incorrect_count: "0",
  wrong_count: "0",
} as const;

const storedChoice: StoredQuestion = {
  courseId: "course_408_001",
  question: publicChoiceQuestion,
  correctOptionIds: ["A", "C"],
  explanation: "两个表头操作会移动元素。",
  referenceSolution: null,
  answerAssets: [],
};

const fixedContext = {
  userId: "user_student_001",
  now: () => new Date("2026-07-27T00:00:00.000Z"),
  createId: (prefix: string) => `${prefix}_001`,
  persistenceStatus: "not_persisted" as const,
};

describe("question evaluation domain service", () => {
  it("grades choice answers by exact option set and returns the key only after submission", () => {
    const result = evaluateStoredQuestion(
      storedChoice,
      {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["C", "A"],
      },
      fixedContext,
    );

    expect(result.evaluation).toMatchObject({
      grading_mode: "deterministic_choice",
      status: "correct",
      is_correct: true,
      score: 100,
      correct_option_ids: ["A", "C"],
    });
    expect(result.evidence).toMatchObject({
      outcome: "correct",
      eligible_for_learning_state_update: true,
      persistence_status: "not_persisted",
    });
  });

  it("rejects duplicate or unknown selected options instead of silently grading them", () => {
    const duplicate: AnswerSubmission = {
      question_id: "2026-01",
      answer_type: "choice",
      selected_option_ids: ["A", "A"],
    };
    expect(() => evaluateStoredQuestion(storedChoice, duplicate, fixedContext)).toThrow(
      QuestionSubmissionError,
    );

    expect(() =>
      evaluateStoredQuestion(
        storedChoice,
        {
          question_id: "2026-01",
          answer_type: "choice",
          selected_option_ids: ["Z"],
        },
        fixedContext,
      ),
    ).toThrow("Selected option does not exist");
  });

  it("marks subjective responses for AI or teacher review without a correctness claim", () => {
    const subjective: StoredQuestion = {
      ...storedChoice,
      question: {
        ...publicChoiceQuestion,
        id: "2026-41",
        number: 41,
        type: "subjective",
        multiple: false,
        options: [],
      },
      correctOptionIds: [],
      explanation: null,
      referenceSolution: "参考算法：中序遍历并维护最小差值。",
    };

    const result = evaluateStoredQuestion(
      subjective,
      {
        question_id: "2026-41",
        answer_type: "subjective",
        response_text: "先中序遍历，再记录当前最小差值。",
      },
      fixedContext,
    );

    expect(result.evaluation).toMatchObject({
      grading_mode: "ai_or_teacher_review_required",
      status: "pending_review",
      is_correct: null,
      score: null,
      review_required: true,
    });
    expect(result.evidence).toMatchObject({
      outcome: "pending_review",
      eligible_for_learning_state_update: false,
    });
  });
});

describe("PostgreSQL question repository", () => {
  it("filters with parameters and maps only public, plain-text fields", async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const row = {
      question_id: "2026-01",
      year: 2026,
      number: 1,
      subject: "数据结构",
      question_type: "choice",
      multiple: false,
      question_text: "顺序表的哪项操作必然移动元素？",
      options: [
        {
          ...publicChoiceQuestion.options[0]!,
          assets: [{
            asset_id: "asset_nested_explanation_private",
            role: "explanation",
            option_id: null,
            reference_kind: "external_url",
            source_reference: "https://private.example/answer.png",
            mime_type: "image/png",
            availability: "external_reference",
          }],
        },
        ...publicChoiceQuestion.options.slice(1),
      ],
      tags: ["线性表"],
      assets: [
        {
          asset_id: "asset_option_duplicate",
          role: "option",
          option_id: "A",
          reference_kind: "local_file",
          source_reference: "2026/images/option-a.png",
          mime_type: "image/png",
          availability: "local_file",
        },
        {
          asset_id: "asset_explanation_private",
          role: "explanation",
          option_id: null,
          reference_kind: "embedded_source",
          source_reference: `embedded:sha256:${"a".repeat(64)}`,
          mime_type: "image/png",
          availability: "metadata_only",
        },
      ],
      source_provider: "csgraduates.com",
      dataset_id: "408_json_data",
      source_url: source.source_url,
      license_status: "unverified",
      usage_scope: "local_demo_only",
      total_count: "1",
      ...practiceMetadataRow,
      answer_key: ["A"],
      question_html: "<strong>must not escape</strong>",
    };
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, ...(parameters ? { parameters } : {}) });
        return { rows: [row as Row], rowCount: 1 };
      },
      async connect(): Promise<SqlClient> {
        throw new Error("not used");
      },
    };

    const repository = new PostgresQuestionBank(pool, "course_408_001");
    const result = await repository.select("user_student_001", {
      mode: "targeted",
      subject: "数据结构",
      year: 2026,
      type: "choice",
      tags: ["线性表"],
      tag_match: "all",
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.question).toEqual(publicChoiceQuestion);
    expect(result.items[0]).not.toHaveProperty("answer_key");
    expect(result.items[0]?.question).not.toHaveProperty("question_html");
    expect(calls[0]?.sql).toContain("q.tags @>");
    expect(calls[0]?.sql).not.toContain("answer_key");
    expect(calls[0]?.sql).toContain("q.review_status = 'approved'");
    expect(calls[0]?.sql).toContain("meta.content_review_status = 'teacher_verified'");
    expect(calls[0]?.sql).toContain("q.usage_scope = 'authorized_product_use'");
    expect(calls[0]?.sql).toContain("q.license_status = 'verified'");
    expect(calls[0]?.sql).toContain("'self_authored_practice'");
    expect(calls[0]?.sql).toContain("jsonb_array_elements(q.assets)");
    expect(calls[0]?.sql).toContain("'question', 'option'");
    expect(calls[0]?.parameters).toEqual([
      "course_408_001",
      "user_student_001",
      "数据结构",
      2026,
      "choice",
      ["线性表"],
    ]);
  });

  it("fails closed when a stored asset byte length does not match its content", async () => {
    const content = Buffer.from("question-asset-bytes", "utf8");
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
        return {
          rows: [{
            role: "question",
            mime_type: "image/png",
            byte_length: content.length + 1,
            content,
          } as Row],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    };

    await expect(
      new PostgresQuestionBank(pool, "course_408_001").openAsset(
        "user_student_001",
        "2026-01",
        "asset_question_001",
      ),
    ).rejects.toThrow("Stored question image byte length is inconsistent.");
  });

  it("limits concept practice to persisted exact-tag associations", async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("COUNT(*)::text AS total_count")) {
          return { rows: [{ total_count: "2" } as Row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      async connect() { throw new Error("not used"); },
    };

    const result = await new PostgresQuestionBank(pool, "course_408_001").select("user_student_001", {
      mode: "targeted",
      subject: "数据结构",
      concept_id: "ds_c02_02",
      type: "choice",
      tags: [],
      tag_match: "all",
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(0);
    const associationQueries = calls.filter((call) => call.sql.includes("course_concept_question_links"));
    expect(associationQueries.length).toBeGreaterThan(0);
    expect(associationQueries.every((call) => call.parameters?.includes("ds_c02_02"))).toBe(true);
  });

  it("does not expose targeted practice for an unverified or cross-course concept link", async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const row = {
      question_id: publicChoiceQuestion.id,
      year: publicChoiceQuestion.year,
      number: publicChoiceQuestion.number,
      subject: publicChoiceQuestion.subject,
      question_type: publicChoiceQuestion.type,
      multiple: publicChoiceQuestion.multiple,
      question_text: publicChoiceQuestion.question,
      options: publicChoiceQuestion.options,
      tags: publicChoiceQuestion.tags,
      assets: [],
      source_provider: source.provider,
      dataset_id: source.dataset_id,
      source_url: source.source_url,
      license_status: source.license_status,
      usage_scope: source.usage_scope,
      ...practiceMetadataRow,
      total_count: "1",
    };
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("total_count") && sql.includes("FROM questions q")) {
          return sql.includes("JOIN course_core_concepts")
            ? { rows: [], rowCount: 0 }
            : { rows: [row as Row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      async connect() { throw new Error("not used"); },
    };

    const result = await new PostgresQuestionBank(pool, "course_408_001").select("user_student_001", {
      mode: "targeted",
      concept_id: "os_c01_01",
      tags: [],
      tag_match: "all",
      limit: 20,
      offset: 0,
    });

    expect(result.items).toHaveLength(0);
    const questionQuery = calls.find((call) => call.sql.includes("total_count") && call.sql.includes("FROM questions q"));
    expect(questionQuery?.sql).toContain("JOIN course_core_concepts concept");
    expect(questionQuery?.sql).toContain("JOIN course_catalog_entries catalog");
    expect(questionQuery?.sql).toContain("concept.review_status = 'verified'");
    expect(questionQuery?.sql).toContain("catalog.question_subject = q.subject");
  });

  it("keeps an explicit re-practice question bound to its exact question ID", async () => {
    const calls: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        calls.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("COUNT(*)::text AS total_count")) {
          return { rows: [{ total_count: "1" } as Row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      async connect() { throw new Error("not used"); },
    };

    await new PostgresQuestionBank(pool, "course_408_001").select("user_student_001", {
      mode: "targeted",
      subject: "数据结构",
      question_id: "2026-01",
      type: "choice",
      tags: [],
      tag_match: "all",
      limit: 1,
      offset: 0,
    });

    const questionQueries = calls.filter((call) => call.sql.includes("FROM questions q"));
    expect(questionQueries).toHaveLength(1);
    expect(questionQueries.every((call) => call.sql.includes("q.question_id ="))).toBe(true);
    expect(questionQueries.every((call) => call.parameters?.includes("2026-01"))).toBe(true);
  });

  it("does not expose a protected full-paper question through the direct read endpoint", async () => {
    let query = "";
    const row = {
      question_id: publicChoiceQuestion.id,
      year: publicChoiceQuestion.year,
      number: publicChoiceQuestion.number,
      subject: publicChoiceQuestion.subject,
      question_type: publicChoiceQuestion.type,
      multiple: publicChoiceQuestion.multiple,
      question_text: publicChoiceQuestion.question,
      options: publicChoiceQuestion.options,
      tags: publicChoiceQuestion.tags,
      assets: [],
      source_provider: source.provider,
      dataset_id: source.dataset_id,
      source_url: source.source_url,
      license_status: "verified",
      usage_scope: "authorized_product_use",
    };
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        query = sql;
        return sql.includes("meta.protect_full_paper = false")
          ? { rows: [], rowCount: 0 }
          : { rows: [row as Row], rowCount: 1 };
      },
      async connect() { throw new Error("not used"); },
    };

    const question = await new PostgresQuestionBank(pool, "course_408_001").get(publicChoiceQuestion.id);

    expect(question).toBeNull();
    expect(query).toContain("meta.protect_full_paper = false");
  });

  it("keeps the filtered total when an offset page has no rows", async () => {
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
        return {
          rows: [{
            question_id: publicChoiceQuestion.id,
            year: publicChoiceQuestion.year,
            number: publicChoiceQuestion.number,
            subject: publicChoiceQuestion.subject,
            question_type: publicChoiceQuestion.type,
            multiple: publicChoiceQuestion.multiple,
            question_text: publicChoiceQuestion.question,
            options: publicChoiceQuestion.options,
            tags: publicChoiceQuestion.tags,
            assets: [],
            source_provider: source.provider,
            dataset_id: source.dataset_id,
            source_url: source.source_url,
            license_status: source.license_status,
            usage_scope: source.usage_scope,
            ...practiceMetadataRow,
            total_count: "7",
          } as Row],
          rowCount: 1,
        };
      },
      async connect(): Promise<SqlClient> {
        throw new Error("not used");
      },
    };

    const result = await new PostgresQuestionBank(pool, "course_408_001").select("user_student_001", {
      mode: "targeted",
      tags: [],
      tag_match: "all",
      limit: 20,
      offset: 100,
    });

    expect(result).toMatchObject({ items: [], total: 7, limit: 20, offset: 100 });
  });

  it("persists attempt, evaluation, and learning evidence in one transaction", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const storedRow = {
      question_id: "2026-01",
      course_id: "course_408_001",
      year: 2026,
      number: 1,
      subject: "数据结构",
      question_type: "choice",
      multiple: false,
      question_text: publicChoiceQuestion.question,
      options: publicChoiceQuestion.options,
      tags: ["线性表"],
      assets: [],
      answer_key: ["A", "C"],
      explanation_text: storedChoice.explanation,
      solution_text: null,
      source_provider: "csgraduates.com",
      dataset_id: "408_json_data",
      source_url: source.source_url,
      license_status: "unverified",
      usage_scope: "local_demo_only",
    };
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("q.answer_key")) {
          return { rows: [storedRow as Row], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {
        statements.push({ sql: "RELEASE" });
      },
    };
    const pool = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return client;
      },
    };
    const repository = new PostgresQuestionBank(pool, "course_408_001", {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
      createId: (prefix) => `${prefix}_001`,
    });

    const result = await repository.evaluate(
      "user_student_001",
      {
        question_id: "2026-01",
        answer_type: "choice",
        concept_id: "ds_c02_02",
        selected_option_ids: ["A", "C"],
      },
      "choice-persist-001",
    );

    expect(result.evidence.persistence_status).toBe("persisted");
    const storedQuestionRead = statements.find((entry) => entry.sql.includes("q.answer_key"));
    expect(storedQuestionRead?.sql).toContain("JOIN question_learning_metadata meta");
    expect(storedQuestionRead?.sql).toContain("q.review_status = 'approved'");
    expect(storedQuestionRead?.sql).toContain("meta.content_review_status = 'teacher_verified'");
    expect(storedQuestionRead?.sql).toContain("q.usage_scope = 'authorized_product_use'");
    expect(storedQuestionRead?.sql).toContain("jsonb_array_elements(q.assets)");
    expect(statements.some((entry) => entry.sql.includes("course_concept_question_links"))).toBe(true);
    expect(statements.map((entry) => entry.sql)).toEqual(
      expect.arrayContaining([
        "BEGIN",
        expect.stringContaining("INSERT INTO practice_attempts"),
        expect.stringContaining("INSERT INTO evaluations"),
        expect.stringContaining("INSERT INTO learning_evidence"),
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining("INSERT INTO student_question_memory_states"),
        expect.stringContaining("UPDATE practice_mistake_review_states"),
        "COMMIT",
        "RELEASE",
      ]),
    );
    const memoryWrite = statements.find((entry) =>
      entry.sql.includes("INSERT INTO student_question_memory_states")
    );
    expect(memoryWrite?.parameters).toEqual(expect.arrayContaining([
      "user_student_001",
      "2026-01",
      "attempt_001",
      "fsrs_v6_ts_fsrs_5_4_1",
    ]));
    const reviewSync = statements.find((entry) =>
      entry.sql.includes("UPDATE practice_mistake_review_states")
    );
    expect(reviewSync?.parameters).toEqual(expect.arrayContaining([
      "user_student_001",
      "2026-01",
      "fsrs_v6_ts_fsrs_5_4_1",
    ]));
  });

  it("attributes a course-wide submission to its unique active concept on the server", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("q.answer_key")) {
          return {
            rows: [{
              question_id: "2026-01",
              course_id: "course_408_001",
              year: 2026,
              number: 1,
              subject: "数据结构",
              question_type: "choice",
              multiple: false,
              question_text: publicChoiceQuestion.question,
              options: publicChoiceQuestion.options,
              tags: ["线性表"],
              assets: [],
              answer_key: ["A", "C"],
              explanation_text: storedChoice.explanation,
              solution_text: null,
              source_provider: "csgraduates.com",
              dataset_id: "408_json_data",
              source_url: source.source_url,
              license_status: "unverified",
              usage_scope: "local_demo_only",
            } as Row],
            rowCount: 1,
          };
        }
        if (sql.includes("SELECT link.concept_id")) {
          return { rows: [{ concept_id: "ds_c02_02" } as Row], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      query: client.query.bind(client),
      connect: async () => client,
    };

    const result = await new PostgresQuestionBank(pool, "course_408_001", {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
      createId: (prefix) => `${prefix}_unique_concept`,
    }).evaluate(
      "user_student_001",
      {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A", "C"],
      },
      "choice-course-wide-001",
    );

    expect(result.attempt.concept_id).toBe("ds_c02_02");
    expect(result.evidence.concept_id).toBe("ds_c02_02");
    const conceptLookup = statements.find((entry) => entry.sql.includes("SELECT link.concept_id"));
    expect(conceptLookup?.sql).toContain("JOIN course_catalog_entries catalog");
    expect(conceptLookup?.sql).toContain("catalog.question_subject = $2");
    expect(conceptLookup?.sql).not.toContain("concept.course_id = $2");
    expect(conceptLookup?.parameters).toEqual(["2026-01", "数据结构", "course_408_001"]);
    const attemptWrite = statements.find((entry) => entry.sql.includes("INSERT INTO practice_attempts"));
    expect(attemptWrite?.parameters).toContain("ds_c02_02");
  });

  it("rejects an explicit concept that is not verified in the question course and subject", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const storedRow = {
      question_id: "2026-01",
      course_id: "course_408_001",
      year: 2026,
      number: 1,
      subject: "数据结构",
      question_type: "choice",
      multiple: false,
      question_text: publicChoiceQuestion.question,
      options: publicChoiceQuestion.options,
      tags: ["线性表"],
      assets: [],
      answer_key: ["A", "C"],
      explanation_text: storedChoice.explanation,
      solution_text: null,
      source_provider: source.provider,
      dataset_id: source.dataset_id,
      source_url: source.source_url,
      license_status: source.license_status,
      usage_scope: source.usage_scope,
    };
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("q.answer_key")) return { rows: [storedRow as Row], rowCount: 1 };
        if (sql.includes("FROM course_concept_question_links")) {
          // The association exists, but the concept is from another course or
          // has not passed review; the hardened query must reject it.
          return sql.includes("JOIN course_core_concepts")
            ? { rows: [], rowCount: 0 }
            : { rows: [{ ok: 1 } as Row], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      query: client.query.bind(client),
      connect: async () => client,
    };

    await expect(new PostgresQuestionBank(pool, "course_408_001", {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
      createId: (prefix) => `${prefix}_invalid_concept`,
    }).evaluate(
      "user_student_001",
      {
        question_id: "2026-01",
        answer_type: "choice",
        concept_id: "os_c01_01",
        selected_option_ids: ["A", "C"],
      },
      "choice-invalid-concept-001",
    )).rejects.toMatchObject({
      code: "CONCEPT_QUESTION_MISMATCH",
    });

    const conceptLookup = statements.find((entry) => entry.sql.includes("FROM course_concept_question_links"));
    expect(conceptLookup?.sql).toContain("JOIN course_core_concepts concept");
    expect(conceptLookup?.sql).toContain("JOIN course_catalog_entries catalog");
    expect(conceptLookup?.sql).toContain("concept.review_status = 'verified'");
    expect(conceptLookup?.sql).toContain("concept.course_id = $3");
  });

  it("persists frozen grading without loading live question answers or review state", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (/FROM\s+questions\s+q|q\.answer_key/u.test(sql)) {
          throw new Error("frozen grading must not load the live question");
        }
        if (sql.includes("FROM student_question_memory_states")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      query: client.query.bind(client),
      connect: async () => client,
    };
    const repository = new PostgresQuestionBank(pool, "course_408_001", {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
      createId: (prefix) => `${prefix}_frozen_persist`,
    });

    const result = await repository.evaluateSnapshotInTransaction(
      client,
      "user_student_001",
      {
        question_id: publicChoiceQuestion.id,
        answer_type: "choice",
        selected_option_ids: ["B"],
      },
      "frozen-persist-001",
      {
        courseId: "course_408_001",
        question: publicChoiceQuestion,
        correctOptionIds: ["B"],
        explanation: "冻结快照答案。",
        referenceSolution: null,
        answerAssets: [],
      },
    );

    expect(result).toMatchObject({
      idempotency_replayed: false,
      evaluation: {
        status: "correct",
        explanation: "冻结快照答案。",
      },
      evidence: {
        outcome: "correct",
        persistence_status: "persisted",
        eligible_for_learning_state_update: true,
      },
    });
    const sql = statements.map((entry) => entry.sql);
    expect(sql.some((statement) => /FROM\s+questions\s+q|q\.answer_key/u.test(statement))).toBe(false);
    expect(sql).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO practice_evaluation_idempotency"),
      expect.stringContaining("INSERT INTO practice_attempts"),
      expect.stringContaining("INSERT INTO evaluations"),
      expect.stringContaining("INSERT INTO learning_evidence"),
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("INSERT INTO student_question_memory_states"),
      expect.stringContaining("UPDATE practice_mistake_review_states"),
      expect.stringContaining("UPDATE practice_evaluation_idempotency"),
    ]));
    const memoryWrite = statements.find((entry) =>
      entry.sql.includes("INSERT INTO student_question_memory_states")
    );
    expect(memoryWrite?.parameters).toEqual(expect.arrayContaining([
      "user_student_001",
      publicChoiceQuestion.id,
      "attempt_frozen_persist",
      "fsrs_v6_ts_fsrs_5_4_1",
    ]));
  });

  it("rejects an explicit cross-course concept when grading from a frozen snapshot", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("FROM course_concept_question_links")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      query: client.query.bind(client),
      connect: async () => client,
    };
    const repository = new PostgresQuestionBank(pool, "course_408_001", {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
      createId: (prefix) => `${prefix}_frozen_concept`,
    });

    await expect(repository.evaluateSnapshotInTransaction(
      client,
      "user_student_001",
      {
        question_id: publicChoiceQuestion.id,
        answer_type: "choice",
        concept_id: "os_c01_01",
        selected_option_ids: ["A", "C"],
      },
      "frozen-invalid-concept-001",
      {
        courseId: "course_408_001",
        question: publicChoiceQuestion,
        correctOptionIds: ["A", "C"],
        explanation: storedChoice.explanation,
        referenceSolution: null,
        answerAssets: [],
      },
    )).rejects.toMatchObject({ code: "CONCEPT_QUESTION_MISMATCH" });

    expect(statements.some((entry) => entry.sql.includes("FROM course_concept_question_links"))).toBe(true);
  });

  it("applies the formal exposure and visual-completeness policy to direct question reads", async () => {
    let sql = "";
    const pool: SqlQueryablePool = {
      async query<Row = Record<string, unknown>>(query: string): Promise<SqlQueryResult<Row>> {
        sql = query;
        return { rows: [], rowCount: 0 };
      },
      async connect() { throw new Error("not used"); },
    };

    await new PostgresQuestionBank(pool, "course_408_001").get("2026-01");

    expect(sql).toContain("JOIN question_learning_metadata meta");
    expect(sql).toContain("q.review_status = 'approved'");
    expect(sql).toContain("meta.content_review_status = 'teacher_verified'");
    expect(sql).toContain("q.usage_scope = 'authorized_product_use'");
    expect(sql).toContain("q.license_status = 'verified'");
    expect(sql).toContain("'self_authored_screening'");
    expect(sql).toContain("jsonb_array_elements(q.assets)");
    expect(sql).toContain("jsonb_array_elements(q.options)");
    expect(sql).toContain("option_item->'assets'");
    expect(sql).toContain("'question', 'option'");
  });

  it("does not advance FSRS for a subjective answer awaiting review", async () => {
    const statements: string[] = [];
    const storedRow = {
      question_id: "2026-41",
      course_id: "course_408_001",
      year: 2026,
      number: 41,
      subject: "数据结构",
      question_type: "subjective",
      multiple: false,
      question_text: "说明算法思想。",
      options: [],
      tags: ["综合题"],
      assets: [],
      answer_key: [],
      explanation_text: null,
      solution_text: "参考解法。",
      source_provider: source.provider,
      dataset_id: source.dataset_id,
      source_url: source.source_url,
      license_status: source.license_status,
      usage_scope: source.usage_scope,
    };
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        statements.push(sql);
        if (sql.includes("q.answer_key")) return { rows: [storedRow as Row], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return client; },
    };

    const result = await new PostgresQuestionBank(pool, "course_408_001", {
      now: () => new Date("2026-08-24T06:00:00.000Z"),
      createId: (prefix) => `${prefix}_subjective`,
    }).evaluate("user_student_001", {
      question_id: "2026-41",
      answer_type: "subjective",
      response_text: "先说明思路，再给出伪代码。",
    }, "subjective-persist-001");

    expect(result.evaluation.status).toBe("pending_review");
    expect(statements.some((sql) => sql.includes("student_question_memory_states"))).toBe(false);
    expect(statements.some((sql) => sql.includes("practice_mistake_review_states"))).toBe(false);
  });

  it("replays a persisted evaluation before writing another attempt for the same request key", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    let attemptWrites = 0;
    const submission: AnswerSubmission = {
      question_id: "2026-01",
      answer_type: "choice",
      selected_option_ids: ["C", "A"],
    };
    const replayedBundle = evaluateStoredQuestion(storedChoice, submission, {
      ...fixedContext,
      persistenceStatus: "persisted",
    });
    const requestFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          answer_type: "choice",
          concept_id: null,
          question_id: "2026-01",
          selected_option_ids: ["A", "C"],
        }),
      )
      .digest("hex");
    const storedRow = {
      question_id: "2026-01",
      course_id: "course_408_001",
      year: 2026,
      number: 1,
      subject: "数据结构",
      question_type: "choice",
      multiple: false,
      question_text: publicChoiceQuestion.question,
      options: publicChoiceQuestion.options,
      tags: ["线性表"],
      assets: [],
      answer_key: ["A", "C"],
      explanation_text: storedChoice.explanation,
      solution_text: null,
      source_provider: source.provider,
      dataset_id: source.dataset_id,
      source_url: source.source_url,
      license_status: source.license_status,
      usage_scope: source.usage_scope,
    };
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("INSERT INTO practice_evaluation_idempotency")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("SELECT request_fingerprint, response_payload")) {
          return {
            rows: [{ request_fingerprint: requestFingerprint, response_payload: JSON.stringify(replayedBundle) } as Row],
            rowCount: 1,
          };
        }
        if (sql.includes("q.answer_key")) return { rows: [storedRow as Row], rowCount: 1 };
        if (sql.includes("INSERT INTO practice_attempts")) attemptWrites += 1;
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return client;
      },
    };

    const result = await new PostgresQuestionBank(pool, "course_408_001").evaluate(
      "user_student_001",
      submission,
      "choice-replay-001",
    );

    expect(result).toMatchObject({
      idempotency_replayed: true,
      attempt: replayedBundle.attempt,
    });
    expect(attemptWrites).toBe(0);
    expect(statements.some((statement) => statement.sql.includes("student_question_memory_states"))).toBe(false);
    expect(statements.some((statement) => statement.sql.includes("q.answer_key"))).toBe(false);
    expect(statements.find((statement) => statement.sql.includes("INSERT INTO practice_evaluation_idempotency"))?.parameters)
      .toEqual(["user_student_001", "choice-replay-001", requestFingerprint]);
  });

  it("rejects a reused request key when its stored fingerprint is for another answer", async () => {
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        if (sql.includes("INSERT INTO practice_evaluation_idempotency")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("SELECT request_fingerprint, response_payload")) {
          return {
            rows: [{ request_fingerprint: "a".repeat(64), response_payload: "{}" } as Row],
            rowCount: 1,
          };
        }
        if (sql.includes("q.answer_key")) {
          throw new Error("an idempotency conflict must be detected before loading a second question");
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return client;
      },
    };

    await expect(
      new PostgresQuestionBank(pool, "course_408_001").evaluate(
        "user_student_001",
        {
          question_id: "2026-01",
          answer_type: "choice",
          selected_option_ids: ["B"],
        },
        "choice-conflict-001",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
  });
});
