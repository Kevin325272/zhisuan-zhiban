import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const configUrl = new URL("../src/config/past-exams.ts", import.meta.url);
const configPath = fileURLToPath(configUrl);

describe("past-exam exposure config", () => {
  it("has a dedicated server-only configuration module", () => {
    expect(existsSync(configPath)).toBe(true);
  });

  it("defaults local-demo past exams off and accepts an explicit true", async () => {
    if (!existsSync(configPath)) return;
    const { readPastExamConfig } = await import(configUrl.href);
    expect(readPastExamConfig({})).toEqual({ allowLocalDemoPastExams: false });
    expect(readPastExamConfig({ XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS: " true " })).toEqual({
      allowLocalDemoPastExams: true,
    });
  });

  it("rejects misspelled boolean values instead of silently exposing local-demo data", async () => {
    if (!existsSync(configPath)) return;
    const { readPastExamConfig } = await import(configUrl.href);
    expect(() => readPastExamConfig({
      XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS: "yes",
    })).toThrow("XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS must be true or false");
  });

  it("does not make the switch available to browser code", () => {
    const webEnvironment = readFileSync(
      fileURLToPath(new URL("../../web/src/api/client.ts", import.meta.url)),
      "utf8",
    );
    expect(webEnvironment).not.toContain("XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS");
  });
});
