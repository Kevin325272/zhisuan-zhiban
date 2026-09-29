import { expect, test } from "./fixtures";

test("eight languages keep real highlighting, evaluation, and isolated history", async ({ page }) => {
  await page.goto("/student/tasks/task_bfs_bug_001");
  const languageSelect = page.getByRole("combobox", { name: "提交语言" });
  await expect(languageSelect.locator("option")).toHaveCount(8);
  await expect(page.getByText("提交语言：C++ · C++17")).toBeVisible();

  const languages = [
    ["c", "bfs.c"],
    ["cpp", "bfs.cpp"],
    ["java", "BfsTraversal.java"],
    ["python", "bfs.py"],
    ["javascript", "bfs.js"],
    ["typescript", "bfs.ts"],
    ["go", "bfs.go"],
    ["rust", "bfs.rs"],
  ] as const;

  for (const [language, fileName] of languages) {
    await languageSelect.selectOption(language);
    await expect(page.getByText(fileName, { exact: true })).toBeVisible();
    await expect(page.locator(".editor-highlight-scroll .token.keyword").first()).toBeVisible();
  }

  await languageSelect.selectOption("python");
  await expect(page.getByText("提交语言：Python · Python 3.12")).toBeVisible();
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect(page.getByRole("heading", { name: "测试结果" })).toBeVisible();
  await expect(page.getByText("2 / 4")).toBeVisible();
  await page.getByRole("button", { name: "已修复代码" }).click();
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect(page.getByText("运行通过")).toBeVisible();
  await expect(page.getByText("4 / 4")).toBeVisible();

  await page.getByRole("button", { name: "代码", exact: true }).click();
  await languageSelect.selectOption("java");
  await page.getByRole("button", { name: "已修复代码" }).click();
  await page.getByRole("button", { name: "提交评测" }).click();
  await expect(page.getByText("4 / 4")).toBeVisible();

  await page.getByRole("button", { name: "代码", exact: true }).click();
  await expect(page.getByText("BfsTraversal.java", { exact: true })).toBeVisible();
  await languageSelect.selectOption("rust");
  await expect(page.getByText("bfs.rs", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "已修复代码" }).click();
  await page.getByRole("button", { name: "提交评测" }).click();
  await expect(page.getByText("4 / 4")).toBeVisible();
  await page.getByRole("button", { name: "提交记录" }).click();
  await expect(page.getByText("1 次提交")).toBeVisible();
  await expect(page.getByText(/Rust · 版本/).first()).toBeVisible();
  await expect(page.getByText(/Java · 版本/)).toHaveCount(0);

  await page.screenshot({
    path: "e2e/artifacts/workbench-eight-languages-desktop-1440x900.png",
    fullPage: true,
  });
});

test("edited source drives run output, line location, and the matching trace", async ({ page }) => {
  await page.goto("/student/tasks/task_bfs_bug_001");
  await expect(page.getByRole("textbox", { name: "BFS 代码" })).toBeEditable();

  await page.getByRole("button", { name: "运行代码" }).click();
  await expect(page.getByRole("heading", { name: "测试结果" })).toBeVisible();
  await expect(page.getByText("2 / 4")).toBeVisible();
  await expect(page.getByText("菱形汇聚图")).toBeVisible();
  await expect(page.getByText("1 2 3 4 4", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  await page.screenshot({
    path: "e2e/artifacts/workbench-run-result-desktop-1440x900.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: /定位第 \d+ 行/ }).click();
  await expect(page.getByRole("textbox", { name: "BFS 代码" })).toBeFocused();

  await page.getByRole("button", { name: "已修复代码" }).click();
  await page.getByRole("button", { name: "运行代码" }).click();
  await expect(page.getByText("运行通过")).toBeVisible();
  await expect(page.getByText("4 / 4")).toBeVisible();
  await page.getByRole("button", { name: "查看本次轨迹" }).click();
  await expect(page.getByRole("heading", { name: "BFS 运行轨迹" })).toBeVisible();
  await page.getByRole("button", { name: "退出专注模式" }).click();
  await expect(page.getByRole("heading", { name: "当前状态一致" })).toBeVisible();
});

test("student compares and predicts from the A+ BFS trace workspace", async ({ page }) => {
  await page.goto("/student/tasks/task_bfs_bug_001?view=trace");
  await expect(page.getByRole("heading", { name: "BFS 运行轨迹" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByRole("button", { name: "讲解模式" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  expect(
    await page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>(".trace-code-pane");
      return Boolean(pane && pane.scrollWidth <= pane.clientWidth + 1);
    }),
  ).toBe(true);
  await page.screenshot({
    path: "e2e/artifacts/trace-a-plus-explain-desktop-1440x900.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByRole("button", { name: /跳到第 6 步/ }).click();
  const traceFitsTaskPane = await page.evaluate(() => {
    const taskPane = document.querySelector<HTMLElement>(".task-pane");
    const stage = document.querySelector<HTMLElement>(".trace-player-stage");
    const nodes = Array.from(
      document.querySelectorAll<SVGCircleElement>(".trace-graph-node > circle"),
    );
    if (!taskPane || !stage || nodes.length === 0) return false;

    const taskRect = taskPane.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    return (
      stageRect.left >= taskRect.left - 1 &&
      stageRect.right <= taskRect.right + 1 &&
      nodes.every((node) => {
        const nodeRect = node.getBoundingClientRect();
        return nodeRect.left >= taskRect.left && nodeRect.right <= taskRect.right;
      })
    );
  });
  expect(traceFitsTaskPane).toBe(true);
  await page.screenshot({
    path: "e2e/artifacts/trace-a-plus-explain-laptop-1200x900.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "双轨对比" }).click();
  await expect(page.getByRole("heading", { name: "BFS 双轨对比" })).toBeVisible();
  await expect(page.getByText("首次分叉：第 1 步")).toBeVisible();
  const scrollBeforeTraceSync = await page.evaluate(() => {
    scrollTo(0, 260);
    return scrollY;
  });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) =>
      item.getAttribute("aria-label")?.startsWith("跳到第 5 步"),
    );
    button?.click();
  });
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrollBeforeTraceSync);
  const comparedQueues = page.getByLabel("当前队列");
  await expect(comparedQueues.nth(0)).toContainText("334");
  await expect(comparedQueues.nth(1)).toContainText("34");
  await page.screenshot({
    path: "e2e/artifacts/trace-a-plus-compare-desktop-1440x900.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(page.getByRole("heading", { name: "错误版" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "修复版" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  await page.screenshot({
    path: "e2e/artifacts/trace-a-plus-compare-laptop-1200x900.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "回到起点" }).click();
  await page.getByRole("button", { name: "预测挑战" }).click();
  await expect(page.getByRole("button", { name: "下一步" })).toBeDisabled();
  await page.getByRole("radio", { name: "空队列" }).click();
  await page.getByRole("button", { name: "提交预测" }).click();
  await expect(page.getByRole("status")).toContainText("回答正确");
  await expect(page.getByRole("status")).toContainText("真实下一步 Queue：空");
  await page.screenshot({
    path: "e2e/artifacts/trace-a-plus-challenge-desktop-1440x900.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1200, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  await page.screenshot({
    path: "e2e/artifacts/trace-a-plus-challenge-laptop-1200x900.png",
    fullPage: true,
  });
});

test("student sees one evidence-backed task, the course domain, and honest AI status", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/student/home");

  await expect(page.getByRole("region", { name: "目标院校", exact: true })).toBeVisible();
  const currentTask = page.getByRole("region", { name: "当前学习任务", exact: true });
  await expect(currentTask).toBeVisible();
  await expect(currentTask.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "开始本关", exact: true })).toHaveCount(1);
  const recommendation = page.locator(".home-recommendation-disclosure");
  await recommendation.locator("summary").click();
  await expect(page.getByRole("region", { name: "任务判断依据", exact: true })).toBeVisible();
  await expect(recommendation.getByRole("heading", { name: "7 日学习路径" })).toHaveCount(0);
  await expect(page.getByText("AI 学伴 · 下一步说明")).toBeVisible();
  await expect(page.getByText("AI 辅助尚未运行")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成 AI 说明" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);

  await page.goto("/student/courses");
  await expect(page.getByRole("heading", { name: "408 核心课程", exact: true })).toBeVisible();
  const courseDomain = page.getByRole("region", { name: "408 课程域" });
  await expect(courseDomain).toBeVisible();
  await expect(courseDomain.getByRole("article")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "四门课，一条学习主线" })).toBeVisible();
  await expect(page.getByText("PostgreSQL 真实课程与题量")).toBeVisible();
  await expect(page.getByRole("link", { name: "进入课程" })).toHaveCount(4);

  await page.getByRole("link", { name: "进入课程" }).first().click();
  await expect(page).toHaveURL(/\/student\/courses\/data-structures$/);
  await expect(page.getByRole("heading", { name: "数据结构", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "课程知识地图" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本节学习目标" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);

  await page.goto("/student/ask");
  await expect(page).toHaveURL(/\/student\/courses$/u);
  await expect(page.getByRole("heading", { name: "408 核心课程", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BFS 联调助手", exact: true })).toHaveCount(0);

  await page.goto("/student/evidence");
  await expect(page).toHaveURL(/\/student\/profile$/u);
  await expect(page.getByRole("heading", { name: "我的学习", exact: true })).toBeVisible();
  await expect(page.getByText(/依据当前课程的确定性学习记录生成，不是 AI 诊断/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test("keeps source material contextual to courses instead of exposing a standalone student library", async ({ page }) => {
  await page.goto("/student/home");
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await expect(navigation.getByRole("link", { name: "资料库" })).toHaveCount(0);

  await page.goto("/student/materials");
  await expect(page).toHaveURL(/\/student\/courses$/u);
  await expect(page.getByRole("heading", { name: "408 核心课程", exact: true })).toBeVisible();

  await page.goto("/student/materials?source=textbook");
  await expect(page).toHaveURL(/\/student\/courses\/data-structures$/u);
  await expect(page.getByRole("heading", { name: "数据结构", exact: true })).toBeVisible();
});

test("admissions failure degrades independently from the current learning task", async ({ page }) => {
  await page.route("**/api/v1/student/admissions/target", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        contract_version: "0.1",
        request_id: "req_e2e_admissions_unavailable",
        error: {
          code: "ADMISSIONS_UNAVAILABLE",
          message: "院校信息暂时无法读取，当前学习任务仍可继续。",
          retryable: true,
          details: {},
        },
      }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/student/home");

  const admissions = page.getByRole("region", { name: "目标院校", exact: true });
  await expect(admissions.getByRole("alert")).toContainText("院校信息暂时无法读取");
  await expect(page.getByRole("region", { name: "当前学习任务", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "开始本关", exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);

  await page.screenshot({
    path: "output/playwright/personalized-home/admissions-failure-1280.png",
    fullPage: true,
  });
});

test("personalized home captures the fixed target and target picker at acceptance widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/student/home");

  const admissions = page.getByRole("region", { name: "目标院校", exact: true });
  await expect(admissions.getByRole("heading", { name: "已固定目标" })).toBeVisible();
  await expect(admissions.getByText("中国科学技术大学")).toBeVisible();
  await expect(page.getByRole("region", { name: "当前学习任务", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "我的 408 路线", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "最近 7 天学习反馈", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "开始本关", exact: true })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({
    path: "output/playwright/profile-driven-challenge-home/home-1440.png",
    fullPage: true,
  });

  await page.locator(".home-recommendation-disclosure > summary").click();
  await expect(page.locator(".home-recommendation-disclosure")).toHaveAttribute("open", "");
  await page.screenshot({
    path: "output/playwright/profile-driven-challenge-home/home-reason-expanded-1440.png",
    fullPage: true,
  });

  await admissions.getByRole("button", { name: "调整目标" }).click();
  await expect(admissions.getByRole("combobox", { name: "院校或专业" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({
    path: "output/playwright/personalized-home/target-picker-1440.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(admissions.getByRole("heading", { name: "已固定目标" })).toBeVisible();
  await expect(page.getByRole("region", { name: "当前学习任务", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({
    path: "output/playwright/profile-driven-challenge-home/home-1280.png",
    fullPage: true,
  });
});

test("personal learning routes practice through a reliable course or concept entry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/student/evidence");
  await expect(page).toHaveURL(/\/student\/profile$/u);
  await expect(page.getByRole("heading", { name: "我的学习", exact: true })).toBeVisible();

  const targetedPracticeLink = page.getByRole("link", { name: "练习薄弱知识点" });
  const usesTargetedPractice = await targetedPracticeLink.count() > 0;
  const coursePracticeLink = usesTargetedPractice
    ? targetedPracticeLink
    : page.getByRole("link", { name: "进入课程综合训练" }).first();
  await expect(coursePracticeLink).toBeVisible();
  await coursePracticeLink.click();

  await expect(page.getByRole("heading", { name: "数据结构课程训练", exact: true })).toBeVisible();
  const destination = new URL(page.url());
  expect(destination.searchParams.get("subject")).toBe("数据结构");
  expect(destination.searchParams.has("concept_id")).toBe(usesTargetedPractice);
  await expect(page.getByRole("heading", { name: "该知识点暂无可靠关联题目" })).toHaveCount(0);
  await page.screenshot({
    path: "output/playwright/personal-learning-center/practice-route-1440.png",
    fullPage: true,
  });
});

test("student compares formal submissions and restores a snapshot", async ({ page }) => {
  await page.goto("/student/tasks/task_bfs_bug_001");
  await page.getByRole("button", { name: "当前错误代码" }).click();
  await page.getByRole("button", { name: "提交评测" }).click();
  await expect(page.getByRole("heading", { name: "客观评测证据" })).toBeVisible();

  await page.getByRole("button", { name: "已修复代码" }).click();
  await page.getByRole("button", { name: "提交评测" }).click();
  await expect(page.getByText("4 / 4")).toBeVisible();

  await page.getByRole("button", { name: "提交记录" }).click();
  await expect(page.getByRole("heading", { name: "提交记录" })).toBeVisible();
  await expect(page.getByText("新增 2")).toBeVisible();
  await expect(page.getByText("删除 1")).toBeVisible();
  await expect(page.getByText("修改 0")).toBeVisible();
  await expect(page.locator(".code-diff-cell.added").filter({ hasText: "visited[next] = true;" }))
    .toBeVisible();
  await expect(page.locator(".code-diff-cell.removed").filter({ hasText: "#include" }))
    .toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  await page.screenshot({
    path: "e2e/artifacts/submission-history-desktop-1440x900.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "恢复目标版本到编辑器" }).click();
  await expect(page.getByRole("textbox", { name: "BFS 代码" })).toHaveValue(
    /visited\[next\] = true;/,
  );
  await expect(page.getByText(/已载入版本 \d+，尚未产生新提交/)).toBeVisible();
});

test("current student modules render as coherent learning surfaces", async ({ page }) => {
  const modules = [
    { path: "/student/home", heading: null, artifact: "task-home" },
    { path: "/student/courses", heading: "408 核心课程", artifact: "course-overview" },
    { path: "/student/courses/data-structures", heading: "数据结构", artifact: "course-map" },
    { path: "/student/practice?subject=数据结构", heading: "数据结构课程训练", artifact: "practice" },
    { path: "/student/mistakes", heading: "错题本", artifact: "mistakes" },
    { path: "/student/profile", heading: "我的学习", artifact: "personal-learning" },
  ];

  for (const module of modules) {
    await page.goto(module.path);
    if (module.heading === null) {
      const currentTask = page.getByRole("region", { name: "当前学习任务", exact: true });
      await expect(currentTask.getByRole("heading", { level: 1 })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: module.heading, exact: true })).toBeVisible();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: `e2e/artifacts/${module.artifact}-desktop-1440x900.png`,
      fullPage: true,
    });
  }
});

test("3D virtual experiments are reachable from primary navigation and expose the three 408 courses", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/student/home");

  const programmingExperimentsLink = page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "实验中心" });
  await expect(programmingExperimentsLink).toHaveCount(1);
  await expect(programmingExperimentsLink).toHaveAttribute(
    "href",
    "/student/programming-experiments",
  );

  await page.goto("/student/programming-experiments");
  await expect(page).toHaveURL(/\/student\/programming-experiments$/u);
  await expect(page.getByRole("heading", { name: "三门核心课程 · 3D 仿真中心", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "CO 计算机组成原理" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "OS 操作系统" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "CN 计算机网络" })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({
    path: "output/playwright/programming-experiments/hub-1440.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "OS 操作系统" }).click();
  await expect(page.getByRole("heading", { name: "进程调度与内存分页", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始仿真" }).click();
  await expect(page.getByRole("button", { name: "暂停仿真" })).toBeVisible();
  await page.getByRole("button", { name: "暂停仿真" }).click();
  await expect(page.getByRole("button", { name: "开始仿真" })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/student/programming-experiments");
  await expect(page.getByRole("heading", { name: "三门核心课程 · 3D 仿真中心", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({
    path: "output/playwright/programming-experiments/hub-1280.png",
    fullPage: true,
  });
});

for (const viewport of [
  { width: 1440, height: 900, label: "desktop" },
  { width: 1366, height: 768, label: "standard" },
  { width: 1600, height: 900, label: "wide" },
]) {
  test(`visual layout remains usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/student/home");
    await expect(page.getByRole("region", { name: "目标院校", exact: true })).toBeVisible();
    const currentTask = page.getByRole("region", { name: "当前学习任务", exact: true });
    await expect(currentTask).toBeVisible();
    await expect(currentTask.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "开始本关", exact: true })).toHaveCount(1);
    const recommendation = page.locator(".home-recommendation-disclosure");
    await recommendation.locator("summary").click();
    await expect(page.getByRole("region", { name: "任务判断依据", exact: true })).toBeVisible();
    await expect(recommendation.getByRole("heading", { name: "7 日学习路径" })).toHaveCount(0);
    await expect(page.getByText("AI 学伴 · 下一步说明")).toBeVisible();
    await expect(page.getByText("AI 辅助尚未运行")).toBeVisible();
    await expect(page.getByRole("button", { name: "生成 AI 说明" })).toBeVisible();

    const homeOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(homeOverflow).toBe(false);
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    await page.screenshot({
      path: `e2e/artifacts/home-${viewport.label}-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });

    await page.goto("/student/courses");
    await expect(page.getByRole("heading", { name: "408 核心课程", exact: true })).toBeVisible();
    const courseDomain = page.getByRole("region", { name: "408 课程域" });
    await expect(courseDomain.getByRole("article")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "进入课程" })).toHaveCount(4);
    const coursesOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(coursesOverflow).toBe(false);
    await page.screenshot({
      path: `e2e/artifacts/courses-${viewport.label}-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });

    await page.goto("/student/tasks/task_bfs_bug_001");
    await expect(page.getByRole("heading", { name: "修复 BFS 重复入队问题" })).toBeVisible();
    const workbenchOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(workbenchOverflow).toBe(false);
    await page.screenshot({
      path: `e2e/artifacts/workbench-${viewport.label}-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  });
}
