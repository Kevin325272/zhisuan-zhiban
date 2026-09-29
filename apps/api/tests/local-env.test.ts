import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadLocalEnvironment } from "../src/config/local-env.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "xuetu-env-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local API environment loader", () => {
  it("loads .env.local from an API package working directory", () => {
    const directory = temporaryDirectory();
    const envPath = join(directory, ".env.local");
    writeFileSync(envPath, "LLM_API_KEY=test\n", "utf8");
    const loader = vi.fn();

    expect(loadLocalEnvironment(directory, loader)).toBe(envPath);
    expect(loader).toHaveBeenCalledWith(envPath);
  });

  it("loads apps/api/.env.local from a workspace root", () => {
    const directory = temporaryDirectory();
    const apiDirectory = join(directory, "apps", "api");
    mkdirSync(apiDirectory, { recursive: true });
    const envPath = join(apiDirectory, ".env.local");
    writeFileSync(envPath, "LLM_API_KEY=test\n", "utf8");
    const loader = vi.fn();

    expect(loadLocalEnvironment(directory, loader)).toBe(envPath);
    expect(loader).toHaveBeenCalledWith(envPath);
  });

  it("does nothing when no local environment file exists", () => {
    const loader = vi.fn();

    expect(loadLocalEnvironment(temporaryDirectory(), loader)).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });
});
