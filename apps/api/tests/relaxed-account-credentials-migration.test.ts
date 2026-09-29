import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("relaxed account credential migration", () => {
  it("allows short Unicode usernames without rewriting existing accounts", () => {
    const migration = loadMigrations().find((entry) => entry.version === "035");

    expect(migration?.name).toBe("035_relaxed_account_credentials.sql");
    expect(migration?.sql).toContain("DROP CONSTRAINT IF EXISTS users_username_format_check");
    expect(migration?.sql).toContain("char_length(username) BETWEEN 1 AND 32");
    expect(migration?.sql).toContain("username !~ '[[:space:][:cntrl:]]'");
    expect(migration?.sql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\b/iu);
  });
});
