import { expect, test } from "./fixtures";

const courseRoutes = [
  { slug: "data-structures", title: "数据结构", map: "数据结构课程知识地图" },
  { slug: "computer-organization", title: "计算机组成原理", map: "组成原理知识地图" },
  { slug: "operating-systems", title: "操作系统", map: "操作系统课程知识地图" },
  { slug: "computer-networks", title: "计算机网络", map: "计算机网络课程知识地图" },
] as const;

const courseVideoTotals = [
  { slug: "data-structures", title: "数据结构", series: "40", episodes: "2065" },
  { slug: "computer-organization", title: "计算机组成原理", series: "34", episodes: "1602" },
  { slug: "operating-systems", title: "操作系统", series: "37", episodes: "1276" },
  { slug: "computer-networks", title: "计算机网络", series: "38", episodes: "1495" },
] as const;

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function expectEditorialHeading(page: import("@playwright/test").Page, name: string | RegExp) {
  const heading = page.getByRole("heading", { name }).first();
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(
    /Serif|Songti|STSong|SimSun|Georgia/iu,
  );
}

test.describe("ochre-serif student visual system", () => {
  test("keeps home and catalogue coherent at 1440 and 1280", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900, label: "1440" },
      { width: 1280, height: 900, label: "1280" },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/student/home");
      await expect(page.locator('[data-visual-system="ochre-serif"].learning-orchestrator-page')).toBeVisible();
      const homeHeading = page.getByRole("region", { name: "当前学习任务", exact: true })
        .getByRole("heading", { level: 1 });
      await expect(homeHeading).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      expect(await homeHeading.evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(
        /Serif|Songti|STSong|SimSun|Georgia/iu,
      );
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `output/playwright/visual-system/home-${viewport.label}.png`, fullPage: true });

      await page.goto("/student/courses");
      await expect(page.locator('[data-visual-system="ochre-serif"].courses-overview-page')).toBeVisible();
      await expectEditorialHeading(page, "408 核心课程");
      await expect(page.getByRole("region", { name: "408 课程域" }).getByRole("article")).toHaveCount(4);
      await expect(page.getByRole("link", { name: "视频资源" })).toHaveCount(4);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `output/playwright/visual-system/courses-${viewport.label}.png`, fullPage: true });
    }
  });

  test("keeps the empty target-school action visually prominent", async ({ page }) => {
    await page.route("**/api/v1/student/admissions/target", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            contract_version: "0.2",
            request_id: "e2e_admissions_target_empty",
            data: { target: null, saved_at: null },
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/student/home");

    const admissions = page.getByRole("region", { name: "目标院校" });
    const trigger = admissions.getByRole("button", { name: "选目标院校" });
    await expect(trigger).toBeVisible();
    await expect(admissions.getByRole("alert")).toHaveCount(0);
    const geometry = await trigger.boundingBox();
    expect(geometry?.width ?? 0).toBeGreaterThanOrEqual(148);
    expect(geometry?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(await trigger.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe("rgba(0, 0, 0, 0)");
    await page.screenshot({
      path: "output/playwright/visual-system/admissions-trigger-1440.png",
      fullPage: true,
    });
  });

  test("keeps course progress in one compact desktop ledger at 1440 and 1280", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/student/home");

      const priorities = page.getByRole("region", { name: "课程进度" });
      const ledger = priorities.locator(":scope > ol");
      const rows = ledger.locator(":scope > li");
      await expect(rows).toHaveCount(4);

      const ledgerStyle = await ledger.evaluate((node) => ({
        backgroundColor: getComputedStyle(node).backgroundColor,
        borderTopWidth: getComputedStyle(node).borderTopWidth,
        borderBottomWidth: getComputedStyle(node).borderBottomWidth,
      }));
      expect(ledgerStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(ledgerStyle.borderTopWidth).toBe("1px");
      expect(ledgerStyle.borderBottomWidth).toBe("1px");

      const rowHeights = await rows.evaluateAll((nodes) => (
        nodes.map((node) => Math.round(node.getBoundingClientRect().height))
      ));
      expect(Math.max(...rowHeights)).toBeLessThanOrEqual(96);
      expect(Math.max(...rowHeights) - Math.min(...rowHeights)).toBeLessThanOrEqual(1);
      expect((await rows.first().getByRole("link", { name: /数据结构/u }).boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("keeps journey and feedback in two compact continuous desktop rails", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/student/home");
      await expect(page.locator(".home-journey-workspace")).toBeVisible();
      await expect(page.locator(".home-feedback-workspace")).toBeVisible();

      const geometry = await page.evaluate(() => {
        const journey = document.querySelector<HTMLElement>(".home-journey-workspace");
        const route = document.querySelector<HTMLElement>(".home-challenge-route");
        const activity = document.querySelector<HTMLElement>(".home-recent-activity");
        const feedback = document.querySelector<HTMLElement>(".home-feedback-workspace");
        if (!journey || !route || !activity || !feedback) {
          throw new Error("home learning rails are incomplete");
        }

        const journeyRect = journey.getBoundingClientRect();
        const routeRect = route.getBoundingClientRect();
        const activityRect = activity.getBoundingClientRect();
        const feedbackRect = feedback.getBoundingClientRect();
        const journeyStyle = getComputedStyle(journey);
        const feedbackStyle = getComputedStyle(feedback);
        return {
          journeyBackground: journeyStyle.backgroundColor,
          journeyBorderTop: journeyStyle.borderTopWidth,
          journeyBorderBottom: journeyStyle.borderBottomWidth,
          feedbackBackground: feedbackStyle.backgroundColor,
          feedbackBorderTop: feedbackStyle.borderTopWidth,
          feedbackBorderBottom: feedbackStyle.borderBottomWidth,
          journeyHeight: Math.round(journeyRect.height),
          feedbackHeight: Math.round(feedbackRect.height),
          routeTop: Math.round(routeRect.top),
          routeBottom: Math.round(routeRect.bottom),
          activityTop: Math.round(activityRect.top),
          activityBottom: Math.round(activityRect.bottom),
          journeyLeft: Math.round(journeyRect.left),
          journeyRight: Math.round(journeyRect.right),
          feedbackLeft: Math.round(feedbackRect.left),
          feedbackRight: Math.round(feedbackRect.right),
        };
      });

      expect(geometry.journeyBackground).not.toBe("rgba(0, 0, 0, 0)");
      expect(geometry.journeyBorderTop).toBe("1px");
      expect(geometry.journeyBorderBottom).toBe("1px");
      expect(geometry.feedbackBackground).not.toBe("rgba(0, 0, 0, 0)");
      expect(geometry.feedbackBorderTop).toBe("1px");
      expect(geometry.feedbackBorderBottom).toBe("1px");
      expect(geometry.journeyHeight).toBeLessThanOrEqual(200);
      expect(geometry.feedbackHeight).toBeLessThanOrEqual(220);
      expect(Math.abs(geometry.routeTop - geometry.activityTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.routeBottom - geometry.activityBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.journeyLeft - geometry.feedbackLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.journeyRight - geometry.feedbackRight)).toBeLessThanOrEqual(1);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("keeps the lower home rail continuous instead of leaving a tall side column", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/student/home");
    await expect(page.getByRole("region", { name: "当前学习任务", exact: true })).toBeVisible();

    const layout = await page.evaluate(() => {
      const profile = document.querySelector<HTMLElement>(".home-profile-updates");
      const quick = document.querySelector<HTMLElement>(".home-quick-actions");
      const courses = document.querySelector<HTMLElement>(".home-course-rail");
      if (!profile || !quick || !courses) throw new Error("home lower rail is incomplete");
      const profileRect = profile.getBoundingClientRect();
      const quickRect = quick.getBoundingClientRect();
      const courseRect = courses.getBoundingClientRect();
      return {
        profileLeft: profileRect.left,
        profileRight: profileRect.right,
        quickLeft: quickRect.left,
        quickRight: quickRect.right,
        courseLeft: courseRect.left,
        courseRight: courseRect.right,
        profileWidth: profileRect.width,
        quickWidth: quickRect.width,
      };
    });

    expect(Math.abs(layout.quickLeft - layout.profileLeft)).toBeLessThan(2);
    expect(Math.abs(layout.quickRight - layout.profileRight)).toBeLessThan(2);
    expect(layout.quickWidth).toBeGreaterThan(layout.profileWidth * 0.95);
    expect(Math.abs(layout.courseLeft - layout.profileLeft)).toBeLessThan(2);
    expect(Math.abs(layout.courseRight - layout.profileRight)).toBeLessThan(2);
  });

  test("lets the home canvas fill the shell content area without a side gutter break", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/student/home");
    await expect(page.getByRole("region", { name: "当前学习任务", exact: true })).toBeVisible();

    const layout = await page.evaluate(() => {
      const pageContent = document.querySelector<HTMLElement>(".page-content");
      const home = document.querySelector<HTMLElement>(".learning-orchestrator-page");
      const shellBody = document.querySelector<HTMLElement>(".shell-body");
      if (!pageContent || !home || !shellBody) throw new Error("home shell geometry is incomplete");
      const pageRect = pageContent.getBoundingClientRect();
      const homeRect = home.getBoundingClientRect();
      const pageStyle = getComputedStyle(pageContent);
      const homeStyle = getComputedStyle(home);
      const bodyStyle = getComputedStyle(shellBody);
      return {
        pageLeft: pageRect.left,
        pageRight: pageRect.right,
        homeLeft: homeRect.left,
        homeRight: homeRect.right,
        pageBackground: pageStyle.backgroundColor,
        homeBackground: homeStyle.backgroundColor,
        bodyBackground: bodyStyle.backgroundColor,
      };
    });

    expect(Math.abs(layout.homeLeft - layout.pageLeft)).toBeLessThan(1);
    expect(Math.abs(layout.homeRight - layout.pageRight)).toBeLessThan(1);
    expect(layout.homeBackground).toBe(layout.pageBackground);
    expect(layout.bodyBackground).toBe(layout.pageBackground);
  });

  for (const course of courseRoutes) {
    test(`course reading keeps tree levels and collapsed reading width: ${course.title}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/student/courses/${course.slug}`);
      await expect(page.locator('[data-visual-system="ochre-serif"].course-study-page')).toBeVisible();
      await expectEditorialHeading(page, course.title);
      const map = page.getByRole("navigation", { name: course.map });
      await expect(map).toBeVisible();
      await expect(page.getByRole("heading", { name: "课程讲解" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "本节学习目标" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `output/playwright/visual-system/${course.slug}-1440.png`, fullPage: true });

      const readingBefore = await page.locator(".course-lesson-panel").evaluate((node) => node.getBoundingClientRect().width);
      await map.getByRole("button", { name: "收起课程目录" }).click();
      await expect(map).toHaveAttribute("data-collapsed", "true");
      const readingAfter = await page.locator(".course-lesson-panel").evaluate((node) => node.getBoundingClientRect().width);
      expect(readingAfter).toBeGreaterThan(readingBefore);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `output/playwright/visual-system/${course.slug}-collapsed-1440.png`, fullPage: true });
    });
  }

  test("keeps the complete video library scan-friendly at 1440 and 1280", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900, label: "1440" },
      { width: 1280, height: 900, label: "1280" },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/student/courses/data-structures/videos");

      const library = page.locator('[data-visual-system="ochre-serif"].course-video-library-page');
      await expect(library).toBeVisible();
      await expectEditorialHeading(page, "数据结构视频资源");
      await expect(page.getByRole("searchbox", { name: "搜索视频" })).toBeVisible();
      await expect(page.getByRole("group", { name: "视频类型" })).toBeVisible();

      const firstRow = page.locator(".course-video-series-row").first();
      await expect(firstRow).toBeVisible();
      const rowLayout = await firstRow.evaluate((node) => ({
        display: getComputedStyle(node).display,
        columns: getComputedStyle(node).gridTemplateColumns,
      }));
      expect(rowLayout.display).toBe("grid");
      expect(rowLayout.columns.split(" ").length).toBeGreaterThanOrEqual(4);

      const searchButton = page.getByRole("button", { name: "搜索" });
      expect((await searchButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      await page.getByRole("button", { name: /^展开分集：/u }).first().click();
      const episodePanel = page.locator(".course-video-episode-panel");
      await expect(episodePanel).toBeVisible();
      const containment = await library.evaluate((root) => {
        const panel = root.querySelector<HTMLElement>(".course-video-episode-panel");
        if (!panel) throw new Error("expanded episode panel is missing");
        const rootRect = root.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        return {
          left: panelRect.left >= rootRect.left - 1,
          right: panelRect.right <= rootRect.right + 1,
        };
      });
      expect(containment).toEqual({ left: true, right: true });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: `output/playwright/video-library/data-structures-${viewport.label}.png`,
        fullPage: true,
      });
    }
  });

  test("serves the complete database totals on all four course video routes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const course of courseVideoTotals) {
      await page.goto(`/student/courses/${course.slug}/videos`);
      await expectEditorialHeading(page, `${course.title}视频资源`);
      const overview = page.locator('dl[aria-label="视频资源概况"]');
      await expect(overview.locator("dd").nth(0)).toHaveText(course.series);
      await expect(overview.locator("dd").nth(1)).toHaveText(course.episodes);
      await expect(page.locator(".course-video-series-row")).toHaveCount(10);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("practice and personal learning retain readable editorial hierarchy at 1280", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84");
    await expect(page.locator('[data-visual-system="ochre-serif"].question-practice-center')).toBeVisible();
    await expectEditorialHeading(page, "数据结构课程训练");
    await expect(page.getByText("AI 学伴 · 评测诊断与下一题推荐")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "output/playwright/visual-system/practice-1280.png", fullPage: true });

    await page.goto("/student/profile");
    await expect(page.locator('[data-visual-system="ochre-serif"].personal-learning-page')).toBeVisible();
    await expectEditorialHeading(page, "我的学习");
    await expect(page.getByRole("img", { name: "数据结构课程学习画像" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: "output/playwright/visual-system/profile-1280.png", fullPage: true });
  });

  test("mistake book keeps evidence-ranked review usable at 1440 and 1280", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900, label: "1440" },
      { width: 1280, height: 900, label: "1280" },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/student/mistakes");
      await expectEditorialHeading(page, "错题本");
      await expect(page.getByText("建议先练")).toBeVisible();
      await expect(page.getByText("已到复习时间").first()).toBeVisible();
      await expect(page.getByRole("link", { name: /复习第/ }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: `output/playwright/mistake-recommendations/mistakes-${viewport.label}.png`,
        fullPage: true,
      });
    }
  });
});
