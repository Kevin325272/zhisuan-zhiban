import type { Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";

const invitationGreeting = "最近的学习节奏慢了一些。今天照常继续，还是先完成一个轻一点的步骤？";
const offlineFallback = "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。";

function invitation(interactionId = "care_e2e_001") {
  return {
    kind: "invitation" as const,
    preference_enabled: true,
    interaction_id: interactionId,
    signal_code: "rhythm_drop" as const,
    greeting: invitationGreeting,
    reason_summary: "最近一周完成学习任务的天数比你此前的节奏少。",
    actions: ["continue", "lighten", "talk", "dismiss", "disable"],
    presented_at: "2026-08-21T08:00:00.000Z",
    expires_at: "2026-08-22T08:00:00.000Z",
  };
}

function lightSession(interactionId: string) {
  return {
    kind: "light_session" as const,
    preference_enabled: true,
    interaction_id: interactionId,
    signal_code: "rhythm_drop" as const,
    message: "今天先完成一个更轻的步骤，原任务和学习路径都不会被改写。",
    step: {
      task_id: "task_ds_read",
      task_type: "course_reading" as const,
      course_id: "course_408_ds",
      course_title: "数据结构",
      title: "回到上次阅读位置",
      detail: "先阅读约 10 分钟，完成情况仍以真实阅读记录为准。",
      estimated_minutes: 10,
      href: "/student/courses/data-structures",
    },
    expires_at: "2026-08-21T15:59:59.999Z",
  };
}

async function fulfillData(route: Route, data: unknown, requestId: string) {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ contract_version: "0.2", request_id: requestId, data }),
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
            element.classList.length > 0 ? `.${Array.from(element.classList).join(".")}` : ""
          }`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((element) => element.right > viewportWidth + 1 || element.left < -1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 12);
    return {
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders,
      viewportWidth,
    };
  });
  expect(
    geometry.documentScrollWidth <= geometry.innerWidth + 1,
    `Horizontal overflow: ${JSON.stringify(geometry, null, 2)}`,
  ).toBe(true);
}

async function expectCarePopoverGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const care = document.querySelector<HTMLElement>(".student-care-panel");
    const primaryAction = document.querySelector<HTMLElement>(".orchestrator-task-action a");
    if (!care || !primaryAction) throw new Error("Care popover geometry is incomplete.");
    const careRect = care.getBoundingClientRect();
    const primaryActionRect = primaryAction.getBoundingClientRect();
    const overlapsPrimaryAction = !(
      careRect.right <= primaryActionRect.left
      || careRect.left >= primaryActionRect.right
      || careRect.bottom <= primaryActionRect.top
      || careRect.top >= primaryActionRect.bottom
    );
    return {
      position: getComputedStyle(care).position,
      careTop: careRect.top,
      careLeft: careRect.left,
      careRight: careRect.right,
      careBottom: careRect.bottom,
      careHeight: careRect.height,
      careContained: care.scrollWidth <= care.clientWidth + 1,
      overlapsPrimaryAction,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.position).toBe("fixed");
  expect(geometry.careTop).toBeGreaterThanOrEqual(68);
  expect(geometry.careLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.careRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.careBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.careHeight).toBeLessThanOrEqual(362);
  expect(geometry.careContained).toBe(true);
  expect(geometry.overlapsPrimaryAction).toBe(false);
}

test("real care endpoint stays authenticated and privacy bounded", async ({ page }) => {
  const response = await page.request.get("/api/v1/student/care");
  expect(response.status()).toBe(200);
  const envelope = await response.json() as { data: { kind: string; preference_enabled: boolean } };
  expect(["none", "invitation", "light_session"]).toContain(envelope.data.kind);
  const serialized = JSON.stringify(envelope.data);
  expect(serialized).not.toMatch(/user[_-]?id|correct_option|answer_text|evidence_refs|score/iu);
});

test("care invitation opens as a desktop popover without moving or covering the main task", async ({ page }) => {
  let releaseCare: (() => void) | null = null;
  let gateOpen = false;
  const gate = new Promise<void>((resolve) => {
    releaseCare = () => {
      gateOpen = true;
      resolve();
    };
  });

  await page.route("**/api/v1/student/care", async (route) => {
    if (!gateOpen) await gate;
    await fulfillData(route, invitation(), "e2e_care_status_invitation");
  });

  for (const viewport of [
    { width: 1440, height: 900, label: "1440" },
    { width: 1280, height: 900, label: "1280" },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/student/home");
    const task = page.getByRole("region", { name: "当前学习任务", exact: true });
    await expect(task).toBeVisible();
    const before = await task.boundingBox();
    if (!gateOpen) {
      expect(releaseCare).not.toBeNull();
      releaseCare?.();
    }

    const care = page.getByRole("dialog", { name: "学习关怀" });
    await expect(care).toBeVisible();
    await expect(care).toHaveAttribute("aria-modal", "false");
    const after = await task.boundingBox();
    expect(after?.x).toBeCloseTo(before?.x ?? 0, 0);
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
    expect(after?.width).toBeCloseTo(before?.width ?? 0, 0);
    expect(after?.height).toBeCloseTo(before?.height ?? 0, 0);
    await expect(page.getByRole("link", { name: "开始本关", exact: true })).toHaveCount(1);
    await expect(care.getByRole("button", { name: "关闭本次关怀" })).toBeVisible();
    await expect(care.getByRole("group", { name: "选择今天的学习方式" }).getByRole("button"))
      .toHaveCount(3);
    await expectCarePopoverGeometry(page);
    await expectNoHorizontalOverflow(page);

    const buttonsFit = await care.getByRole("button").evaluateAll((buttons) =>
      buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
    );
    expect(buttonsFit).toBe(true);
    const normalChoice = care.getByRole("button", { name: "照常学习" });
    await normalChoice.focus();
    await expect(normalChoice).toBeFocused();
    expect(await normalChoice.evaluate((button) => parseFloat(getComputedStyle(button).outlineWidth))).toBeGreaterThan(0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `outputs/playwright/student-care/invitation-${viewport.label}.png`,
      fullPage: true,
    });
  }

  const care = page.getByRole("dialog", { name: "学习关怀" });
  await care.getByText("为什么看到这个提示").click();
  await expect(care.getByText("最近一周完成学习任务的天数比你此前的节奏少。")).toBeVisible();
  await expect(care.getByRole("button", { name: "暂不需要" })).toBeVisible();
  await expect(care.getByRole("button", { name: "关闭关怀提醒" })).toBeVisible();
});

test("light, talk fallback, disable, and profile re-enable stay reversible", async ({ page }) => {
  let careStatus: ReturnType<typeof invitation> | ReturnType<typeof lightSession> | {
    kind: "none";
    preference_enabled: boolean;
  } = invitation("care_e2e_actions_001");
  let preferenceEnabled = true;
  const carePayloads: unknown[] = [];
  const preferencePayloads: unknown[] = [];

  await page.route("**/api/v1/student/care", async (route) => {
    await fulfillData(route, careStatus, "e2e_care_status_actions");
  });
  await page.route("**/api/v1/student/care/*/respond", async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    carePayloads.push(body);
    const interactionId = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").at(-2) ?? "",
    );
    if (!interactionId) throw new Error("Missing care interaction ID in response request.");
    if (body.action === "lighten") {
      careStatus = lightSession(interactionId);
      await fulfillData(route, {
        action: "lighten",
        idempotent: false,
        status: careStatus,
        talk: null,
      }, "e2e_care_respond_lighten");
      return;
    }
    if (body.action === "talk") {
      careStatus = { kind: "none", preference_enabled: preferenceEnabled };
      await fulfillData(route, {
        action: "talk",
        idempotent: false,
        status: careStatus,
        talk: {
          capability: "care",
          course_id: "course_408_ds",
          conversation_id: interactionId,
          fallback_step: lightSession(interactionId).step,
        },
      }, "e2e_care_respond_talk");
      return;
    }
    if (body.action === "disable") preferenceEnabled = false;
    careStatus = { kind: "none", preference_enabled: preferenceEnabled };
    await fulfillData(route, {
      action: body.action,
      idempotent: false,
      status: careStatus,
      talk: null,
    }, "e2e_care_respond_other");
  });
  await page.route("**/api/v1/student/care/preferences", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillData(route, {
        enabled: preferenceEnabled,
        updated_at: null,
      }, "e2e_care_preference_read");
      return;
    }
    const body = route.request().postDataJSON() as { enabled: boolean };
    preferencePayloads.push(body);
    preferenceEnabled = body.enabled;
    careStatus = { kind: "none", preference_enabled: preferenceEnabled };
    await fulfillData(route, {
      enabled: preferenceEnabled,
      updated_at: "2026-08-21T08:05:00.000Z",
    }, "e2e_care_preference");
  });
  let aiPayload: Record<string, unknown> | null = null;
  await page.route("**/api/v1/student/ai-workflows/care", async (route) => {
    aiPayload = route.request().postDataJSON() as Record<string, unknown>;
    await fulfillData(route, {
      contract_version: "0.2",
      request_id: "workflow_e2e_care_offline",
      capability: "care",
      slot: "supportive_check_in",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "AI 学伴暂时不可用。",
        retryable: true,
        fallback_message: offlineFallback,
      },
    }, "e2e_care_ai_offline");
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/student/home");
  let care = page.getByRole("dialog", { name: "学习关怀" });
  await care.getByRole("button", { name: "今天轻一点" }).click();
  await expect(care.getByRole("heading", { name: "回到上次阅读位置" })).toBeVisible();
  await expect(care.getByRole("link", { name: "开始轻量步骤" }))
    .toHaveAttribute("href", "/student/courses/data-structures");
  await expect(page.getByRole("link", { name: "开始本关", exact: true })).toHaveCount(1);
  await expectCarePopoverGeometry(page);
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "outputs/playwright/student-care/light-step-1440.png", fullPage: true });

  careStatus = invitation("care_e2e_actions_002");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  care = page.getByRole("dialog", { name: "学习关怀" });
  await care.getByRole("button", { name: "和学伴聊聊" }).click();
  const message = care.getByRole("textbox", { name: "想和学伴说什么" });
  await message.fill("我今天总觉得很难开始。");
  await care.getByRole("button", { name: "发送给学伴" }).click();
  await expect(care.locator(".student-care-fallback")).toHaveText(offlineFallback);
  await expect(care.getByRole("link", { name: "开始轻量步骤" }))
    .toHaveAttribute("href", "/student/courses/data-structures");
  await expect(care.getByRole("link", { name: "继续原任务" })).toBeVisible();
  expect(aiPayload).toEqual({
    contract_version: "0.2",
    capability: "care",
    course_id: "course_408_ds",
    concept_id: null,
    qa_id: null,
    attempt_id: null,
    conversation_id: "care_e2e_actions_002",
    user_message: "我今天总觉得很难开始。",
  });
  expect(JSON.stringify(aiPayload)).not.toMatch(/user[_-]?id|evidence|score|href/iu);
  await expectCarePopoverGeometry(page);
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "outputs/playwright/student-care/talk-offline-1280.png", fullPage: true });

  careStatus = invitation("care_e2e_actions_003");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  care = page.getByRole("dialog", { name: "学习关怀" });
  await care.getByText("为什么看到这个提示").click();
  await care.getByRole("button", { name: "关闭关怀提醒" }).click();
  await expect(care.locator(".student-care-notice"))
    .toHaveText("关怀提醒已关闭，可在“我的学习”中重新开启。");
  await expect(care.getByText(invitationGreeting)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto("/student/profile");
  const preference = page.getByRole("switch", { name: "主动关怀提醒" });
  await expect(preference).toHaveAttribute("aria-checked", "false");
  await preference.click();
  await expect(preference).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/主动关怀提醒已开启，满足个人学习证据门槛后才会提醒。/u)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "outputs/playwright/student-care/re-enabled-1280.png", fullPage: true });

  expect(carePayloads).toEqual([
    { action: "lighten" },
    { action: "talk" },
    { action: "disable" },
  ]);
  expect(preferencePayloads).toEqual([{ enabled: true }]);
});
