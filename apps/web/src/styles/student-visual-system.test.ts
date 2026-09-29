import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve(process.cwd(), "src/styles/student-visual-tokens.css"), "utf8");
const shell = readFileSync(resolve(process.cwd(), "src/styles/student-app-shell.css"), "utf8");
const homeOrchestrator = readFileSync(resolve(process.cwd(), "src/features/home/home-orchestrator.css"), "utf8");
const professional = readFileSync(resolve(process.cwd(), "src/styles/professional.css"), "utf8");
const reliableLearningLoop = readFileSync(resolve(process.cwd(), "src/styles/reliable-learning-loop.css"), "utf8");
const community = readFileSync(resolve(process.cwd(), "src/features/community/community.css"), "utf8");
const pagesPath = resolve(process.cwd(), "src/styles/student-visual-pages.css");
const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const primaryPageSources = [
  "features/home/home-page.tsx",
  "features/course/courses-page.tsx",
  "features/course/data-structures-page.tsx",
  "features/course/operating-systems-page.tsx",
  "features/course/computer-networks-page.tsx",
  "features/course/computer-organization-page.tsx",
  "features/practice/practice-page.tsx",
  "features/mistakes/mistakes-page.tsx",
  "features/profile/personal-learning-page.tsx",
].map((file) => readFileSync(resolve(process.cwd(), `src/${file}`), "utf8"));
const activeStudentCopySources = [
  "features/course/courses-page.tsx",
  "features/course/course-video-library-page.tsx",
  "features/course/course-video-resources.tsx",
  "features/course/data-structures-page.tsx",
  "features/course/computer-organization-page.tsx",
  "features/course/operating-systems-page.tsx",
  "features/course/computer-networks-page.tsx",
  "features/profile/personal-learning-page.tsx",
  "features/practice/photo-tutor-page.tsx",
  "features/programming-experiment/programming-experiment-page.tsx",
].map((file) => readFileSync(resolve(process.cwd(), `src/${file}`), "utf8"));

describe("student visual system", () => {
  it("locks the approved deck palette and shared font roles", () => {
    expect(tokens).toContain("--xuetu-canvas: #f7f8f5");
    expect(tokens).toContain("--xuetu-surface: #ffffff");
    expect(tokens).toContain("--xuetu-highlight: #e9efe9");
    expect(tokens).toContain("--xuetu-ink: #03182e");
    expect(tokens).toContain("--xuetu-action: #14544c");
    expect(tokens).toContain("--xuetu-font-editorial");
    expect(tokens).toContain("--xuetu-font-interface");
    expect(tokens).not.toMatch(/@import\s+url|Anthropic Serif/iu);
  });

  it("defines a visible focus ring and reduced-motion behavior", () => {
    expect(tokens).toContain("--xuetu-focus-ring");
    expect(tokens).toContain("@media (prefers-reduced-motion: reduce)");
    expect(shell).toContain("data-visual-system=\"ochre-serif\"");
    expect(shell).toContain("box-shadow: var(--xuetu-focus-ring)");
  });

  it("maps every primary student surface onto the same shared tokens", () => {
    expect(existsSync(pagesPath)).toBe(true);
    if (!existsSync(pagesPath)) return;
    const pages = readFileSync(pagesPath, "utf8");

    for (const selector of [
      ".login-entry-page",
      ".student-onboarding-page",
      ".learning-orchestrator-page",
      ".courses-overview-page",
      ".course-study-page",
      ".question-practice-center",
      ".mistakes-page",
      ".personal-learning-page",
    ]) {
      expect(pages).toContain(selector);
    }
    expect(pages).toContain("var(--xuetu-font-editorial)");
    expect(pages).toContain("var(--xuetu-highlight)");
    expect(pages).toContain("var(--xuetu-action)");
    expect(pages).not.toMatch(/#c8(?:ed58|f04a)|neon|linear-gradient/iu);
  });

  it("loads the page layer after the shared student shell styles", () => {
    expect(main).toContain('import "./styles/student-visual-pages.css";');
    const pageLayerIndex = main.indexOf('import "./styles/student-visual-pages.css";');
    expect(pageLayerIndex).toBeGreaterThan(main.indexOf('import "./styles/student-app-shell.css";'));
    expect(pageLayerIndex).toBeGreaterThan(main.indexOf('import "./features/course/courses-overview.css";'));
  });

  it("keeps shared shell chrome independent from home page styles", () => {
    for (const selector of [
      ".app-shell:has(.learning-orchestrator-page) :is(.topbar, .sidebar)",
      ".app-shell:has(.learning-orchestrator-page) .topbar",
      ".app-shell:has(.learning-orchestrator-page) .sidebar",
      ".app-shell:has(.learning-orchestrator-page) .brand-mark",
      ".app-shell:has(.learning-orchestrator-page) .topbar-workspace-context",
      ".app-shell:has(.learning-orchestrator-page) .profile-summary-copy",
      ".app-shell:has(.learning-orchestrator-page) .nav-section-label",
      ".app-shell:has(.learning-orchestrator-page) .nav-link",
      ".app-shell:has(.learning-orchestrator-page) .sidebar-collapse-button",
    ]) {
      expect(homeOrchestrator).not.toContain(selector);
    }
  });

  it("keeps past-exam row actions clear of the fixed learning-manager trigger", () => {
    expect(reliableLearningLoop).toMatch(
      /\.past-exam-library\s*\{[^}]*padding-right:\s*64px;/u,
    );
  });

  it("reserves a forum edge rail for the fixed learning-manager trigger on compact desktop", () => {
    expect(community).toMatch(
      /@media \(max-width:\s*1320px\)\s*\{[\s\S]*?\.community-page\s*\{[^}]*padding-right:\s*64px;/u,
    );
  });

  it("keeps the learning-manager trigger in the same viewport corner on every student page", () => {
    expect(professional).toMatch(
      /\.study-agent-trigger,\s*\.study-agent-dock\s*\{[^}]*position:\s*fixed;[^}]*right:\s*24px;/u,
    );
    expect(professional).toMatch(
      /\.study-agent-trigger\s*\{[^}]*bottom:\s*72px;/u,
    );
    expect(professional).not.toMatch(
      /\.app-shell:has\(\.learning-orchestrator-page\)\s+\.study-agent-trigger[^{]*\{[^}]*bottom\s*:/u,
    );
  });

  it("declares the shared visual system on every primary student page", () => {
    for (const source of primaryPageSources) {
      expect(source).toContain('data-visual-system="ochre-serif"');
    }
  });

  it("does not expose template-like English eyebrow labels on active student pages", () => {
    const source = activeStudentCopySources.join("\n");
    for (const label of [
      "408 COURSE DOMAIN",
      "408 VIDEO SOURCE INDEX",
      "EXTERNAL VIDEO",
      "COURSE KNOWLEDGE MAP",
      "CONCEPT FIGURE",
      "FIGURE GUIDE",
      "READING NOTES",
      "COURSE TRAINING",
      "MY LEARNING",
      "LEARNING PROFILE",
      "COURSE PROFILE",
      "NEXT ACTION",
      "FOCUS CONCEPT",
      "REVIEW QUEUE",
      "408 · PERSONAL QUESTION",
      "01 / IMAGE",
      "02 / VERIFY",
      "03 / EXPLAIN",
      "STEP 01",
      "STEP 02",
      "DATA STRUCTURES · PROGRAMMING LAB",
      "SUBMISSION HISTORY",
    ]) {
      expect(source).not.toContain(label);
    }
  });
});
