import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "./fixtures";

const outputDirectory = resolve(process.cwd(), "outputs/playwright/community");

test("student completes the school-community discussion workflow on desktop", async ({ page }) => {
  const token = Date.now().toString(36);
  const originalTitle = `论坛验收-${token}-四门课复习安排`;
  const updatedTitle = `${originalTitle}-已更新`;
  let postId: string | null = null;
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    await page.goto("/student/community");
    await expect(page.getByRole("heading", { level: 1, name: "院校圈" })).toBeVisible();
    await page.getByRole("button", { name: /新疆大学/u }).click();
    await page.getByRole("button", { name: "最新" }).click();

    await page.getByRole("button", { name: "发布讨论" }).click();
    const compose = page.getByRole("dialog", { name: "发布讨论" });
    await compose.getByLabel("标题").fill(originalTitle);
    await compose.getByLabel("正文").fill("我正在安排数据结构、计组、操作系统和计网的一轮复习，想交流每天四小时的课程分配方式。");
    await compose.getByRole("button", { name: "确认发布" }).click();
    await expect(compose).toBeHidden();

    const createdLink = page.getByRole("link", { name: originalTitle });
    await expect(createdLink).toBeVisible();
    const href = await createdLink.getAttribute("href");
    postId = href?.split("/").at(-1) ?? null;
    expect(postId).toBeTruthy();
    await createdLink.click();
    await expect(page.getByRole("heading", { name: originalTitle })).toBeVisible();

    await page.getByRole("button", { name: "赞同这篇讨论" }).click();
    await expect(page.getByRole("button", { name: "取消赞同这篇讨论" })).toBeVisible();
    await page.getByLabel("回复内容").fill("我会把最清醒的时间留给计组和数据结构，晚上复盘操作系统与计网。");
    await page.getByRole("button", { name: "发表回复" }).click();
    await expect(page.getByText("我会把最清醒的时间留给计组和数据结构，晚上复盘操作系统与计网。")).toBeVisible();

    await page.getByRole("button", { name: "编辑这条回复" }).click();
    await page.getByLabel("编辑回复内容").fill("我会把最清醒的时间留给计组和数据结构，晚上安排操作系统与计网复盘。");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("我会把最清醒的时间留给计组和数据结构，晚上安排操作系统与计网复盘。")).toBeVisible();

    await page.getByRole("button", { name: "编辑这篇讨论" }).click();
    const edit = page.getByRole("dialog", { name: "编辑讨论" });
    await edit.getByLabel("标题").fill(updatedTitle);
    await edit.getByRole("button", { name: "保存修改" }).click();
    await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();

    mkdirSync(outputDirectory, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: resolve(outputDirectory, "community-detail-1440x900.png"), fullPage: true });

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: resolve(outputDirectory, "community-detail-1280x800.png"), fullPage: true });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除这条回复" }).click();
    await expect(page.getByText("我会把最清醒的时间留给计组和数据结构，晚上安排操作系统与计网复盘。")).toBeHidden();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除这篇讨论" }).click();
    await expect(page).toHaveURL(/\/student\/community$/u);
    expect(browserErrors).toEqual([]);
  } finally {
    if (postId) {
      await page.request.delete(`/api/v1/student/community/posts/${encodeURIComponent(postId)}`)
        .catch(() => undefined);
    }
  }
});
