import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function openExamPaperWorkspace(page: Page) {
  await page.goto("/student/exam-papers");
  await expect(page.getByRole("heading", { name: "资料暂未开放训练" })).toBeVisible();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`closed self-authored papers remain a clear downgrade at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openExamPaperWorkspace(page);

    const layout = await page.evaluate(() => {
      return {
        hasClosedHeading: document.body.innerText.includes("资料暂未开放训练"),
        hasTrainingBoundary: document.body.innerText.includes("不进入学生主学习链"),
        hasPdfFrame: Boolean(document.querySelector(".exam-paper-pdf-frame iframe")),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });

    expect(layout.hasClosedHeading).toBe(true);
    expect(layout.hasTrainingBoundary).toBe(true);
    expect(layout.hasPdfFrame).toBe(false);
    expect(layout?.horizontalOverflow).toBe(false);

    await page.screenshot({
      path: `output/playwright/reliable-learning-loop/exam-papers-closed-${viewport.width}.png`,
      fullPage: true,
    });
  });
}
