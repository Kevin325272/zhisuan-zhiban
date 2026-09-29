import { defineConfig, devices } from "@playwright/test";

function readPort(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1024 and 65535.`);
  }
  return port;
}

const apiPort = readPort("PLAYWRIGHT_API_PORT", 3101);
const webPort = readPort("PLAYWRIGHT_WEB_PORT", 5174);
const externalQuestionFixturePort = readPort("PHOTO_TUTOR_FIXTURE_PORT", 8327);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const externalQuestionFixtureOrigin = `http://127.0.0.1:${externalQuestionFixturePort}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: "node external-question-ai-fixture.mjs",
      env: { PORT: String(externalQuestionFixturePort) },
      url: `${externalQuestionFixtureOrigin}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @xuetu/api start",
      // Keep repository E2E deterministic and offline. The real Dify endpoint
      // is exercised separately by the local demo smoke; E2E owns the honest
      // unavailable fallback and must not depend on a tunnel or secret.
      env: {
        PORT: String(apiPort),
        EVALUATOR_MODE: "mock",
        XUETU_STATE_FILE: "off",
        AI_WORKFLOW_PROVIDER: "xuetu",
        AI_WORKFLOW_BASE_URL: "",
        AI_WORKFLOW_SECRET: "",
        AI_PROFILE_WORKFLOW_BASE_URL: "",
        AI_PROFILE_WORKFLOW_SECRET: "",
        // Browser acceptance covers the public learner entry. Controlled
        // school deployments are enforced separately by API and component tests.
        XUETU_STUDENT_REGISTRATION_MODE: "self_service",
        XUETU_DEMO_COURSE_IDS: "course_408_ds,course_408_co,course_408_os,course_408_cn",
        // Legacy BFS workbench regressions opt in explicitly. The runtime
        // server default and student navigation keep this surface disabled.
        XUETU_ENABLE_LEGACY_AGENT_ROUTES: "true",
        XUETU_ENABLE_LEGACY_DEMO_ROUTES: "true",
        // The suite intentionally visits the same AI slot many times. Keep
        // production's default per-user limit, but avoid test-order coupling.
        AI_REQUEST_MAX_REQUESTS: "1000",
        AI_REQUEST_MAX_CONCURRENT: "20",
        // Only the external model boundary is deterministic in E2E. The API,
        // PostgreSQL, private media and permissions remain production paths.
        LLM_BASE_URL: `${externalQuestionFixtureOrigin}/v1`,
        LLM_API_KEY: "e2e-local-fixture",
        LLM_MODEL: "gpt-5.6-terra",
        LLM_TIMEOUT_MS: "10000",
      },
      url: `${apiOrigin}/api/v1/system-status`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @xuetu/web exec vite --host 127.0.0.1 --port ${webPort}`,
      env: { API_PROXY_TARGET: apiOrigin },
      url: `${webOrigin}/student/home`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
