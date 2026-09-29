import { withTransaction, type SqlPool } from "./client.js";
import { passwordStrengthError, type PasswordHasher } from "../services/auth/password-hasher.js";

export interface AuthenticationSeedOptions {
  initialAdminPassword: string;
  legacyStudentPassword: string;
  /**
   * Re-hash the supplied deployment credentials for the fixed demo accounts.
   * Keep this opt-in so a routine seed cannot silently reset existing users.
   */
  syncDemoCredentials?: boolean;
  now?: () => Date;
}

const seedAccounts = [
  {
    userId: "user_admin_001",
    username: "user_admin_001",
    origin: "seeded_admin" as const,
    role: "admin" as const,
    passwordKey: "initialAdminPassword" as const,
  },
  {
    userId: "user_student_001",
    username: "user_student_001",
    origin: "legacy_demo" as const,
    role: "student" as const,
    passwordKey: "legacyStudentPassword" as const,
  },
  {
    userId: "user_teacher_001",
    username: "user_teacher_001",
    origin: "legacy_demo" as const,
    role: "teacher" as const,
    // The local pre-defense teacher account reuses the ignored demo password.
    // It is not a production credential and is never returned or logged.
    passwordKey: "legacyStudentPassword" as const,
  },
];

export async function seedAuthentication(
  pool: SqlPool,
  hasher: PasswordHasher,
  options: AuthenticationSeedOptions,
) {
  const adminIssue = passwordStrengthError(options.initialAdminPassword);
  const studentIssue = passwordStrengthError(options.legacyStudentPassword);
  if (adminIssue || studentIssue) {
    throw new Error(`Authentication seed passwords are invalid: ${adminIssue ?? studentIssue}`);
  }
  const now = (options.now ?? (() => new Date()))().toISOString();
  return withTransaction(pool, async (client) => {
    let updated = 0;
    for (const account of seedAccounts) {
      const existing = await client.query<{ user_id: string; password_hash: string | null }>(
        "SELECT user_id, password_hash FROM users WHERE user_id = $1 FOR UPDATE",
        [account.userId],
      );
      if (!existing.rows[0]) throw new Error(`Cannot seed authentication; ${account.userId} is missing.`);
      const password = options[account.passwordKey];
      const passwordHash = options.syncDemoCredentials === true || !existing.rows[0].password_hash
        ? await hasher.hash(password)
        : existing.rows[0].password_hash;
      await client.query(
        `UPDATE users
            SET username = COALESCE(username, $2),
                password_hash = $3,
                account_origin = CASE
                  WHEN account_origin = 'legacy_demo' OR account_origin IS NULL THEN $4
                  ELSE account_origin
                END,
                updated_at = $5
          WHERE user_id = $1`,
        [account.userId, account.username, passwordHash, account.origin, now],
      );
      await client.query(
        `INSERT INTO user_roles(user_id, role_key, granted_by, granted_at)
         VALUES ($1,$2,'user_admin_001',$3)
         ON CONFLICT (user_id, role_key) DO NOTHING`,
        [account.userId, account.role, now],
      );
      updated += 1;
    }
    return { updated };
  });
}
