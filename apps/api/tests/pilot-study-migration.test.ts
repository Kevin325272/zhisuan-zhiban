import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("pilot study evidence migration", () => {
  it("adds constrained pilot records without modifying existing learning evidence", () => {
    const migration = loadMigrations().find((entry) => entry.version === "028");

    expect(migration?.name).toBe("028_pilot_study_evidence.sql");
    expect(migration?.sql).toContain("CREATE TABLE pilot_studies");
    expect(migration?.sql).toContain("CREATE TABLE pilot_tasks");
    expect(migration?.sql).toContain("CREATE TABLE pilot_participants");
    expect(migration?.sql).toContain("CREATE TABLE pilot_task_progress");
    expect(migration?.sql).toContain("CREATE TABLE pilot_feedback");
    expect(migration?.sql).toContain("participant_kind IN ('real_trial', 'synthetic_verification')");
    expect(migration?.sql).toContain("evidence_kind IN ('verified_choice_attempt', 'verified_course_reading')");
    expect(migration?.sql).toContain("UNIQUE (study_id, participant_code)");
    expect(migration?.sql).toContain("UNIQUE (study_id, user_id)");
    expect(migration?.sql).toContain("CHECK (baseline_confidence BETWEEN 1 AND 5)");
    expect(migration?.sql).toContain("CHECK (ease_of_use BETWEEN 1 AND 5)");
    expect(migration?.sql).not.toMatch(
      /(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:practice_attempts|evaluations|learning_evidence|users)/iu,
    );
  });
});

