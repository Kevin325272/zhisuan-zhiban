import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("pilot study database commands", () => {
  it("exposes a dedicated seed command without running it from broad setup", () => {
    const apiPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const rootPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), "../../package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const cliSource = readFileSync(resolve(process.cwd(), "src/database/cli.ts"), "utf8");

    expect(apiPackage.scripts["db:seed:pilot-study"]).toContain("seed-pilot-study");
    expect(rootPackage.scripts["db:seed:pilot-study"]).toContain("@xuetu/api");
    expect(cliSource).toContain('"seed-pilot-study"');
    expect(cliSource).toContain("await seedPilotStudy(sqlPool)");
    const pilotCondition = cliSource.match(/if \(command === "seed-pilot-study"[\s\S]*?\n    \}/u)?.[0] ?? "";
    expect(pilotCondition).not.toContain('|| command === "setup"');
  });
});
