import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("question learning modes and FSRS migration", () => {
  it("adds governed question metadata and protects the latest three full papers", () => {
    const migration = loadMigrations().find((entry) => entry.version === "031");

    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("ALTER TABLE questions ALTER COLUMN year DROP NOT NULL");
    expect(migration?.sql).toContain("CREATE TABLE question_learning_metadata");
    expect(migration?.sql).toContain("source_type IN ('past_exam', 'mock_exam', 'self_authored_screening', 'self_authored_practice')");
    expect(migration?.sql).toContain("allowed_modes");
    expect(migration?.sql).toContain("protect_full_paper");
    expect(migration?.sql).toMatch(/MAX\(year\)[\s\S]*-\s*2/iu);
    expect(migration?.sql).toContain("'past_exam'");
    expect(migration?.sql).toContain("'targeted'");
    expect(migration?.sql).toContain("'mock_exam'");
    expect(migration?.sql).toContain("ALTER COLUMN diagnostic_set_version SET DEFAULT '408-v3'");
    expect(migration?.sql).not.toMatch(/\b(?:TRUNCATE|DELETE)\s+(?:TABLE|FROM)\s+questions\b/iu);
    expect(migration?.sql).not.toMatch(/\bDROP\s+TABLE\b/iu);
  });

  it("stores a versioned per-user FSRS card with an attempt idempotency boundary", () => {
    const sql = loadMigrations().find((entry) => entry.version === "031")?.sql;

    expect(sql).toContain("CREATE TABLE student_question_memory_states");
    for (const column of [
      "due",
      "stability",
      "difficulty",
      "elapsed_days",
      "scheduled_days",
      "reps",
      "lapses",
      "learning_steps",
      "state",
      "last_review",
      "last_attempt_id",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("fsrs_v6_ts_fsrs_5_4_1");
    expect(sql).toContain("PRIMARY KEY (user_id, question_id)");
    expect(sql).toContain("UNIQUE (user_id, last_attempt_id)");
    expect(sql).toContain("evidence_weighted_v1");
  });

  it("creates server-owned 180-minute full-paper sessions without storing answers", () => {
    const sql = loadMigrations().find((entry) => entry.version === "031")?.sql;

    expect(sql).toContain("CREATE TABLE practice_exam_sessions");
    expect(sql).toContain("duration_minutes integer NOT NULL DEFAULT 180");
    expect(sql).toContain("status IN ('active', 'submitted')");
    expect(sql).toContain("started_at");
    expect(sql).toContain("submitted_at");
    expect(sql).toContain("submission_key_hash");
    expect(sql).toContain("result_payload");
    expect(sql).toContain("CREATE TABLE practice_exam_session_questions");
    expect(sql).toContain("PRIMARY KEY (session_id, question_id)");
    expect(sql).toContain("UNIQUE (session_id, ordinal)");
    expect(sql).toContain("CREATE UNIQUE INDEX practice_exam_sessions_active_idx");
    expect(sql).not.toContain("answer_key");
    expect(sql).not.toContain("response_text");
  });
});
