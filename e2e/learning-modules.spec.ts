import { expect, test } from "./fixtures";

test("task-first home exposes evidence-backed orchestration and a separate course domain", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/student/home");

  await expect(
    page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "AI 学伴" }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "目标院校", exact: true })).toBeVisible();
  const currentTask = page.getByRole("region", { name: "当前学习任务", exact: true });
  await expect(currentTask).toBeVisible();
  await expect(currentTask.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "开始本关", exact: true })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "我的 408 路线", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "最近 7 天学习反馈", exact: true })).toBeVisible();
  const recommendation = page.locator(".home-recommendation-disclosure");
  await expect(recommendation).toBeVisible();
  await recommendation.locator("summary").click();
  await expect(page.getByRole("region", { name: "任务判断依据", exact: true })).toBeVisible();
  await expect(recommendation.getByRole("heading", { name: "7 日学习路径" })).toHaveCount(0);
  await expect(page.getByText("AI 学伴 · 下一步说明")).toBeVisible();
  await expect(page.getByText("AI 辅助尚未运行")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成 AI 说明" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: "e2e/artifacts/task-home-1366x768.png", fullPage: true });

  await page.goto("/student/courses");
  await expect(page.getByRole("heading", { name: "408 核心课程" })).toBeVisible();
  const courseDomain = page.getByRole("region", { name: "408 课程域" });
  await expect(courseDomain).toBeVisible();
  await expect(courseDomain.getByRole("article")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "四门课，一条学习主线" })).toBeVisible();
  await expect(page.getByText("PostgreSQL 真实课程与题量")).toBeVisible();
  await expect(page.getByRole("link", { name: "进入课程" })).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: "e2e/artifacts/course-overview-1366x768.png", fullPage: true });

  await page.getByRole("link", { name: "进入课程" }).first().click();
  await expect(page).toHaveURL(/\/student\/courses\/data-structures$/);
  await expect(page.getByRole("heading", { name: "数据结构" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "课程知识地图" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本节学习目标" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: "e2e/artifacts/course-data-structures-1366x768.png", fullPage: true });

  await page.goto("/student/ask");
  await expect(page).toHaveURL(/\/student\/courses$/u);
  await expect(page.getByRole("heading", { name: "408 核心课程" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BFS 联调助手" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  expect(consoleErrors).toEqual([]);
});
