import type { AlgorithmTrace, AlgorithmTraceStep } from "@xuetu/contracts";
import {
  BrainCircuit,
  CheckCircle2,
  RotateCcw,
  SkipBack,
  SkipForward,
  XCircle,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { findStepByIndex } from "./trace-player-model";
import {
  TraceCodePane,
  TraceExecutionSummary,
  TraceGraphStage,
  TraceTimeline,
} from "./trace-player-parts";

export type TraceChallengeAnswers = Record<number, string>;

interface TracePredictionChallengeProps {
  trace: AlgorithmTrace;
  stepIndex: number;
  onStepIndexChange: (stepIndex: number) => void;
  answers: TraceChallengeAnswers;
  onAnswer: (stepIndex: number, optionId: string) => void;
  onStepChange?: ((step: AlgorithmTraceStep) => void) | undefined;
}

function formatQueue(queue: string[]) {
  return queue.length > 0 ? `[${queue.join(", ")}]` : "空";
}

export function TracePredictionChallenge({
  trace,
  stepIndex,
  onStepIndexChange,
  answers,
  onAnswer,
  onStepChange,
}: TracePredictionChallengeProps) {
  const headingId = useId();
  const questionId = useId();
  const maxStepIndex = Math.max(...trace.steps.map((item) => item.step_index));
  const step = findStepByIndex(trace, stepIndex) ?? trace.steps[0]!;
  const nextStep = findStepByIndex(trace, step.step_index + 1);
  const prediction = step.prediction;
  const submittedOptionId = answers[step.step_index];
  const submitted = submittedOptionId !== undefined;
  const correct = submitted && submittedOptionId === prediction?.correct_option_id;
  const [selectedOptionId, setSelectedOptionId] = useState(submittedOptionId ?? "");
  const finalStep = nextStep === null;

  useEffect(() => {
    setSelectedOptionId(submittedOptionId ?? "");
  }, [step.step_index, submittedOptionId]);

  useEffect(() => {
    onStepChange?.(step);
  }, [onStepChange, step]);

  const unlockedStepIndex = useMemo(() => {
    let unlocked = trace.steps[0]?.step_index ?? 0;
    for (const traceStep of trace.steps) {
      if (traceStep.step_index > unlocked) break;
      if (traceStep.prediction === null || answers[traceStep.step_index] !== undefined) {
        unlocked = Math.min(traceStep.step_index + 1, maxStepIndex);
      } else {
        break;
      }
    }
    return unlocked;
  }, [answers, maxStepIndex, trace.steps]);

  const answeredSteps = trace.steps.filter(
    (traceStep) =>
      traceStep.prediction !== null && answers[traceStep.step_index] !== undefined,
  );
  const correctAnswerCount = answeredSteps.filter(
    (traceStep) =>
      answers[traceStep.step_index] === traceStep.prediction?.correct_option_id,
  ).length;
  const canContinue = !finalStep && (prediction === null || submitted);

  function selectStep(nextIndex: number) {
    onStepIndexChange(
      Math.min(Math.max(nextIndex, trace.steps[0]?.step_index ?? 0), unlockedStepIndex),
    );
  }

  function submitPrediction() {
    if (!prediction || !selectedOptionId || submitted) return;
    onAnswer(step.step_index, selectedOptionId);
  }

  return (
    <section aria-labelledby={headingId} className="trace-prediction-challenge">
      <header className="trace-challenge-heading">
        <div>
          <p>先判断，再揭晓 · 主动回忆训练</p>
          <h2 id={headingId}>BFS 预测挑战</h2>
        </div>
        <span className="trace-step-status">
          第 {step.step_index + 1} / {trace.steps.length} 步
        </span>
      </header>

      <TraceExecutionSummary step={step} />

      <div className="trace-player-stage trace-challenge-stage">
        <TraceCodePane
          fileName={trace.file_name}
          language={trace.language}
          sourceCode={trace.source_code}
          step={step}
        />
        <TraceGraphStage step={step} trace={trace} />
      </div>

      <section aria-labelledby={questionId} className="trace-prediction-card">
        {finalStep ? (
          <div className="trace-challenge-complete">
            <span>
              <CheckCircle2 aria-hidden="true" size={22} />
            </span>
            <div>
              <small>本轮结果</small>
              <h3 id={questionId}>挑战完成</h3>
              <p>答对 {correctAnswerCount} / {answeredSteps.length} 题</p>
            </div>
          </div>
        ) : prediction ? (
          <>
            <header>
              <span>
                <BrainCircuit aria-hidden="true" size={18} />
              </span>
              <div>
                <small>不要运行，先在脑中执行一遍</small>
                <h3 id={questionId}>预测下一步</h3>
                <p>{prediction.question}</p>
              </div>
            </header>

            <fieldset aria-labelledby={questionId} className="trace-prediction-options">
              {prediction.options.map((option) => (
                <label
                  className={`${submittedOptionId === option.option_id ? "selected " : ""}${submitted && option.option_id === prediction.correct_option_id ? "correct " : ""}${submitted && submittedOptionId === option.option_id && !correct ? "incorrect" : ""}`.trim()}
                  key={option.option_id}
                >
                  <input
                    checked={selectedOptionId === option.option_id}
                    disabled={submitted}
                    name={`prediction-${step.step_index}`}
                    onChange={() => setSelectedOptionId(option.option_id)}
                    type="radio"
                    value={option.option_id}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>

            {!submitted ? (
              <button
                className="trace-submit-prediction"
                disabled={!selectedOptionId}
                onClick={submitPrediction}
                type="button"
              >
                提交预测
              </button>
            ) : (
              <div className={`trace-prediction-feedback ${correct ? "correct" : "incorrect"}`} role="status">
                {correct ? (
                  <CheckCircle2 aria-hidden="true" size={18} />
                ) : (
                  <XCircle aria-hidden="true" size={18} />
                )}
                <div>
                  <strong>{correct ? "回答正确" : "预测有偏差"}</strong>
                  <span>真实下一步 Queue：{formatQueue(nextStep?.queue ?? [])}</span>
                  <p>{prediction.explanation}</p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="trace-prediction-empty">
            <BrainCircuit aria-hidden="true" size={19} />
            <div>
              <h3 id={questionId}>本步暂无预测题</h3>
              <p>可以继续查看下一步真实执行状态。</p>
            </div>
          </div>
        )}
      </section>

      <TraceTimeline
        maxSelectableIndex={unlockedStepIndex}
        onSelectStep={selectStep}
        stepIndex={step.step_index}
        trace={trace}
      />

      <footer className="trace-challenge-navigation">
        <button aria-label="回到起点" onClick={() => selectStep(0)} title="回到起点" type="button">
          <RotateCcw aria-hidden="true" size={15} />
        </button>
        <button aria-label="上一步" disabled={step.step_index === 0} onClick={() => selectStep(step.step_index - 1)} title="上一步" type="button">
          <SkipBack aria-hidden="true" size={15} />
        </button>
        {!finalStep ? (
          <button
            aria-label={canContinue ? "继续到下一步" : "下一步"}
            className="trace-challenge-next"
            disabled={!canContinue}
            onClick={() => selectStep(step.step_index + 1)}
            type="button"
          >
            {canContinue ? "继续到下一步" : "下一步"}
            <SkipForward aria-hidden="true" size={15} />
          </button>
        ) : null}
      </footer>
    </section>
  );
}
