import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("timed self-authored mock migration", () => {
  it("relaxes the fixed timer and promotes only the reviewed self-authored set to mock mode", () => {
    const sql = readFileSync(fileURLToPath(new URL(
      "../src/database/migrations/039_timed_self_authored_mock_exam.sql",
      import.meta.url,
    )), "utf8");

    expect(sql).toContain("DROP CONSTRAINT practice_exam_sessions_duration_minutes_check");
    expect(sql).toContain("duration_minutes BETWEEN 15 AND 240");
    expect(sql).toContain("make_interval(mins => duration_minutes)");
    expect(sql).toContain("question_id LIKE 'practice-408-v1-%'");
    expect(sql).toContain("ARRAY['targeted','mock_exam']::text[]");
    expect(sql).toContain("paper_year = 2026");
    expect(sql).not.toMatch(/UPDATE\s+questions/iu);
    expect(sql).not.toMatch(/review_status\s*=\s*'approved'/u);
    expect(sql).not.toMatch(/content_review_status\s*=\s*'teacher_verified'/u);
  });

  it("removes the legacy 180-minute expiry check and restores the objective count constraint", () => {
    const migrationPath = fileURLToPath(new URL(
      "../src/database/migrations/040_repair_timed_mock_exam_constraints.sql",
      import.meta.url,
    ));
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("DROP CONSTRAINT IF EXISTS practice_exam_sessions_check2");
    expect(sql).toContain("practice_exam_sessions_objective_count_check");
    expect(sql).toContain("objective_count BETWEEN 0 AND question_count");
  });
});
