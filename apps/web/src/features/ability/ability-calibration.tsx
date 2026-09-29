import type {
  AbilityAssessmentDimension,
  AbilityAssessmentKey,
} from "@xuetu/contracts";
import { Check, Clock3, Crosshair, SlidersHorizontal, Target, X } from "lucide-react";
import { useState } from "react";

import type {
  AbilityCalibration,
  AbilityDiagnosticAnswer,
  AbilityGoal,
} from "../../lib/learning-output-store";

const goalMeta: Record<
  AbilityGoal,
  { label: string; description: string; keys: AbilityAssessmentKey[] }
> = {
  course_foundation: {
    label: "课程夯实",
    description: "优先稳住概念理解与系统联系",
    keys: ["knowledge_understanding", "system_thinking"],
  },
  coding_practice: {
    label: "编程实战",
    description: "优先提高实现质量与调试效率",
    keys: ["code_implementation", "debugging_diagnosis"],
  },
  algorithm_advanced: {
    label: "算法进阶",
    description: "优先加强策略拆解与陌生题迁移",
    keys: ["algorithmic_thinking", "transfer_application"],
  },
};

const targetOverrides: Record<AbilityGoal, Partial<Record<AbilityAssessmentKey, number>>> = {
  course_foundation: {
    knowledge_understanding: 90,
    system_thinking: 80,
  },
  coding_practice: {
    code_implementation: 85,
    debugging_diagnosis: 84,
  },
  algorithm_advanced: {
    algorithmic_thinking: 88,
    transfer_application: 84,
  },
};

const diagnosticGroups: Array<{
  key: keyof AbilityCalibration["answers"];
  title: string;
  dimensions: AbilityAssessmentKey[];
  options: Array<{ value: AbilityDiagnosticAnswer; label: string }>;
}> = [
  {
    key: "concept",
    title: "面对一个刚学过的概念",
    dimensions: ["knowledge_understanding", "system_thinking"],
    options: [
      { value: 0, label: "概念还需要提示" },
      { value: 1, label: "能复述主要过程" },
      { value: 2, label: "能解释并举反例" },
    ],
  },
  {
    key: "implementation",
    title: "独立完成代码任务时",
    dimensions: ["code_implementation", "debugging_diagnosis"],
    options: [
      { value: 0, label: "经常不知道从哪里改" },
      { value: 1, label: "基本能完成但边界易错" },
      { value: 2, label: "能独立实现并补测试" },
    ],
  },
  {
    key: "transfer",
    title: "题目换一个场景以后",
    dimensions: ["algorithmic_thinking", "transfer_application"],
    options: [
      { value: 0, label: "换一种题型就会卡住" },
      { value: 1, label: "相似题可以迁移" },
      { value: 2, label: "陌生场景也能拆解" },
    ],
  },
];

export function applyAbilityCalibration(
  dimensions: AbilityAssessmentDimension[],
  calibration: AbilityCalibration | null,
) {
  if (!calibration) return dimensions;
  const overrides = targetOverrides[calibration.goal];

  return dimensions.map((dimension) => ({
    ...dimension,
    target_score: Math.max(
      dimension.target_score,
      overrides[dimension.key] ?? 0,
      dimension.key === calibration.focusKey ? dimension.target_score + 4 : 0,
    ),
  }));
}

function chooseFocusKey(
  dimensions: AbilityAssessmentDimension[],
  answers: AbilityCalibration["answers"],
  goal: AbilityGoal,
) {
  const weakestValue = Math.min(answers.concept, answers.implementation, answers.transfer);
  const weakestGroups = diagnosticGroups.filter((group) => answers[group.key] === weakestValue);
  const goalKeys = goalMeta[goal].keys;
  const matchedGoalGroup = weakestGroups.find((group) =>
    group.dimensions.some((key) => goalKeys.includes(key)),
  );
  const candidates = matchedGoalGroup?.dimensions ?? weakestGroups[0]?.dimensions ?? goalKeys;

  return candidates.reduce((weakest, key) => {
    const current = dimensions.find((dimension) => dimension.key === key)?.score ?? 100;
    const weakestScore = dimensions.find((dimension) => dimension.key === weakest)?.score ?? 100;
    return current < weakestScore ? key : weakest;
  }, candidates[0] ?? "code_implementation");
}

interface AbilityCalibrationPanelProps {
  calibration: AbilityCalibration | null;
  dimensions: AbilityAssessmentDimension[];
  onSave: (calibration: AbilityCalibration) => void;
}

export function AbilityCalibrationPanel({
  calibration,
  dimensions,
  onSave,
}: AbilityCalibrationPanelProps) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState<AbilityGoal>(calibration?.goal ?? "coding_practice");
  const [weeklyHours, setWeeklyHours] = useState<2 | 4 | 6>(calibration?.weeklyHours ?? 4);
  const [answers, setAnswers] = useState<Partial<AbilityCalibration["answers"]>>(
    calibration?.answers ?? {},
  );

  const focusLabel = calibration
    ? dimensions.find((dimension) => dimension.key === calibration.focusKey)?.label
    : null;

  if (!open && calibration) {
    return (
      <section aria-label="个性化目标" className="ability-goal-status" role="status">
        <span className="ability-goal-mark"><Check aria-hidden="true" size={17} /></span>
        <div>
           <small>目标已启用</small>
          <strong>个性化目标已启用 · {goalMeta[calibration.goal].label}</strong>
          <p>{goalMeta[calibration.goal].description}</p>
        </div>
        <dl>
          <div><dt><Clock3 aria-hidden="true" size={13} />投入</dt><dd>每周 {calibration.weeklyHours} 小时</dd></div>
          <div><dt><Crosshair aria-hidden="true" size={13} />优先补强</dt><dd>{focusLabel}</dd></div>
        </dl>
        <button onClick={() => setOpen(true)} type="button">
          <SlidersHorizontal aria-hidden="true" size={14} />重新校准目标
        </button>
      </section>
    );
  }

  if (!open) {
    return (
      <section className="ability-calibration-intro">
        <span className="ability-calibration-index">01</span>
        <div>
           <small>首次设置</small>
          <h2>先用 2 分钟校准学习目标</h2>
          <p>当前分数继续由学习证据生成；你的回答只决定阶段目标、投入节奏和优先补强方向。</p>
        </div>
        <button onClick={() => setOpen(true)} type="button">
          <Target aria-hidden="true" size={15} />开始首次诊断
        </button>
      </section>
    );
  }

  const answersComplete = diagnosticGroups.every((group) => answers[group.key] !== undefined);

  return (
    <section className="ability-calibration-form" aria-labelledby="ability-calibration-title">
      <header>
        <div>
           <small>目标校准</small>
          <h2 id="ability-calibration-title">首次能力诊断与目标设定</h2>
          <p>选择最接近当前状态的一项，不会覆盖平台已经采集的真实学习证据。</p>
        </div>
        <button aria-label="收起诊断" className="icon-button" onClick={() => setOpen(false)} type="button">
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="ability-diagnostic-questions">
        {diagnosticGroups.map((group, index) => (
          <fieldset key={group.key}>
            <legend><span>0{index + 1}</span>{group.title}</legend>
            <div>
              {group.options.map((option) => (
                <label key={option.value}>
                  <input
                    checked={answers[group.key] === option.value}
                    name={`ability-${group.key}`}
                    onChange={() => setAnswers((current) => ({ ...current, [group.key]: option.value }))}
                    type="radio"
                    value={option.value}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="ability-calibration-settings">
        <fieldset>
          <legend>本阶段目标</legend>
          <div className="ability-goal-options">
            {(Object.entries(goalMeta) as Array<[AbilityGoal, (typeof goalMeta)[AbilityGoal]]>).map(
              ([value, meta]) => (
                <button
                  aria-pressed={goal === value}
                  className={goal === value ? "active" : undefined}
                  key={value}
                  onClick={() => setGoal(value)}
                  type="button"
                >
                  <strong>{meta.label}</strong><small>{meta.description}</small>
                </button>
              ),
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>每周投入</legend>
          <div className="ability-hour-options">
            {([2, 4, 6] as const).map((hours) => (
              <button
                aria-label={`每周 ${hours} 小时`}
                aria-pressed={weeklyHours === hours}
                className={weeklyHours === hours ? "active" : undefined}
                key={hours}
                onClick={() => setWeeklyHours(hours)}
                type="button"
              >
                <strong>{hours}</strong><span>小时 / 周</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <footer>
        <p><Target aria-hidden="true" size={14} />校准后会重新计算目标轮廓，当前能力分保持不变。</p>
        <button
          disabled={!answersComplete}
          onClick={() => {
            if (!answersComplete) return;
            const completedAnswers = answers as AbilityCalibration["answers"];
            onSave({
              goal,
              weeklyHours,
              answers: completedAnswers,
              focusKey: chooseFocusKey(dimensions, completedAnswers, goal),
              completedAt: new Date().toISOString(),
            });
            setOpen(false);
          }}
          type="button"
        >
          生成我的能力基线
        </button>
      </footer>
    </section>
  );
}
