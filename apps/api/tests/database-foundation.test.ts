import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DatabaseConfigurationError,
  readDatabaseConfig,
} from "../src/config/database.js";
import {
  createPostgresPool,
  withTransaction,
  type SqlClient,
  type SqlQueryResult,
} from "../src/database/client.js";
import { loadMigrations, runMigrations } from "../src/database/migrate.js";
import { seedDevelopmentPlatform } from "../src/database/seed-development-platform.js";
import {
  hasPlatformCapability,
  roleCapabilities,
} from "../src/services/access-control.js";

describe("PostgreSQL configuration", () => {
  it("requires an explicit PostgreSQL connection URL", () => {
    expect(() => readDatabaseConfig({})).toThrow(DatabaseConfigurationError);
    expect(() =>
      readDatabaseConfig({ DATABASE_URL: "file:./runtime.json" }),
    ).toThrow("DATABASE_URL must use postgresql:// or postgres://");
  });

  it("parses bounded pool and SSL settings", () => {
    expect(
      readDatabaseConfig({
        DATABASE_URL: "postgresql://xuetu:secret@127.0.0.1:55432/xuetu_dev",
        DATABASE_POOL_MAX: "8",
        DATABASE_SSL: "disable",
      }),
    ).toEqual({
      connectionString: "postgresql://xuetu:secret@127.0.0.1:55432/xuetu_dev",
      maxConnections: 8,
      ssl: false,
    });

    expect(() =>
      readDatabaseConfig({
        DATABASE_URL: "postgresql://xuetu:secret@127.0.0.1:55432/xuetu_dev",
        DATABASE_POOL_MAX: "51",
      }),
    ).toThrow("DATABASE_POOL_MAX must be between 1 and 50");
  });
});

describe("database transactions and migrations", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates a PostgreSQL pool from validated settings", () => {
    let received: Record<string, unknown> | undefined;
    class PoolDouble {
      constructor(options: {
        connectionString: string;
        max: number;
        ssl: false | { rejectUnauthorized: true };
        application_name: string;
      }) {
        received = options;
      }
    }

    const pool = createPostgresPool(
      {
        connectionString: "postgresql://xuetu:secret@127.0.0.1:55432/xuetu_dev",
        maxConnections: 8,
        ssl: false,
      },
      PoolDouble,
    );

    expect(pool).toBeInstanceOf(PoolDouble);
    expect(received).toEqual({
      connectionString: "postgresql://xuetu:secret@127.0.0.1:55432/xuetu_dev",
      max: 8,
      ssl: false,
      application_name: "xuetu-api",
    });
  });

  it("uses one client for BEGIN, work, COMMIT, and release", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release() {
        statements.push("RELEASE");
      },
    };
    const pool = { async connect() { return client; } };

    await withTransaction(pool, async (transaction) => {
      expect(transaction).toBe(client);
      await transaction.query("INSERT INTO audit_log VALUES ($1)", ["event"]);
    });

    expect(statements).toEqual([
      "BEGIN",
      "INSERT INTO audit_log VALUES ($1)",
      "COMMIT",
      "RELEASE",
    ]);
  });

  it("rolls back and releases the same client on failure", async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release() {
        statements.push("RELEASE");
      },
    };
    const pool = { async connect() { return client; } };

    await expect(
      withTransaction(pool, async () => {
        throw new Error("seed failed");
      }),
    ).rejects.toThrow("seed failed");
    expect(statements).toEqual(["BEGIN", "ROLLBACK", "RELEASE"]);
  });

  it("loads migrations in order and applies each version once", async () => {
    const directory = mkdtempSync(join(tmpdir(), "xuetu-migrations-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "002_second.sql"), "CREATE TABLE second(id text);", "utf8");
    writeFileSync(join(directory, "001_first.sql"), "CREATE TABLE first(id text);", "utf8");
    writeFileSync(join(directory, "README.md"), "ignored", "utf8");

    const migrations = loadMigrations(directory);
    expect(migrations.map((migration) => migration.version)).toEqual(["001", "002"]);

    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(
        sql: string,
        parameters?: readonly unknown[],
      ): Promise<SqlQueryResult<Row>> {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("FROM schema_migrations ORDER BY version")) {
          return {
            rows: [{ version: "001", checksum: migrations[0]!.checksum } as Row],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };

    await runMigrations({ async connect() { return client; } }, migrations);

    expect(statements.some((entry) => entry.sql.includes("CREATE TABLE first"))).toBe(false);
    expect(statements.some((entry) => entry.sql.includes("CREATE TABLE second"))).toBe(true);
    expect(
      statements.some(
        (entry) =>
          entry.sql.includes("INSERT INTO schema_migrations") &&
          entry.parameters?.[0] === "002",
      ),
    ).toBe(true);
  });

  it("ships a foundation migration for every required runtime entity", () => {
    const migrations = loadMigrations();
    const sql = migrations.map((migration) => migration.sql).join("\n").toLowerCase();
    for (const table of [
      "users",
      "roles",
      "permissions",
      "user_roles",
      "courses",
      "course_memberships",
      "materials",
      "question_import_batches",
      "questions",
      "practice_attempts",
      "evaluations",
      "learning_evidence",
      "course_catalog_entries",
      "course_content_sources",
      "course_content_chunks",
      "course_qa_examples",
      "course_figure_assets",
      "course_figure_references",
      "course_figure_catalog_entries",
      "course_concept_figures",
      "course_reading_progress",
      "course_reading_history",
      "exam_paper_import_batches",
      "exam_papers",
      "course_concept_question_links",
      "practice_mistakes",
      "course_source_datasets",
      "course_source_chunks",
      "course_source_figure_assets",
      "course_source_figure_relations",
      "student_onboarding_states",
      "student_onboarding_self_assessments",
      "onboarding_diagnostic_questions",
      "student_onboarding_diagnostic_answers",
      "student_initial_profile_versions",
      "student_learning_plan_versions",
      "student_learning_plan_tasks",
      "student_learning_task_assignments",
      "admission_targets",
      "admission_retest_lines",
      "student_admission_targets",
      "course_video_import_batches",
      "course_video_series",
      "course_video_episodes",
      "course_concept_video_links",
      "programming_experiment_attempts",
      "programming_experiment_evidence",
      "academic_classes",
      "student_academic_profiles",
      "teacher_academic_profiles",
      "teacher_course_class_assignments",
      "student_course_progress_snapshots",
    ]) {
      expect(sql).toContain(`create table ${table}`);
    }
    expect(sql).toContain("source_url");
    expect(sql).toContain("license_status");
    expect(sql).toContain("usage_scope");
    expect(sql).toContain("human_verified");
    expect(sql).toContain("pdf_physical_page");
    expect(sql).toContain("paragraph_index");
    expect(sql).toContain("source_expanded");
    expect(sql).toContain("archive_entry");
    expect(sql).toContain("training_allowed");
    expect(sql).not.toMatch(/\b(drop|truncate)\s+table\b/u);
  });

  it("ships credential columns and revocable server sessions", () => {
    const sql = loadMigrations().map((migration) => migration.sql).join("\n").toLowerCase();
    expect(sql).toContain("username");
    expect(sql).toContain("password_hash");
    expect(sql).toContain("must_change_password");
    expect(sql).toContain("create table account_sessions");
    expect(sql).toContain("token_hash");
    expect(sql).toContain("revoked_at");
    expect(sql).toContain("expires_at");
  });

  it("lets migrated existing students remain completed without fabricated onboarding goals", () => {
    const onboarding = loadMigrations().find((migration) => migration.version === "013");
    expect(onboarding?.sql).toContain("status IN ('not_started', 'completed')");
    expect(onboarding?.sql).toContain("SELECT DISTINCT u.user_id, 'completed', 'plan'");
  });

  it("versions onboarding diagnostic ownership without rewriting historical answers", () => {
    const migration = loadMigrations().find((entry) => entry.version === "014");
    expect(migration?.sql).toContain("ADD COLUMN diagnostic_set_version");
    expect(migration?.sql).toContain("DEFAULT '408-v1'");
    expect(migration?.sql).toContain("SET DEFAULT '408-v2'");
    expect(migration?.sql).not.toMatch(/DELETE\s+FROM\s+student_onboarding_diagnostic_answers/iu);
    expect(migration?.sql).not.toMatch(/UPDATE\s+student_onboarding_diagnostic_answers/iu);
  });

  it("adds searchable admissions targets without rewriting the legacy onboarding target", () => {
    const migration = loadMigrations().find((entry) => entry.version === "015");
    expect(migration?.sql).toContain("CREATE TABLE admission_targets");
    expect(migration?.sql).toContain("CREATE TABLE admission_retest_lines");
    expect(migration?.sql).toContain("CREATE TABLE student_admission_targets");
    expect(migration?.sql).toContain("student_admission_targets_user_idx");
    expect(migration?.sql).not.toMatch(/UPDATE\s+student_onboarding_states/iu);
    expect(migration?.sql).not.toMatch(/\b(DROP|TRUNCATE)\s+TABLE\b/iu);
  });

  it("versions server-owned learning task assignments with an active-user guard", () => {
    const migration = loadMigrations().find((entry) => entry.version === "016");
    expect(migration?.sql).toContain("CREATE TABLE student_learning_task_assignments");
    expect(migration?.sql).toContain("CREATE UNIQUE INDEX student_learning_task_one_pending_idx");
    expect(migration?.sql).toContain("activated_at");
    expect(migration?.sql).toContain("completion_evidence_refs");
    expect(migration?.sql).toContain("status IN ('pending', 'completed', 'superseded')");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+TABLE\b/iu);
  });

  it("adds traceable external course videos without deleting existing learning data", () => {
    const migration = loadMigrations().find((entry) => entry.version === "017");
    expect(migration?.sql).toContain("CREATE TABLE course_video_import_batches");
    expect(migration?.sql).toContain("CREATE TABLE course_video_series");
    expect(migration?.sql).toContain("CREATE TABLE course_video_episodes");
    expect(migration?.sql).toContain("CREATE TABLE course_concept_video_links");
    expect(migration?.sql).toContain("license_status");
    expect(migration?.sql).toContain("usage_scope");
    expect(migration?.sql).toContain("external_links_only");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+TABLE\b|\bDELETE\s+FROM\b/iu);
  });

  it("adds account-owned programming experiment attempts and evidence without rewriting learning data", () => {
    const migration = loadMigrations().find((entry) => entry.version === "018");
    expect(migration?.sql).toContain("CREATE TABLE programming_experiment_attempts");
    expect(migration?.sql).toContain("CREATE TABLE programming_experiment_evidence");
    expect(migration?.sql).toContain("user_id");
    expect(migration?.sql).toContain("concept_id");
    expect(migration?.sql).toContain("execution_mode = 'sandbox'");
    expect(migration?.sql).toContain("UNIQUE (user_id, experiment_id, idempotency_key)");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+TABLE\b|\b(?:DELETE|UPDATE)\s+FROM\b/iu);
  });

  it("adds persistent idempotency protection for answer-backed question evaluation", () => {
    const migration = loadMigrations().find((entry) => entry.version === "020");
    expect(migration?.sql).toContain("CREATE TABLE practice_evaluation_idempotency");
    expect(migration?.sql).toContain("PRIMARY KEY (user_id, idempotency_key)");
    expect(migration?.sql).toContain("request_fingerprint");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/iu);
  });

  it("adds a stable task-settlement snapshot without rewriting learning records", () => {
    const migration = loadMigrations().find((entry) => entry.version === "021");
    expect(migration?.sql).toContain("ADD COLUMN IF NOT EXISTS completion_settlement");
    expect(migration?.sql).toContain("jsonb_typeof(completion_settlement) = 'object'");
    expect(migration?.sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/iu);
    expect(migration?.sql).not.toMatch(/UPDATE\s+(?:learning_evidence|practice_attempts|practice_mistakes)/iu);
  });

  it("seeds separated local-development users, roles, course, and memberships", async () => {
    const statements: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
    const client = {
      async query(sql: string, parameters?: readonly unknown[]) {
        statements.push({ sql, ...(parameters ? { parameters } : {}) });
        return { rows: [], rowCount: 1 };
      },
      release() {
        statements.push({ sql: "RELEASE" });
      },
    };
    const result = await seedDevelopmentPlatform(
      { async connect() { return client; } },
      () => new Date("2026-07-27T00:00:00.000Z"),
    );

    expect(result).toEqual({
      users: 3,
      roles: 3,
      courses: 5,
      memberships: 10,
      catalogEntries: 4,
    });
    expect(JSON.stringify(statements)).toContain("user_student_001");
    expect(JSON.stringify(statements)).toContain("user_teacher_001");
    expect(JSON.stringify(statements)).toContain("user_admin_001");
    expect(JSON.stringify(statements)).toContain("course_408_co");
    expect(JSON.stringify(statements)).toContain("computer-organization");
    expect(JSON.stringify(statements)).not.toContain("password_hash");
    expect(statements.map((entry) => entry.sql)).toEqual(
      expect.arrayContaining([
        "BEGIN",
        expect.stringContaining("INSERT INTO roles"),
        expect.stringContaining("INSERT INTO permissions"),
        expect.stringContaining("INSERT INTO users"),
        expect.stringContaining("INSERT INTO courses"),
        expect.stringContaining("INSERT INTO course_memberships"),
        "COMMIT",
        "RELEASE",
      ]),
    );
  });
});

describe("role and course authorization", () => {
  it("does not grant teacher global administrator capabilities", () => {
    expect(roleCapabilities.teacher).toContain("question:manage:assigned");
    expect(roleCapabilities.teacher).not.toContain("identity:manage:any");
    expect(roleCapabilities.admin).toContain("identity:manage:any");
  });

  it("requires course assignment for teacher management operations", () => {
    expect(
      hasPlatformCapability(["teacher"], "question:manage", {
        courseAssigned: true,
      }),
    ).toBe(true);
    expect(
      hasPlatformCapability(["teacher"], "question:manage", {
        courseAssigned: false,
      }),
    ).toBe(false);
    expect(
      hasPlatformCapability(["admin"], "question:manage", {
        courseAssigned: false,
      }),
    ).toBe(true);
  });
});
