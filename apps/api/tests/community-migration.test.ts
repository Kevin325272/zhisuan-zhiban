import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../src/database/migrations/048_school_community.sql", import.meta.url),
);

describe("school community migration", () => {
  it("keeps authorship, soft deletion, retry safety and active-list indexes in PostgreSQL", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("REFERENCES users(user_id) ON DELETE CASCADE");
    expect(sql).toContain("deleted_at timestamptz NULL");
    expect(sql).toContain("UNIQUE (author_user_id, idempotency_key)");
    expect(sql).toMatch(/CREATE INDEX community_posts_active_circle_idx[\s\S]*WHERE deleted_at IS NULL/u);
    expect(sql).toMatch(/CREATE INDEX community_replies_active_post_idx[\s\S]*WHERE deleted_at IS NULL/u);
    expect(sql).toContain("PRIMARY KEY (post_id, user_id)");
    expect(sql).toContain("CREATE TABLE community_post_views");
    expect(sql).toContain("PRIMARY KEY (post_id, user_id)");
  });
});
