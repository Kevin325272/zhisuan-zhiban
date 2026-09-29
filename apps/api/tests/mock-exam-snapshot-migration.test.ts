import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../src/database/migrations/052_freeze_mock_exam_evaluation.sql",
  import.meta.url,
));

describe("mock-exam evaluation snapshot migration", () => {
  it("adds a server-only grading payload and backfills existing snapshots", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("evaluation_payload jsonb");
    expect(sql).toContain("jsonb_build_object");
    expect(sql).toContain("question.answer_key");
    expect(sql).toContain("question.explanation_text");
    expect(sql).toContain("question.solution_text");
    expect(sql).toContain("jsonb_array_elements(question.assets)");
    expect(sql).not.toMatch(/DROP\s+TABLE|TRUNCATE\s+TABLE/iu);
  });
});
