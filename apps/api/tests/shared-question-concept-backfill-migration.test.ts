import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("shared question concept backfill migration", () => {
  it("maps a unique active question link through the 408 subject catalog", () => {
    const migration = loadMigrations().find((entry) => entry.version === "043");
    const sql = migration?.sql ?? "";

    expect(migration?.name).toBe("043_shared_question_concept_backfill.sql");
    expect(sql).toContain("JOIN course_catalog_entries catalog");
    expect(sql).toContain("catalog.question_subject = question.subject");
    expect(sql).toContain("concept.course_id = catalog.course_id");
    expect(sql).toContain("UPDATE practice_attempts");
    expect(sql).toContain("UPDATE learning_evidence");
    expect(sql).toContain("UPDATE practice_mistakes");
    expect(sql).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP)\b/iu);
  });
});
