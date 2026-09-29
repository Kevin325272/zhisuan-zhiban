import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("student care migration", () => {
  it("adds reversible preferences and constrained care interactions", () => {
    const migration = loadMigrations().find((entry) => entry.version === "024");

    expect(migration?.name).toBe("024_student_care_mode.sql");
    expect(migration?.sql).toContain("CREATE TABLE student_care_preferences");
    expect(migration?.sql).toContain("CREATE TABLE student_care_interactions");
    expect(migration?.sql).toContain("signal_code IN ('return_after_gap', 'accuracy_shift', 'rhythm_drop')");
    expect(migration?.sql).toContain("response IN ('continue', 'lighten', 'talk', 'dismiss', 'disable')");
    expect(migration?.sql).toContain("jsonb_typeof(evidence_summary) = 'object'");
    expect(migration?.sql).toContain("jsonb_typeof(light_step) = 'object'");
    expect(migration?.sql).toContain("CREATE UNIQUE INDEX student_care_one_presented_idx");
    expect(migration?.sql).toContain("WHERE status = 'presented'");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/iu);
    expect(migration?.sql).not.toMatch(
      /UPDATE\s+(?:learning_evidence|practice_attempts|practice_mistakes|student_learning_task_assignments)/iu,
    );
  });

  it("persists the server-owned course for idempotent talk consent", () => {
    const migration = loadMigrations().find((entry) => entry.version === "025");

    expect(migration?.name).toBe("025_student_care_talk_course.sql");
    expect(migration?.sql).toContain("ADD COLUMN talk_course_id");
    expect(migration?.sql).toContain("REFERENCES courses(course_id)");
    expect(migration?.sql).toContain("response = 'talk'");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/iu);
    expect(migration?.sql).not.toMatch(
      /UPDATE\s+(?:learning_evidence|practice_attempts|practice_mistakes|student_learning_task_assignments)/iu,
    );
  });

  it("validates the talk-course constraint only when legacy rows are compatible", () => {
    const migration = loadMigrations().find((entry) => entry.version === "026");

    expect(migration?.name).toBe("026_validate_student_care_talk_course.sql");
    expect(migration?.sql).toContain("IF NOT EXISTS");
    expect(migration?.sql).toContain("VALIDATE CONSTRAINT student_care_talk_course_scope_check");
    expect(migration?.sql).toContain("response = 'talk' AND talk_course_id IS NULL");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/iu);
  });

  it("persists and backfills a server-owned fallback step for talk responses", () => {
    const migration = loadMigrations().find((entry) => entry.version === "027");

    expect(migration?.name).toBe("027_student_care_talk_fallback_step.sql");
    expect(migration?.sql).toContain("ADD COLUMN talk_fallback_step jsonb");
    expect(migration?.sql).toContain("jsonb_typeof(talk_fallback_step) = 'object'");
    expect(migration?.sql).toContain("response = 'talk'");
    expect(migration?.sql).toContain("UPDATE student_care_interactions interaction");
    expect(migration?.sql).toContain("VALIDATE CONSTRAINT student_care_talk_fallback_scope_check");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/iu);
    expect(migration?.sql).not.toMatch(
      /UPDATE\s+(?:learning_evidence|practice_attempts|practice_mistakes|student_learning_task_assignments)/iu,
    );
  });
});
