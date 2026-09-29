import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("learning task type constraint migration", () => {
  it("removes unsupported case-review tasks without deleting historical learning data", () => {
    const migration = loadMigrations().find((entry) => entry.version === "023");

    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("student_learning_plan_tasks_task_type_check");
    expect(migration?.sql).toContain("student_learning_task_assignments_task_type_check");
    expect(migration?.sql).toContain("task_type = 'case_review'");
    expect(migration?.sql).not.toMatch(/CHECK\s*\([^)]*case_review/isu);
    expect(migration?.sql).toContain("RAISE EXCEPTION");
    expect(migration?.sql).not.toMatch(/\b(?:TRUNCATE|DELETE)\b/iu);
  });
});
