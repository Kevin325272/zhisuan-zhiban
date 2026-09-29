import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { buildAiWorkflowContractMock } from "../scripts/ai-workflow-mock-server.js";
import {
  buildAiWorkflowConformanceFixtures,
  runAiWorkflowConformance,
} from "../scripts/ai-workflow-conformance.js";

const runningApps: Array<ReturnType<typeof buildAiWorkflowContractMock>> = [];

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.close()));
});

async function startMock(secret = "contract-mock-secret") {
  const app = buildAiWorkflowContractMock(secret);
  runningApps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("AI workflow contract conformance kit", () => {
  it("validates auth, idempotency, all four endpoints and 0.2 response schemas", async () => {
    const baseUrl = await startMock();

    const report = await runAiWorkflowConformance({
      baseUrl,
      secret: "contract-mock-secret",
    });

    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(4);
    expect(report.results.map((item) => item.capability)).toEqual([
      "plan",
      "explain",
      "coach",
      "diagnose",
    ]);
    expect(report.results.every((item) => item.ok)).toBe(true);
  });

  it("reports authentication failures without exposing the secret", async () => {
    const baseUrl = await startMock();

    const report = await runAiWorkflowConformance({
      baseUrl,
      secret: "wrong-secret",
    });

    expect(report.ok).toBe(false);
    expect(report.results.every((item) => item.ok === false)).toBe(true);
    expect(JSON.stringify(report)).not.toContain("wrong-secret");
    expect(JSON.stringify(report)).not.toContain("contract-mock-secret");
  });

  it("provides source-owned fixtures for every capability", () => {
    const fixtures = buildAiWorkflowConformanceFixtures();

    expect(fixtures).toHaveLength(4);
    expect(fixtures.find((item) => item.capability === "explain")?.source_chunk_ids)
      .toEqual(["co_k_1"]);
    expect(fixtures.find((item) => item.capability === "coach")?.context.qa_case?.qa_id)
      .toBe("co_q_1");
    expect(fixtures.find((item) => item.capability === "diagnose")?.context.attempt?.attempt_id)
      .toBe("attempt_contract_001");
  });
});
