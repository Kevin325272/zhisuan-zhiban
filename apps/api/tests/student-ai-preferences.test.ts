import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STUDENT_AI_PREFERENCES } from "@xuetu/contracts";
import { registerStudentAiPreferencesRoutes } from "../src/routes/student-ai-preferences.js";
import { buildApp } from "../src/app.js";
import type { LocalAuthenticationService } from "../src/services/auth/authentication.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";
import type { StudentProfileWorkflowService } from "../src/services/profile-workflow/student-profile-workflow-service.js";
import { PostgresStudentAiPreferences } from "../src/services/student-ai-preferences.js";
import type { SqlQueryablePool } from "../src/database/client.js";

const headers = { cookie: "xuetu_session=student" };
const authentication = { resolveSession: async (token: string) => ["student", "teacher"].includes(token) ? { account: { user_id: token, roles: [token], must_change_password: false } } : null } as unknown as LocalAuthenticationService;
const platformAccess = { getActor: async (id: string) => ({ user: { user_id: id }, roles: ["student"] }), isCourseAssigned: async () => true } as unknown as PlatformAccessService;
const store = () => ({ get: vi.fn().mockResolvedValue(DEFAULT_STUDENT_AI_PREFERENCES), update: vi.fn().mockResolvedValue({ ...DEFAULT_STUDENT_AI_PREFERENCES, collaboration_enabled: false }) });

describe("student AI preferences", () => {
  it("requires a student session for reads and updates", async () => {
    const app = Fastify(); const preferences = store();
    registerStudentAiPreferencesRoutes(app, preferences, { authentication, allowLocalDevAuth: false });
    for (const token of [undefined, "invalid", "teacher"]) {
      for (const method of ["GET", "PATCH"] as const) {
        const result = await app.inject({ method, url: "/api/v1/student/ai-preferences", headers: token ? { cookie: `xuetu_session=${token}` } : {}, ...(method === "PATCH" ? { payload: { collaboration_enabled: false } } : {}) });
        expect(result.statusCode).toBe(token === "teacher" ? 403 : 401);
      }
    }
    expect(preferences.get).not.toHaveBeenCalled(); expect(preferences.update).not.toHaveBeenCalled(); await app.close();
  });
  it("updates only the session owner and rejects forged or empty input", async () => {
    const app = Fastify(); const preferences = store();
    registerStudentAiPreferencesRoutes(app, preferences, { authentication, allowLocalDevAuth: false });
    await app.inject({ url: "/api/v1/student/ai-preferences", headers });
    expect(preferences.get).toHaveBeenCalledWith("student");
    for (const payload of [{}, { collaboration_enabled: "false" }, { collaboration_enabled: false, user_id: "other" }]) {
      expect((await app.inject({ method: "PATCH", url: "/api/v1/student/ai-preferences", headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: "/api/v1/student/ai-preferences?user_id=other", headers })).statusCode).toBe(400);
    expect(preferences.update).not.toHaveBeenCalled();
    expect((await app.inject({ method: "PATCH", url: "/api/v1/student/ai-preferences", headers, payload: { collaboration_enabled: false } })).statusCode).toBe(200);
    expect(preferences.update).toHaveBeenCalledWith("student", { collaboration_enabled: false }); await app.close();
  });
  it("returns a retryable failure when persistence fails", async () => {
    const app = Fastify(); const preferences = store(); preferences.update.mockRejectedValue(new Error("offline"));
    registerStudentAiPreferencesRoutes(app, preferences, { authentication, allowLocalDevAuth: false });
    const result = await app.inject({ method: "PATCH", url: "/api/v1/student/ai-preferences", headers, payload: { visual_explanations_enabled: false } });
    expect(result.statusCode).toBe(503); expect(result.json().error.retryable).toBe(true); await app.close();
  });
  it("blocks all five AI capabilities and profile generation before context or model work", async () => {
    const preferences = store(); preferences.get.mockResolvedValue({ ...DEFAULT_STUDENT_AI_PREFERENCES, collaboration_enabled: false });
    const build = vi.fn(); const run = vi.fn(); const generate = vi.fn();
    const app = buildApp({ authentication, platformAccess, studentAiPreferences: preferences, workflowContext: { build }, aiWorkflowGateway: { status: vi.fn(), run }, studentProfileWorkflow: { generate } as unknown as StudentProfileWorkflowService });
    for (const capability of ["plan", "explain", "coach", "diagnose", "care"]) {
      const result = await app.inject({ method: "POST", url: `/api/v1/student/ai-workflows/${capability}`, headers, payload: { contract_version: "0.2", capability, course_id: "course_408_co", concept_id: ["explain", "coach"].includes(capability) ? "co_c01_01" : null, qa_id: capability === "coach" ? "qa_1" : null, attempt_id: capability === "diagnose" ? "attempt_1" : null, user_message: capability === "care" ? "今天学得有点慢" : null, ...(capability === "care" ? { conversation_id: "care_1" } : {}) } });
      expect(result.json().error?.code).toBe("AI_COLLABORATION_DISABLED"); expect(result.statusCode).toBe(409);
    }
    const result = await app.inject({ method: "POST", url: "/api/v1/student/profile/ai", headers, payload: { course_id: "course_408_co" } });
    expect(result.statusCode).toBe(409); expect(build).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
    await app.close();
  });
  it("keeps the local care safety response available with collaboration off", async () => {
    const preferences = store(); preferences.get.mockResolvedValue({ ...DEFAULT_STUDENT_AI_PREFERENCES, collaboration_enabled: false });
    const run = vi.fn(); const build = vi.fn();
    const app = buildApp({ authentication, platformAccess, studentAiPreferences: preferences, workflowContext: { build }, aiWorkflowGateway: { status: vi.fn(), run } });
    const result = await app.inject({ method: "POST", url: "/api/v1/student/ai-workflows/care", headers, payload: { contract_version: "0.2", capability: "care", course_id: "course_408_co", concept_id: null, qa_id: null, attempt_id: null, conversation_id: "care_1", user_message: "我想自杀" } });
    expect(result.statusCode).toBe(200); expect(result.json().data.display_blocks[0].title).toBe("先确保你的安全"); expect(build).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); await app.close();
  });
  it("preserves false values and unspecified fields in a single SQL upsert", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ collaboration_enabled: false, visual_explanations_enabled: true, updated_at: new Date("2026-09-09T00:00:00Z") }] });
    const preferences = new PostgresStudentAiPreferences({ query } as unknown as SqlQueryablePool);
    const result = await preferences.update("student", { collaboration_enabled: false });
    expect(result.collaboration_enabled).toBe(false); expect(query.mock.calls[0]![1]).toEqual(["student", false, null]);
    expect(query.mock.calls[0]![0]).toContain("COALESCE($3::boolean, student_ai_preferences.visual_explanations_enabled)");
  });
});
