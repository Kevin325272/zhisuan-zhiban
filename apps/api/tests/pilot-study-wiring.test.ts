import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync(
  fileURLToPath(new URL("../src/server.ts", import.meta.url)),
  "utf8",
);
const appSource = readFileSync(
  fileURLToPath(new URL("../src/app.ts", import.meta.url)),
  "utf8",
);

describe("pilot study server wiring", () => {
  it("constructs one PostgreSQL pilot service and passes it into buildApp", () => {
    expect(serverSource).toContain("PostgresPilotStudy");
    expect(serverSource).toMatch(/const pilotStudy = new PostgresPilotStudy\(databasePool,\s*\{\s*choiceEvaluator: questionBank\s*\}\);/u);
    expect(serverSource).toMatch(/buildApp\(\{[\s\S]*?pilotStudy,/u);
  });

  it("registers pilot routes only when the service is available", () => {
    expect(appSource).toContain("pilotStudy?: PilotStudyService | null");
    expect(appSource).toMatch(/if \(options\.pilotStudy\) \{[\s\S]*?registerPilotStudyRoutes/u);
  });
});
