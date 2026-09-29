import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const serverSource = readFileSync(
  fileURLToPath(new URL("../src/server.ts", import.meta.url)),
  "utf8",
);
const e2eFixtureSource = readFileSync(
  fileURLToPath(new URL("../../../e2e/fixtures.ts", import.meta.url)),
  "utf8",
);
const e2eConfigSource = readFileSync(
  fileURLToPath(new URL("../../../e2e/playwright.config.ts", import.meta.url)),
  "utf8",
);
const webClientSource = readFileSync(
  fileURLToPath(new URL("../../web/src/api/client.ts", import.meta.url)),
  "utf8",
);

describe("real server dependency wiring", () => {
  it("registers the legacy in-memory BFS surface only with an explicit demo switch", async () => {
    const productionApp = buildApp({ answerModel: null });
    const demoApp = buildApp({
      answerModel: null,
      enableLegacyDemoRoutes: true,
    });

    try {
      for (const url of [
        "/api/v1/student/overview",
        "/api/v1/tasks/task_bfs_bug_001",
        "/api/v1/mistakes",
      ]) {
        expect((await productionApp.inject({ method: "GET", url })).statusCode).toBe(404);
        expect((await demoApp.inject({ method: "GET", url })).statusCode).toBe(200);
      }
    } finally {
      await productionApp.close();
      await demoApp.close();
    }
  });

  it("routes only the diagnose capability to the Dify workflow while other providers keep every capability on the primary gateway", () => {
    expect(serverSource).not.toContain("diagnoseDify");
    expect(serverSource).toMatch(
      /aiWorkflowConfig\?\.provider === "dify"[\s\S]*?new CapabilityRoutedAiWorkflowGateway\([\s\S]*?\{ diagnose: primaryAiWorkflowGateway \}[\s\S]*?: primaryAiWorkflowGateway/u,
    );
  });

  it("uses the server-only OpenAI-compatible model for profile interpretation when selected", () => {
    expect(serverSource).toContain("OpenAiCompatibleProfileWorkflowGateway");
    expect(serverSource).toMatch(
      /aiWorkflowConfig\?\.provider === "openai_compatible"[\s\S]*?new OpenAiCompatibleProfileWorkflowGateway/u,
    );
    expect(serverSource).toMatch(
      /aiWorkflowConfig\?\.provider === "openai_compatible"[\s\S]*?new UnavailableProfileWorkflowGateway\(\)/u,
    );
    expect(serverSource.match(/timeoutMs:\s*llmConfig\.timeoutMs/gu)).toHaveLength(3);
  });

  it("constructs photo tutoring from PostgreSQL, private storage and the selected relay", () => {
    expect(serverSource).toContain("readExternalQuestionConfig");
    expect(serverSource).toContain("PostgresExternalQuestionRepository");
    expect(serverSource).toContain("ExternalQuestionImageService");
    expect(serverSource).toContain("PostgresExternalQuestionConceptMatcher");
    expect(serverSource).toContain("OpenAiCompatibleExternalQuestionGateway");
    expect(serverSource).toContain("UnavailableExternalQuestionAiGateway");
    expect(serverSource).toMatch(
      /const externalQuestionGateway[\s\S]*?llmConfig[\s\S]*?new OpenAiCompatibleExternalQuestionGateway\([\s\S]*?baseUrl:\s*llmConfig\.baseUrl,[\s\S]*?apiKey:\s*llmConfig\.apiKey,[\s\S]*?model:\s*llmConfig\.model,[\s\S]*?circuitBreaker:\s*openAiCircuitBreaker/u,
    );
    expect(serverSource).toMatch(/buildApp\(\{[\s\S]*?externalQuestions,/u);
  });

  it("keeps local-demo past exams behind the server-only exposure switch", () => {
    expect(serverSource).toContain("readPastExamConfig");
    expect(serverSource).toMatch(
      /new PostgresQuestionBank\(databasePool, "course_408_001", \{[\s\S]*?allowLocalDemoPastExams:\s*pastExamConfig\.allowLocalDemoPastExams/u,
    );
  });

  it("runs bounded private-image cleanup without making startup depend on cleanup success", () => {
    expect(serverSource).toContain("runExternalQuestionCleanupBatch");
    expect(serverSource).toMatch(/try\s*\{[\s\S]*?await runExternalQuestionCleanupBatch\(/u);
    expect(serverSource).toMatch(/catch\s*\([^)]+\)\s*\{[\s\S]*?external_question_cleanup_startup_failed/u);
  });

  it("passes the mistake recommendation service to buildApp", () => {
    expect(serverSource).toMatch(/const mistakeRecommendation = new PostgresMistakeRecommendation\(databasePool\);/u);
    expect(serverSource).toMatch(/buildApp\(\{[\s\S]*?mistakeRecommendation,\s*[\s\S]*?\}\);/u);
  });

  it("wires the PostgreSQL learning probe into the production app", () => {
    expect(serverSource).toContain("PostgresLearningProbe");
    expect(serverSource).toMatch(
      /const learningProbeQuestionBanks = new Map\([\s\S]*?course_408_co[\s\S]*?new PostgresQuestionBank\(databasePool, courseId[\s\S]*?const learningProbes = new PostgresLearningProbe\(databasePool, questionBank, \{[\s\S]*?questionBankForCourse:/u,
    );
    expect(serverSource).toMatch(
      /buildApp\(\{[\s\S]*?mistakeRecommendation,[\s\S]*?learningProbes,/u,
    );
  });

  it("passes the constructed student care service to buildApp", () => {
    expect(serverSource).toMatch(
      /const studentCare = new DeterministicStudentCareService\([\s\S]*?\);/u,
    );
    expect(serverSource).toMatch(
      /buildApp\(\{[\s\S]*?learningOrchestration,\s*studentCare,\s*studentAdmissions,/u,
    );
  });

  it("constructs the PostgreSQL class enrollment workflow for the production app", () => {
    expect(serverSource).toContain("PostgresClassEnrollment");
    expect(serverSource).toMatch(
      /const classEnrollment = new PostgresClassEnrollment\(databasePool\);/u,
    );
    expect(serverSource).toMatch(
      /buildApp\(\{[\s\S]*?studentOnboarding,[\s\S]*?classEnrollment,/u,
    );
  });

  it("does not enable the development identity header from auth mode alone", () => {
    expect(serverSource).not.toContain(
      'allowLocalDevAuth: process.env.XUETU_AUTH_MODE === "local_dev"',
    );
    expect(serverSource).toMatch(
      /allowLocalDevAuth:\s*resolveLocalDevIdentityHeader\(\)/u,
    );
  });

  it("prunes stale sessions before constructing the authentication service", () => {
    expect(serverSource).toMatch(/const authRepository = new PostgresAuthRepository\(databasePool\);/u);
    expect(serverSource).toMatch(/await authRepository\.cleanupStaleSessions\(/u);
    expect(serverSource).toMatch(/new LocalAuthenticationService\(\s*authRepository,/u);
  });

  it("logs out every E2E session in a finally block even after cookie changes", () => {
    expect(e2eFixtureSource).toMatch(/try\s*\{\s*await use\(page\);\s*\}\s*finally\s*\{/u);
    expect(e2eFixtureSource).toContain("/api/v1/auth/logout");
    expect(e2eFixtureSource).toMatch(/headers:\s*\{\s*cookie:/u);
    expect(e2eFixtureSource).toMatch(
      /export async function establishAdminSession[\s\S]*?await logoutCurrentSession\(page\)/u,
    );
    expect(e2eFixtureSource).toMatch(/page\.request\.post\("\/api\/v1\/auth\/logout",\s*\{\s*data:\s*\{\},/u);
  });

  it("does not contain a literal NUL byte in the browser API client source", () => {
    expect(webClientSource).not.toContain("\u0000");
  });

  it("keeps both AI workflow providers unavailable in deterministic E2E", () => {
    expect(e2eConfigSource).toMatch(/AI_WORKFLOW_BASE_URL:\s*""/u);
    expect(e2eConfigSource).toMatch(/AI_WORKFLOW_SECRET:\s*""/u);
    expect(e2eConfigSource).toMatch(/AI_PROFILE_WORKFLOW_BASE_URL:\s*""/u);
    expect(e2eConfigSource).toMatch(/AI_PROFILE_WORKFLOW_SECRET:\s*""/u);
  });

  it("allows E2E services to move to explicit alternate local ports", () => {
    expect(e2eConfigSource).toContain("PLAYWRIGHT_API_PORT");
    expect(e2eConfigSource).toContain("PLAYWRIGHT_WEB_PORT");
    expect(e2eConfigSource).toContain("const apiOrigin");
    expect(e2eConfigSource).toContain("const webOrigin");
  });
});
