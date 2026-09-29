import type { StudentLearningOrchestration } from "@xuetu/contracts";
import { ArrowUpRight, BookOpen, CalendarDays, Check, CheckCheck, ChevronRight, RotateCcw, Target } from "lucide-react";
import { Link } from "react-router-dom";

const stageLabels = {
  preparing: "准备阶段",
  foundation: "基础阶段",
  strengthening: "强化阶段",
  sprint: "冲刺阶段",
} as const;

export function DashboardSummary({ snapshot, displayName }: {
  snapshot: StudentLearningOrchestration;
  displayName: string;
}) {
  const goal = snapshot.goal_context;
  const started = snapshot.course_priorities.reduce((sum, course) => sum + course.started_concept_count, 0);
  const total = snapshot.course_priorities.reduce((sum, course) => sum + course.concept_count, 0);
  const coverage = total > 0 ? Math.round(started / total * 100) : 0;

  return (
    <>
      <header className="dashboard-page-heading">
        <div><h2>学习面板</h2><span>欢迎回来，{displayName}</span></div>
        <span className="dashboard-date"><CalendarDays aria-hidden="true" size={16} />
          {new Date(snapshot.generated_at).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}
        </span>
      </header>
      <dl aria-label="个人备考概况" className="dashboard-summary-grid">
        <div className="dashboard-summary-item is-goal student-action-card">
          <dt><Target aria-hidden="true" size={18} />备考目标</dt>
          <dd className="dashboard-goal-value">{goal ? stageLabels[goal.preparation_stage] : "尚未设置"}</dd>
          <div className="dashboard-summary-foot">
            <span>{goal ? `${goal.target_exam_year} 考研 · 每日 ${goal.daily_minutes} 分钟` : "408 专业基础综合"}</span>
            <Link className="student-card-target" aria-label={goal ? "调整学习设置" : "设置备考目标"} title={goal ? "调整学习设置" : "设置备考目标"} to="/student/onboarding">
              <ArrowUpRight aria-hidden="true" size={17} />
            </Link>
          </div>
        </div>
        <div className="dashboard-summary-item student-action-card">
          <dt><CheckCheck aria-hidden="true" size={18} />累计练习</dt>
          <dd aria-label="累计练习次数">{snapshot.evidence_summary.practice_attempt_count}<span>次</span></dd>
          <div className="dashboard-summary-foot"><span>已记录作答</span><Link className="student-card-target" aria-label="查看学习分析" title="查看学习分析" to="/student/profile"><ArrowUpRight aria-hidden="true" size={17} /></Link></div>
        </div>
        <div className="dashboard-summary-item is-review student-action-card">
          <dt><RotateCcw aria-hidden="true" size={18} />待复习</dt>
          <dd aria-label="待复习数量">{snapshot.evidence_summary.needs_review_count}<span>项</span></dd>
          <div className="dashboard-summary-foot"><span>待完成复习</span><Link className="student-card-target" aria-label="查看待复习错题" title="查看待复习错题" to="/student/mistakes?status=needs_review"><ArrowUpRight aria-hidden="true" size={17} /></Link></div>
        </div>
        <div className="dashboard-summary-item is-coverage student-action-card">
          <dt><BookOpen aria-hidden="true" size={18} />课程阅读覆盖</dt>
          <dd aria-label="课程阅读覆盖率">{coverage}%</dd>
          <div className="dashboard-summary-foot"><span>已开始 {started} / {total} 个知识点</span><Link className="student-card-target" aria-label="查看408课程" title="查看408课程" to="/student/courses"><ArrowUpRight aria-hidden="true" size={17} /></Link></div>
        </div>
      </dl>
    </>
  );
}

export function DashboardActivity({ snapshot }: { snapshot: StudentLearningOrchestration }) {
  const activity = snapshot.challenge_journey.recent_activity;
  const lastUpdate = snapshot.challenge_journey.profile_updates[0];
  return (
    <section aria-label="学习记录" className="dashboard-activity">
      <header className="dashboard-section-heading"><h2>学习记录</h2><span>最近 7 天</span></header>
      <div className="dashboard-activity-total"><strong aria-label="最近7天完成天数">{activity.completed_day_count}</strong><span>天完成学习</span></div>
      <ol aria-label="最近7天学习记录" className="dashboard-week">
        {activity.days.map((day) => (
          <li aria-label={`${day.date} ${day.completed ? "已完成学习任务" : "暂无完成记录"}`} data-completed={day.completed} key={day.date}>
            <span>{new Date(`${day.date}T12:00:00`).toLocaleDateString("zh-CN", { weekday: "short" })}</span>
            <span className="dashboard-day-mark">{day.completed ? <Check aria-hidden="true" size={17} /> : <span aria-hidden="true" />}</span>
            <small>{Number(day.date.slice(5, 7))}.{Number(day.date.slice(8, 10))}</small>
          </li>
        ))}
      </ol>
      <div className="dashboard-last-activity">
        <span>最近记录</span>
        <p>{lastUpdate?.title ?? "暂无学习记录"}</p>
        <Link to="/student/profile">全部记录<ChevronRight aria-hidden="true" size={14} /></Link>
      </div>
    </section>
  );
}

export function DashboardUpdates({ snapshot }: { snapshot: StudentLearningOrchestration }) {
  const updates = snapshot.challenge_journey.profile_updates.slice(0, 3);
  return (
    <section aria-label="最近学习动态" className="dashboard-updates">
      <header className="dashboard-section-heading"><h2>最近动态</h2><Link to="/student/profile">全部<ChevronRight aria-hidden="true" size={15} /></Link></header>
      {updates.length ? (
        <ul>{updates.map((update) => (
          <li key={update.update_id}>
            <span className="dashboard-update-marker" aria-hidden="true" />
            <div><strong>{update.title}</strong><span>{update.course_title} · {update.occurred_at
              ? new Date(update.occurred_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
              : "时间未记录"}</span></div>
          </li>
        ))}</ul>
      ) : <p className="dashboard-empty">暂无学习动态</p>}
    </section>
  );
}
