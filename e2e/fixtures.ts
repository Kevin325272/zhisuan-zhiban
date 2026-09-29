import { test as base, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sessionTokensByPage = new WeakMap<Page, Set<string>>();

export interface StudentSessionCredentials {
  username: string;
  password: string;
}

export interface SyntheticStudentIdentity extends StudentSessionCredentials {
  temporaryPassword: string;
  participantCode: string;
  displayName: string;
}

export function createSyntheticStudentIdentity(): SyntheticStudentIdentity {
  const token = randomUUID().replace(/-/gu, "").slice(0, 12).toLowerCase();
  return {
    username: `pilot_e2e_${token}`,
    password: `PilotE2E!${token}b8`,
    temporaryPassword: `PilotTemp!${token}a9`,
    participantCode: `SYN${token.toUpperCase()}`,
    displayName: "自动化浏览器验收账户",
  };
}

/**
 * E2E uses the same server-issued cookie as a real browser. Passwords are
 * read only from the ignored local environment file and never logged.
 */
function localSecret(name: string) {
  const candidates = [resolve(process.cwd(), "apps/api/.env.local"), resolve(process.cwd(), ".env.local")];
  for (const candidate of candidates) {
    try {
      const line = readFileSync(candidate, "utf8").split(/\r?\n/u).find((item) => item.startsWith(`${name}=`));
      if (line) return line.slice(name.length + 1);
    } catch { /* ignored; the next candidate may exist */ }
  }
  throw new Error(`${name} is required for authenticated E2E; keep it in ignored apps/api/.env.local.`);
}

async function rememberCurrentSession(page: Page) {
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "xuetu_session",
  );
  if (!cookie) return;
  let tokens = sessionTokensByPage.get(page);
  if (!tokens) {
    tokens = new Set<string>();
    sessionTokensByPage.set(page, tokens);
  }
  tokens.add(cookie.value);
}

export async function logoutCurrentSession(page: Page) {
  await rememberCurrentSession(page);
  const tokens = sessionTokensByPage.get(page) ?? new Set<string>();
  for (const token of tokens) {
    try {
      await page.request.post("/api/v1/auth/logout", {
        data: {},
        headers: { cookie: `xuetu_session=${encodeURIComponent(token)}` },
      });
    } catch {
      // Cleanup must not hide the original E2E assertion failure.
    }
  }
  tokens.clear();
  await page.context().clearCookies();
}

export async function establishStudentSession(
  page: Page,
  credentials: StudentSessionCredentials = {
    username: "user_student_001",
    password: localSecret("XUETU_LEGACY_STUDENT_PASSWORD"),
  },
) {
  await logoutCurrentSession(page);
  await page.goto("/login");
  await page.getByLabel("用户名").fill(credentials.username);
  await page.getByLabel("密码").fill(credentials.password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(/\/student\/home$/u);
  await rememberCurrentSession(page);
}

export async function establishAdminSession(page: Page) {
  await logoutCurrentSession(page);
  await page.goto("/login");
  await page.getByLabel("用户名").fill("user_admin_001");
  await page.getByLabel("密码").fill(localSecret("XUETU_INITIAL_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(/\/admin$/u);
  await rememberCurrentSession(page);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await establishStudentSession(page);
    try {
      await use(page);
    } finally {
      await logoutCurrentSession(page);
    }
  },
});

export { expect };
