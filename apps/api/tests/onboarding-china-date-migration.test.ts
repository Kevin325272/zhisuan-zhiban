import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("onboarding China-local plan date migration", () => {
  it("repairs existing plan and task dates from each plan generation timestamp", () => {
    const migration = loadMigrations().find((entry) => entry.version === "038");

    expect(migration?.sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
    expect(migration?.sql).toContain("UPDATE student_learning_plan_versions");
    expect(migration?.sql).toContain("UPDATE student_learning_plan_tasks AS task");
    expect(migration?.sql).toContain("task.day_index - 1");
    expect(migration?.sql).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP)\b/iu);
  });
});
