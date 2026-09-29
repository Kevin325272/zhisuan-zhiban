import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("teacher intervention lifecycle migration", () => {
  it("adds target integrity, lifecycle timestamps, and immutable completion evidence", () => {
    const migrationPath = fileURLToPath(new URL(
      "../src/database/migrations/051_teacher_intervention_lifecycle.sql",
      import.meta.url,
    ));
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("ADD COLUMN IF NOT EXISTS updated_at");
    expect(sql).toContain("target_type");
    expect(sql).toContain("target_class_id");
    expect(sql).toContain("target_user_id");
    expect(sql).toContain("evidence_snapshot");
    expect(sql).toContain("completed_at >= delivered_at");
    expect(sql).toContain("prevent_teacher_intervention_snapshot_mutation");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS teacher_interventions_target_class_idx");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+TABLE\b/iu);
  });
});
