import { ArrowLeft, ArrowRight, RotateCcw, ShieldCheck, Workflow } from "lucide-react";
import { useState } from "react";
import type { CSSProperties } from "react";

import type { LearningSession } from "./learning-session";

type NodeState = "undiscovered" | "queued" | "current" | "visited";

interface BfsStep {
  title: string;
  currentNode: number | null;
  queue: number[];
  visited: number[];
  pseudoLine: number;
  queueEvent: string;
  explanation: string;
}

const nodes = [
  { id: 1, x: 50, y: 12 },
  { id: 2, x: 25, y: 40 },
  { id: 3, x: 73, y: 40 },
  { id: 4, x: 10, y: 76 },
  { id: 5, x: 39, y: 76 },
  { id: 6, x: 68, y: 76 },
  { id: 7, x: 91, y: 76 },
] as const;

const edges = [
  [1, 2],
  [1, 3],
  [2, 4],
  [2, 5],
  [3, 5],
  [3, 6],
  [6, 7],
] as const;

const steps: BfsStep[] = [
  {
    title: "初始化起点",
    currentNode: null,
    queue: [1],
    visited: [],
    pseudoLine: 0,
    queueEvent: "节点 1 入队",
    explanation: "从起点 1 开始；发现节点时立即标记，保证它只进入 Queue 一次。",
  },
  {
    title: "取出节点 1",
    currentNode: 1,
    queue: [],
    visited: [],
    pseudoLine: 1,
    queueEvent: "1 出队 → Queue 暂时为空",
    explanation: "队首节点 1 出队，成为当前处理节点，下一步检查它的邻接点。",
  },
  {
    title: "发现节点 2 与 3",
    currentNode: null,
    queue: [2, 3],
    visited: [1],
    pseudoLine: 3,
    queueEvent: "2、3 依次入队",
    explanation: "节点 2、3 首次被发现，在入队这一刻写入 discovered，节点 1 处理完成。",
  },
  {
    title: "取出节点 2",
    currentNode: 2,
    queue: [3],
    visited: [1],
    pseudoLine: 1,
    queueEvent: "2 出队，3 移到队首",
    explanation: "BFS 始终从队首取节点，因此同一层的节点 2 会先于节点 3 展开。",
  },
  {
    title: "发现节点 4 与 5",
    currentNode: null,
    queue: [3, 4, 5],
    visited: [1, 2],
    pseudoLine: 4,
    queueEvent: "4、5 入队，排在 3 后面",
    explanation: "处理节点 2 时发现 4、5；二者入队同时被标记，后续不能再次入队。",
  },
  {
    title: "取出节点 3",
    currentNode: 3,
    queue: [4, 5],
    visited: [1, 2],
    pseudoLine: 2,
    queueEvent: "3 出队，准备检查 5、6",
    explanation: "节点 3 的邻接点包含 5 和 6。先检查 discovered，再决定是否入队。",
  },
  {
    title: "检查节点 3 的邻接点",
    currentNode: null,
    queue: [4, 5, 6],
    visited: [1, 2, 3],
    pseudoLine: 3,
    queueEvent: "跳过 5，仅将 6 入队",
    explanation: "节点 5 已在发现时标记，阻止重复入队；节点 6 首次发现，因此加入队尾。",
  },
];

const pseudoCode = [
  ["标记 1 为已发现并入队", "discovered[start] = true; enqueue(start)"],
  ["从队首取出当前节点", "u = queue.dequeue()"],
  ["逐个检查当前节点的邻接点", "for v in neighbors(u)"],
  ["只处理尚未发现的节点", "if not discovered[v]"],
  ["先标记，再加入队尾", "discovered[v] = true; enqueue(v)"],
] as const;

const stateLabels: Record<NodeState, string> = {
  undiscovered: "未发现",
  queued: "已入队",
  current: "当前处理",
  visited: "已访问",
};

function getNodeState(nodeId: number, step: BfsStep): NodeState {
  if (step.currentNode === nodeId) return "current";
  if (step.visited.includes(nodeId)) return "visited";
  if (step.queue.includes(nodeId)) return "queued";
  return "undiscovered";
}

export function BfsAlgorithmSurface({ session }: { session: LearningSession }) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex] ?? steps[0]!;

  return (
    <section aria-label="算法过程工作面" className="learning-surface bfs-learning-surface">
      <header className="learning-surface-head">
        <div className="learning-surface-title">
          <span aria-hidden="true"><Workflow size={17} /></span>
          <div>
            <small>算法步骤 · BFS</small>
            <strong>队列驱动的广度优先遍历</strong>
          </div>
        </div>
        <span className="learning-surface-mode">BFS 过程演练</span>
      </header>

      <div className="learning-surface-body bfs-surface-body">
        <div className="bfs-teaching-grid">
          <section aria-labelledby="bfs-graph-title" className="bfs-graph-panel">
            <header>
              <div>
                <small>图状态</small>
                <strong id="bfs-graph-title">当前图状态</strong>
              </div>
              <div className="bfs-state-legend" aria-label="节点状态图例">
                {(Object.keys(stateLabels) as NodeState[]).map((state) => (
                  <span data-state={state} key={state}><i />{stateLabels[state]}</span>
                ))}
              </div>
            </header>

            <div className="bfs-graph" role="img" aria-label="BFS 七节点图与当前状态">
              <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
                {edges.map(([from, to]) => {
                  const source = nodes.find((node) => node.id === from)!;
                  const target = nodes.find((node) => node.id === to)!;
                  return <line key={`${from}-${to}`} x1={source.x} x2={target.x} y1={source.y} y2={target.y} />;
                })}
              </svg>
              {nodes.map((node) => {
                const state = getNodeState(node.id, step);
                return (
                  <span
                    aria-label={`节点 ${node.id}：${stateLabels[state]}`}
                    className="bfs-graph-node"
                    data-state={state}
                    key={node.id}
                    style={{ "--node-x": `${node.x}%`, "--node-y": `${node.y}%` } as CSSProperties}
                  >
                    <b>{node.id}</b>
                    <small>{stateLabels[state]}</small>
                  </span>
                );
              })}
            </div>

            <div className="bfs-visit-order">
              <span>访问顺序</span>
              <strong>{step.visited.length ? step.visited.join(" → ") : "等待首个节点处理完成"}</strong>
            </div>
          </section>

          <aside aria-label="当前步骤与伪代码" className="bfs-step-panel">
            <header>
              <span>STEP {String(stepIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.explanation}</p>
            </header>

            <div className="bfs-key-rule">
              <ShieldCheck aria-hidden="true" size={16} />
              <div><strong>关键规则：发现即标记</strong><span>visited-on-enqueue 阻止同一节点重复入队</span></div>
            </div>

            <ol className="bfs-pseudocode" aria-label="BFS 伪代码">
              {pseudoCode.map(([label, code], index) => (
                <li data-active={step.pseudoLine === index ? "true" : "false"} key={label}>
                  <b>{index + 1}</b>
                  <div>
                    <span aria-current={step.pseudoLine === index ? "step" : undefined}>{label}</span>
                    <code>{code}</code>
                  </div>
                </li>
              ))}
            </ol>

            <div className="bfs-step-controls">
              <button disabled={stepIndex === 0} onClick={() => setStepIndex((current) => current - 1)} type="button">
                <ArrowLeft aria-hidden="true" size={14} /> 上一步
              </button>
              <button disabled={stepIndex === steps.length - 1} onClick={() => setStepIndex((current) => current + 1)} type="button">
                下一步 <ArrowRight aria-hidden="true" size={14} />
              </button>
              <button aria-label="重置演示" onClick={() => setStepIndex(0)} type="button">
                <RotateCcw aria-hidden="true" size={14} />
              </button>
            </div>
          </aside>

          <section aria-label="Queue 变化" className="bfs-queue-strip">
            <header>
              <div><small>队列变化</small><strong>Queue 变化</strong></div>
              <span>{step.queueEvent}</span>
            </header>
            <div className="bfs-queue-flow">
              <span className="bfs-queue-end is-head">队首</span>
              <div className="bfs-queue-slots">
                {step.queue.length ? step.queue.map((nodeId, index) => (
                  <b data-edge={index === 0 ? "head" : index === step.queue.length - 1 ? "tail" : "middle"} key={nodeId}>{nodeId}</b>
                )) : <em>空队列</em>}
              </div>
              <span className="bfs-queue-end is-tail">队尾</span>
            </div>
            <p><strong>为什么下一步这样做：</strong>{step.explanation}</p>
          </section>
        </div>
        <p className="surface-callout bfs-surface-callout">{session.task.summary}</p>
      </div>
    </section>
  );
}
