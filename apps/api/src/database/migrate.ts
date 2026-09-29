import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { withTransaction, type SqlPool } from "./client.js";

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

const defaultMigrationDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));

export function loadMigrations(directory = defaultMigrationDirectory): Migration[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{3,}_[a-z0-9_-]+\.sql$/u.test(entry.name))
    .map((entry) => {
      const version = entry.name.split("_", 1)[0];
      if (!version) throw new Error(`Invalid migration filename: ${entry.name}`);
      const sql = readFileSync(new URL(`file:///${directory.replace(/\\/gu, "/")}/${entry.name}`), "utf8");
      return {
        version,
        name: entry.name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));
}

export async function runMigrations(
  pool: SqlPool,
  migrations = loadMigrations(),
): Promise<string[]> {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('xuetu-schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));
    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.version);
      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Migration ${migration.version} checksum does not match the database.`);
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, migration.checksum],
      );
      newlyApplied.push(migration.version);
    }
    return newlyApplied;
  });
}
