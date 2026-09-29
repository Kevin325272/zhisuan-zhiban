export interface BfsGraphCase {
  id: string;
  label: string;
  start: number;
  edges: Array<[number, number]>;
  input: string;
}

export const builtInBfsCases: readonly BfsGraphCase[] = [
  {
    id: "case_tree",
    label: "基础树形图",
    start: 1,
    edges: [
      [1, 2],
      [1, 3],
      [2, 4],
      [3, 5],
    ],
    input: "start=1\n1 2\n1 3\n2 4\n3 5",
  },
  {
    id: "case_diamond",
    label: "菱形汇聚图",
    start: 1,
    edges: [
      [1, 2],
      [1, 3],
      [2, 4],
      [3, 4],
    ],
    input: "start=1\n1 2\n1 3\n2 4\n3 4",
  },
  {
    id: "case_path",
    label: "单链路径图",
    start: 1,
    edges: [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ],
    input: "start=1\n1 2\n2 3\n3 4\n4 5",
  },
  {
    id: "case_multi_merge",
    label: "双汇聚图",
    start: 1,
    edges: [
      [1, 2],
      [1, 3],
      [2, 4],
      [2, 5],
      [3, 4],
      [3, 5],
    ],
    input: "start=1\n1 2\n1 3\n2 4\n2 5\n3 4\n3 5",
  },
];

export class InvalidCustomInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCustomInputError";
  }
}

export function parseCustomGraph(input: string): BfsGraphCase {
  let start: number | null = null;
  const edges: Array<[number, number]> = [];

  for (const [index, rawLine] of input.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const startMatch = /^start\s*=\s*(\d+)$/iu.exec(line);
    if (startMatch) {
      start = Number(startMatch[1]);
      continue;
    }

    const parts = line.replace("->", " ").replace(",", " ").split(/\s+/u);
    if (parts.length !== 2 || parts.some((part) => !/^\d+$/u.test(part))) {
      throw new InvalidCustomInputError(
        `自定义输入第 ${index + 1} 行格式错误，请使用“起点 终点”，例如“1 2”。`,
      );
    }
    const from = Number(parts[0]);
    const to = Number(parts[1]);
    if (from > 15 || to > 15) {
      throw new InvalidCustomInputError("当前 BFS 演示图的顶点编号必须在 0 到 15 之间。");
    }
    edges.push([from, to]);
  }

  if (edges.length === 0) {
    throw new InvalidCustomInputError("自定义输入至少需要一条边，例如“1 2”。");
  }

  return {
    id: "case_custom",
    label: "自定义图",
    start: start ?? edges[0]![0],
    edges,
    input: input.trim(),
  };
}

export function expectedOutputFor(graphCase: BfsGraphCase) {
  const adjacency = new Map<number, number[]>();
  for (const [from, to] of graphCase.edges) {
    const neighbors = adjacency.get(from) ?? [];
    neighbors.push(to);
    adjacency.set(from, neighbors);
  }

  const visited = new Set([graphCase.start]);
  const pending = [graphCase.start];
  const order: number[] = [];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    order.push(current);
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(next);
    }
  }
  return order.join(" ");
}

export function allNodesFor(graphCase: BfsGraphCase) {
  return [...new Set([graphCase.start, ...graphCase.edges.flat()])].sort((a, b) => a - b);
}
