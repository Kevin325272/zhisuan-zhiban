export interface BfsGraphNode {
  id: number;
  x: number;
  y: number;
}

export interface BfsGraphEdge {
  from: number;
  to: number;
}

export interface BfsGraph {
  id: string;
  label: string;
  nodes: readonly BfsGraphNode[];
  edges: readonly BfsGraphEdge[];
}

export interface BfsTraceStep {
  index: number;
  title: string;
  currentNode: number | null;
  queue: number[];
  visited: number[];
  discovered: number[];
  highlightedEdge: [number, number] | null;
  pseudoLine: number;
  queueEvent: string;
  explanation: string;
  edgeChecks: number;
  queuePeak: number;
}

export const BFS_GRAPH_PRESETS: readonly BfsGraph[] = [
  {
    id: "diamond-seven",
    label: "七节点菱形图",
    nodes: [
      { id: 1, x: 50, y: 12 },
      { id: 2, x: 25, y: 40 },
      { id: 3, x: 73, y: 40 },
      { id: 4, x: 10, y: 76 },
      { id: 5, x: 39, y: 76 },
      { id: 6, x: 68, y: 76 },
      { id: 7, x: 91, y: 76 },
    ],
    edges: [
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 2, to: 4 },
      { from: 2, to: 5 },
      { from: 3, to: 5 },
      { from: 3, to: 6 },
      { from: 6, to: 7 },
    ],
  },
] as const;

function edgeKey(from: number, to: number) {
  return `${Math.min(from, to)}:${Math.max(from, to)}`;
}

function neighborsFor(graph: BfsGraph) {
  const adjacency = new Map<number, number[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);

  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to) || edge.from === edge.to) continue;
    const fromNeighbors = adjacency.get(edge.from)!;
    const toNeighbors = adjacency.get(edge.to)!;
    if (!fromNeighbors.includes(edge.to)) fromNeighbors.push(edge.to);
    if (!toNeighbors.includes(edge.from)) toNeighbors.push(edge.from);
  }

  return adjacency;
}

export function buildBfsTrace(graph: BfsGraph, startNode: number): BfsTraceStep[] {
  if (!graph.nodes.some((node) => node.id === startNode)) {
    throw new Error("起点节点不存在");
  }

  const adjacency = neighborsFor(graph);
  const discovered = new Set<number>([startNode]);
  const queue = [startNode];
  const visited: number[] = [];
  const steps: BfsTraceStep[] = [];
  let edgeChecks = 0;
  let queuePeak = queue.length;

  const addStep = (step: Omit<BfsTraceStep, "index" | "queuePeak">) => {
    queuePeak = Math.max(queuePeak, step.queue.length);
    steps.push({
      ...step,
      index: steps.length,
      queue: [...step.queue],
      visited: [...step.visited],
      discovered: [...step.discovered],
      highlightedEdge: step.highlightedEdge ? [...step.highlightedEdge] as [number, number] : null,
      queuePeak,
    });
  };

  addStep({
    title: "初始化起点",
    currentNode: null,
    queue,
    visited,
    discovered: [...discovered],
    highlightedEdge: null,
    pseudoLine: 0,
    queueEvent: `节点 ${startNode} 入队`,
    explanation: "从起点开始，先标记为已发现，再加入队列，避免同一节点重复入队。",
    edgeChecks,
  });

  while (queue.length > 0) {
    const currentNode = queue.shift()!;
    addStep({
      title: `取出节点 ${currentNode}`,
      currentNode,
      queue,
      visited,
      discovered: [...discovered],
      highlightedEdge: null,
      pseudoLine: 1,
      queueEvent: `节点 ${currentNode} 出队`,
      explanation: "队列遵循先进先出，先处理较早发现的节点，保证按层推进。",
      edgeChecks,
    });

    for (const neighbor of adjacency.get(currentNode) ?? []) {
      edgeChecks += 1;
      const highlightedEdge: [number, number] = [currentNode, neighbor];
      if (discovered.has(neighbor)) {
        addStep({
          title: `跳过节点 ${neighbor}`,
          currentNode,
          queue,
          visited,
          discovered: [...discovered],
          highlightedEdge,
          pseudoLine: 3,
          queueEvent: `检查 ${currentNode} → ${neighbor}：已发现`,
          explanation: `节点 ${neighbor} 已经在发现时标记，本次只检查边，不再重复入队。`,
          edgeChecks,
        });
        continue;
      }

      discovered.add(neighbor);
      queue.push(neighbor);
      addStep({
        title: `发现节点 ${neighbor}`,
        currentNode,
        queue,
        visited,
        discovered: [...discovered],
        highlightedEdge,
        pseudoLine: 4,
        queueEvent: `节点 ${neighbor} 入队`,
        explanation: `首次发现节点 ${neighbor}，立即标记并放到队尾，后续按层处理。`,
        edgeChecks,
      });
    }

    visited.push(currentNode);
    addStep({
      title: `完成节点 ${currentNode}`,
      currentNode: null,
      queue,
      visited,
      discovered: [...discovered],
      highlightedEdge: null,
      pseudoLine: 2,
      queueEvent: `节点 ${currentNode} 处理完成`,
      explanation: "当前节点的邻接点检查结束，访问顺序记录后继续处理队首。",
      edgeChecks,
    });
  }

  addStep({
    title: "遍历完成",
    currentNode: null,
    queue,
    visited,
    discovered: [...discovered],
    highlightedEdge: null,
    pseudoLine: 0,
    queueEvent: "队列为空",
    explanation: `从节点 ${startNode} 出发的连通分量已经全部访问，队列中没有待处理节点。`,
    edgeChecks,
  });

  return steps;
}

export function edgeIsHighlighted(step: BfsTraceStep, from: number, to: number) {
  if (!step.highlightedEdge) return false;
  return edgeKey(...step.highlightedEdge) === edgeKey(from, to);
}
