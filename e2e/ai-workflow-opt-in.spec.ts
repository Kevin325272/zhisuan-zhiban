import { studentLearningOrchestrationSchema } from "@xuetu/contracts";
import type { Page } from "@playwright/test";

import { test, expect } from "./fixtures";

const orchestration = studentLearningOrchestrationSchema.parse({
  generated_at: "2026-08-26T05:00:00.000Z",
  source: "deterministic_evidence_rules",
  ai_status: "unavailable",
  ai_status_message: "当前任务由学习记录确定。",
  goal_context: null,
  evidence_summary: {
    basis: "live_evidence",
    confidence: "developing",
    objective_evidence_count: 3,
    subjective_evidence_count: 0,
    reading_progress_count: 1,
    practice_attempt_count: 2,
    needs_review_count: 1,
    explanation: "当前判断结合 2 次真实作答与 1 条错题记录。",
    evidence_refs: ["attempt:attempt_e2e_001", "mistake:mistake_e2e_001"],
  },
  plan_progress: {
    plan_id: null,
    completed_task_count: 0,
    total_task_count: 0,
    completion_percent: 0,
    tasks: [],
  },
  challenge_journey: {
    current_stage_label: "数据结构 · 错题复习",
    current_node_id: "journey_e2e_review",
    nodes: [{
      node_id: "journey_e2e_review",
      task_id: "task_e2e_review_ds",
      kind: "mistake_review",
      status: "review_due",
      course_id: "course_408_ds",
      course_title: "数据结构",
      concept_id: "ds_c01",
      title: "复习：顺序表的存储表示",
      href: "/student/mistakes?course_id=course_408_ds",
    }],
    recent_activity: {
      completed_day_count: 1,
      days: [
        { date: "2026-08-20", completed: false },
        { date: "2026-08-21", completed: false },
        { date: "2026-08-22", completed: false },
        { date: "2026-08-23", completed: false },
        { date: "2026-08-24", completed: true },
        { date: "2026-08-25", completed: false },
        { date: "2026-08-26", completed: false },
      ],
    },
    profile_updates: [{
      update_id: "profile_update_e2e_001",
      course_id: "course_408_ds",
      course_title: "数据结构",
      kind: "mistake",
      occurred_at: "2026-08-26T04:40:00.000Z",
      title: "顺序表进入错题复习",
      detail: "重复错误已经进入当前复习任务。",
    }],
  },
  current_task: {
    task_id: "task_e2e_review_ds",
    source: "mistake",
    task_type: "mistake_review",
    course_id: "course_408_ds",
    course_title: "数据结构",
    concept_id: "ds_c01",
    concept_title: "顺序表",
    mistake_id: "mistake_e2e_001",
    title: "复习：顺序表的存储表示",
    reason: "这道题累计答错 2 次，先完成错题复习。",
    completion_criteria: "完成错题回看并提交一次关联练习。",
    estimated_minutes: 20,
    href: "/student/mistakes?course_id=course_408_ds",
    practice_question_count: 1,
    evidence_refs: ["mistake:mistake_e2e_001"],
  },
  course_priorities: [{
    rank: 1,
    course_id: "course_408_ds",
    course_title: "数据结构",
    priority: "focus",
    evidence_level: "limited",
    rationale: "顺序表还有 1 道错题没有完成复习。",
    started_concept_count: 1,
    concept_count: 10,
    practice_attempt_count: 2,
    needs_review_count: 1,
    href: "/student/courses/data-structures",
  }, {
    rank: 2,
    course_id: "course_408_co",
    course_title: "计算机组成原理",
    priority: "strengthen",
    evidence_level: "self_report_only",
    rationale: "当前先按起步计划保持学习顺序。",
    started_concept_count: 0,
    concept_count: 10,
    practice_attempt_count: 0,
    needs_review_count: 0,
    href: "/student/courses/computer-organization",
  }, {
    rank: 3,
    course_id: "course_408_os",
    course_title: "操作系统",
    priority: "maintain",
    evidence_level: "self_report_only",
    rationale: "当前先按起步计划保持学习顺序。",
    started_concept_count: 0,
    concept_count: 10,
    practice_attempt_count: 0,
    needs_review_count: 0,
    href: "/student/courses/operating-systems",
  }, {
    rank: 4,
    course_id: "course_408_cn",
    course_title: "计算机网络",
    priority: "maintain",
    evidence_level: "self_report_only",
    rationale: "当前先按起步计划保持学习顺序。",
    started_concept_count: 0,
    concept_count: 10,
    practice_attempt_count: 0,
    needs_review_count: 0,
    href: "/student/courses/computer-networks",
  }],
  boundary_note: "当前结果只描述已存储学习证据。",
});

async function routeOrchestration(page: Page) {
  await page.route("**/api/v1/student/learning-orchestration", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contract_version: "0.2",
        request_id: "e2e_learning_orchestration_001",
        data: orchestration,
      }),
    });
  });
}

async function expectDesktopDockToFit(page: Page) {
  const layout = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
    const overlaps = (a: DOMRect | undefined, b: DOMRect | undefined) => Boolean(
      a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
    );
    const dock = rect(".study-agent-dock");
    const topbar = rect(".topbar");
    const sidebar = rect(".sidebar");
    const composer = rect(".study-agent-composer");
    const primaryAction = rect(".study-agent-primary-action");
    const homePrimary = rect(".orchestrator-task-action > a");
    return {
      dockInsideViewport: Boolean(dock && dock.top >= 0 && dock.bottom <= innerHeight),
      clearsTopbar: Boolean(dock && topbar && dock.top >= topbar.bottom),
      clearsSidebar: !overlaps(dock, sidebar),
      clearsHomePrimary: !overlaps(dock, homePrimary),
      composerVisible: Boolean(composer && composer.top >= 0 && composer.bottom <= innerHeight),
      primaryActionVisible: Boolean(primaryAction && primaryAction.top >= 0 && primaryAction.bottom <= innerHeight),
    };
  });

  expect(layout).toEqual({
    dockInsideViewport: true,
    clearsTopbar: true,
    clearsSidebar: true,
    clearsHomePrimary: true,
    composerVisible: true,
    primaryActionVisible: true,
  });
}

async function expectCollapsedTriggerToClearHomePrimary(page: Page) {
  const layout = await page.evaluate(() => {
    const triggerElement = document.querySelector<HTMLElement>(".study-agent-trigger");
    const trigger = triggerElement?.getBoundingClientRect();
    const triggerStyle = triggerElement ? getComputedStyle(triggerElement) : null;
    const homePrimary = document.querySelector<HTMLElement>(".orchestrator-task-action > a")?.getBoundingClientRect();
    if (!trigger || !triggerStyle || !homePrimary) {
      return { clearsHomePrimary: false, square: false, transparentChrome: false };
    }
    return {
      clearsHomePrimary: !(
        trigger.left < homePrimary.right
        && trigger.right > homePrimary.left
        && trigger.top < homePrimary.bottom
        && trigger.bottom > homePrimary.top
      ),
      square: trigger.width === trigger.height && trigger.width <= 48,
      transparentChrome: triggerStyle.backgroundColor === "rgba(0, 0, 0, 0)"
        && triggerStyle.borderTopWidth === "0px"
        && triggerStyle.boxShadow === "none",
    };
  });
  expect(layout).toEqual({
    clearsHomePrimary: true,
    square: true,
    transparentChrome: true,
  });
}

async function readCollapsedTriggerPlacement(page: Page) {
  return page.locator(".study-agent-trigger").evaluate((triggerElement) => {
    const trigger = triggerElement.getBoundingClientRect();
    const style = getComputedStyle(triggerElement);
    return {
      position: style.position,
      right: style.right,
      bottom: style.bottom,
      top: style.top,
      rect: {
        x: trigger.x,
        y: trigger.y,
        width: trigger.width,
        height: trigger.height,
        right: trigger.right,
        bottom: trigger.bottom,
      },
      viewportRightGap: innerWidth - trigger.right,
      viewportBottomGap: innerHeight - trigger.bottom,
    };
  });
}

async function expectCollapsedTriggerToClearCourseActions(page: Page) {
  const clearsActions = await page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>(".study-agent-trigger")?.getBoundingClientRect();
    if (!trigger) return false;
    return [...document.querySelectorAll<HTMLElement>(".courses-overview-actions a")]
      .filter((action) => {
        const style = getComputedStyle(action);
        const rect = action.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      })
      .every((action) => {
        const rect = action.getBoundingClientRect();
        return !(
          trigger.left < rect.right
          && trigger.right > rect.left
          && trigger.top < rect.bottom
          && trigger.bottom > rect.top
        );
      });
  });
  expect(clearsActions).toBe(true);
}

test("the learning manager leads from evidence-backed task to a follow-up", async ({ page }) => {
  let workflowCalls = 0;
  let releaseInitialWorkflow!: () => void;
  const initialWorkflowGate = new Promise<void>((resolve) => {
    releaseInitialWorkflow = resolve;
  });

  await routeOrchestration(page);

  await page.route("**/api/v1/student/ai-workflows/plan", async (route) => {
    workflowCalls += 1;
    if (workflowCalls === 1) await initialWorkflowGate;
    const content = workflowCalls === 1
      ? "你在顺序表上已有重复错题，先回看存储表示，再做一道关联练习。"
      : "时间不足时，先用 10 分钟完成错题回看，关联练习可以留到下一次。";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contract_version: "0.2",
        request_id: `e2e_study_agent_${workflowCalls}`,
        data: {
          contract_version: "0.2",
          request_id: `workflow_e2e_study_agent_${workflowCalls}`,
          capability: "plan",
          slot: "learning_orchestration",
          status: "ready",
          display_blocks: [{
            block_id: `workflow_e2e_study_agent_block_${workflowCalls}`,
            kind: "summary",
            title: "当前安排",
            content,
          }],
          citations: [],
          evidence_refs: [],
          next_actions: [],
          failure: null,
        },
      }),
    });
  });

  await page.goto("/student/courses");
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/student/home");

  const dock = page.getByRole("complementary", { name: "学习管家" });
  await expect(dock).toBeVisible();
  await expect(dock.getByText(/今天先完成/)).toContainText("复习：顺序表的存储表示");
  await expect(dock.getByText("顺序表还有 1 道错题没有完成复习。")).toBeVisible();
  await expect(dock.getByRole("link", { name: /开始这项任务/ })).toHaveAttribute(
    "href",
    orchestration.current_task.href,
  );
  await expect(dock.getByText("正在结合你的学习记录…")).toBeVisible();
  expect(workflowCalls).toBe(1);

  await page.screenshot({
    path: "output/playwright/study-agent/loading-1440x900.png",
    fullPage: false,
  });
  releaseInitialWorkflow();
  await expect(dock.getByText(/你在顺序表上已有重复错题/)).toBeVisible();

  await dock.getByRole("button", { name: "今天时间不够怎么办？" }).click();
  await expect(dock.getByRole("region", { name: "与学习管家的对话" })
    .getByText("今天时间不够怎么办？")).toBeVisible();
  await expect(dock.getByText(/先用 10 分钟完成错题回看/)).toBeVisible();
  expect(workflowCalls).toBe(2);

  await expectDesktopDockToFit(page);
  await page.screenshot({
    path: "output/playwright/study-agent/ready-1440x900.png",
    fullPage: false,
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await expectDesktopDockToFit(page);
  await page.screenshot({
    path: "output/playwright/study-agent/ready-1280x800.png",
    fullPage: false,
  });

  await dock.getByRole("button", { name: "关闭学习管家" }).click();
  await expect(page.getByRole("button", { name: "打开学习管家" })).toBeVisible();
  await expectCollapsedTriggerToClearHomePrimary(page);
  const homeTriggerPlacement = await readCollapsedTriggerPlacement(page);
  expect(homeTriggerPlacement).toMatchObject({
    position: "fixed",
    right: "24px",
    bottom: "72px",
    viewportRightGap: 24,
    viewportBottomGap: 72,
  });
  await page.screenshot({
    path: "output/playwright/study-agent/collapsed-1280x800.png",
    fullPage: false,
  });

  await page.goto("/student/courses");
  await expect(page.getByRole("button", { name: "打开学习管家" })).toBeVisible();
  const coursesTriggerPlacement = await readCollapsedTriggerPlacement(page);
  expect(coursesTriggerPlacement).toEqual(homeTriggerPlacement);
  await expectCollapsedTriggerToClearCourseActions(page);
  await page.screenshot({
    path: "output/playwright/study-agent/collapsed-courses-1280x800.png",
    fullPage: false,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/student/home");
  await expect(page.getByRole("button", { name: "打开学习管家" })).toBeVisible();
  const homeWideTriggerPlacement = await readCollapsedTriggerPlacement(page);
  expect(homeWideTriggerPlacement).toMatchObject({
    position: "fixed",
    right: "24px",
    bottom: "72px",
    viewportRightGap: 24,
    viewportBottomGap: 72,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({
    path: "output/playwright/study-agent/collapsed-home-1440x900.png",
    fullPage: false,
  });

  await page.goto("/student/courses");
  await expect(page.getByRole("button", { name: "打开学习管家" })).toBeVisible();
  const coursesWideTriggerPlacement = await readCollapsedTriggerPlacement(page);
  expect(coursesWideTriggerPlacement).toEqual(homeWideTriggerPlacement);
  await expectCollapsedTriggerToClearCourseActions(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({
    path: "output/playwright/study-agent/collapsed-courses-1440x900.png",
    fullPage: false,
  });
});

test("the learning manager keeps the real task when its explanation is unavailable", async ({ page }) => {
  await routeOrchestration(page);
  await page.route("**/api/v1/student/ai-workflows/plan", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contract_version: "0.2",
        request_id: "e2e_study_agent_unavailable",
        data: {
          contract_version: "0.2",
          request_id: "workflow_e2e_study_agent_unavailable",
          capability: "plan",
          slot: "learning_orchestration",
          status: "unavailable",
          display_blocks: [],
          citations: [],
          evidence_refs: [],
          next_actions: [],
          failure: {
            code: "UPSTREAM_UNAVAILABLE",
            message: "解释暂时无法生成。",
            retryable: true,
            fallback_message: "先按当前任务继续。",
          },
        },
      }),
    });
  });

  await page.goto("/student/courses");
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/student/home");

  const dock = page.getByRole("complementary", { name: "学习管家" });
  await expect(dock.getByText(/今天先完成/)).toContainText(orchestration.current_task.title);
  await expect(dock.getByText(/这次解释暂时没有生成/)).toBeVisible();
  await expect(dock.getByRole("button", { name: "重新整理" })).toBeVisible();
  await expect(dock.getByRole("link", { name: /开始这项任务/ })).toHaveAttribute(
    "href",
    orchestration.current_task.href,
  );
  await expectDesktopDockToFit(page);
  await page.screenshot({
    path: "output/playwright/study-agent/degraded-1440x900.png",
    fullPage: false,
  });
});
