import type { AlgorithmTrace, AlgorithmTraceStep } from "@xuetu/contracts";
import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { findStepByIndex } from "./trace-player-model";
import {
  TraceCodePane,
  TraceExecutionSummary,
  TraceGraphStage,
  TracePlaybackControls,
  TraceTimeline,
} from "./trace-player-parts";

interface AlgorithmTracePlayerProps {
  trace: AlgorithmTrace;
  stepIndex: number;
  onStepIndexChange: (stepIndex: number) => void;
  onStepChange?: ((step: AlgorithmTraceStep) => void) | undefined;
}

export function AlgorithmTracePlayer({
  trace,
  stepIndex,
  onStepIndexChange,
  onStepChange,
}: AlgorithmTracePlayerProps) {
  const headingId = useId();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [codePanePercent, setCodePanePercent] = useState(50);
  const stageRef = useRef<HTMLDivElement>(null);
  const maxStepIndex = Math.max(...trace.steps.map((step) => step.step_index));
  const step = findStepByIndex(trace, stepIndex) ?? trace.steps[0]!;
  const activePseudocodeStep = step.step_index === 0
    ? 0
    : step.action.includes("出队")
      ? 2
      : step.newly_enqueued.length > 0
        ? 4
        : 3;

  useEffect(() => {
    setPlaying(false);
  }, [trace]);

  useEffect(() => {
    onStepChange?.(step);
  }, [onStepChange, step]);

  useEffect(() => {
    if (!playing) return undefined;
    if (stepIndex >= maxStepIndex) {
      setPlaying(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      onStepIndexChange(stepIndex + 1);
    }, 900 / speed);

    return () => window.clearTimeout(timer);
  }, [maxStepIndex, onStepIndexChange, playing, speed, stepIndex]);

  function selectStep(nextIndex: number) {
    setPlaying(false);
    onStepIndexChange(Math.min(Math.max(nextIndex, 0), maxStepIndex));
  }

  function togglePlayback() {
    if (!playing && stepIndex >= maxStepIndex) onStepIndexChange(0);
    setPlaying((current) => !current);
  }

  function resizeFromClientX(clientX: number) {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const nextPercent = ((clientX - bounds.left) / bounds.width) * 100;
    setCodePanePercent(Math.min(68, Math.max(32, Math.round(nextPercent))));
  }

  function nudgePaneWidth(key: string) {
    if (key === "ArrowLeft") setCodePanePercent((current) => Math.max(32, current - 5));
    if (key === "ArrowRight") setCodePanePercent((current) => Math.min(68, current + 5));
    if (key === "Home") setCodePanePercent(32);
    if (key === "End") setCodePanePercent(68);
  }

  return (
    <section className="algorithm-trace-player" aria-labelledby={headingId}>
      <header className="trace-player-header">
        <div>
          <p>{trace.variant === "visited-on-dequeue" ? "错误版本" : "修复版本"} · 逐步执行</p>
          <h2 id={headingId}>BFS 运行轨迹</h2>
          <small>{trace.graph.nodes.length} 个节点 · 起点 {trace.steps[0]?.current_node_id ?? "-"}</small>
        </div>
        <span className={`trace-step-status${step.conflict ? " conflict" : ""}`}>
          {step.conflict ? <AlertTriangle aria-hidden="true" size={13} /> : null}
          第 {step.step_index + 1} / {trace.steps.length} 步
        </span>
      </header>

      <TraceExecutionSummary step={step} />

      <ol aria-label="BFS 伪代码状态" className="trace-pseudocode-strip">
        {["起点入队", "队列非空", "取出队首", "扫描邻接点", "未访问则标记并入队"].map((label, index) => (
          <li className={activePseudocodeStep === index ? "active" : undefined} key={label}>
            <span>{String(index + 1).padStart(2, "0")}</span>{label}
          </li>
        ))}
      </ol>

      <div
        className="trace-player-stage"
        ref={stageRef}
        style={{ "--trace-code-percent": `${codePanePercent}%` } as CSSProperties}
      >
        <TraceCodePane
          fileName={trace.file_name}
          language={trace.language}
          sourceCode={trace.source_code}
          step={step}
        />
        <div
          aria-label="调整代码与图状态宽度"
          aria-orientation="vertical"
          aria-valuemax={68}
          aria-valuemin={32}
          aria-valuenow={codePanePercent}
          className="trace-pane-resizer"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            nudgePaneWidth(event.key);
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeFromClientX(event.clientX);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            resizeFromClientX(event.clientX);
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          role="separator"
          tabIndex={0}
          title="拖动调整代码与图状态宽度"
        >
          <span aria-hidden="true" />
        </div>
        <TraceGraphStage step={step} trace={trace} />
      </div>

      <TraceTimeline onSelectStep={selectStep} stepIndex={step.step_index} trace={trace} />

      <TracePlaybackControls
        maxStepIndex={maxStepIndex}
        onSelectStep={selectStep}
        onSpeedChange={setSpeed}
        onTogglePlayback={togglePlayback}
        playing={playing}
        speed={speed}
        stepIndex={step.step_index}
      />
    </section>
  );
}
