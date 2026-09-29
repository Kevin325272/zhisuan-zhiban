import { describe, expect, it } from "vitest";

import { loadMigrations } from "../src/database/migrate.js";

describe("canonical username migration", () => {
  it("checks canonical collisions before rewriting usernames", () => {
    const migration = loadMigrations().find((entry) => entry.version === "036");

    expect(migration?.name).toBe("036_canonical_usernames.sql");
    const sql = migration?.sql ?? "";
    const collisionGuard = sql.search(/HAVING\s+COUNT\(\*\)\s*>\s*1/iu);
    const abort = sql.search(/RAISE\s+EXCEPTION/iu);
    const rewrite = sql.search(/UPDATE\s+users\s+SET\s+username/iu);
    expect(collisionGuard).toBeGreaterThanOrEqual(0);
    expect(abort).toBeGreaterThan(collisionGuard);
    expect(rewrite).toBeGreaterThan(abort);
  });

  it("stores NFKC lowercase usernames behind a canonical constraint and unique index", () => {
    const migration = loadMigrations().find((entry) => entry.version === "036");
    const sql = migration?.sql ?? "";

    expect(sql).toMatch(/lower\s*\(\s*normalize\s*\(\s*btrim\s*\(\s*username\s*\)\s*,\s*NFKC\s*\)\s*\)/iu);
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+users_username_format_check/iu);
    expect(sql).toMatch(/username\s*=\s*lower\s*\(\s*normalize/iu);
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+users_username_canonical_idx/iu);
    expect(sql).not.toMatch(/string_agg|array_agg/iu);
  });
});
