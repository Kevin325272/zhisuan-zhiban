import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { expect, test, establishAdminSession } from "./fixtures";

const teacherAccountsToClean = new Set<string>();

test.afterEach(async () => {
  const usernames = [...teacherAccountsToClean];
  teacherAccountsToClean.clear();
  if (usernames.length === 0) return;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to clean teacher registration E2E accounts.");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM users
        WHERE username = ANY($1::text[])
          AND account_origin = 'registered'
          AND username LIKE 'teacher_e2e_%'`,
      [usernames],
    );
  } finally {
    await client.end();
  }
});

const passwordChangeFixture = {
  username: "e2e_password_change",
  displayName: "改密流程测试学生",
  temporaryPassword: "E2ETemporaryPassword123",
  nextPassword: "E2ENewPassword456",
} as const;

async function preparePasswordChangeAccount(page: Parameters<typeof establishAdminSession>[0]) {
  await establishAdminSession(page);
  const listed = await page.request.get("/api/v1/manage/accounts");
  expect(listed.status()).toBe(200);
  const existing = (listed.json() as Promise<{ data: { items: Array<{ user_id: string; username: string }> } }>)
    .then((body) => body.data.items.find((account) => account.username === passwordChangeFixture.username));
  let account = await existing;
  if (!account) {
    const created = await page.request.post("/api/v1/manage/accounts", {
      data: {
        username: passwordChangeFixture.username,
        display_name: passwordChangeFixture.displayName,
        password: passwordChangeFixture.temporaryPassword,
        role: "student",
        course_id: "course_408_ds",
      },
    });
    expect(created.status()).toBe(201);
    account = (await created.json() as { data: { account: { user_id: string; username: string } } }).data.account;
  } else {
    const reset = await page.request.post(`/api/v1/manage/accounts/${account.user_id}/reset-password`, {
      data: { password: passwordChangeFixture.temporaryPassword },
    });
    expect(reset.status()).toBe(200);
  }
  return account;
}

test("login and registration surfaces are clear at 1440px and 1280px", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const expectedSessionProbe = text.includes("401 (Unauthorized)");
    if (message.type() === "error" && !expectedSessionProbe) browserErrors.push(text);
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) browserErrors.push(`${response.status()} ${response.url()}`);
  });
  await page.context().clearCookies();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "进入智算智伴" })).toBeVisible();
  await expect(page.getByRole("link", { name: "注册账户" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: "output/playwright/account-auth/login-1440.png", fullPage: true });

  await page.goto("/register");
  const studentRegistrationTitle = page.getByRole("heading", { name: "开始你的 408 备考" });
  await expect(studentRegistrationTitle).toBeVisible();
  const titleMetrics = await studentRegistrationTitle.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(styles.lineHeight),
    };
  });
  expect(titleMetrics.height).toBeLessThan(titleMetrics.lineHeight * 1.5);
  await expect(page.getByRole("button", { name: "创建学习账户" })).toBeVisible();
  await expect(page.getByRole("button", { name: "教师申请入口" })).toBeVisible();
  await expect(page.getByRole("group", { name: "选择注册身份" })).toHaveCount(0);
  await page.screenshot({ path: "output/playwright/account-auth/register-student-1440.png", fullPage: true });
  await page.getByRole("button", { name: "教师申请入口" }).click();
  await expect(page.getByRole("heading", { name: "申请教师账户" })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交教师申请" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回学生注册" })).toBeVisible();
  await page.screenshot({ path: "output/playwright/account-auth/register-teacher-1440.png", fullPage: true });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "进入智算智伴" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: "output/playwright/account-auth/login-1280.png", fullPage: true });

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "开始你的 408 备考" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: "output/playwright/account-auth/register-student-1280.png", fullPage: true });
  await page.getByRole("button", { name: "教师申请入口" }).click();
  await expect(page.getByRole("heading", { name: "申请教师账户" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: "output/playwright/account-auth/register-teacher-1280.png", fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("student account page exposes role and safe data boundary", async ({ page }) => {
  await page.goto("/student/account");
  await expect(page.getByRole("heading", { name: "账户与安全" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前身份" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("password_hash");
  await expect(page.locator("body")).not.toContainText(/PostgreSQL|RBAC|数据边界/u);
  await page.screenshot({ path: "output/playwright/account-auth/account-student-1440.png", fullPage: true });
});

test("account surfaces stay readable at 1280px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/student/account");
  await expect(page.getByRole("heading", { name: "账户与安全" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: "output/playwright/account-auth/account-student-1280.png", fullPage: true });
});

test("protected route redirects after the server cookie is cleared", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/student/home");
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole("heading", { name: "进入智算智伴" })).toBeVisible();
});

test("administrator sees account governance without credential fields", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const expectedSessionProbe = text.includes("401 (Unauthorized)");
    if (message.type() === "error" && !expectedSessionProbe) browserErrors.push(text);
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) browserErrors.push(`${response.status()} ${response.url()}`);
  });
  await establishAdminSession(page);
  await expect(page.getByRole("heading", { name: "管理员工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "账户与权限" })).toBeVisible();
  await expect(page.getByText("创建账户")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("password_hash");
  await expect(page.locator("body")).not.toContainText(/PostgreSQL|RBAC|数据边界/u);
  await page.screenshot({ path: "output/playwright/account-auth/admin-governance-1440.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: "output/playwright/account-auth/admin-governance-1280.png", fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("teacher registration stays pending until an administrator assigns course and class scope", async ({ page }) => {
  const token = randomUUID().replace(/-/gu, "").slice(0, 10).toLowerCase();
  const username = `teacher_e2e_${token}`;
  const password = `TeacherE2E${token}a8`;
  teacherAccountsToClean.add(username);

  await page.context().clearCookies();
  await page.goto("/register");
  await page.getByRole("button", { name: "教师申请入口" }).click();
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("姓名").fill("教师申请验收");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  await page.getByRole("button", { name: "提交教师申请" }).click();
  await expect(page.getByRole("heading", { name: "教师申请已提交" })).toBeVisible();

  await page.getByRole("link", { name: "返回登录" }).click();
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert")).toContainText("用户名或密码不正确");

  await establishAdminSession(page);
  const accountRow = page.getByRole("row").filter({ hasText: username });
  await expect(accountRow).toHaveCount(1);
  await expect(accountRow).toContainText("待审核");
  await accountRow.getByRole("button", { name: "审核教师" }).click();
  await expect(page.getByRole("heading", { name: "审核教师 · 教师申请验收" })).toBeVisible();
  await page.getByLabel("教师编号").fill(`E2E${token}`);
  await page.getByLabel("院系").fill("计算机科学与技术学院");
  await page.getByLabel("职称").fill("讲师");
  await page.getByLabel("授权课程").selectOption("course_408_ds");
  const classScope = page.getByRole("group", { name: "负责班级（至少选择一个）" });
  await classScope.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "通过审核" }).click();
  await expect(page.getByRole("status")).toContainText("教师账户已通过审核");

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/teacher$/u);
  await expect(page.getByRole("heading", { name: "班级学情" })).toBeVisible();
});

test("temporary-password change revokes the cookie, shows success, and permits re-login", async ({ page }) => {
  await preparePasswordChangeAccount(page);
  await page.context().clearCookies();

  await page.goto("/login");
  await page.getByLabel("用户名").fill(passwordChangeFixture.username);
  await page.getByLabel("密码").fill(passwordChangeFixture.temporaryPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/account\/password$/u);
  await expect(page.getByRole("heading", { name: "首次登录，请先修改密码" })).toBeVisible();

  await page.getByLabel("当前密码").fill(passwordChangeFixture.temporaryPassword);
  await page.getByLabel("新密码", { exact: true }).fill(passwordChangeFixture.nextPassword);
  await page.getByLabel("确认新密码").fill(passwordChangeFixture.nextPassword);
  await page.getByRole("button", { name: "更新密码" }).click();

  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole("status")).toContainText("密码已更新");
  expect((await page.context().cookies()).some((cookie) => cookie.name === "xuetu_session")).toBe(false);
  const revokedSession = await page.request.get("/api/v1/auth/session");
  expect(revokedSession.status()).toBe(401);

  await page.getByLabel("用户名").fill(passwordChangeFixture.username);
  await page.getByLabel("密码").fill(passwordChangeFixture.nextPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/student\/onboarding$/u);
});
