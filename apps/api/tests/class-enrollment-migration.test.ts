import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("class enrollment workflow migration", () => {
  it("stores invitation hashes and reviewable enrollment requests", () => {
    const migrationPath = fileURLToPath(new URL(
      "../src/database/migrations/047_class_enrollment_workflow.sql",
      import.meta.url,
    ));
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE class_invitation_codes");
    expect(sql).toContain("code_hash char(64)");
    expect(sql).toContain("CREATE TABLE class_enrollment_requests");
    expect(sql).toContain("status IN ('pending', 'approved', 'rejected', 'cancelled')");
    expect(sql).toContain("WHERE status = 'pending'");
    expect(sql).toContain("UNIQUE INDEX class_enrollment_requests_pending_user_idx");
    expect(sql).toContain("UNIQUE INDEX class_enrollment_requests_pending_number_idx");
    expect(sql).not.toMatch(/invite_code\s+text/iu);
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE)\s+TABLE\b/iu);
  });
});
