import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  canonicalizeUsername,
  type AcademicClassOption,
  type PlatformRole,
} from "@xuetu/contracts";

import {
  DEMO_408_COURSE_IDS,
  type StudentRegistrationConfig,
} from "../../config/student-registration.js";
import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordStrengthError,
  type PasswordHasher,
} from "./password-hasher.js";

export type AccountStatus = "active" | "pending_approval" | "disabled";
export type AccountOrigin = "legacy_demo" | "registered" | "seeded_admin";

export interface StoredAccount {
  user_id: string;
  username: string;
  display_name: string;
  account_status: AccountStatus;
  auth_source: "local_development" | "external_identity";
  account_origin: AccountOrigin;
  must_change_password: boolean;
  password_hash: string | null;
  roles: PlatformRole[];
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
}

export interface PublicAccount {
  user_id: string;
  username: string;
  display_name: string;
  account_status: AccountStatus;
  roles: PlatformRole[];
  auth_source: StoredAccount["auth_source"];
  account_origin: AccountOrigin;
  data_boundary: "legacy_demo" | "local_account";
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface StoredSession {
  session_id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  account: StoredAccount;
}

export interface AuthRepository {
  findByUsername(username: string): Promise<StoredAccount | null>;
  findById(userId: string): Promise<StoredAccount | null>;
  createStudent(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    courseIds?: readonly string[];
  }): Promise<StoredAccount>;
  createTeacherApplication(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    mustChangePassword: boolean;
  }): Promise<StoredAccount>;
  createAccount(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: Exclude<PlatformRole, "teacher">;
    courseIds?: readonly string[];
    mustChangePassword: boolean;
  }): Promise<StoredAccount>;
  createSession(input: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<void>;
  findSession(tokenHash: string): Promise<StoredSession | null>;
  touchSession(sessionId: string, lastSeenAt: string): Promise<void>;
  revokeSession(tokenHash: string, revokedAt: string): Promise<void>;
  revokeAllSessions(userId: string, revokedAt: string): Promise<void>;
  updateLastLogin(userId: string, lastLoginAt: string): Promise<void>;
  updatePassword(userId: string, passwordHash: string, mustChangePassword: boolean, updatedAt: string): Promise<StoredAccount>;
  replacePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
    updatedAt: string,
    expectedPasswordHash: string | null,
  ): Promise<StoredAccount | null>;
  listAccounts(): Promise<StoredAccount[]>;
  listAcademicClasses(): Promise<AcademicClassOption[]>;
  approveTeacher(input: {
    userId: string;
    teacherNumber: string;
    department: string;
    professionalTitle: string;
    courseId: string;
    classIds: readonly string[];
    updatedAt: string;
  }): Promise<
    | { status: "approved"; account: StoredAccount }
    | { status: "not_found" }
    | { status: "not_approvable_teacher" }
    | { status: "invalid_scope" }
  >;
  updateAccountStatus(userId: string, status: AccountStatus, updatedAt: string): Promise<StoredAccount | null>;
  updateAccountStatusAndRevokeSessions(
    userId: string,
    status: AccountStatus,
    updatedAt: string,
  ): Promise<
    | { status: "updated"; account: StoredAccount }
    | { status: "not_found" }
    | { status: "last_admin_protected" }
  >;
  countActiveAdmins(): Promise<number>;
}

export interface AuthSessionResult {
  account: PublicAccount;
  sessionToken: string;
}

export interface AuthenticatedSession {
  account: PublicAccount;
}

export interface RegisterInput {
  username: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export class AuthenticationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

function nowIso(now: () => Date) {
  return now().toISOString();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeUsername(username: string) {
  return canonicalizeUsername(username);
}

export function usernameError(username: string) {
  if (!/^[^\s\p{C}]{1,32}$/u.test(username)) {
    return "用户名需为 1–32 位，且不能包含空格。";
  }
  return null;
}

function displayNameError(displayName: string) {
  if (displayName.length < 1 || displayName.length > 100) return "显示名称长度无效。";
  return null;
}

function assertPassword(password: string) {
  const error = passwordStrengthError(password);
  if (error) {
    throw new AuthenticationError("ACCOUNT_INPUT_INVALID", error, 400);
  }
}

function publicAccount(account: StoredAccount): PublicAccount {
  return {
    user_id: account.user_id,
    username: normalizeUsername(account.username),
    display_name: account.display_name,
    account_status: account.account_status,
    roles: [...account.roles],
    auth_source: account.auth_source,
    account_origin: account.account_origin,
    data_boundary: account.account_origin === "legacy_demo" ? "legacy_demo" : "local_account",
    must_change_password: account.must_change_password,
    created_at: account.created_at,
    updated_at: account.updated_at,
    last_login_at: account.last_login_at ?? null,
  };
}

const INVALID_CREDENTIALS = "用户名或密码不正确。";

export class LocalAuthenticationService {
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;
  private readonly registration: StudentRegistrationConfig;

  constructor(
    private readonly repository: AuthRepository,
    private readonly hasher: PasswordHasher,
    options: {
      now?: () => Date;
      sessionTtlMs?: number;
      registration?: StudentRegistrationConfig;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
    this.registration = options.registration ?? {
      mode: "self_service",
      courseIds: DEMO_408_COURSE_IDS,
    };
  }

  async registerStudent(input: RegisterInput): Promise<AuthSessionResult> {
    if (this.registration.mode === "controlled") {
      throw new AuthenticationError(
        "STUDENT_REGISTRATION_CONTROLLED",
        "当前试点需要管理员创建账户或提供课程邀请，暂不开放自行注册。",
        403,
      );
    }
    const username = normalizeUsername(input.username);
    const usernameIssue = usernameError(username);
    const displayName = input.displayName.trim();
    const displayIssue = displayNameError(displayName);
    if (usernameIssue || displayIssue) {
      throw new AuthenticationError("ACCOUNT_INPUT_INVALID", usernameIssue ?? displayIssue ?? "注册信息无效。", 400);
    }
    assertPassword(input.password);
    if (await this.repository.findByUsername(username)) {
      throw new AuthenticationError("ACCOUNT_CREATION_FAILED", "无法创建账户，请检查输入或更换用户名。", 409);
    }
    try {
      const account = await this.repository.createStudent({
        username,
        displayName,
        passwordHash: await this.hasher.hash(input.password),
        courseIds: this.registration.courseIds,
      });
      return this.issueSession(account);
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError("ACCOUNT_CREATION_FAILED", "无法创建账户，请检查输入或更换用户名。", 409);
    }
  }

  async registerTeacher(input: RegisterInput): Promise<PublicAccount> {
    const username = normalizeUsername(input.username);
    const usernameIssue = usernameError(username);
    const displayName = input.displayName.trim();
    const displayIssue = displayNameError(displayName);
    if (usernameIssue || displayIssue) {
      throw new AuthenticationError("ACCOUNT_INPUT_INVALID", usernameIssue ?? displayIssue ?? "注册信息无效。", 400);
    }
    assertPassword(input.password);
    if (await this.repository.findByUsername(username)) {
      throw new AuthenticationError("ACCOUNT_CREATION_FAILED", "无法提交申请，请检查输入或更换用户名。", 409);
    }
    try {
      const account = await this.repository.createTeacherApplication({
        username,
        displayName,
        passwordHash: await this.hasher.hash(input.password),
        mustChangePassword: false,
      });
      return publicAccount(account);
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError("ACCOUNT_CREATION_FAILED", "无法提交申请，请检查输入或更换用户名。", 409);
    }
  }

  async login(input: LoginInput): Promise<AuthSessionResult> {
    const username = normalizeUsername(input.username);
    const account = await this.repository.findByUsername(username);
    const valid = await this.hasher.verify(
      input.password,
      account?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!account || account.account_status !== "active" || !valid) {
      throw new AuthenticationError("INVALID_CREDENTIALS", INVALID_CREDENTIALS, 401);
    }
    return this.issueSession(account);
  }

  async resolveSession(sessionToken: string): Promise<AuthenticatedSession | null> {
    if (!sessionToken || sessionToken.length > 200) return null;
    const session = await this.repository.findSession(hashToken(sessionToken));
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= this.now().getTime()) {
      return null;
    }
    if (session.account.account_status !== "active") return null;
    await this.repository.touchSession(session.session_id, nowIso(this.now));
    return { account: publicAccount(session.account) };
  }

  async revokeSession(sessionToken: string) {
    if (!sessionToken) return;
    await this.repository.revokeSession(hashToken(sessionToken), nowIso(this.now));
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string) {
    const account = await this.repository.findById(userId);
    if (!account?.password_hash || !(await this.hasher.verify(currentPassword, account.password_hash))) {
      throw new AuthenticationError("CURRENT_PASSWORD_INVALID", INVALID_CREDENTIALS, 401);
    }
    assertPassword(nextPassword);
    const updatedAt = nowIso(this.now);
    const updated = await this.repository.replacePasswordAndRevokeSessions(
      userId,
      await this.hasher.hash(nextPassword),
      false,
      updatedAt,
      account.password_hash,
    );
    if (!updated) {
      throw new AuthenticationError("CURRENT_PASSWORD_INVALID", INVALID_CREDENTIALS, 401);
    }
    return publicAccount(updated);
  }

  async listAccounts(actor: PublicAccount) {
    this.requireAdmin(actor);
    return (await this.repository.listAccounts()).map(publicAccount);
  }

  async listAcademicClasses(actor: PublicAccount) {
    this.requireAdmin(actor);
    return this.repository.listAcademicClasses();
  }

  async approveTeacher(actor: PublicAccount, userId: string, input: {
    teacherNumber: string;
    department: string;
    professionalTitle: string;
    courseId: string;
    classIds: readonly string[];
  }) {
    this.requireAdmin(actor);
    const teacherNumber = input.teacherNumber.trim();
    const department = input.department.trim();
    const professionalTitle = input.professionalTitle.trim();
    const classIds = [...new Set(input.classIds)];
    if (teacherNumber.length < 4 || teacherNumber.length > 32
      || department.length < 1 || department.length > 120
      || professionalTitle.length < 1 || professionalTitle.length > 50
      || classIds.length < 1 || classIds.length > 50) {
      throw new AuthenticationError("TEACHER_APPROVAL_INPUT_INVALID", "教师审核信息不完整。", 400);
    }
    if (!this.registration.courseIds.includes(input.courseId)) {
      throw new AuthenticationError("COURSE_BINDING_INVALID", "教师只能绑定当前试点允许的课程。", 400);
    }
    try {
      const outcome = await this.repository.approveTeacher({
        userId,
        teacherNumber,
        department,
        professionalTitle,
        courseId: input.courseId,
        classIds,
        updatedAt: nowIso(this.now),
      });
      if (outcome.status === "not_found") {
        throw new AuthenticationError("ACCOUNT_NOT_FOUND", "账户不存在。", 404);
      }
      if (outcome.status === "not_approvable_teacher") {
        throw new AuthenticationError("TEACHER_APPROVAL_NOT_ALLOWED", "当前账户不是可审核的教师账户。", 409);
      }
      if (outcome.status === "invalid_scope") {
        throw new AuthenticationError("TEACHER_APPROVAL_SCOPE_INVALID", "所选课程或班级不存在。", 400);
      }
      return publicAccount(outcome.account);
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError("TEACHER_APPROVAL_FAILED", "教师审核未完成，请检查教师编号或稍后重试。", 409);
    }
  }

  async createAccount(actor: PublicAccount, input: { username: string; displayName: string; password: string; role: PlatformRole; courseId?: string }) {
    this.requireAdmin(actor);
    const username = normalizeUsername(input.username);
    const usernameIssue = usernameError(username);
    const displayName = input.displayName.trim();
    const displayIssue = displayNameError(displayName);
    if (usernameIssue || displayIssue || !["student", "teacher", "admin"].includes(input.role)) {
      throw new AuthenticationError("ACCOUNT_INPUT_INVALID", usernameIssue ?? displayIssue ?? "账户信息无效。", 400);
    }
    if (input.role === "teacher" && input.courseId) {
      throw new AuthenticationError(
        "TEACHER_APPROVAL_REQUIRED",
        "教师课程和班级必须通过审核流程分配。",
        409,
      );
    }
    if (input.role === "student" && input.courseId && !this.registration.courseIds.includes(input.courseId)) {
      throw new AuthenticationError(
        "COURSE_BINDING_INVALID",
        "学生或教师只能绑定当前试点允许的课程。",
        400,
      );
    }
    assertPassword(input.password);
    if (await this.repository.findByUsername(username)) {
      throw new AuthenticationError("ACCOUNT_CREATION_FAILED", "无法创建账户，请检查输入或更换用户名。", 409);
    }
    try {
      const passwordHash = await this.hasher.hash(input.password);
      if (input.role === "teacher") {
        return publicAccount(await this.repository.createTeacherApplication({
          username,
          displayName,
          passwordHash,
          mustChangePassword: true,
        }));
      }
      return publicAccount(await this.repository.createAccount({
        username,
        displayName,
        passwordHash,
        role: input.role,
        ...(input.role === "student"
          ? {
              courseIds: this.registration.courseIds,
            }
          : {}),
        mustChangePassword: true,
      }));
    } catch {
      throw new AuthenticationError("ACCOUNT_CREATION_FAILED", "无法创建账户，请检查输入或更换用户名。", 409);
    }
  }

  async updateAccountStatus(actor: PublicAccount, userId: string, status: AccountStatus) {
    this.requireAdmin(actor);
    if (actor.user_id === userId && status === "disabled") {
      throw new AuthenticationError("SELF_DISABLE_FORBIDDEN", "不能停用当前管理员账户。", 409);
    }
    const target = await this.repository.findById(userId);
    if (!target) {
      throw new AuthenticationError("ACCOUNT_NOT_FOUND", "账户不存在。", 404);
    }
    if (status === "active" && target.roles.includes("teacher")) {
      throw new AuthenticationError(
        "TEACHER_APPROVAL_REQUIRED",
        "教师账户必须确认教师资料、课程和班级后才能启用。",
        409,
      );
    }
    const outcome = await this.repository.updateAccountStatusAndRevokeSessions(
      userId,
      status,
      nowIso(this.now),
    );
    if (outcome.status === "not_found") {
      throw new AuthenticationError("ACCOUNT_NOT_FOUND", "账户不存在。", 404);
    }
    if (outcome.status === "last_admin_protected") {
      throw new AuthenticationError("LAST_ADMIN_PROTECTED", "至少需要保留一个启用中的管理员账户。", 409);
    }
    return publicAccount(outcome.account);
  }

  async resetPassword(actor: PublicAccount, userId: string, nextPassword: string) {
    this.requireAdmin(actor);
    const target = await this.repository.findById(userId);
    if (!target) throw new AuthenticationError("ACCOUNT_NOT_FOUND", "账户不存在。", 404);
    assertPassword(nextPassword);
    const updated = await this.repository.replacePasswordAndRevokeSessions(
      userId,
      await this.hasher.hash(nextPassword),
      true,
      nowIso(this.now),
      null,
    );
    if (!updated) throw new AuthenticationError("ACCOUNT_NOT_FOUND", "账户不存在。", 404);
    return publicAccount(updated);
  }

  private requireAdmin(account: PublicAccount) {
    if (!account.roles.includes("admin") || account.account_status !== "active") {
      throw new AuthenticationError("ADMIN_ACCESS_REQUIRED", "只有管理员可以治理账户。", 403);
    }
  }

  private async issueSession(account: StoredAccount): Promise<AuthSessionResult> {
    const sessionToken = randomBytes(32).toString("base64url");
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.sessionTtlMs);
    await this.repository.createSession({
      sessionId: `session_${randomUUID()}`,
      userId: account.user_id,
      tokenHash: hashToken(sessionToken),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    await this.repository.updateLastLogin(account.user_id, createdAt.toISOString());
    return { account: publicAccount(account), sessionToken };
  }
}

export const authenticationPolicy = {
  passwordMinLength: PASSWORD_MIN_LENGTH,
  passwordMaxLength: PASSWORD_MAX_LENGTH,
};
