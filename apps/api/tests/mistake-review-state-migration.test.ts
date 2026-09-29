import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("mistake review state migration", () => {
  it("creates an answer-backed review-state table and ordered evidence trigger", () => {
    const migration = loadMigrations().find((entry) => entry.version === "019");

    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("CREATE TABLE practice_mistake_review_states");
    expect(migration?.sql).toContain("last_processed_attempt_id");
    expect(migration?.sql).toContain("next_review_at");
    expect(migration?.sql).toContain("AFTER INSERT ON learning_evidence");
    expect(migration?.sql).toContain("zz_mistake_review_state_trigger");
    expect(migration?.sql).toContain("NEW.eligible_for_learning_state_update");
    expect(migration?.sql).toContain("NEW.outcome = 'incorrect'");
    expect(migration?.sql).toContain("NEW.outcome = 'correct'");
  });

  it("backfills only derived review state and never deletes historical mistakes", () => {
    const migration = loadMigrations().find((entry) => entry.version === "019");

    expect(migration?.sql).toContain("last_incorrect_at + interval '1 day'");
    expect(migration?.sql).toContain("WHERE status = 'needs_review'");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\s+practice_mistakes\b/iu);
  });

  it("advances a correct review only after the persisted due time", () => {
    const migration = loadMigrations().find((entry) => entry.version === "022");

    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("CREATE OR REPLACE FUNCTION xuetu_advance_mistake_review_state");
    expect(migration?.sql).toMatch(/NEW\.created_at\s*<\s*review_state_row\.next_review_at/iu);
    expect(migration?.sql).toContain("RETURN NEW");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\s+practice_mistakes\b/iu);
  });
});
