import type {
  AlgorithmTrace,
  ProgrammingLanguage,
  TraceVariant,
} from "@xuetu/contracts";

import { getProgrammingLanguageDefinition } from "../domain/programming-languages.js";

const graph: AlgorithmTrace["graph"] = {
  nodes: [
    { node_id: "1", label: "1", position: { x: 12, y: 42 } },
    { node_id: "2", label: "2", position: { x: 40, y: 58 } },
    { node_id: "3", label: "3", position: { x: 68, y: 27 } },
    { node_id: "4", label: "4", position: { x: 69, y: 78 } },
    { node_id: "5", label: "5", position: { x: 91, y: 52 } },
  ],
  edges: [
    { from_node_id: "1", to_node_id: "2" },
    { from_node_id: "1", to_node_id: "3" },
    { from_node_id: "2", to_node_id: "3" },
    { from_node_id: "2", to_node_id: "4" },
    { from_node_id: "3", to_node_id: "5" },
  ],
};

const sourceIds = ["source_ds_book_143"];

function queuePrediction(
  question: string,
  options: string[][],
  correctOptionIndex: number,
  explanation: string,
): NonNullable<AlgorithmTrace["steps"][number]["prediction"]> {
  return {
    question,
    options: options.map((queue, index) => ({
      option_id: `queue-option-${index + 1}`,
      label: queue.length > 0 ? `[${queue.join(", ")}]` : "空队列",
    })),
    correct_option_id: `queue-option-${correctOptionIndex + 1}`,
    explanation,
  };
}

const wrongSteps: AlgorithmTrace["steps"] = [
  {
    step_index: 0,
    code_line: 2,
    action: "起点 1 入队",
    explanation: "队列从起点开始，但错误代码尚未把起点标记为已访问。",
    guiding_question: "只要节点进入队列，它是否就已经被发现？",
    current_node_id: "1",
    queue: ["1"],
    visited: [],
    output: [],
    newly_enqueued: ["1"],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "节点 1 执行出队后，Queue 会变成什么？",
      [["1"], [], ["1", "2"]],
      1,
      "节点 1 位于队首，执行 pop 后队列暂时为空。",
    ),
  },
  {
    step_index: 1,
    code_line: 6,
    action: "节点 1 出队",
    explanation: "节点 1 成为当前节点，队列暂时为空。",
    guiding_question: "访问标记发生在出队后，会留下多长的未标记窗口？",
    current_node_id: "1",
    queue: [],
    visited: ["1"],
    output: ["1"],
    newly_enqueued: [],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "扫描节点 1 的邻接点后，Queue 会变成什么？",
      [["2"], ["2", "3"], ["3", "2"]],
      1,
      "节点 2、3 按邻接表顺序入队，但错误代码尚未标记它们。",
    ),
  },
  {
    step_index: 2,
    code_line: 11,
    action: "节点 2、3 入队",
    explanation: "节点 1 的两个邻接点进入队列，但仍要等到出队才会被标记。",
    guiding_question: "队列中的节点是否可能被另一条边再次发现？",
    current_node_id: "1",
    queue: ["2", "3"],
    visited: ["1"],
    output: ["1"],
    newly_enqueued: ["2", "3"],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "节点 2 从队首取出后，Queue 会变成什么？",
      [["3"], ["2", "3"], []],
      0,
      "节点 2 出队，尚未处理其邻接点，因此队列只剩节点 3。",
    ),
  },
  {
    step_index: 3,
    code_line: 6,
    action: "节点 2 出队",
    explanation: "节点 2 出队并标记访问，节点 3 仍在队列中但尚未标记。",
    guiding_question: "此时 visited[3] 的值能反映节点 3 已经在队列中吗？",
    current_node_id: "2",
    queue: ["3"],
    visited: ["1", "2"],
    output: ["1", "2"],
    newly_enqueued: [],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "扫描节点 2 的邻接点后，Queue 会变成什么？",
      [["3", "4"], ["3", "3", "4"], ["3", "4", "3"]],
      1,
      "节点 3 已在队列中却仍未标记，于是再次入队；节点 4 也随之入队。",
    ),
  },
  {
    step_index: 4,
    code_line: 11,
    action: "节点 3 重复入队",
    explanation: "节点 3 已在队列中，但 visited[3] 仍为 false，因此从节点 2 再次入队。",
    guiding_question: "如果在第一次入队时标记 visited[3]，本次判断会怎样？",
    current_node_id: "2",
    queue: ["3", "3", "4"],
    visited: ["1", "2"],
    output: ["1", "2"],
    newly_enqueued: ["3", "4"],
    source_ids: sourceIds,
    conflict: {
      code: "BFS_DUPLICATE_ENQUEUE",
      message: "节点 3 已在队列中但仍未标记访问，产生重复入队。",
    },
    prediction: queuePrediction(
      "第一个节点 3 出队后，Queue 会变成什么？",
      [["3", "4"], ["4"], ["3", "3", "4"]],
      0,
      "队首的一个节点 3 被移除，重复的节点 3 仍留在队列中。",
    ),
  },
  {
    step_index: 5,
    code_line: 6,
    action: "重复节点 3 等待出队",
    explanation: "队列中已有两个节点 3，后续会造成重复访问和额外开销。",
    guiding_question: "这个错误是否会在邻接边更多的图中被放大？",
    current_node_id: "3",
    queue: ["3", "4"],
    visited: ["1", "2", "3"],
    output: ["1", "2", "3"],
    newly_enqueued: [],
    source_ids: sourceIds,
    conflict: {
      code: "BFS_DUPLICATE_ENQUEUE",
      message: "队列保留了重复节点，遍历序列不再满足每个顶点只入队一次。",
    },
    prediction: null,
  },
];

const fixedSteps: AlgorithmTrace["steps"] = [
  {
    step_index: 0,
    code_line: 3,
    action: "起点 1 入队并标记",
    explanation: "起点进入队列时立即标记为已访问。",
    guiding_question: "入队和标记绑定后，哪个状态代表节点已被发现？",
    current_node_id: "1",
    queue: ["1"],
    visited: ["1"],
    output: [],
    newly_enqueued: ["1"],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "节点 1 执行出队后，Queue 会变成什么？",
      [[], ["1"], ["1", "2"]],
      0,
      "节点 1 位于队首，执行 pop 后队列暂时为空。",
    ),
  },
  {
    step_index: 1,
    code_line: 7,
    action: "节点 1 出队",
    explanation: "节点 1 出队，访问标记保持不变。",
    guiding_question: "出队操作是否还需要重复修改 visited？",
    current_node_id: "1",
    queue: [],
    visited: ["1"],
    output: ["1"],
    newly_enqueued: [],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "扫描节点 1 的邻接点后，Queue 会变成什么？",
      [["3", "2"], ["2"], ["2", "3"]],
      2,
      "节点 2、3 按邻接表顺序入队，并在入队时立即标记。",
    ),
  },
  {
    step_index: 2,
    code_line: 12,
    action: "节点 2、3 入队并标记",
    explanation: "两个邻接点在进入队列的同一时刻被标记。",
    guiding_question: "另一条边再次遇到节点 3 时，判断结果是什么？",
    current_node_id: "1",
    queue: ["2", "3"],
    visited: ["1", "2", "3"],
    output: ["1"],
    newly_enqueued: ["2", "3"],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "节点 2 从队首取出后，Queue 会变成什么？",
      [[], ["3"], ["2", "3"]],
      1,
      "节点 2 出队后，已在队列中的节点 3 保持等待。",
    ),
  },
  {
    step_index: 3,
    code_line: 7,
    action: "节点 2 出队",
    explanation: "节点 3 虽仍在队列中，但 visited[3] 已经为 true。",
    guiding_question: "visited 现在是否同时承担了“已发现”和“已处理”的含义？",
    current_node_id: "2",
    queue: ["3"],
    visited: ["1", "2", "3"],
    output: ["1", "2"],
    newly_enqueued: [],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "扫描节点 2 的邻接点后，Queue 会变成什么？",
      [["3", "3", "4"], ["3", "4"], ["4"]],
      1,
      "节点 3 已标记而被跳过，只有新节点 4 入队。",
    ),
  },
  {
    step_index: 4,
    code_line: 12,
    action: "跳过节点 3，节点 4 入队",
    explanation: "节点 3 已标记，不会重复入队；只有新节点 4 进入队列。",
    guiding_question: "这一状态如何保证每个顶点最多入队一次？",
    current_node_id: "2",
    queue: ["3", "4"],
    visited: ["1", "2", "3", "4"],
    output: ["1", "2"],
    newly_enqueued: ["4"],
    source_ids: sourceIds,
    conflict: null,
    prediction: queuePrediction(
      "节点 3 出队并发现节点 5 后，Queue 会变成什么？",
      [["3", "4"], ["5", "4"], ["4", "5"]],
      2,
      "节点 3 出队，节点 4 留在队首，新发现的节点 5 加到队尾。",
    ),
  },
  {
    step_index: 5,
    code_line: 7,
    action: "节点 3 出队",
    explanation: "队列没有重复节点，遍历继续按层推进。",
    guiding_question: "当前队列顺序如何体现 BFS 的分层访问？",
    current_node_id: "3",
    queue: ["4", "5"],
    visited: ["1", "2", "3", "4", "5"],
    output: ["1", "2", "3"],
    newly_enqueued: ["5"],
    source_ids: sourceIds,
    conflict: null,
    prediction: null,
  },
];

function applySemanticLines(
  steps: AlgorithmTrace["steps"],
  lines: { start: number; dequeue: number; enqueue: number },
) {
  return steps.map((step, index) => ({
    ...step,
    code_line:
      index === 0
        ? lines.start
        : index === 1 || index === 3 || index === 5
          ? lines.dequeue
          : lines.enqueue,
  }));
}

interface CustomGraphDefinition {
  start: string;
  nodes: string[];
  edges: Array<{ from_node_id: string; to_node_id: string }>;
}

export class InvalidTraceGraphError extends Error {}

function parseCustomTraceGraph(input: string): CustomGraphDefinition {
  let start: string | null = null;
  const edges: CustomGraphDefinition["edges"] = [];
  const nodes = new Set<string>();

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const startMatch = /^start\s*=\s*(\d+)$/i.exec(line);
    if (startMatch) {
      start = startMatch[1]!;
      nodes.add(start);
      continue;
    }

    const parts = line.replace("->", " ").replace(",", " ").split(/\s+/);
    if (parts.length !== 2 || parts.some((part) => !/^\d+$/.test(part))) {
      throw new InvalidTraceGraphError(
        `自定义图第 ${index + 1} 行格式错误，请使用“起点 终点”，例如“1 2”。`,
      );
    }
    const [fromNodeId, toNodeId] = parts as [string, string];
    nodes.add(fromNodeId);
    nodes.add(toNodeId);
    edges.push({ from_node_id: fromNodeId, to_node_id: toNodeId });
  }

  if (edges.length === 0) {
    throw new InvalidTraceGraphError("自定义图至少需要一条边，例如“1 2”。");
  }
  if (nodes.size > 10 || edges.length > 24) {
    throw new InvalidTraceGraphError("轨迹演示最多支持 10 个节点和 24 条边，请缩小输入后重试。");
  }

  const sortedNodes = [...nodes].sort((left, right) => Number(left) - Number(right));
  return { start: start ?? edges[0]!.from_node_id, nodes: sortedNodes, edges };
}

function layoutCustomGraph(definition: CustomGraphDefinition): AlgorithmTrace["graph"] {
  const count = definition.nodes.length;
  return {
    nodes: definition.nodes.map((nodeId, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(count, 1);
      return {
        node_id: nodeId,
        label: nodeId,
        position: {
          x: Number((50 + Math.cos(angle) * 34).toFixed(2)),
          y: Number((50 + Math.sin(angle) * 34).toFixed(2)),
        },
      };
    }),
    edges: definition.edges,
  };
}

function createCustomTraceSteps(
  definition: CustomGraphDefinition,
  variant: TraceVariant,
  lines: { start: number; dequeue: number; enqueue: number },
): AlgorithmTrace["steps"] {
  const fixed = variant === "visited-on-enqueue";
  const adjacency = new Map<string, string[]>();
  for (const nodeId of definition.nodes) adjacency.set(nodeId, []);
  for (const edge of definition.edges) {
    adjacency.get(edge.from_node_id)?.push(edge.to_node_id);
  }

  const queue = [definition.start];
  const visited = new Set<string>(fixed ? [definition.start] : []);
  const output: string[] = [];
  const steps: AlgorithmTrace["steps"] = [
    {
      step_index: 0,
      code_line: lines.start,
      action: fixed
        ? `起点 ${definition.start} 入队并标记`
        : `起点 ${definition.start} 入队`,
      explanation: fixed
        ? "使用自定义图，并在起点进入队列时同步完成访问标记。"
        : "使用自定义图，错误版本暂未标记刚进入队列的起点。",
      guiding_question: "队列中的节点是否都应该已经处于“已发现”状态？",
      current_node_id: definition.start,
      queue: [...queue],
      visited: [...visited],
      output: [],
      newly_enqueued: [definition.start],
      source_ids: sourceIds,
      conflict: null,
      prediction: null,
    },
  ];

  let operations = 0;
  while (queue.length > 0 && operations < 80) {
    operations += 1;
    const current = queue.shift()!;
    if (!fixed) visited.add(current);
    output.push(current);
    steps.push({
      step_index: steps.length,
      code_line: lines.dequeue,
      action: `节点 ${current} 出队`,
      explanation: `当前处理节点 ${current}，随后检查它在自定义图中的出边。`,
      guiding_question: `此时 Queue 与 Visited 是否能区分节点 ${current} 的发现和处理状态？`,
      current_node_id: current,
      queue: [...queue],
      visited: [...visited],
      output: [...output],
      newly_enqueued: [],
      source_ids: sourceIds,
      conflict: output.slice(0, -1).includes(current)
        ? {
            code: "BFS_DUPLICATE_DEQUEUE",
            message: `节点 ${current} 已经处理过一次，当前为重复出队。`,
          }
        : null,
      prediction: null,
    });

    const newlyEnqueued: string[] = [];
    let duplicateNode: string | null = null;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      if (queue.includes(next)) duplicateNode ??= next;
      if (fixed) visited.add(next);
      queue.push(next);
      newlyEnqueued.push(next);
    }

    steps.push({
      step_index: steps.length,
      code_line: lines.enqueue,
      action: newlyEnqueued.length
        ? `扫描节点 ${current}，${newlyEnqueued.join("、")} 入队`
        : `扫描节点 ${current}，没有新节点入队`,
      explanation: duplicateNode
        ? `节点 ${duplicateNode} 已在队列中却仍未标记，因此再次入队。`
        : fixed
          ? "新发现节点在入队时同步标记，后续边不会让它重复入队。"
          : "本步未触发重复，但队列中的未标记窗口仍然存在。",
      guiding_question: duplicateNode
        ? `若节点 ${duplicateNode} 第一次入队时就被标记，本次是否还会进入队列？`
        : "下一条边遇到队列中的节点时，visited 能否阻止重复入队？",
      current_node_id: current,
      queue: [...queue],
      visited: [...visited],
      output: [...output],
      newly_enqueued: newlyEnqueued,
      source_ids: sourceIds,
      conflict: duplicateNode
        ? {
            code: "BFS_DUPLICATE_ENQUEUE",
            message: `节点 ${duplicateNode} 已在队列中但仍未标记访问，产生重复入队。`,
          }
        : null,
      prediction: null,
    });
  }

  return steps;
}

export function createBfsTrace(
  language: ProgrammingLanguage,
  variant: TraceVariant,
  customInput?: string,
): AlgorithmTrace {
  const definition = getProgrammingLanguageDefinition(language);
  const fixed = variant === "visited-on-enqueue";
  const semanticLines = fixed ? definition.trace_lines.fixed : definition.trace_lines.wrong;

  if (customInput?.trim()) {
    const customGraph = parseCustomTraceGraph(customInput);
    return {
      task_id: "task_bfs_bug_001",
      variant,
      language,
      file_name: definition.file_name,
      source_code: fixed ? definition.fixed_code : definition.starter_code,
      graph: layoutCustomGraph(customGraph),
      steps: createCustomTraceSteps(customGraph, variant, semanticLines),
    };
  }

  return {
    task_id: "task_bfs_bug_001",
    variant,
    language,
    file_name: definition.file_name,
    source_code: fixed ? definition.fixed_code : definition.starter_code,
    graph,
    steps: applySemanticLines(fixed ? fixedSteps : wrongSteps, semanticLines),
  };
}
