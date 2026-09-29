import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const outputDirectory = resolve(process.cwd(), "outputs/question-bank-modes");

function captureBrowserFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error: Error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
  });
  return failures;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ))).toBe(false);
}

test("student completes an FSRS-weighted mistake and a server-owned full paper", async ({ page }) => {
  mkdirSync(outputDirectory, { recursive: true });
  const browserFailures = captureBrowserFailures(page);

  await page.goto("/student/practice?mode=targeted&subject=数据结构&question_id=2010-01");
  await expect(page.getByRole("navigation", { name: "训练模式" })).toBeVisible();
  await expect(page.getByRole("link", { name: "专项练习" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/若元素 a, b, c, d, e, f 依次进栈/)).toBeVisible();
  await expect(page.getByRole("note", { name: "本题推荐依据" })).toContainText("FSRS 个体复习权重");
  await expect(page.locator("body")).not.toContainText("精准难度");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: resolve(outputDirectory, "targeted-1440.png"), fullPage: true });

  await page.getByRole("radio", { name: /^A\./u }).check();
  await page.getByRole("button", { name: "提交并查看结果" }).click();
  await expect(page.getByRole("heading", { name: "这题未答对" })).toBeVisible();
  await expect(page.getByText("正确答案：D", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: resolve(outputDirectory, "targeted-result-1280.png"), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "全真模考" }).click();
  await expect(page.getByRole("heading", { name: "全真模考" })).toBeVisible();
  await page.getByLabel("模考年份").selectOption("2010");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: resolve(outputDirectory, "mock-start-1440.png"), fullPage: true });

  await page.getByRole("button", { name: "开始全真模考" }).click();
  await expect(page.getByRole("heading", { name: "2010 年 408 全真模考" })).toBeVisible();
  await expect(page.getByRole("timer", { name: "剩余时间" })).toContainText(/^02:59:|^03:00:00$/u);
  await expect(page.locator("body")).not.toContainText(/正确答案|题目解析|参考答案/u);
  await page.getByRole("radio", { name: /^A\./u }).check();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: resolve(outputDirectory, "mock-session-1440.png"), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: resolve(outputDirectory, "mock-session-1280.png"), fullPage: true });

  await page.getByRole("button", { name: "交卷" }).click();
  const confirmation = page.getByRole("dialog", { name: "确认交卷" });
  await expect(confirmation).toContainText(/还有 \d+ 道题未作答/u);
  await confirmation.getByRole("button", { name: "确认交卷" }).click();

  const result = page.getByRole("region", { name: "模考结果" });
  await expect(result).toBeVisible();
  await expect(result).toContainText(/客观题\d+ \/ \d+ 分/u);
  await expect(result).toContainText("主观题");
  await expect(result).not.toContainText("150 分");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: resolve(outputDirectory, "mock-result-1280.png"), fullPage: true });
  expect(browserFailures).toEqual([]);
});
