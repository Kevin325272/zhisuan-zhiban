import { describe, expect, it, vi } from "vitest";

import { seedAuthentication } from "../src/database/seed-authentication.js";
import type { SqlPool } from "../src/database/client.js";
import { ScryptPasswordHasher } from "../src/services/auth/password-hasher.js";

describe("authentication seed", () => {
  it("seeds only missing hashes and never logs or returns plaintext credentials", async () => {
    const statements: string[] = [];
    let userReads = 0;
    const client = {
      async query<Row = Record<string, unknown>>(sql: string) {
        statements.push(sql);
        if (sql.startsWith("SELECT user_id")) {
          userReads += 1;
          const userIds = ["user_admin_001", "user_student_001", "user_teacher_001"];
          return {
            rows: [{ user_id: userIds[userReads - 1], password_hash: null } as Row],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlPool = { async connect() { return client; } };
    const result = await seedAuthentication(pool, new ScryptPasswordHasher({ cost: 1_024 }), {
      initialAdminPassword: "StrongAdminPassword123",
      legacyStudentPassword: "StrongStudentPassword123",
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(result).toEqual({ updated: 3 });
    expect(statements.join("\n")).not.toContain("StrongAdminPassword123");
    expect(statements.join("\n")).not.toContain("StrongStudentPassword123");
    expect(statements.join("\n")).not.toContain("must_change_password = false");
  });

  it("only synchronizes existing demo hashes when the deployment switch is explicit", async () => {
    const statements: string[] = [];
    const updateParameters: unknown[][] = [];
    let userReads = 0;
    const client = {
      async query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]) {
        statements.push(sql);
        if (sql.startsWith("SELECT user_id")) {
          userReads += 1;
          const userIds = ["user_admin_001", "user_student_001", "user_teacher_001"];
          return {
            rows: [{ user_id: userIds[userReads - 1], password_hash: "old-hash" } as Row],
            rowCount: 1,
          };
        }
        if (sql.startsWith("UPDATE users")) updateParameters.push(parameters ?? []);
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlPool = { async connect() { return client; } };
    const hasher = {
      hash: vi.fn(async (password: string) => `replacement-${password}`),
      verify: vi.fn(),
    };

    await seedAuthentication(pool, hasher, {
      initialAdminPassword: "StrongAdminPassword123",
      legacyStudentPassword: "StrongStudentPassword123",
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(updateParameters.every((parameters) => parameters[2] === "old-hash")).toBe(true);

    userReads = 0;
    updateParameters.length = 0;
    await seedAuthentication(pool, hasher, {
      initialAdminPassword: "StrongAdminPassword123",
      legacyStudentPassword: "StrongStudentPassword123",
      syncDemoCredentials: true,
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });

    expect(hasher.hash).toHaveBeenCalledTimes(3);
    expect(updateParameters.map((parameters) => parameters[2])).toEqual([
      "replacement-StrongAdminPassword123",
      "replacement-StrongStudentPassword123",
      "replacement-StrongStudentPassword123",
    ]);
    expect(statements.join("\n")).not.toContain("StrongAdminPassword123");
    expect(statements.join("\n")).not.toContain("StrongStudentPassword123");
  });

  it("writes the replacement hash when explicit synchronization is enabled", async () => {
    const hashes = new Map([
      ["user_admin_001", "old-admin-hash"],
      ["user_student_001", "old-student-hash"],
      ["user_teacher_001", "old-teacher-hash"],
    ]);
    let userReads = 0;
    const client = {
      async query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]) {
        if (sql.startsWith("SELECT user_id")) {
          const userIds = ["user_admin_001", "user_student_001", "user_teacher_001"];
          const userId = userIds[userReads++]!;
          return {
            rows: [{ user_id: userId, password_hash: hashes.get(userId) } as Row],
            rowCount: 1,
          };
        }
        if (sql.startsWith("UPDATE users")) {
          const [userId, , replacementHash] = parameters ?? [];
          // Model the database behavior so the test catches COALESCE retaining an old hash.
          if (!sql.includes("password_hash = COALESCE(password_hash")) {
            hashes.set(String(userId), String(replacementHash));
          }
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlPool = { async connect() { return client; } };
    const hasher = {
      hash: vi.fn(async (password: string) => `replacement-${password}`),
      verify: vi.fn(),
    };

    await seedAuthentication(pool, hasher, {
      initialAdminPassword: "StrongAdminPassword123",
      legacyStudentPassword: "StrongStudentPassword123",
      syncDemoCredentials: true,
    });

    expect([...hashes.entries()]).toEqual([
      ["user_admin_001", "replacement-StrongAdminPassword123"],
      ["user_student_001", "replacement-StrongStudentPassword123"],
      ["user_teacher_001", "replacement-StrongStudentPassword123"],
    ]);
  });
});
