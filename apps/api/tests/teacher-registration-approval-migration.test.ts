import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("teacher registration approval migration", () => {
  it("adds pending approval without weakening active-account checks", () => {
    const sql = readFileSync(
      new URL("../src/database/migrations/034_teacher_registration_approval.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("pending_approval");
    expect(sql).toMatch(/CHECK\s*\(account_status\s+IN\s*\('active',\s*'pending_approval',\s*'disabled'\)\)/u);
    expect(sql).not.toMatch(/DROP\s+COLUMN/u);
  });
});
