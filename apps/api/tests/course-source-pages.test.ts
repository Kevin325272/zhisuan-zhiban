import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalCourseSourcePages } from "../src/services/course-content/course-source-pages.js";

describe("source-page archive", () => {
  let root: string;
  const id = "012345abcdef-p128";
  const bytes = Buffer.from("test-page");
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xuetu-source-pages-"));
    await mkdir(join(root, "processed/data-structures"), { recursive: true });
    await writeFile(join(root, `processed/data-structures/${id}.webp`), bytes);
    await writeFile(join(root, "manifest.json"), JSON.stringify({ schema_version: 1, courses: {
      "data-structures": { title: "数据结构", chunks: { ds_k0114: id }, pages: {
        [id]: { page_id: id, print_page: 114, physical_page: 128, width: 1488, height: 2200,
          file: `processed/data-structures/${id}.webp`, sha256: createHash("sha256").update(bytes).digest("hex") },
      } },
    } }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it("maps the imported chunk to the printed page rather than equating PDF and printed pages", async () => {
    const pages = new LocalCourseSourcePages(root);
    expect(await pages.describe("data-structures", "ds_k0114")).toMatchObject({ print_page: 114, physical_page: 128 });
    expect(await pages.open("data-structures", id)).toEqual(bytes);
    expect(await pages.describe("operating-systems", "ds_k0114")).toBeNull();
    expect(await pages.open("operating-systems", id)).toBeNull();
  });
  it("never opens paths supplied as page IDs and rejects a tampered page", async () => {
    const pages = new LocalCourseSourcePages(root);
    expect(await pages.open("data-structures", "../manifest.json")).toBeNull();
    await writeFile(join(root, `processed/data-structures/${id}.webp`), "changed");
    await expect(pages.open("data-structures", id)).rejects.toThrow("integrity");
  });
  it("rejects an archive entry pointing outside the source-page directory", async () => {
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    manifest.courses["data-structures"].pages[id].file = "../private.txt";
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await expect(new LocalCourseSourcePages(root).open("data-structures", id)).rejects.toThrow("path");
  });
});
