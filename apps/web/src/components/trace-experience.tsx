import type {
  AlgorithmTrace,
  AlgorithmTraceStep,
  TraceVariant,
} from "@xuetu/contracts";
import {
  BookOpenCheck,
  BrainCircuit,
  GitCompareArrows,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import { AlgorithmTracePlayer } from "./algorithm-trace-player";
import { TraceComparisonPlayer } from "./trace-comparison-player";
import {
  TracePredictionChallenge,
  type TraceChallengeAnswers,
} from "./trace-prediction-challenge";

type TraceExperienceMode = "explain" | "compare" | "challenge";

interface TraceExperienceProps {
  trace: AlgorithmTrace;
  comparisonTrace: AlgorithmTrace | null;
  comparisonLoading: boolean;
  comparisonError: string | null;
  onRequestComparison: () => void;
  onStepChange?: ((step: AlgorithmTraceStep) => void) | undefined;
}

function traceMaxStep(trace: AlgorithmTrace) {
  return Math.max(...trace.steps.map((step) => step.step_index));
}

export function TraceExperience({
  trace,
  comparisonTrace,
  comparisonLoading,
  comparisonError,
  onRequestComparison,
  onStepChange,
}: TraceExperienceProps) {
  const [mode, setMode] = useState<TraceExperienceMode>("explain");
  const [stepIndex, setStepIndex] = useState(trace.steps[0]?.step_index ?? 0);
  const [mobileVariant, setMobileVariant] = useState<TraceVariant>(trace.variant);
  const [answers, setAnswers] = useState<TraceChallengeAnswers>({});

  useEffect(() => {
    setStepIndex(trace.steps[0]?.step_index ?? 0);
    setMobileVariant(trace.variant);
    setAnswers({});
  }, [trace.task_id, trace.variant, trace.steps]);

  function selectMode(nextMode: TraceExperienceMode) {
    setMode(nextMode);
    const nextMaxStep =
      nextMode === "compare" && comparisonTrace
        ? Math.max(traceMaxStep(trace), traceMaxStep(comparisonTrace))
        : traceMaxStep(trace);
    setStepIndex((current) => Math.min(current, nextMaxStep));

    if (
      nextMode === "compare" &&
      !comparisonTrace &&
      !comparisonLoading &&
      !comparisonError
    ) {
      onRequestComparison();
    }
  }

  const wrongTrace =
    trace.variant === "visited-on-dequeue"
      ? trace
      : comparisonTrace?.variant === "visited-on-dequeue"
        ? comparisonTrace
        : null;
  const fixedTrace =
    trace.variant === "visited-on-enqueue"
      ? trace
      : comparisonTrace?.variant === "visited-on-enqueue"
        ? comparisonTrace
        : null;

  return (
    <section className="trace-experience">
      <div aria-label="运行轨迹学习模式" className="trace-mode-switch" role="group">
        <button
          aria-pressed={mode === "explain"}
          className={mode === "explain" ? "active" : undefined}
          onClick={() => selectMode("explain")}
          type="button"
        >
          <BookOpenCheck aria-hidden="true" size={16} />
          <span>讲解模式</span>
        </button>
        <button
          aria-pressed={mode === "compare"}
          className={mode === "compare" ? "active" : undefined}
          onClick={() => selectMode("compare")}
          type="button"
        >
          <GitCompareArrows aria-hidden="true" size={16} />
          <span>双轨对比</span>
        </button>
        <button
          aria-pressed={mode === "challenge"}
          className={mode === "challenge" ? "active" : undefined}
          onClick={() => selectMode("challenge")}
          type="button"
        >
          <BrainCircuit aria-hidden="true" size={16} />
          <span>预测挑战</span>
        </button>
      </div>

      <div className={`trace-mode-panel is-${mode}`} data-mode={mode} key={mode}>
        {mode === "explain" ? (
          <AlgorithmTracePlayer
            onStepChange={onStepChange}
            onStepIndexChange={setStepIndex}
            stepIndex={stepIndex}
            trace={trace}
          />
        ) : null}

        {mode === "compare" ? (
          wrongTrace && fixedTrace ? (
            <TraceComparisonPlayer
              activeVariant={mobileVariant}
              fixedTrace={fixedTrace}
              onActiveVariantChange={setMobileVariant}
              onStepChange={onStepChange}
              onStepIndexChange={setStepIndex}
              stepIndex={stepIndex}
              wrongTrace={wrongTrace}
            />
          ) : comparisonError ? (
            <div className="trace-comparison-degraded">
              <div className="trace-comparison-error" role="alert">
                <div>
                  <strong>另一条执行轨迹暂未加载</strong>
                  <span>{comparisonError}</span>
                </div>
                <button onClick={onRequestComparison} type="button">
                  <RefreshCw aria-hidden="true" size={14} />重新加载对比轨迹
                </button>
              </div>
              <AlgorithmTracePlayer
                onStepChange={onStepChange}
                onStepIndexChange={setStepIndex}
                stepIndex={stepIndex}
                trace={trace}
              />
            </div>
          ) : (
            <div className="trace-comparison-loading" role="status">
              <RefreshCw aria-hidden="true" className="spin" size={17} />
              正在加载对比轨迹…
            </div>
          )
        ) : null}

        {mode === "challenge" ? (
          <TracePredictionChallenge
            answers={answers}
            onAnswer={(answerStepIndex, optionId) =>
              setAnswers((current) => ({ ...current, [answerStepIndex]: optionId }))
            }
            onStepChange={onStepChange}
            onStepIndexChange={setStepIndex}
            stepIndex={stepIndex}
            trace={trace}
          />
        ) : null}
      </div>
    </section>
  );
}
