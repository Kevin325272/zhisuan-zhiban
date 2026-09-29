import type { StudentLearningOrchestration } from "@xuetu/contracts";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, RefreshCw, Route } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStudentLearningOrchestration } from "../../api/client";
import { currentTaskHref } from "../../lib/learning-task-href";

function dateLabel(value: string) {
  return new Date(value + "T12:00:00+08:00").toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Shanghai" });
}

export function PlanPage() {
  const [snapshot, setSnapshot] = useState<StudentLearningOrchestration | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setRefreshing(true); setError(null);
    getStudentLearningOrchestration()
      .then((result) => { if (active) setSnapshot(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "暂时无法读取计划，请重试。"); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [revision]);

  if (!snapshot && error) return (
    <div className="page-inner page-surface student-load-failure" role="alert">
      <Route aria-hidden="true" size={32} />
      <h1>学习计划暂时无法打开</h1><p>{error}</p>
      <div><button className="primary-button" disabled={refreshing} onClick={() => setRevision((value) => value + 1)} type="button">重新加载</button><Link className="secondary-button" to="/student/home">返回学习面板</Link></div>
    </div>
  );
  if (!snapshot) return <div className="page-inner page-loading" role="status">正在读取学习计划…</div>;
  const plan = snapshot.plan_progress;
  const days = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    tasks: plan.tasks.filter((task) => task.day_index === index + 1),
  })).filter((day) => day.tasks.length > 0);

  return (
    <div className="page-inner page-surface plan-page current-plan-page" data-visual-system="ochre-serif">
      <header className="current-plan-heading">
        <div><h1>学习计划</h1><p>查看七日安排，继续当前学习任务。</p></div>
        <div><Link to="/student/onboarding">调整学习设置</Link><button aria-label="刷新学习计划" disabled={refreshing} onClick={() => setRevision((value) => value + 1)} type="button"><RefreshCw aria-hidden="true" size={17} />{refreshing ? "正在刷新" : "刷新计划"}</button></div>
      </header>
      {error ? <p role="alert" className="current-plan-error">本次刷新未成功，仍显示上次读取的计划。{error}</p> : null}
      <section className="current-plan-overview" aria-label="七日计划概览">
        <div><CalendarDays aria-hidden="true" size={22} /><span><strong>7 日学习安排</strong><small>{plan.completed_task_count} / {plan.total_task_count} 项已完成</small></span></div>
        <div className="current-plan-progress"><strong>{plan.completion_percent}%</strong><div role="progressbar" aria-label="七日计划完成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.completion_percent}><i style={{ width: plan.completion_percent + "%" }} /></div></div>
      </section>
      <section className="current-plan-next" aria-label="当前学习任务">
        <div><span>当前建议</span><h2>{snapshot.current_task.title}</h2><small>{snapshot.current_task.course_title} · {snapshot.current_task.estimated_minutes} 分钟</small></div>
        <Link to={currentTaskHref(snapshot.current_task)}>继续当前任务<ArrowRight aria-hidden="true" size={17} /></Link>
      </section>
      {days.length ? <div className="current-plan-days">{days.map(({ day, tasks }) => (
        <section className="current-plan-day" key={day} aria-label={"第" + day + "天学习安排"}>
          <header><h2>第 {day} 天</h2><time dateTime={tasks[0]!.task_date}>{dateLabel(tasks[0]!.task_date)}</time><span>{tasks.reduce((sum, task) => sum + task.estimated_minutes, 0)} 分钟</span></header>
          <ol>{tasks.map((task) => (
            <li key={task.task_id} data-testid={"plan-task-" + task.task_id} data-completed={task.status === "completed"}>
              <div className="current-plan-task-status">{task.status === "completed" ? <CheckCircle2 aria-hidden="true" size={18} /> : <Clock3 aria-hidden="true" size={18} />}</div>
              <div><span>{task.course_title}</span><strong>{task.title}</strong><small>{task.estimated_minutes} 分钟 · {task.status === "completed" ? "已完成" : "待完成"}</small></div>
              <Link to={task.href}>查看内容<ArrowRight aria-hidden="true" size={14} /></Link>
            </li>
          ))}</ol>
        </section>
      ))}</div> : <section className="current-plan-empty"><CalendarDays aria-hidden="true" size={30} /><h2>还没有七日学习计划</h2><p>保存学习目标后，在这里查看每天的课程安排。</p><Link to="/student/onboarding">设置学习目标<ArrowRight aria-hidden="true" size={16} /></Link></section>}
    </div>
  );
}
