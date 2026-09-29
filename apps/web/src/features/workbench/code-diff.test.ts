import { describe, expect, it } from "vitest";

import { buildCodeDiff } from "./code-diff";

describe("buildCodeDiff", () => {
  it("keeps identical lines aligned", () => {
    const result = buildCodeDiff("first\nsecond", "first\nsecond");

    expect(result.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 2 });
    expect(result.rows).toEqual([
      {
        left: { lineNumber: 1, content: "first", kind: "unchanged" },
        right: { lineNumber: 1, content: "first", kind: "unchanged" },
      },
      {
        left: { lineNumber: 2, content: "second", kind: "unchanged" },
        right: { lineNumber: 2, content: "second", kind: "unchanged" },
      },
    ]);
  });

  it("pairs a removed and added line as one modification", () => {
    const result = buildCodeDiff("alpha\nold value\nomega", "alpha\nnew value\nomega");

    expect(result.summary).toEqual({ added: 0, removed: 0, modified: 1, unchanged: 2 });
    expect(result.rows[1]).toEqual({
      left: { lineNumber: 2, content: "old value", kind: "modified" },
      right: { lineNumber: 2, content: "new value", kind: "modified" },
    });
  });

  it("shows the BFS visited fix as two additions and one removal", () => {
    const before = `pending.push(start);

while (!pending.empty()) {
  visited[current] = true;
  if (!visited[next]) {
    pending.push(next);
  }
}`;
    const after = `pending.push(start);
visited[start] = true;

while (!pending.empty()) {
  if (!visited[next]) {
    visited[next] = true;
    pending.push(next);
  }
}`;
    const result = buildCodeDiff(before, after);

    expect(result.summary).toEqual({ added: 2, removed: 1, modified: 0, unchanged: 7 });
    expect(result.rows).toEqual(
      expect.arrayContaining([
        {
          left: null,
          right: { lineNumber: 2, content: "visited[start] = true;", kind: "added" },
        },
        {
          left: { lineNumber: 4, content: "  visited[current] = true;", kind: "removed" },
          right: null,
        },
        {
          left: null,
          right: { lineNumber: 6, content: "    visited[next] = true;", kind: "added" },
        },
      ]),
    );
  });
});
