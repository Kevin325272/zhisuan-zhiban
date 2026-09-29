import type {
  AbilityAssessment,
  AbilityAssessmentDimension,
  AbilityAssessmentKey,
} from "@xuetu/contracts";
import {
  Activity,
  ArrowRight,
  BookCheck,
  BrainCircuit,
  Bug,
  CheckCircle2,
  Code2,
  Cpu,
  Database,
  ShieldCheck,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getAbilityAssessment } from "../../api/client";
import { AbilityRadar } from "../../components/ability-radar";
import {
  loadLearningOutputs,
  saveAbilityCalibration,
  type AbilityCalibration,
} from "../../lib/learning-output-store";
import {
  AbilityCalibrationPanel,
  applyAbilityCalibration,
} from "./ability-calibration";

const dimensionIcons = {
  knowledge_understanding: BookCheck,
  algorithmic_thinking: BrainCircuit,
  code_implementation: Code2,
  debugging_diagnosis: Bug,
  system_thinking: Cpu,
  transfer_application: Database,
} satisfies Record<AbilityAssessmentKey, LucideIcon>;

function getLargestGapDimension(dimensions: AbilityAssessmentDimension[]) {
  return dimensions.reduce((largest, current) =>
    current.target_score - current.score > largest.target_score - largest.score
      ? current
      : largest,
  );
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTrendDelta(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function AbilityPage() {
  const [assessment, setAssessment] = useState<AbilityAssessment | null>(null);
  const [calibration, setCalibration] = useState<AbilityCalibration | null>(
    () => loadLearningOutputs().abilityCalibration,
  );
  const [selectedKey, setSelectedKey] = useState<AbilityAssessmentKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getAbilityAssessment()
      .then((result) => {
        if (!active) return;
        setAssessment(result);
        setSelectedKey(getLargestGapDimension(result.dimensions).key);
      })
      .catch(() => active && setError("能力评估暂时无法加载。"));

    return () => {
      active = false;
    };
  }, []);

  const selectedDimension = useMemo(() => {
    if (!assessment) return null;
    const dimensions = applyAbilityCalibration(assessment.dimensions, calibration);
    return (
      dimensions.find((dimension) => dimension.key === selectedKey) ??
      getLargestGapDimension(dimensions)
    );
  }, [assessment, calibration, selectedKey]);

  if (error) {
    return <div className="page-inner page-error" role="alert">{error}</div>;
  }

  if (!assessment || !selectedDimension) {
    return <div className="page-inner page-loading" role="status">正在汇总专业能力证据...</div>;
  }

  const dimensions = applyAbilityCalibration(assessment.dimensions, calibration);
  const strongest = dimensions.reduce((best, current) =>
    current.score > best.score ? current : best,
  );
  const largestGap = getLargestGapDimension(dimensions);
  const decliningDimension = dimensions.find((dimension) => dimension.trend_delta < 0);
  const SelectedIcon = dimensionIcons[selectedDimension.key];
  const selectedGap = selectedDimension.target_score - selectedDimension.score;

  return (
    <div className="page-inner page-surface module-page ability-assessment-page">
      <header className="cs-page-header module-page-header">
        <div>
          <p className="cs-workspace-kicker">学习能力概览</p>
          <h1>能力评估</h1>
          <p>看看当前优势、薄弱点，以及下一步适合练什么。</p>
        </div>
        <div className="ability-header-meta">
          <span><ShieldCheck aria-hidden="true" size={14} /> 记录覆盖 {assessment.confidence}%</span>
          <small>更新于 {formatUpdatedAt(assessment.updated_at)}</small>
        </div>
      </header>

      <AbilityCalibrationPanel
        calibration={calibration}
        dimensions={assessment.dimensions}
        onSave={(nextCalibration) => {
          saveAbilityCalibration(nextCalibration);
          setCalibration(nextCalibration);
          setSelectedKey(nextCalibration.focusKey);
        }}
      />

      <section className="module-stat-strip ability-stat-strip" aria-label="能力评估概览">
        <div className="featured">
          <span><Activity aria-hidden="true" size={15} /> 综合能力</span>
          <strong>{assessment.overall_score}</strong>
          <small>综合能力 {assessment.overall_score}</small>
        </div>
        <div><span>成长阶段</span><strong>进阶构建期</strong><small>基础稳定 · 实践待加强</small></div>
        <div><span>有效证据</span><strong>{assessment.evidence_count}</strong><small>任务 / 诊断 / 独立验证</small></div>
        <div><span>专业范围</span><strong>06 维</strong><small>{assessment.major}</small></div>
      </section>

      <section className="ability-workspace" aria-label="六维专业能力工作台">
        <aside className="ability-overview-panel">
          <header>
            <span>概览</span>
            <h2>能力概览</h2>
          </header>

          <div className="ability-score-dial" style={{ "--score": assessment.overall_score } as CSSProperties}>
            <div><strong>{assessment.overall_score}</strong><span>/ 100</span></div>
            <small>综合能力</small>
          </div>

          <dl className="ability-overview-list">
            <div>
              <dt><CheckCircle2 aria-hidden="true" size={14} /> 当前优势</dt>
              <dd><strong>{strongest.label}</strong><span>{strongest.score} 分</span></dd>
            </div>
            <div>
              <dt><Target aria-hidden="true" size={14} /> 优先补强</dt>
              <dd><strong>{largestGap.label}</strong><span>差 {largestGap.target_score - largestGap.score} 分</span></dd>
            </div>
            <div>
              <dt><TrendingUp aria-hidden="true" size={14} /> 近期变化</dt>
              <dd>
                <strong>{decliningDimension ? `${decliningDimension.label}短期回落` : "持续上升"}</strong>
                <span>{decliningDimension ? "已纳入优先补强" : "六维均为正向"}</span>
              </dd>
            </div>
          </dl>

          <p className="ability-method-note">
            <ShieldCheck aria-hidden="true" size={14} />
            分数只使用课程任务、代码提交、错题诊断和独立验证证据。
          </p>
        </aside>

        <div className="ability-radar-stage">
          <header>
             <div><span>能力分布</span><h2>六维能力分布</h2></div>
            <div className="ability-radar-legend" aria-label="雷达图图例">
              <span className="current"><i />当前能力</span>
              <span className="target"><i />目标水平</span>
            </div>
          </header>
          <AbilityRadar
            dimensions={dimensions}
            onSelect={setSelectedKey}
            selectedKey={selectedDimension.key}
          />
          <p className="ability-radar-caption">选择任一顶点，查看该能力的证据判断与提升动作。</p>
        </div>

        <aside className="ability-detail-panel" aria-live="polite">
          <header>
            <span className="ability-detail-icon"><SelectedIcon aria-hidden="true" size={18} /></span>
             <div><small>当前维度</small><h2>{selectedDimension.label}</h2></div>
          </header>

          <div className="ability-detail-score" aria-label={`${selectedDimension.label}当前得分`}>
            <strong>{selectedDimension.score}</strong>
            <span>目标 {selectedDimension.target_score}</span>
          </div>

          <div className="ability-gap-meter">
            <div><span>当前进度</span><b>差距 {selectedGap} 分</b></div>
            <span className="ability-gap-track"><i style={{ width: `${selectedDimension.score}%` }} /><em style={{ left: `${selectedDimension.target_score}%` }} /></span>
          </div>

          <div className="ability-detail-facts">
            <span><TrendingUp aria-hidden="true" size={13} /> 近阶段 {formatTrendDelta(selectedDimension.trend_delta)}</span>
            <span><ShieldCheck aria-hidden="true" size={13} /> {selectedDimension.evidence_count} 条证据</span>
          </div>

          <section>
            <small>能力判断</small>
            <p>{selectedDimension.summary}</p>
          </section>
          <section className="ability-recommendation">
            <small>下一步建议</small>
            <p>{selectedDimension.recommendation}</p>
          </section>

          <Link className="ability-evidence-link" to="/student/evidence">
            查看学习证据 <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </aside>
      </section>

      <section className="ability-matrix" aria-labelledby="ability-matrix-title">
        <header>
          <div><span>能力明细</span><h2 id="ability-matrix-title">能力明细</h2></div>
          <p>目标值依据当前课程阶段设置，不参与同伴排名。</p>
        </header>
        <table>
          <thead>
            <tr><th>能力维度</th><th>当前</th><th>阶段目标</th><th>差距</th><th>近期变化</th><th>有效证据</th><th>状态</th></tr>
          </thead>
          <tbody>
            {dimensions.map((dimension) => {
              const Icon = dimensionIcons[dimension.key];
              const gap = dimension.target_score - dimension.score;
              return (
                <tr key={dimension.key}>
                  <th scope="row"><span><Icon aria-hidden="true" size={14} /></span>{dimension.label}</th>
                  <td><strong>{dimension.score}</strong></td>
                  <td>{dimension.target_score}</td>
                  <td className={gap >= 15 ? "needs-focus" : ""}>{gap} 分</td>
                  <td className={dimension.trend_delta >= 0 ? "positive" : "negative"}>
                    {formatTrendDelta(dimension.trend_delta)}
                  </td>
                  <td>{dimension.evidence_count} 条</td>
                  <td><button onClick={() => setSelectedKey(dimension.key)} type="button">查看 <ArrowRight aria-hidden="true" size={12} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
