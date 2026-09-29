import { describe, expect, it } from "vitest";

import { readProfileWorkflowConfig } from "../src/config/profile-workflow.js";

describe("profile workflow configuration", () => {
  it("is disabled when both server-only values are absent", () => {
    expect(readProfileWorkflowConfig({})).toBeNull();
  });

  it("requires both an HTTPS endpoint and a server-only secret", () => {
    expect(() => readProfileWorkflowConfig({ AI_PROFILE_WORKFLOW_BASE_URL: "https://workflow.example.test/v1/workflows/run" }))
      .toThrow(/必须同时配置/u);
    expect(() => readProfileWorkflowConfig({ AI_PROFILE_WORKFLOW_SECRET: "server-secret" }))
      .toThrow(/必须同时配置/u);
    expect(readProfileWorkflowConfig({
      AI_PROFILE_WORKFLOW_BASE_URL: "https://workflow.example.test/v1/workflows/run/",
      AI_PROFILE_WORKFLOW_SECRET: "server-secret",
    })).toMatchObject({
      baseUrl: "https://workflow.example.test/v1/workflows/run",
      timeoutMs: 20_000,
    });
  });

  it("does not allow credentials embedded in the endpoint", () => {
    expect(() => readProfileWorkflowConfig({
      AI_PROFILE_WORKFLOW_BASE_URL: "https://user:pass@workflow.example.test/run",
      AI_PROFILE_WORKFLOW_SECRET: "server-secret",
    })).toThrow(/认证信息/u);
  });
});
