import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ADMISSIONS_NORMALIZED_SHA256,
  loadAdmissionsSource,
} from "../src/services/admissions/admissions-source.js";

const sourceRoot = fileURLToPath(
  new URL("../../../data/admissions/retest-lines/", import.meta.url),
);

describe("admissions source adapter", () => {
  it("verifies the workbook and normalized JSON hashes before loading", () => {
    const source = loadAdmissionsSource(sourceRoot);
    const workbook = readFileSync(`${sourceRoot}/raw/院校复试信息.xlsx`);
    const normalized = readFileSync(`${sourceRoot}/processed/retest-lines.normalized.json`);

    expect(createHash("sha256").update(workbook).digest("hex"))
      .toBe("365f5d9bf5fc1059bc635b1847af4afbe92248e777fdb4f782810cdcd141eaf8");
    expect(createHash("sha256").update(normalized).digest("hex"))
      .toBe(ADMISSIONS_NORMALIZED_SHA256);
    expect(source.manifest.usage_scope).toBe("local_demo_only");
    expect(source.manifest.training_allowed).toBe(false);
  });

  it("imports only answer-independent national 408 targets and preserves source lines", () => {
    const source = loadAdmissionsSource(sourceRoot);

    expect(source.allRecordCount).toBe(3374);
    expect(source.lines).toHaveLength(2058);
    expect(source.targets).toHaveLength(1431);
    expect(source.lines.every((line) => line.exam_category === "统考408")).toBe(true);
    expect(source.lines.every((line) => line.retest_source_url.startsWith("http"))).toBe(true);
    expect(source.targets.every((target) => target.target_id.startsWith("admission_target_")))
      .toBe(true);
  });

  it("uses the five-field course target key and keeps it stable across repeated loads", () => {
    const first = loadAdmissionsSource(sourceRoot);
    const second = loadAdmissionsSource(sourceRoot);
    const uniqueKeys = new Set(first.targets.map((target) => [
      target.school,
      target.training_unit,
      target.program_code,
      target.program_name,
      target.study_mode,
    ].join("\u001f")));

    expect(uniqueKeys.size).toBe(first.targets.length);
    expect(second.targets.map((target) => target.target_id))
      .toEqual(first.targets.map((target) => target.target_id));
    expect(second.lines.map((line) => line.target_id))
      .toEqual(first.lines.map((line) => line.target_id));
  });
});
