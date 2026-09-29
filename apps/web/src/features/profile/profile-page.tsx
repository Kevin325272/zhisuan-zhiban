import type { LearningProfile } from "@xuetu/contracts";
import { Activity, BookCheck, Code2, GitCompareArrows, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { getLearningProfile } from "../../api/client";

const dimensionIcons = {
  conceptual_understanding: BookCheck,
  code_implementation: Code2,
  transfer_application: GitCompareArrows,
} satisfies Record<LearningProfile["dimensions"][number]["key"], typeof BookCheck>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function ProfilePage() {
  const [profile, setProfile] = useState<LearningProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getLearningProfile()
      .then((result) => active && setProfile(result))
      .catch(() => active && setError("学习档案暂时无法加载。"));
    return () => { active = false; };
  }, []);

  if (error) return <div className="page-inner page-error" role="alert">{error}</div>;
  if (!profile) return <div className="page-inner page-loading" role="status">正在整理学习档案...</div>;

  const scored = profile.dimensions.filter((item) => item.score !== null);
  const average = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + (item.score ?? 0), 0) / scored.length)
    : null;

  return (
    <div className="page-inner page-surface profile-page">
      <header className="page-heading compact-page-heading">
        <div><h1>学习档案</h1><p>只基于你的学习证据呈现能力变化，不参与同伴排名。</p></div>
        <span className="student-context">更新于 {formatDate(profile.updated_at)}</span>
      </header>

      <section className="profile-summary" aria-label="学习档案概览">
        <div className="profile-summary-main"><span className="soft-icon sage"><ShieldCheck aria-hidden="true" size={17} /></span><div><small>当前综合表现</small><strong>{average === null ? "证据不足" : `${average}%`}</strong><p>来自课程任务、错题回访与独立验证</p></div></div>
        <div><small>证据总量</small><strong>证据 {profile.evidence_count} 条</strong></div>
        <div><small>课程范围</small><strong>数据结构</strong></div>
        <div><small>诊断维度</small><strong>{profile.dimensions.length} 项</strong></div>
      </section>

      <div className="profile-grid">
        <section className="ability-profile-section" aria-labelledby="ability-profile-title">
          <header className="table-toolbar"><div><h2 id="ability-profile-title">能力诊断</h2><p>每项结果都附带证据数量与当前判断</p></div></header>
          <ol className="ability-profile-list">
            {profile.dimensions.map((dimension, index) => {
              const Icon = dimensionIcons[dimension.key];
              return (
                <li key={dimension.key}>
                  <span className={`soft-icon ${index === 0 ? "sage" : index === 1 ? "blue" : "coral"}`}><Icon aria-hidden="true" size={16} /></span>
                  <div className="ability-profile-copy"><div><strong>{dimension.label}</strong><small>证据 {dimension.evidence_count} 条</small></div><p>{dimension.summary}</p><div className="ability-progress" role="progressbar" aria-label={`${dimension.label}得分`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={dimension.score ?? 0}><span style={{ width: `${dimension.score ?? 0}%` }} /></div></div>
                  <b>{dimension.score === null ? "证据不足" : `${dimension.score}%`}</b>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="personal-trend-section" aria-labelledby="personal-trend-title">
          <header><span className="soft-icon blue"><Activity aria-hidden="true" size={15} /></span><div><h2 id="personal-trend-title">个人学习趋势</h2><p>仅与你自己的历史证据比较</p></div></header>
          <div className="personal-trend-chart" role="img" aria-label="个人能力得分变化">
            {profile.trend.map((point) => (
              <div key={point.date}><span className="trend-value">{point.score}</span><span className="trend-bar"><i style={{ height: `${point.score}%` }} /></span><time dateTime={point.date}>{point.date.slice(5).replace("-", "/")}</time></div>
            ))}
          </div>
          <div className="trend-note"><ShieldCheck aria-hidden="true" size={13} /><span>掌握状态只在独立验证通过后更新。</span></div>
        </section>
      </div>
    </div>
  );
}
