import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Gauge, GitBranch, Pause, Play, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BFS_GRAPH_PRESETS, buildBfsTrace, edgeIsHighlighted, type BfsTraceStep } from "./bfs-simulation";
import { listSimulationProgress, saveSimulationProgress, type SimulationProgressRecord } from "./simulation-progress-store";

interface Props {
  experimentId: string;
  title: string;
  learningObjective: string;
  onSaved?: (record: SimulationProgressRecord) => void;
}

type NodeState = "undiscovered" | "queued" | "current" | "visited";
type PlaybackSpeed = "slow" | "normal" | "fast";

const stateLabels: Record<NodeState, string> = {
  undiscovered: "未发现",
  queued: "已入队",
  current: "当前处理",
  visited: "已访问",
};

const speedMilliseconds: Record<PlaybackSpeed, number> = { slow: 1800, normal: 1000, fast: 500 };
const pseudoCode = [
  ["起点先标记，再入队", "mark(start); enqueue(start)"],
  ["取出队首节点", "u = dequeue()"],
  ["检查当前节点的邻接点", "for v in neighbors(u)"],
  ["已发现的节点直接跳过", "if discovered(v): skip"],
  ["新节点标记并加入队尾", "mark(v); enqueue(v)"],
] as const;

function nodeState(nodeId: number, step: BfsTraceStep): NodeState {
  if (step.currentNode === nodeId) return "current";
  if (step.visited.includes(nodeId)) return "visited";
  if (step.queue.includes(nodeId)) return "queued";
  return "undiscovered";
}

export function BfsSimulationSurface({ experimentId, title, learningObjective, onSaved }: Props) {
  const graph = BFS_GRAPH_PRESETS[0]!;
  const [startNode, setStartNode] = useState(graph.nodes[0]!.id);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>("normal");
  const [savedMessage, setSavedMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [records, setRecords] = useState(() => listSimulationProgress().filter((item) => item.experiment_id === experimentId));
  const trace = useMemo(() => buildBfsTrace(graph, startNode), [graph, startNode]);
  const step = trace[stepIndex] ?? trace[0]!;
  const complete = stepIndex === trace.length - 1;
  const progressPercent = Math.round((stepIndex / (trace.length - 1)) * 100);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setStepIndex((current) => {
        if (current >= trace.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, speedMilliseconds[speed]);
    return () => window.clearInterval(timer);
  }, [playing, speed, trace.length]);

  useEffect(() => {
    if (complete) setPlaying(false);
  }, [complete]);

  const reset = () => {
    setPlaying(false);
    setStepIndex(0);
    setSavedMessage("");
    setSaveError("");
  };

  const changeStart = (value: number) => {
    setStartNode(value);
    reset();
  };

  const save = () => {
    if (!complete) return;
    setSaveError("");
    try {
      const record = saveSimulationProgress({
        experiment_id: experimentId,
        scenario_id: graph.id,
        start_node: startNode,
        step_count: trace.length,
        visited_order: step.visited,
        source: "local",
      });
      setRecords(listSimulationProgress().filter((item) => item.experiment_id === experimentId));
      setSavedMessage("已保存本机轨迹，下次打开仍可查看。");
      onSaved?.(record);
    } catch {
      setSaveError("本机存储暂时不可用，本次轨迹未保存。");
    }
  };

  const graphDescription = `${graph.label}。${graph.nodes.map((node) => `节点 ${node.id}：${stateLabels[nodeState(node.id, step)]}`).join("；")}`;

  return (
    <section aria-label="BFS 可视化仿真实验" className="bfs-simulation">
      <div className="bfs-sim-workspace">
        <aside aria-label="实验场景与参数" className="bfs-sim-scenario">
          <div className="bfs-sim-panel-heading"><GitBranch aria-hidden="true" size={17} /><span>实验场景</span></div>
          <h2>{title}</h2>
          <p>{learningObjective}</p>
          <div className="bfs-sim-field">
            <span>图形预设</span>
            <strong>{graph.label}<ChevronDown aria-hidden="true" size={14} /></strong>
          </div>
          <label className="bfs-sim-field" htmlFor="bfs-start-node">
            <span>起点节点</span>
            <select id="bfs-start-node" onChange={(event) => changeStart(Number(event.target.value))} value={startNode}>
              {graph.nodes.map((node) => <option key={node.id} value={node.id}>节点 {node.id}</option>)}
            </select>
          </label>
          <label className="bfs-sim-field" htmlFor="bfs-playback-speed">
            <span>播放速度</span>
            <select id="bfs-playback-speed" onChange={(event) => setSpeed(event.target.value as PlaybackSpeed)} value={speed}>
              <option value="slow">慢速 · 0.5×</option>
              <option value="normal">标准 · 1×</option>
              <option value="fast">快速 · 2×</option>
            </select>
          </label>
          <div className="bfs-sim-objective">
            <ShieldCheck aria-hidden="true" size={17} />
            <div><strong>发现即标记</strong><span>每个节点最多入队一次，按层完成遍历。</span></div>
          </div>
          <div className="bfs-sim-local-records">
            <span>本机轨迹 {records.length} 次</span>
            {records[0] ? <p>最近访问顺序<br /><strong>{records[0].visited_order.join(" → ")}</strong></p> : <p>完成整条轨迹后，可保存本次实验。</p>}
          </div>
        </aside>

        <section aria-labelledby="bfs-simulation-title" className="bfs-sim-canvas">
          <header>
            <div><span>数据结构 · 图的遍历</span><h2 id="bfs-simulation-title">广度优先遍历仿真</h2></div>
            <strong className={complete ? "is-complete" : ""}>{complete ? "遍历完成" : playing ? "播放中" : "逐步观察"}</strong>
          </header>
          <div className="bfs-sim-legend" aria-label="节点状态图例">
            {(Object.keys(stateLabels) as NodeState[]).map((state) => <span data-state={state} key={state}><i />{stateLabels[state]}</span>)}
          </div>
          <svg aria-label={graphDescription} className="bfs-sim-graph" role="img" viewBox="0 0 1000 580">
            {graph.edges.map((edge) => {
              const source = graph.nodes.find((node) => node.id === edge.from)!;
              const target = graph.nodes.find((node) => node.id === edge.to)!;
              return <line className={edgeIsHighlighted(step, edge.from, edge.to) ? "is-active" : ""} key={`${edge.from}-${edge.to}`} x1={source.x * 10} x2={target.x * 10} y1={source.y * 6} y2={target.y * 6} />;
            })}
            {graph.nodes.map((node) => {
              const state = nodeState(node.id, step);
              return (
                <g className="bfs-sim-node" data-state={state} key={node.id} transform={`translate(${node.x * 10} ${node.y * 6})`}>
                  <circle r="29" />
                  <text className="bfs-sim-node-id" dy="8" textAnchor="middle">{node.id}</text>
                  <text className="bfs-sim-node-label" textAnchor="middle" y="53">{stateLabels[state]}</text>
                </g>
              );
            })}
          </svg>
          <div className="bfs-sim-visit-order"><span>访问顺序</span><strong>{step.visited.length ? step.visited.join(" → ") : "等待首个节点处理完成"}</strong></div>
          <section aria-label="Queue 队列状态" className="bfs-sim-queue">
            <header><strong>Queue</strong><span>{step.queueEvent}</span></header>
            <div><span className="bfs-sim-queue-end">队首</span><div className="bfs-sim-queue-slots">{step.queue.length ? step.queue.map((nodeId, index) => <b data-first={index === 0} key={nodeId}>{nodeId}</b>) : <em>空队列</em>}</div><span className="bfs-sim-queue-end">队尾</span></div>
          </section>
        </section>

        <aside aria-label="当前步骤解释" className="bfs-sim-inspector">
          <div className="bfs-sim-panel-heading"><span>步骤 {String(stepIndex + 1).padStart(2, "0")} / {String(trace.length).padStart(2, "0")}</span><b>{progressPercent}%</b></div>
          <h3>{step.title}</h3>
          <p className="bfs-sim-explanation">{step.explanation}</p>
          <ol className="bfs-sim-pseudocode" aria-label="BFS 伪代码">
            {pseudoCode.map(([label, code], index) => <li aria-current={step.pseudoLine === index ? "step" : undefined} data-active={step.pseudoLine === index} key={label}><b>{index + 1}</b><div><span>{label}</span><code>{code}</code></div></li>)}
          </ol>
          <dl className="bfs-sim-metrics">
            <div><dt><Gauge aria-hidden="true" size={14} />已发现节点</dt><dd>{step.discovered.length}<small> / {graph.nodes.length}</small></dd></div>
            <div><dt>边检查次数</dt><dd>{step.edgeChecks}</dd></div>
            <div><dt>队列峰值</dt><dd>{step.queuePeak}</dd></div>
          </dl>
        </aside>
      </div>

      <footer className="bfs-sim-controls">
        <div className="bfs-sim-progress" aria-label={`仿真进度 ${progressPercent}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progressPercent} role="progressbar"><i style={{ width: `${progressPercent}%` }} /></div>
        <div className="bfs-sim-control-row">
          <div className="bfs-sim-step-buttons">
            <button disabled={stepIndex === 0} onClick={() => { setPlaying(false); setStepIndex((current) => Math.max(0, current - 1)); }} type="button"><ArrowLeft aria-hidden="true" size={15} />上一步</button>
            <button disabled={complete} onClick={() => { setPlaying(false); setStepIndex((current) => Math.min(trace.length - 1, current + 1)); }} type="button">下一步<ArrowRight aria-hidden="true" size={15} /></button>
            <button className="bfs-sim-play" disabled={complete} onClick={() => setPlaying((current) => !current)} type="button">{playing ? <Pause aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}{playing ? "暂停自动播放" : "自动播放"}</button>
            <button aria-label="重置仿真" className="bfs-sim-reset" onClick={reset} type="button"><RotateCcw aria-hidden="true" size={15} />重置</button>
          </div>
          <button className="bfs-sim-save" disabled={!complete} onClick={save} type="button"><Save aria-hidden="true" size={15} />保存本次轨迹</button>
        </div>
        {savedMessage ? <p className="bfs-sim-save-message" role="status"><CheckCircle2 aria-hidden="true" size={15} />{savedMessage}</p> : null}
        {saveError ? <p className="bfs-sim-save-error" role="alert">{saveError}</p> : null}
      </footer>
    </section>
  );
}
