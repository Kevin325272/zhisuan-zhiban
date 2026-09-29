import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const outputDirectory = resolve(process.cwd(), "outputs/photo-question-tutor");

interface ApiEnvelope<T> {
  data: T;
}

interface ExternalQuestionList {
  items: Array<{ external_question_id: string }>;
}

interface LearningRecord {
  courses: Array<Record<string, unknown>>;
}

async function readData<T>(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as ApiEnvelope<T>).data;
}

async function learningSnapshot(page: Page) {
  const record = await readData<LearningRecord>(page, "/api/v1/student/learning-record");
  return record.courses;
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
}

async function expectVisibleButtonsFit(page: Page) {
  const overflow = await page.getByRole("button").evaluateAll((buttons) => buttons
    .filter((button): button is HTMLButtonElement => {
      if (!(button instanceof HTMLButtonElement)) return false;
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    })
    .filter((button) => button.scrollWidth > button.clientWidth + 1
      || button.scrollHeight > button.clientHeight + 1)
    .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "<unlabeled>"));
  expect(overflow).toEqual([]);
}

async function expectShellDoesNotOverlapContent(page: Page) {
  const geometry = await page.evaluate(() => {
    const topbar = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>(".sidebar")?.getBoundingClientRect();
    const main = document.querySelector<HTMLElement>(".page-content")?.getBoundingClientRect();
    if (!topbar || !sidebar || !main) return null;
    return {
      mainTop: main.top,
      mainLeft: main.left,
      sidebarRight: sidebar.right,
      sidebarTop: sidebar.top,
      topbarBottom: topbar.bottom,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.topbarBottom).toBeLessThanOrEqual(geometry!.mainTop + 1);
  expect(geometry!.sidebarRight).toBeLessThanOrEqual(geometry!.mainLeft + 1);
  expect(geometry!.sidebarTop).toBeGreaterThanOrEqual(geometry!.topbarBottom - 1);
}

async function captureState(page: Page, state: string) {
  for (const viewport of [
    { width: 1440, height: 900, label: "1440" },
    { width: 1280, height: 900, label: "1280" },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expectNoHorizontalOverflow(page);
    await expectVisibleButtonsFit(page);
    await expectShellDoesNotOverlapContent(page);
    await expect(page.locator("body")).not.toContainText(
      /requested_model|provider_model|external_question_id|image_storage_ref/iu,
    );
    await page.screenshot({
      path: resolve(outputDirectory, `${state}-${viewport.label}.png`),
      fullPage: true,
    });
  }
}

async function generated408Png(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1_200;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#151515";
    context.font = "bold 42px Microsoft YaHei, sans-serif";
    context.fillText("数据结构 · 队列", 74, 100);
    context.font = "34px Microsoft YaHei, sans-serif";
    context.fillText("队列的基本操作遵循什么原则？", 74, 190);
    context.font = "30px Microsoft YaHei, sans-serif";
    context.fillText("A. 先进先出", 96, 290);
    context.fillText("B. 后进先出", 96, 370);
    context.strokeStyle = "#8b6d2d";
    context.lineWidth = 4;
    context.strokeRect(48, 48, 1_104, 624);
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
}

test("student confirms and saves one private photo question without changing learning evidence", async ({ page }) => {
  mkdirSync(outputDirectory, { recursive: true });
  const beforeLearning = await learningSnapshot(page);
  const beforeQuestions = await readData<ExternalQuestionList>(
    page,
    "/api/v1/student/external-questions",
  );
  const existingIds = new Set(beforeQuestions.items.map((item) => item.external_question_id));

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/student/practice/photo-tutor");
    await expect(page.getByRole("heading", { name: "拍照讲题" })).toBeVisible();
    await captureState(page, "empty");

    const image = await generated408Png(page);
    await page.getByLabel("选择题目图片").setInputFiles({
      name: "queue-question.png",
      mimeType: "image/png",
      buffer: image,
    });
    await page.getByRole("button", { name: "识别题目" }).click();
    const stem = page.getByLabel("题干");
    await expect(stem).toHaveValue("队列遵循什么原则？");
    await expect(page.getByText("请核对题干与选项文字。")).toBeVisible();
    await expect(page.getByRole("button", { name: "只给方向" })).toBeDisabled();
    await captureState(page, "recognized-confirmation");

    await stem.fill("队列的基本操作遵循什么原则？");
    await page.getByRole("textbox", { name: "选项 B", exact: true }).fill("后进先出");
    await page.getByRole("button", { name: "确认题目" }).click();
    await expect(page.getByText("题目内容已确认")).toBeVisible();

    await page.getByRole("button", { name: "只给方向" }).click();
    const explanation = page.getByRole("region", { name: "题目讲解" });
    await expect(explanation).toContainText("先判断队列的基本操作约束");
    await expect(explanation.getByText("最终答案")).toHaveCount(0);

    await page.getByRole("button", { name: "分步讲解" }).click();
    await expect(explanation).toContainText("先标出入队顺序");
    await expect(explanation.getByText("最终答案")).toHaveCount(0);
    await captureState(page, "steps-explanation");

    await page.getByRole("button", { name: "保存到个人题目" }).click();
    await expect(page.getByText("已保存到个人题目")).toBeVisible();

    const relatedPractice = page.getByRole("link", { name: "练习关联题" }).first();
    await expect(relatedPractice).toBeVisible();
    await relatedPractice.click();
    await expect(page).toHaveURL(/\/student\/practice\?/u);

    await page.goto("/student/practice/photo-tutor");
    const savedQuestion = page.getByRole("button", {
      name: /队列的基本操作遵循什么原则/u,
    }).first();
    await expect(savedQuestion).toBeVisible();
    await savedQuestion.click();
    const privateImage = page.getByAltText("题目原图");
    await expect(privateImage).toBeVisible();
    await expect(privateImage).toHaveAttribute(
      "src",
      /\/api\/v1\/student\/external-questions\/[^/]+\/image$/u,
    );
    await expect.poll(() => privateImage.evaluate((image) => (
      image instanceof HTMLImageElement ? image.naturalWidth : 0
    ))).toBeGreaterThan(0);
    const pixelRange = await privateImage.evaluate((image) => {
      if (!(image instanceof HTMLImageElement)) return 0;
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d");
      if (!context) return 0;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let darkest = 255;
      let lightest = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] === 0) continue;
        const luminance = (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3;
        darkest = Math.min(darkest, luminance);
        lightest = Math.max(lightest, luminance);
      }
      return lightest - darkest;
    });
    expect(pixelRange).toBeGreaterThan(30);

    await page.getByRole("button", { name: "删除题目" }).click();
    await expect(page.getByRole("heading", { name: "上传一张 408 题图" })).toBeVisible();

    const afterLearning = await learningSnapshot(page);
    expect(afterLearning).toEqual(beforeLearning);
    await expect(page.locator("body")).not.toContainText(/requested_model|provider_model|external_question_id|image_storage_ref/iu);
  } finally {
    const currentQuestions = await readData<ExternalQuestionList>(
      page,
      "/api/v1/student/external-questions",
    );
    for (const item of currentQuestions.items) {
      if (existingIds.has(item.external_question_id)) continue;
      await page.request.delete(
        `/api/v1/student/external-questions/${encodeURIComponent(item.external_question_id)}`,
        { headers: { "Idempotency-Key": `e2e-cleanup-${randomUUID()}` } },
      );
    }
  }
});
