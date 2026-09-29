export type CodeDiffKind = "unchanged" | "added" | "removed" | "modified";

export interface CodeDiffCell {
  lineNumber: number;
  content: string;
  kind: CodeDiffKind;
}

export interface CodeDiffRow {
  left: CodeDiffCell | null;
  right: CodeDiffCell | null;
}

export interface CodeDiffResult {
  rows: CodeDiffRow[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

type DiffOperation =
  | { type: "equal"; leftLine: number; rightLine: number; content: string }
  | { type: "delete"; leftLine: number; content: string }
  | { type: "insert"; rightLine: number; content: string };

export function buildCodeDiff(before: string, after: string): CodeDiffResult {
  const operations = buildOperations(splitSource(before), splitSource(after));
  const rows: CodeDiffRow[] = [];
  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  let index = 0;

  while (index < operations.length) {
    const operation = operations[index]!;
    if (operation.type === "equal") {
      rows.push({
        left: {
          lineNumber: operation.leftLine,
          content: operation.content,
          kind: "unchanged",
        },
        right: {
          lineNumber: operation.rightLine,
          content: operation.content,
          kind: "unchanged",
        },
      });
      summary.unchanged += 1;
      index += 1;
      continue;
    }

    const deleted: Extract<DiffOperation, { type: "delete" }>[] = [];
    const inserted: Extract<DiffOperation, { type: "insert" }>[] = [];
    while (index < operations.length && operations[index]!.type !== "equal") {
      const changed = operations[index]!;
      if (changed.type === "delete") deleted.push(changed);
      if (changed.type === "insert") inserted.push(changed);
      index += 1;
    }

    const pairedCount = Math.min(deleted.length, inserted.length);
    for (let pairIndex = 0; pairIndex < pairedCount; pairIndex += 1) {
      const left = deleted[pairIndex]!;
      const right = inserted[pairIndex]!;
      rows.push({
        left: { lineNumber: left.leftLine, content: left.content, kind: "modified" },
        right: { lineNumber: right.rightLine, content: right.content, kind: "modified" },
      });
      summary.modified += 1;
    }
    for (const left of deleted.slice(pairedCount)) {
      rows.push({
        left: { lineNumber: left.leftLine, content: left.content, kind: "removed" },
        right: null,
      });
      summary.removed += 1;
    }
    for (const right of inserted.slice(pairedCount)) {
      rows.push({
        left: null,
        right: { lineNumber: right.rightLine, content: right.content, kind: "added" },
      });
      summary.added += 1;
    }
  }

  return { rows, summary };
}

function splitSource(source: string) {
  if (!source) return [];
  return source.replaceAll("\r\n", "\n").split("\n");
}

function buildOperations(left: string[], right: string[]): DiffOperation[] {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      matrix[leftIndex]![rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? 1 + matrix[leftIndex + 1]![rightIndex + 1]!
          : Math.max(matrix[leftIndex + 1]![rightIndex]!, matrix[leftIndex]![rightIndex + 1]!);
    }
  }

  const operations: DiffOperation[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      operations.push({
        type: "equal",
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
        content: left[leftIndex]!,
      });
      leftIndex += 1;
      rightIndex += 1;
    } else if (matrix[leftIndex + 1]![rightIndex]! >= matrix[leftIndex]![rightIndex + 1]!) {
      operations.push({ type: "delete", leftLine: leftIndex + 1, content: left[leftIndex]! });
      leftIndex += 1;
    } else {
      operations.push({ type: "insert", rightLine: rightIndex + 1, content: right[rightIndex]! });
      rightIndex += 1;
    }
  }

  while (leftIndex < left.length) {
    operations.push({ type: "delete", leftLine: leftIndex + 1, content: left[leftIndex]! });
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    operations.push({ type: "insert", rightLine: rightIndex + 1, content: right[rightIndex]! });
    rightIndex += 1;
  }

  return operations;
}
