import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../scripts/learning-profile-integrity-smoke.ts", import.meta.url),
  "utf8",
);

describe("learning profile integrity smoke", () => {
  it("falls back to attributed deterministic evidence when no unattributed sample remains", () => {
    const candidateQuery = source.match(
      /const candidate = await pool\.query<CandidateRow>\(([\s\S]*?)\);\s+const userId/,
    )?.[1] ?? "";

    expect(candidateQuery).not.toContain("AND concept_id IS NULL");
    expect(candidateQuery).toMatch(
      /COUNT\(DISTINCT attempt_id\)\s+FILTER \(WHERE concept_id IS NULL\) DESC/u,
    );
  });
});
