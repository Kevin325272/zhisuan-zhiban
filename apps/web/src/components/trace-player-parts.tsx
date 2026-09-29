import type {
  AlgorithmTrace,
  AlgorithmTraceStep,
  ProgrammingLanguage,
} from "@xuetu/contracts";
import {
  AlertTriangle,
  CircleDot,
  ListStart,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { countQueueEntries } from "./trace-player-model";
import { SyntaxHighlightedCode } from "./syntax-highlighted-code";

type NodeState = "current" | "new" | "queued" | "visited" | "idle";

const nodeStateLabels: Record<NodeState, string> = {
  current: "当前处理",
  new: "本步入队",
  queued: "等待处理",
  visited: "已经发现",
  idle: "尚未发现",
};

function graphNodeState(step: AlgorithmTraceStep, nodeId: string): NodeState {
  if (step.current_node_id === nodeId) return "current";
  if (step.newly_enqueued.includes(nodeId)) return "new";
  if (step.queue.includes(nodeId)) return "queued";
  if (step.visited.includes(nodeId)) return "visited";
  return "idle";
}

export function TraceExecutionSummary({ step }: { step: AlgorithmTraceStep }) {
  const queueCounts = countQueueEntries(step.queue);
  const hasDuplicate = Object.values(queueCounts).some((count) => count > 1);

  return (
    <dl aria-label="执行摘要" className="trace-execution-summary">
      <div className={step.conflict ? "conflict" : undefined}>
        <dt>
          {step.conflict ? <AlertTriangle aria-hidden="true" size={14} /> : <CircleDot aria-hidden="true" size={14} />}
          当前事件
        </dt>
        <dd>{step.action}</dd>
      </div>
      <div aria-label="当前节点">
        <dt>当前节点</dt>
        <dd>{step.current_node_id ?? "未进入循环"}</dd>
      </div>
      <div>
        <dt>Queue</dt>
        <dd>
          {step.queue.length} 项
          {hasDuplicate ? <small>含重复</small> : null}
        </dd>
      </div>
      <div>
        <dt>Visited</dt>
        <dd>{step.visited.length} 个节点</dd>
      </div>
    </dl>
  );
}

interface TraceCodePaneProps {
  fileName: string;
  language: ProgrammingLanguage;
  sourceCode: string;
  step: AlgorithmTraceStep;
  compact?: boolean;
}

export function TraceCodePane({
  fileName,
  language,
  sourceCode,
  step,
  compact = false,
}: TraceCodePaneProps) {
  const lines = useMemo(() => sourceCode.split("\n"), [sourceCode]);
  const paneRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (compact) return;
    const pane = paneRef.current;
    const activeLine = activeLineRef.current;
    if (!pane || !activeLine || pane.clientHeight === 0) return;

    const lineTop = activeLine.offsetTop;
    const lineBottom = lineTop + activeLine.offsetHeight;
    const viewportTop = pane.scrollTop;
    const viewportBottom = viewportTop + pane.clientHeight;
    if (lineTop >= viewportTop && lineBottom <= viewportBottom) return;

    pane.scrollTo?.({
      behavior: "smooth",
      top: Math.max(0, lineTop - (pane.clientHeight - activeLine.offsetHeight) / 2),
    });
  }, [compact, step.code_line]);

  const visibleLines = compact
    ? lines
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ lineNumber }) => Math.abs(lineNumber - step.code_line) <= 1)
    : lines.map((line, index) => ({ line, lineNumber: index + 1 }));

  return (
    <div
      aria-label="同步代码"
      className={`trace-code-pane${compact ? " compact" : ""}`}
      ref={paneRef}
    >
      <div className="trace-pane-title">
        <span>{fileName}</span>
        <small>第 {step.code_line} 行</small>
      </div>
      <ol>
        {visibleLines.map(({ line, lineNumber }) => {
          const active = lineNumber === step.code_line;
          return (
            <li
              className={active ? `active${step.conflict ? " conflict" : ""}` : undefined}
              key={`${lineNumber}-${line}`}
              ref={active ? activeLineRef : undefined}
            >
              <span>{lineNumber}</span>
              <SyntaxHighlightedCode code={line || " "} language={language} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TraceValueList({
  values,
  queueCounts,
  newlyEnqueued,
}: {
  values: string[];
  queueCounts?: Record<string, number>;
  newlyEnqueued?: string[];
}) {
  if (values.length === 0) return <em>空</em>;

  return values.map((nodeId, index) => {
    const duplicateCount = queueCounts?.[nodeId] ?? 1;
    const classNames = [
      duplicateCount > 1 ? "duplicate" : "",
      newlyEnqueued?.includes(nodeId) ? "new" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <b
        aria-label={
          duplicateCount > 1
            ? `队列项 ${nodeId}，共出现 ${duplicateCount} 次`
            : `状态项 ${nodeId}`
        }
        className={classNames || undefined}
        key={`${nodeId}-${index}`}
      >
        {nodeId}
      </b>
    );
  });
}

interface TraceGraphStageProps {
  trace: AlgorithmTrace;
  step: AlgorithmTraceStep;
  compact?: boolean;
  title?: string;
}

export function TraceGraphStage({
  trace,
  step,
  compact = false,
  title = "图状态",
}: TraceGraphStageProps) {
  const queueCounts = countQueueEntries(step.queue);

  return (
    <div className={`trace-visual-pane${compact ? " compact" : ""}`}>
      <div className="trace-pane-title">
        <span>{title}</span>
        <small>{step.conflict ? "检测到状态冲突" : "与当前代码行同步"}</small>
      </div>
      <div className="trace-graph-wrap">
        <svg aria-label="BFS 图状态" className="trace-graph" role="img" viewBox="0 0 100 100">
          <title>{`BFS 第 ${step.step_index + 1} 步：${step.action}`}</title>
          {trace.graph.edges.map((edge) => {
            const from = trace.graph.nodes.find((node) => node.node_id === edge.from_node_id);
            const to = trace.graph.nodes.find((node) => node.node_id === edge.to_node_id);
            if (!from || !to) return null;
            const active =
              step.current_node_id !== null &&
              ((edge.from_node_id === step.current_node_id &&
                step.newly_enqueued.includes(edge.to_node_id)) ||
                (edge.to_node_id === step.current_node_id &&
                  step.newly_enqueued.includes(edge.from_node_id)));
            return (
              <line
                className={active ? "trace-edge-active" : undefined}
                key={`${edge.from_node_id}-${edge.to_node_id}`}
                x1={from.position.x}
                x2={to.position.x}
                y1={from.position.y}
                y2={to.position.y}
              />
            );
          })}
          {trace.graph.nodes.map((node) => {
            const state = graphNodeState(step, node.node_id);
            const duplicateCount = queueCounts[node.node_id] ?? 0;
            return (
              <g
                aria-label={`节点 ${node.label}，${nodeStateLabels[state]}`}
                className={`trace-graph-node state-${state}`}
                key={node.node_id}
                role="group"
              >
                <circle cx={node.position.x} cy={node.position.y} r="7" />
                <text dominantBaseline="central" textAnchor="middle" x={node.position.x} y={node.position.y}>
                  {node.label}
                </text>
                {duplicateCount > 1 ? (
                  <g
                    aria-label={`节点 ${node.label} 在队列中出现 ${duplicateCount} 次`}
                    className="trace-node-duplicate-badge"
                    role="group"
                  >
                    <circle cx={node.position.x + 6} cy={node.position.y - 6} r="4" />
                    <text
                      dominantBaseline="central"
                      textAnchor="middle"
                      x={node.position.x + 6}
                      y={node.position.y - 6}
                    >
                      x{duplicateCount}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
        {!compact ? (
          <ul aria-label="节点状态图例" className="trace-graph-legend">
            {Object.entries(nodeStateLabels).map(([state, label]) => (
              <li key={state}>
                <i className={`state-${state}`} />
                {label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="trace-state-rows">
        <div aria-label="当前处理节点" className="trace-state-row">
          <span>Current</span>
          <div>
            {step.current_node_id ? <b>{step.current_node_id}</b> : <em>空</em>}
          </div>
        </div>
        <div aria-label="当前队列" className="trace-state-row">
          <span>Queue</span>
          <div>
            <TraceValueList
              newlyEnqueued={step.newly_enqueued}
              queueCounts={queueCounts}
              values={step.queue}
            />
          </div>
        </div>
        <div aria-label="已发现节点" className="trace-state-row">
          <span>Visited</span>
          <div>
            <TraceValueList values={step.visited} />
          </div>
        </div>
        <div aria-label="遍历输出" className="trace-state-row">
          <span>Output</span>
          <div>
            <TraceValueList values={step.output} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface TraceTimelineProps {
  trace: AlgorithmTrace;
  stepIndex: number;
  onSelectStep: (stepIndex: number) => void;
  maxSelectableIndex?: number;
}

export function TraceTimeline({
  trace,
  stepIndex,
  onSelectStep,
  maxSelectableIndex = Number.POSITIVE_INFINITY,
}: TraceTimelineProps) {
  return (
    <ol aria-label="执行步骤时间轴" className="trace-timeline">
      {trace.steps.map((timelineStep) => {
        const current = timelineStep.step_index === stepIndex;
        const completed = timelineStep.step_index < stepIndex;
        return (
          <li key={timelineStep.step_index}>
            <button
              aria-current={current ? "step" : undefined}
              aria-label={`跳到第 ${timelineStep.step_index + 1} 步：${timelineStep.action}`}
              className={`${current ? "current " : ""}${completed ? "completed " : ""}${timelineStep.conflict ? "conflict" : ""}`.trim()}
              disabled={timelineStep.step_index > maxSelectableIndex}
              onClick={() => onSelectStep(timelineStep.step_index)}
              title={timelineStep.action}
              type="button"
            >
              {timelineStep.conflict ? <AlertTriangle aria-hidden="true" size={10} /> : null}
              <span>{timelineStep.step_index + 1}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

interface TracePlaybackControlsProps {
  stepIndex: number;
  maxStepIndex: number;
  playing: boolean;
  speed: number;
  onSelectStep: (stepIndex: number) => void;
  onTogglePlayback: () => void;
  onSpeedChange: (speed: number) => void;
  disableNext?: boolean;
  disablePlayback?: boolean;
}

export function TracePlaybackControls({
  stepIndex,
  maxStepIndex,
  playing,
  speed,
  onSelectStep,
  onTogglePlayback,
  onSpeedChange,
  disableNext = false,
  disablePlayback = false,
}: TracePlaybackControlsProps) {
  return (
    <footer className="trace-player-controls">
      <div className="trace-control-buttons">
        <button aria-label="回到起点" onClick={() => onSelectStep(0)} title="回到起点" type="button">
          <RotateCcw aria-hidden="true" size={15} />
        </button>
        <button aria-label="上一步" disabled={stepIndex === 0} onClick={() => onSelectStep(stepIndex - 1)} title="上一步" type="button">
          <SkipBack aria-hidden="true" size={15} />
        </button>
        <button
          aria-label={playing ? "暂停轨迹" : "播放轨迹"}
          className="trace-play-button"
          disabled={disablePlayback}
          onClick={onTogglePlayback}
          title={playing ? "暂停轨迹" : "播放轨迹"}
          type="button"
        >
          {playing ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
        </button>
        <button
          aria-label="下一步"
          disabled={disableNext || stepIndex >= maxStepIndex}
          onClick={() => onSelectStep(stepIndex + 1)}
          title="下一步"
          type="button"
        >
          <SkipForward aria-hidden="true" size={15} />
        </button>
      </div>

      <label className="trace-range-control">
        <span className="sr-only">轨迹步骤</span>
        <input
          aria-label="轨迹步骤"
          max={maxStepIndex}
          min={0}
          onChange={(event) => onSelectStep(Number(event.target.value))}
          step={1}
          type="range"
          value={stepIndex}
        />
      </label>

      <label className="trace-speed-control">
        <span>速度</span>
        <select aria-label="播放速度" name="trace-speed" onChange={(event) => onSpeedChange(Number(event.target.value))} value={speed}>
          <option value={0.75}>0.75x</option>
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
      </label>
    </footer>
  );
}

export function TraceMissingStep() {
  return (
    <div className="trace-missing-step" role="status">
      <ListStart aria-hidden="true" size={18} />
      <strong>无对应步骤</strong>
      <span>另一条轨迹在当前索引没有执行快照。</span>
    </div>
  );
}
