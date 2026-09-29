import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("question-bank asset blob migration", () => {
  it("adds content-addressed image blobs and per-question role links", () => {
    const migration = loadMigrations().find((entry) => entry.version === "044");

    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("CREATE TABLE question_asset_blobs");
    expect(migration?.sql).toContain("content_sha256 char(64) PRIMARY KEY");
    expect(migration?.sql).toContain("content bytea NOT NULL");
    expect(migration?.sql).toContain("octet_length(content) = byte_length");
    expect(migration?.sql).toContain("CREATE TABLE question_asset_links");
    expect(migration?.sql).toContain("PRIMARY KEY (question_id, asset_id)");
    expect(migration?.sql).toContain("role IN ('question', 'option', 'explanation', 'solution')");
    expect(migration?.sql).toContain("question_asset_links_question_role_idx");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/iu);
  });

  it("adds an explicit demo-validation state without rewriting review decisions", () => {
    const migration = loadMigrations().find((entry) => entry.version === "045");

    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("demo_validated");
    expect(migration?.sql).toContain("pending_teacher_review");
    expect(migration?.sql).toContain("teacher_verified");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+TABLE\b/iu);
    expect(migration?.sql).not.toMatch(/\b(?:DELETE|UPDATE)\s+(?:FROM\s+)?questions\b/iu);
  });

  it("indexes per-student question progress used by the past-paper catalog", () => {
    const migration = loadMigrations().find((entry) => entry.version === "046");

    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("CREATE INDEX IF NOT EXISTS practice_attempts_user_question_idx");
    expect(migration?.sql).toContain("practice_attempts(user_id, question_id)");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/iu);
  });
});
