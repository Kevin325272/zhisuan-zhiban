import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { PilotStudentStudy } from "@xuetu/contracts";

import {
  createSyntheticStudentIdentity,
  establishAdminSession,
  establishStudentSession,
  expect,
  test,
} from "./fixtures";

const artifacts = resolve(process.cwd(), "e2e/artifacts/pilot-study");

async function readStudentStudy(page: Parameters<typeof establishStudentSession>[0]) {
  const response = await page.request.get("/api/v1/student/pilot-study");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.data as PilotStudentStudy;
}

async function finishSyntheticOnboarding(
  page: Parameters<typeof establishStudentSession>[0],
) {
  const goals = await page.request.put("/api/v1/student/onboarding/goals", {
    data: {
      target_exam_year: 2027,
      preparation_stage: "foundation",
      daily_minutes: 60,
      target_school: null,
      target_score: null,
    },
  });
  expect(goals.status()).toBe(200);
  const assessments = await page.request.put("/api/v1/student/onboarding/self-assessments", {
    data: {
      items: [
        { course_id: "course_408_ds", level: "average" },
        { course_id: "course_408_co", level: "average" },
        { course_id: "course_408_os", level: "average" },
        { course_id: "course_408_cn", level: "average" },
      ],
    },
  });
  expect(assessments.status()).toBe(200);

  const diagnostic = await page.request.get(
    "/api/v1/student/onboarding/diagnostic/questions",
  );
  expect(diagnostic.status()).toBe(200);
  const diagnosticBody = await diagnostic.json() as {
    data?: { items?: Array<{ question?: { id?: string } }> };
  };
  const diagnosticItems = diagnosticBody.data?.items ?? [];
  expect(diagnosticItems).toHaveLength(8);
  for (const item of diagnosticItems) {
    const questionId = item.question?.id;
    expect(typeof questionId).toBe("string");
    const answer = await page.request.put(
      "/api/v1/student/onboarding/diagnostic/answers",
      {
        data: {
          question_id: questionId,
          response_status: "skipped",
          selected_option_ids: [],
        },
      },
    );
    expect(answer.status()).toBe(200);
  }
  const diagnosticCompleted = await page.request.post(
    "/api/v1/student/onboarding/diagnostic/complete",
    { data: {} },
  );
  expect(diagnosticCompleted.status()).toBe(200);
  const completed = await page.request.post("/api/v1/student/onboarding/complete", { data: {} });
  expect(completed.status()).toBe(200);
  await page.goto("/student/home");
  await expect(page).toHaveURL(/\/student\/home$/u);
}

async function ensureSyntheticEnrollment(
  page: Parameters<typeof establishStudentSession>[0],
  identity: ReturnType<typeof createSyntheticStudentIdentity>,
) {
  await establishAdminSession(page);
  const account = await page.request.post("/api/v1/manage/accounts", {
    data: {
      username: identity.username,
      display_name: identity.displayName,
      password: identity.temporaryPassword,
      role: "student",
      course_id: "course_408_ds",
    },
  });
  expect(account.status()).toBe(201);
  const enrollment = await page.request.post("/api/v1/manage/pilot-study/participants", {
    data: {
      username: identity.username,
      participant_code: identity.participantCode,
      role_label: identity.displayName,
      participant_kind: "synthetic_verification",
    },
  });
  expect(enrollment.status()).toBe(201);
  await page.goto("/login");
  await page.getByLabel("用户名").fill(identity.username);
  await page.getByLabel("密码").fill(identity.temporaryPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/account\/password$/u);
  await page.getByLabel("当前密码").fill(identity.temporaryPassword);
  await page.getByLabel("新密码", { exact: true }).fill(identity.password);
  await page.getByLabel("确认新密码").fill(identity.password);
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel("用户名").fill(identity.username);
  await page.getByLabel("密码").fill(identity.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/student\/onboarding$/u);
  await finishSyntheticOnboarding(page);
  const study = await readStudentStudy(page);
  expect(study.kind).toBe("enrolled");
  if (study.kind === "enrolled") {
    expect(study.participant.participant_code).toBe(identity.participantCode);
    expect(study.participant.participant_kind).toBe("synthetic_verification");
    expect(study.participant.consented_at).toBeNull();
    expect(study.feedback).toBeNull();
    expect(study.tasks.map((task) => task.status)).toEqual(["locked", "locked", "locked"]);
  }
  return study;
}

async function submitFixedQuestion(page: Parameters<typeof establishStudentSession>[0]) {
  await expect(page.getByText("课程固定题目", { exact: true })).toBeVisible();
  await expect(page.getByLabel("科目")).toHaveCount(0);
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "提交并查看结果" }).click();
  await expect(page.getByRole("heading", { name: "作答已记录" })).toBeVisible();
  await expect(page.getByText("课程试点任务已核验")).toBeVisible();
  await expect(page.getByText("正确答案", { exact: true })).toHaveCount(0);
  await expect(page.getByText("题目解析", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "返回课程试点流程" }).click();
  await expect(page).toHaveURL(/\/student\/pilot-study$/u);
}

async function completeReading(page: Parameters<typeof establishStudentSession>[0]) {
  const collapse = page.getByRole("button", { name: "收起原文" });
  if (await collapse.count()) await collapse.click();
  const expand = page.getByRole("button", { name: /继续阅读原文/u });
  await expect(expand).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/reading-progress")
      && response.request().method() === "PUT"
      && response.ok()),
    expand.click(),
  ]);
  await expect(page.getByRole("button", { name: "收起原文" })).toBeVisible();
  await page.goto("/student/pilot-study");
  await page.getByRole("button", { name: "核验阅读位置" }).click();
  await expect(page.getByRole("button", { name: "开始独立完成迁移题" })).toBeVisible();
}

test("centralized pilot keeps synthetic verification separate from real-trial evidence", async ({ page }) => {
  await mkdir(artifacts, { recursive: true });
  const clientErrors: string[] = [];
  const serverFailures: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 500) {
      serverFailures.push(`${response.status()} ${response.url()}`);
    }
  });

  const identity = createSyntheticStudentIdentity();
  let study = await ensureSyntheticEnrollment(page, identity);
  await page.goto("/student/pilot-study");

  expect(study.kind).toBe("enrolled");
  await page.getByRole("checkbox", { name: "同意参加本次课程试点" }).check();
  await page.getByRole("radio", { name: "3 分" }).check();
  await page.getByRole("button", { name: "同意并开始课程试点" }).click();
  await expect(page.getByRole("button", { name: "开始独立完成基线题" })).toBeVisible();

  await page.getByRole("button", { name: "开始独立完成基线题" }).click();
  await expect(page).toHaveURL(/question_id=2010-02/u);
  await submitFixedQuestion(page);

  await expect(page.getByRole("button", { name: "开始学习队列核心规则" })).toBeVisible();
  await page.getByRole("button", { name: "开始学习队列核心规则" }).click();
  await expect(page).toHaveURL(/concept_id=ds_c03_02/u);
  await completeReading(page);

  await expect(page.getByRole("button", { name: "开始独立完成迁移题" })).toBeVisible();
  await page.getByRole("button", { name: "开始独立完成迁移题" }).click();
  await expect(page).toHaveURL(/question_id=2021-02/u);
  await submitFixedQuestion(page);

  await page.getByLabel("流程易用性").selectOption("4");
  await page.getByLabel("讲解帮助程度").selectOption("4");
  await page.getByLabel("完成后的信心").selectOption("4");
  await page.getByLabel("继续使用意愿").selectOption("4");
  await page.getByLabel("补充反馈").fill("自动化验收：三阶段流程与服务端核验均可完成。");
  await page.getByRole("button", { name: "提交匿名反馈" }).click();
  await expect(page.getByText("反馈已记录")).toBeVisible();

  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({
      path: resolve(artifacts, `student-complete-${width}.png`),
      fullPage: true,
    });
  }

  await establishAdminSession(page);
  const defaultExport = await page.request.get("/api/v1/manage/pilot-study/export.json");
  expect(defaultExport.ok()).toBeTruthy();
  const defaultText = await defaultExport.text();
  expect(defaultText).not.toContain(identity.participantCode);
  expect(defaultText).toContain("real_trial_only");

  const defaultCsv = await page.request.get("/api/v1/manage/pilot-study/export.csv");
  expect(defaultCsv.ok()).toBeTruthy();
  expect(await defaultCsv.text()).not.toContain(identity.participantCode);

  const diagnostic = await page.request.get(
    "/api/v1/manage/pilot-study?include_synthetic=true",
  );
  expect(diagnostic.ok()).toBeTruthy();
  expect(await diagnostic.text()).toContain(identity.participantCode);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "真实试用验证" })).toBeVisible();
  await expect(page.getByText(/个合成验收账户/u)).toBeVisible();
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({
      path: resolve(artifacts, `admin-governance-${width}.png`),
      fullPage: true,
    });
  }

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 JSON" }).click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/u);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 CSV" }).click();
  expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/u);

  expect(clientErrors).toEqual([]);
  expect(serverFailures).toEqual([]);
});
