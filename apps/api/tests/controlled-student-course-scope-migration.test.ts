import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../src/database/migrations/030_controlled_student_408_memberships.sql",
  import.meta.url,
));

describe("controlled student 408 membership migration", () => {
  it("backfills only registered students already participating in a 408 subcourse", () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("u.account_origin = 'registered'");
    expect(sql).toContain("u.account_status = 'active'");
    expect(sql).toContain("ur.role_key = 'student'");
    expect(sql).toContain("EXISTS (");
    expect(sql).toContain("existing_membership.user_id = u.user_id");
    for (const courseId of [
      "course_408_ds",
      "course_408_co",
      "course_408_os",
      "course_408_cn",
    ]) {
      expect(sql).toContain(`'${courseId}'`);
    }
    expect(sql).not.toContain("'course_408_001'");
    expect(sql).toContain("ON CONFLICT (course_id, user_id) DO UPDATE");
  });
});
