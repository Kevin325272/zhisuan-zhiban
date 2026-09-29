import { describe, expect, it } from "vitest";

import type { SqlQueryablePool } from "../src/database/client.js";
import { PostgresReliableLearningLoop } from "../src/services/question-bank/postgres-reliable-learning-loop.js";

describe("PostgresReliableLearningLoop learning records", () => {
  it("counts only student-visible targeted questions for each concept", async () => {
    let statement = "";
    const pool = {
      async query<Row = Record<string, unknown>>(sql: string) {
        statement = sql;
        return {
          rows: [{
            course_id: "course_408_ds",
            course_title: "数据结构",
            display_order: 1,
            concept_id: "ds_c02_02",
            concept_title: "顺序表的存储表示",
            is_reading: true,
            attempt_count: 0,
            correct_count: 0,
            incorrect_count: 0,
            mistake_count: 0,
            needs_review: false,
            mastered: false,
            practice_question_count: 3,
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    const record = await new PostgresReliableLearningLoop(pool).getLearningRecord("user_student_001");

    expect(record.courses[0]?.concepts[0]?.practice_question_count).toBe(3);
    expect(statement).toContain("course_concept_question_links");
    expect(statement).toContain("course_reading_history");
    expect(statement).toContain("link.status = 'active'");
    expect(statement).toContain("q.review_status = 'approved'");
    expect(statement).toContain("meta.content_review_status = 'teacher_verified'");
    expect(statement).toContain("'targeted' = ANY(meta.allowed_modes)");
    expect(statement).toContain("meta.protect_full_paper = false");
    expect(statement).toContain("q.usage_scope = 'authorized_product_use'");
    expect(statement).toContain("jsonb_array_elements(q.assets)");
  });

  it("counts shared 408 questions through the controlled subject-to-course mapping", async () => {
    let statement = "";
    const pool = {
      async query<Row = Record<string, unknown>>(sql: string) {
        statement = sql;
        return {
          rows: [{
            course_id: "course_408_ds",
            course_title: "数据结构",
            display_order: 1,
            concept_id: "ds_c02_02",
            concept_title: "顺序表的存储表示",
            is_reading: false,
            attempt_count: 0,
            correct_count: 0,
            incorrect_count: 0,
            mistake_count: 0,
            needs_review: false,
            mastered: false,
            practice_question_count: 2,
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    await new PostgresReliableLearningLoop(pool).getLearningRecord("user_student_001");

    expect(statement).toContain("JOIN course_catalog_entries question_catalog");
    expect(statement).toContain("question_catalog.course_id = course.course_id");
    expect(statement).toContain("question_catalog.question_subject = q.subject");
    expect(statement).not.toContain("q.course_id = concept.course_id");
  });

  it("aggregates practice only from evidence eligible to update learning state", async () => {
    let statement = "";
    const pool = {
      async query<Row = Record<string, unknown>>(sql: string) {
        statement = sql;
        return {
          rows: [{
            course_id: "course_408_ds",
            course_title: "数据结构",
            display_order: 1,
            concept_id: "ds_c02_02",
            concept_title: "顺序表的存储表示",
            is_reading: false,
            attempt_count: 0,
            correct_count: 0,
            correct_question_count: 0,
            incorrect_count: 0,
            mistake_count: 0,
            needs_review: false,
            mastered: false,
            practice_question_count: 0,
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    const record = await new PostgresReliableLearningLoop(pool).getLearningRecord("user_student_001");

    expect(record.courses[0]?.concepts[0]?.status).toBe("not_started");
    expect(statement).toContain("learning_evidence");
    expect(statement).toContain("eligible_for_learning_state_update = true");
    expect(statement).not.toContain("ON attempt.user_id = $1 AND attempt.concept_id = concept.concept_id");
  });

  it("keeps unassigned deterministic attempts in course totals without inventing a concept", async () => {
    let statement = "";
    const pool = {
      async query<Row = Record<string, unknown>>(sql: string) {
        statement = sql;
        return {
          rows: [{
            course_id: "course_408_ds",
            course_title: "数据结构",
            display_order: 1,
            concept_id: "ds_c02_02",
            concept_title: "顺序表的存储表示",
            is_reading: false,
            attempt_count: 0,
            correct_count: 0,
            correct_question_count: 0,
            incorrect_count: 0,
            mistake_count: 0,
            course_attempt_count: 1,
            course_correct_count: 1,
            course_incorrect_count: 0,
            needs_review: false,
            mastered: false,
            practice_question_count: 1,
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    const record = await new PostgresReliableLearningLoop(pool).getLearningRecord("user_student_001");

    expect(record.courses[0]).toMatchObject({
      practice_attempt_count: 1,
      correct_count: 1,
      incorrect_count: 0,
      started_concept_count: 0,
    });
    expect(record.courses[0]?.concepts[0]?.status).toBe("not_started");
    expect(statement).toContain("JOIN questions evidence_question");
    expect(statement).toContain("catalog.question_subject = evidence_question.subject");
    expect(statement).toContain("GROUP BY catalog.course_id");
  });

  it("does not promote an entire concept from one mastered mistake without question breadth", async () => {
    const pool = {
      async query<Row = Record<string, unknown>>() {
        return {
          rows: [{
            course_id: "course_408_ds",
            course_title: "数据结构",
            display_order: 1,
            concept_id: "ds_c02_02",
            concept_title: "顺序表的存储表示",
            is_reading: true,
            attempt_count: 4,
            correct_count: 3,
            correct_question_count: 1,
            incorrect_count: 1,
            mistake_count: 1,
            needs_review: false,
            mastered: true,
            practice_question_count: 3,
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    const record = await new PostgresReliableLearningLoop(pool).getLearningRecord("user_student_001");

    expect(record.courses[0]?.concepts[0]?.status).toBe("practiced");
    expect(record.courses[0]?.mastered_count).toBe(0);
  });

  it("promotes clean repeated evidence only after breadth and a seven-day interval", async () => {
    const pool = {
      async query<Row = Record<string, unknown>>() {
        return {
          rows: [{
            course_id: "course_408_ds",
            course_title: "数据结构",
            display_order: 1,
            concept_id: "ds_c02_02",
            concept_title: "顺序表的存储表示",
            is_reading: true,
            attempt_count: 3,
            correct_count: 3,
            correct_question_count: 2,
            first_correct_at: "2026-08-01T08:00:00.000Z",
            last_correct_at: "2026-08-08T08:00:00.000Z",
            incorrect_count: 0,
            mistake_count: 0,
            needs_review: false,
            mastered: false,
            practice_question_count: 3,
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    const record = await new PostgresReliableLearningLoop(pool).getLearningRecord("user_student_001");

    expect(record.courses[0]?.concepts[0]?.status).toBe("mastered");
    expect(record.courses[0]?.mastered_count).toBe(1);
  });

  it.each([
    {
      label: "fewer than three correct attempts",
      correct_count: 2,
      correct_question_count: 2,
      first_correct_at: "2026-08-01T08:00:00.000Z",
      last_correct_at: "2026-08-08T08:00:00.000Z",
      needs_review: false,
    },
    {
      label: "insufficient reliable question breadth",
      correct_count: 3,
      correct_question_count: 1,
      first_correct_at: "2026-08-01T08:00:00.000Z",
      last_correct_at: "2026-08-08T08:00:00.000Z",
      needs_review: false,
    },
    {
      label: "less than seven days of evidence",
      correct_count: 3,
      correct_question_count: 2,
      first_correct_at: "2026-08-01T08:00:00.000Z",
      last_correct_at: "2026-08-07T07:59:59.000Z",
      needs_review: false,
    },
    {
      label: "an unresolved mistake",
      correct_count: 3,
      correct_question_count: 2,
      first_correct_at: "2026-08-01T08:00:00.000Z",
      last_correct_at: "2026-08-08T08:00:00.000Z",
      needs_review: true,
    },
  ])("keeps clean evidence practiced when $label", async (scenario) => {
    const pool = {
      async query<Row = Record<string, unknown>>() {
        return {
          rows: [{
            course_id: "course_408_ds",
            course_title: "数据结构",
            display_order: 1,
            concept_id: "ds_c02_02",
            concept_title: "顺序表的存储表示",
            is_reading: true,
            attempt_count: 3,
            incorrect_count: 0,
            mistake_count: scenario.needs_review ? 1 : 0,
            mastered: false,
            practice_question_count: 3,
            ...scenario,
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    const record = await new PostgresReliableLearningLoop(pool).getLearningRecord("user_student_001");

    expect(record.courses[0]?.concepts[0]?.status).toBe(
      scenario.needs_review ? "needs_review" : "practiced",
    );
    expect(record.courses[0]?.mastered_count).toBe(0);
  });

  it("does not trust an early mastered flag before the seven-day evidence window", async () => {
    const pool = {
      async query<Row = Record<string, unknown>>() {
        return {
          rows: [{
            course_id: "course_408_ds",
            course_title: "数据结构",
            display_order: 1,
            concept_id: "ds_c02_02",
            concept_title: "顺序表的存储表示",
            is_reading: false,
            attempt_count: 3,
            correct_count: 3,
            correct_question_count: 2,
            first_correct_at: "2030-01-01T08:00:00.000Z",
            last_correct_at: "2030-01-08T07:59:59.000Z",
            incorrect_count: 0,
            mistake_count: 0,
            needs_review: false,
            mastered: true,
            practice_question_count: 3,
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    const record = await new PostgresReliableLearningLoop(pool).getLearningRecord("user_student_001");

    expect(record.courses[0]?.concepts[0]?.status).toBe("practiced");
    expect(record.courses[0]?.mastered_count).toBe(0);
  });

  it("preserves a null exam year for a self-authored mistake", async () => {
    const pool = {
      async query<Row = Record<string, unknown>>() {
        return {
          rows: [{
            mistake_id: "mistake_self_authored",
            course_id: "course_408_ds",
            course_title: "数据结构",
            question_id: "practice-408-v1-01",
            question_year: null,
            question_number: 1,
            subject: "数据结构",
            concept_id: null,
            concept_title: null,
            matched_tag: null,
            match_method: null,
            first_incorrect_attempt_id: "attempt_first",
            last_incorrect_attempt_id: "attempt_last",
            last_incorrect_evaluation_id: "evaluation_last",
            wrong_count: 1,
            status: "needs_review",
            latest_attempt_outcome: "incorrect",
            first_incorrect_at: "2026-08-25T22:30:35.000Z",
            last_incorrect_at: "2026-08-25T22:30:35.000Z",
            mastered_at: null,
            updated_at: "2026-08-25T22:30:35.000Z",
          }] as Row[],
          rowCount: 1,
        };
      },
      async connect() { throw new Error("not used"); },
    } as SqlQueryablePool;

    const result = await new PostgresReliableLearningLoop(pool).listMistakes(
      "user_student_001",
      {},
    );

    expect(result.items[0]?.question_year).toBeNull();
  });
});
