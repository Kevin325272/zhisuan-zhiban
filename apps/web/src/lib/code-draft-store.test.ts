import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadCodeDrafts, saveCodeDraft } from "./code-draft-store";
import * as codeDraftStore from "./code-draft-store";

describe("code draft store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes a pending draft when the page is about to be hidden", () => {
    saveCodeDraft("task_bfs_bug_001", "cpp", "int main() { return 0; }");

    expect(window.localStorage.getItem("xuetu.code-drafts.v1")).toBeNull();

    window.dispatchEvent(new Event("pagehide"));

    expect(loadCodeDrafts("task_bfs_bug_001").cpp).toBe(
      "int main() { return 0; }",
    );
  });

  it("keeps browser drafts separate when the authenticated account changes", () => {
    const setOwner = (codeDraftStore as Record<string, unknown>).setCodeDraftOwner;
    expect(typeof setOwner).toBe("function");
    if (typeof setOwner !== "function") return;
    const selectOwner = setOwner as (userId: string | null) => void;

    selectOwner("student_a");
    saveCodeDraft("task_bfs_bug_001", "cpp", "// student A");
    window.dispatchEvent(new Event("pagehide"));

    selectOwner("student_b");
    expect(loadCodeDrafts("task_bfs_bug_001")).toEqual({});
    saveCodeDraft("task_bfs_bug_001", "cpp", "// student B");
    window.dispatchEvent(new Event("pagehide"));

    selectOwner("student_a");
    expect(loadCodeDrafts("task_bfs_bug_001").cpp).toBe("// student A");
    selectOwner("student_b");
    expect(loadCodeDrafts("task_bfs_bug_001").cpp).toBe("// student B");
  });

  afterAll(() => {
    expect(vi.isFakeTimers()).toBe(false);
  });
});
