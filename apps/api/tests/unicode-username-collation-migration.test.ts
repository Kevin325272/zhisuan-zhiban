import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { canonicalizeUsername } from "@xuetu/contracts";

import { loadMigrations } from "../src/database/migrate.js";

describe("Unicode username collation migration", () => {
  it("uses a deterministic ICU root-locale collation before rewriting legacy usernames", () => {
    const migration = loadMigrations().find((entry) => entry.version === "037");

    expect(migration?.name).toBe("037_unicode_username_collation.sql");
    const sql = migration?.sql ?? "";
    expect(sql).toMatch(/CREATE\s+COLLATION\s+xuetu_unicode_canonical/iu);
    expect(sql).toMatch(/provider\s*=\s*icu/iu);
    expect(sql).toMatch(/locale\s*=\s*'und'/iu);
    expect(sql).toMatch(/COLLATE\s+xuetu_unicode_canonical/iu);
    const collisionGuard = sql.search(/HAVING\s+COUNT\(\*\)\s*>\s*1/iu);
    const abort = sql.search(/RAISE\s+EXCEPTION/iu);
    const rewrite = sql.search(/UPDATE\s+users\s+SET\s+username/iu);
    expect(collisionGuard).toBeGreaterThanOrEqual(0);
    expect(abort).toBeGreaterThan(collisionGuard);
    expect(rewrite).toBeGreaterThan(abort);
  });
});

const databaseUrl = process.env.XUETU_POSTGRES_INTEGRATION_URL?.trim() ?? "";
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres("Unicode username canonicalization in PostgreSQL", () => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: "xuetu-username-canonicalization-integration",
  });

  afterAll(async () => {
    await pool.end();
  });

  it("matches the shared JavaScript canonicalizer for non-ASCII case mappings", async () => {
    const samples = ["É", "E\u0301", "Ａ", "İ", "K", "Σ", "ẞ", "ﬃ"];
    for (const sample of samples) {
      const result = await pool.query<{ canonical_username: string }>(
        `SELECT lower(
           normalize(btrim($1), NFKC) COLLATE xuetu_unicode_canonical
         ) AS canonical_username`,
        [sample],
      );
      expect(result.rows[0]?.canonical_username).toBe(canonicalizeUsername(sample));
    }
  });
});
