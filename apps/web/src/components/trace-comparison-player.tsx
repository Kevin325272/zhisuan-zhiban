import type {
  AlgorithmTrace,
  AlgorithmTraceStep,
  TraceVariant,
} from "@xuetu/contracts";
import { GitCompareArrows, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import {
  compareTraceSteps,
  findFirstTraceDivergence,
  findStepByIndex,
  type ComparedTraceField,
} from "./trace-player-model";
import {
  TraceCodePane,
  TraceGraphStage,
  TraceMissingStep,
  TracePlaybackControls,
  TraceTimeline,
} from "./trace-player-parts";

const fieldLabels: Record<ComparedTraceField, string> = {
  queue: "Queue",
  visited: "Visited",
  output: "Output",
};

interface TraceComparisonPlayerProps {
  wrongTrace: AlgorithmTrace;
  fixedTrace: AlgorithmTrace;
  stepIndex: number;
  onStepIndexChange: (stepIndex: number) => void;
  activeVariant: TraceVariant;
  onActiveVariantChange: (variant: TraceVariant) => void;
  onStepChange?: ((step: AlgorithmTraceStep) => void) | undefined;
}

function buildTimelineTrace(wrongTrace: AlgorithmTrace, fixedTrace: AlgorithmTrace) {
  const indexes = Array.from(
    new Set([
      ...wrongTrace.steps.map((step) => step.step_index),
      ...fixedTrace.steps.map((step) => step.step_index),
    ]),
  ).sort((left, right) => left - right);

  return {
    ...wrongTrace,
    steps: indexes
      .map(
        (index) =>
          findStepByIndex(wrongTrace, index) ?? findStepByIndex(fixedTrace, index),
      )
      .filter((step): step is AlgorithmTraceStep => step !== null),
  };
}

export function TraceComparisonPlayer({
  wrongTrace,
  fixedTrace,
  stepIndex,
  onStepIndexChange,
  activeVariant,
  onActiveVariantChange,
  onStepChange,
}: TraceComparisonPlayerProps) {
  const headingId = useId();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timelineTrace = useMemo(
    () => buildTimelineTrace(wrongTrace, fixedTrace),
    [fixedTrace, wrongTrace],
  );
  const maxStepIndex = Math.max(...timelineTrace.steps.map((step) => step.step_index));
  const wrongStep = findStepByIndex(wrongTrace, stepIndex);
  const fixedStep = findStepByIndex(fixedTrace, stepIndex);
  const currentDifferences = compareTraceSteps(wrongStep, fixedStep);
  const firstDivergence = findFirstTraceDivergence(wrongTrace, fixedTrace);
  const activeStep =
    activeVariant === "visited-on-enqueue" ? fixedStep ?? wrongStep : wrongStep ?? fixedStep;

  useEffect(() => {
    if (activeStep) onStepChange?.(activeStep);
  }, [activeStep, onStepChange]);

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

  return (
    <section aria-labelledby={headingId} className="trace-comparison-player">
      <header className="trace-comparison-heading">
        <div>
          <p>错误路径与修复路径 · 同步执行</p>
          <h2 id={headingId}>BFS 双轨对比</h2>
        </div>
        <span className="trace-step-status">
          第 {stepIndex + 1} / {timelineTrace.steps.length} 步
        </span>
      </header>

      <div className="trace-divergence-banner">
        <span>
          <GitCompareArrows aria-hidden="true" size={17} />
        </span>
        <div>
          <small>状态分叉定位</small>
          <strong>
            {firstDivergence === null
              ? "当前轨迹尚未分叉"
              : `首次分叉：第 ${firstDivergence + 1} 步`}
          </strong>
          <p>
            {firstDivergence === 0
              ? "修复版在起点入队时立即标记 Visited，错误版仍留下未标记窗口。"
              : "对照 Queue、Visited 与 Output，定位两条执行路径开始不同的位置。"}
          </p>
        </div>
        <div aria-label="当前步骤差异" className="trace-current-differences">
          <small>当前差异</small>
          {currentDifferences.length > 0 ? (
            <div>
              {currentDifferences.map((field) => (
                <b key={field}>{fieldLabels[field]}</b>
              ))}
            </div>
          ) : (
            <strong>
              <ShieldCheck aria-hidden="true" size={13} />状态一致
            </strong>
          )}
        </div>
      </div>

      <div aria-label="移动端对比版本" className="trace-mobile-track-switch">
        <button
          aria-pressed={activeVariant === "visited-on-dequeue"}
          className={activeVariant === "visited-on-dequeue" ? "active" : undefined}
          onClick={() => onActiveVariantChange("visited-on-dequeue")}
          type="button"
        >
          查看错误版
        </button>
        <button
          aria-pressed={activeVariant === "visited-on-enqueue"}
          className={activeVariant === "visited-on-enqueue" ? "active" : undefined}
          onClick={() => onActiveVariantChange("visited-on-enqueue")}
          type="button"
        >
          查看修复版
        </button>
      </div>

      <div className="trace-comparison-grid">
        <article
          className={`trace-comparison-track wrong${activeVariant === "visited-on-dequeue" ? " mobile-active" : ""}`}
          data-differences={currentDifferences.join(" ")}
        >
          <header>
            <span>
              <TriangleAlert aria-hidden="true" size={15} />错误路径
            </span>
            <div>
              <h3>错误版</h3>
              <small>节点出队后才标记</small>
            </div>
          </header>
          {wrongStep ? (
            <>
              <TraceCodePane
                compact
                fileName={wrongTrace.file_name}
                language={wrongTrace.language}
                sourceCode={wrongTrace.source_code}
                step={wrongStep}
              />
              <TraceGraphStage compact step={wrongStep} title="错误版图状态" trace={wrongTrace} />
            </>
          ) : (
            <TraceMissingStep />
          )}
        </article>

        <article
          className={`trace-comparison-track repaired${activeVariant === "visited-on-enqueue" ? " mobile-active" : ""}`}
          data-differences={currentDifferences.join(" ")}
        >
          <header>
            <span>
              <ShieldCheck aria-hidden="true" size={15} />修复路径
            </span>
            <div>
              <h3>修复版</h3>
              <small>节点入队时立即标记</small>
            </div>
          </header>
          {fixedStep ? (
            <>
              <TraceCodePane
                compact
                fileName={fixedTrace.file_name}
                language={fixedTrace.language}
                sourceCode={fixedTrace.source_code}
                step={fixedStep}
              />
              <TraceGraphStage compact step={fixedStep} title="修复版图状态" trace={fixedTrace} />
            </>
          ) : (
            <TraceMissingStep />
          )}
        </article>
      </div>

      <TraceTimeline
        onSelectStep={selectStep}
        stepIndex={stepIndex}
        trace={timelineTrace}
      />
      <TracePlaybackControls
        maxStepIndex={maxStepIndex}
        onSelectStep={selectStep}
        onSpeedChange={setSpeed}
        onTogglePlayback={togglePlayback}
        playing={playing}
        speed={speed}
        stepIndex={stepIndex}
      />
    </section>
  );
}
