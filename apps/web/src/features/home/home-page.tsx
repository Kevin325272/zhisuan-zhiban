import type {
  StudentLearningCoursePriority,
  StudentLearningOrchestration,
} from "@xuetu/contracts";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cpu,
  FlaskConical,
  Globe,
  HardDrive,
  Network,
  RefreshCw,
  RotateCcw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  getStudentLearningOrchestration,
} from "../../api/client";
import { useAuth } from "../auth/auth-context";
import { currentTaskHref } from "../../lib/learning-task-href";
import { DashboardActivity, DashboardSummary, DashboardUpdates } from "./dashboard-panels";

function loadingErrorText(error: unknown) {
  if (error instanceof ApiError) return `学习任务加载失败：${error.message}`;
  return "学习任务加载失败，请稍后重试。";
}

const priorityCopy: Record<StudentLearningCoursePriority["priority"], string> = {
  focus: "优先处理",
  strengthen: "重点巩固",
  maintain: "保持进度",
};

const agentMeta: Record<string, { agent: string; icon: LucideIcon }> = {
  course_408_ds: { agent: "DS-Agent", icon: Network },
  course_408_co: { agent: "CO-Agent", icon: Cpu },
  course_408_os: { agent: "OS-Agent", icon: HardDrive },
  course_408_cn: { agent: "CN-Agent", icon: Globe },
};

function HomeLoading() {
  return (
    <section aria-busy="true" className="learning-orchestrator-page orchestrator-state" data-visual-system="ochre-serif" role="status">
      <RefreshCw aria-hidden="true" className="is-spinning" size={22} />
      <strong>正在整理今天的学习任务</strong>
      <span>正在汇总阅读进度、练习结果与待复习内容…</span>
    </section>
  );
}

function HomeError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="learning-orchestrator-page orchestrator-state is-error" data-visual-system="ochre-serif" role="alert">
      <RotateCcw aria-hidden="true" size={22} />
      <strong>{message}</strong>
      <span>课程与练习数据没有丢失，可重新建立本次学习任务。</span>
      <button onClick={onRetry} type="button">重新加载</button>
    </section>
  );
}

function PersonalOverview({ snapshot }: { snapshot: StudentLearningOrchestration }) {
  const auth = useAuth();
  return <DashboardSummary snapshot={snapshot} displayName={auth.account?.display_name ?? "同学"} />;
}

function CurrentTask({ snapshot }: { snapshot: StudentLearningOrchestration }) {
  const task = snapshot.current_task;
  const taskSteps = task.task_type === "mistake_review"
    ? [
        ["回看错因", "对照课程知识点"],
        ["完成重练", "提交并查看结果"],
        ["确认掌握", "更新复习队列"],
      ]
    : task.task_type === "choice_practice"
      ? [
          ["回顾知识点", "确认本次训练范围"],
          ["完成作答", task.practice_question_count > 0 ? "完成关联练习" : "进入课程综合训练"],
          ["查看评测", "确认下一步复习动作"],
        ]
      : [
          ["定位知识点", "回到上次学习位置"],
          ["完成阅读", "推进课程化讲解"],
          ["保存进度", "记录本次学习位置"],
        ];
  const taskHref = currentTaskHref(task);
  return (
    <section aria-label="Tutor-Agent 今日推荐研学任务" className="orchestrator-current-task dashboard-current-task" role="region">
      <header className="dashboard-section-heading"><h2>Tutor-Agent 今日推荐研学任务</h2><span className="dashboard-task-status">待完成</span></header>
      <div className="orchestrator-task-main">
        <p className="agent-task-badge"><Sparkles aria-hidden="true" size={13} />Tutor-Agent 推荐 · 约 {task.estimated_minutes} 分钟</p>
        <p className="orchestrator-task-breadcrumb">{task.course_title}{task.concept_title ? ` · ${task.concept_title}` : ""}</p>
        <h1 id="current-task-heading">{task.title}</h1>
        <div className="orchestrator-task-reason"><span>Agent 推荐理由</span><p>{task.reason}</p></div>
        <details className="dashboard-task-details">
        <summary>任务详情<ChevronRight aria-hidden="true" size={14} /></summary>
        <div className="orchestrator-task-completion">
          <CheckCircle2 aria-hidden="true" size={18} />
          <div><span>完成标准</span><p>{task.completion_criteria}</p></div>
        </div>
        <div className="orchestrator-task-flow">
          <span className="orchestrator-task-flow-label">本次学习流程</span>
          <ol aria-label="本次学习流程">
            {taskSteps.map(([title, detail], index) => (
              <li key={title}><b>{index + 1}</b><span><strong>{title}</strong><small>{detail}</small></span></li>
            ))}
          </ol>
        </div>
        </details>
      </div>
      <aside className="orchestrator-task-action">
        <div className="orchestrator-task-time"><Clock3 aria-hidden="true" size={16} /><strong>{task.estimated_minutes} 分钟</strong></div>
        <Link to={taskHref}>开始本关 <ArrowRight aria-hidden="true" size={17} /></Link>
      </aside>
    </section>
  );
}

function ChallengeJourney({ snapshot }: { snapshot: StudentLearningOrchestration }) {
  const journey = snapshot.challenge_journey;
  return (
    <section aria-labelledby="challenge-route-heading" aria-label="我的 408 路线" className="home-challenge-route" role="region">
      <header>
        <div>
          <span className="orchestrator-eyebrow">当前位置</span>
          <h2 id="challenge-route-heading">我的 408 路线</h2>
        </div>
      </header>
      <ol>
        {journey.nodes.map((node) => {
          const current = node.node_id === journey.current_node_id;
          const statusLabel = current ? "当前关" : node.status === "completed" ? "已完成" : "下一关";
          return (
            <li aria-current={current ? "step" : undefined} data-status={node.status} key={node.node_id}>
              <span className="challenge-route-marker">
                {node.status === "completed" ? <CheckCircle2 aria-hidden="true" size={17} /> : <span aria-hidden="true" />}
              </span>
              <div>
                <small><span>{statusLabel}</span><span> · {node.course_title}</span></small>
                {current ? <strong>{node.title}</strong> : <Link to={node.href}>{node.title}</Link>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function AgentMatrix({ items }: { items: StudentLearningCoursePriority[] }) {
  const subjectOrder = Object.keys(agentMeta);
  return (
    <section aria-labelledby="agent-matrix-heading" className="orchestrator-priorities dashboard-courses agent-matrix" role="region">
      <header className="dashboard-section-heading">
        <h2 id="agent-matrix-heading">408 四科专家 Agent 矩阵</h2>
        <Link to="/student/courses">进入四科中枢 <ArrowRight aria-hidden="true" size={15} /></Link>
      </header>
      <ol>
        {[...items].sort((a, b) => subjectOrder.indexOf(a.course_id) - subjectOrder.indexOf(b.course_id)).map((course) => {
          const meta = agentMeta[course.course_id];
          const SubjectIcon = meta?.icon ?? BookOpen;
          const readingPercent = course.concept_count > 0
            ? Math.min(100, Math.round((course.started_concept_count / course.concept_count) * 100))
            : 0;

          return (
            <li className="student-action-card agent-matrix-card" data-priority={course.priority} data-course={course.course_id} key={course.course_id}>
              <span className="dashboard-course-icon"><SubjectIcon aria-hidden="true" size={23} /></span>
              <div className="orchestrator-priority-copy">
                <Link className="student-card-target" to={course.href}><strong>{course.course_title}</strong><ChevronRight aria-hidden="true" size={17} /></Link>
                <span className="dashboard-course-agent"><span className="agent-drive-badge">[Agent 驱动]</span>{meta?.agent} · {priorityCopy[course.priority]}</span>
              </div>
              <div className="orchestrator-course-progress">
                <div className="orchestrator-course-progress-copy">
                  <span>阅读覆盖</span>
                  <strong>{readingPercent}%</strong>
                </div>
                <div className="dashboard-course-facts"><span>{course.started_concept_count} / {course.concept_count} 个知识点</span><span>待复习 {course.needs_review_count} 项</span></div>
                <div
                  aria-label={`${course.course_title}课程阅读进度 ${readingPercent}%`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={readingPercent}
                  className="orchestrator-course-progress-track"
                  role="progressbar"
                >
                  <i style={{ width: `${readingPercent}%` }} />
                </div>
              </div>
              <div className="orchestrator-course-status">
                <strong>{priorityCopy[course.priority]}</strong>
                <small>{course.practice_attempt_count > 0 ? `已练 ${course.practice_attempt_count} 次` : "尚未训练"}</small>
              </div>
              {course.course_id === "course_408_cn" ? (
                <Link className="agent-secondary-action" to="/student/programming-experiments">
                  <FlaskConical aria-hidden="true" size={15} />进入 3D 仿真
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function HomePage() {
  const [snapshot, setSnapshot] = useState<StudentLearningOrchestration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError(null);
    getStudentLearningOrchestration()
      .then((result) => { if (active) setSnapshot(result); })
      .catch((caught: unknown) => { if (active) setError(loadingErrorText(caught)); });
    return () => { active = false; };
  }, [reloadKey]);

  if (error) return <HomeError message={error} onRetry={() => setReloadKey((value) => value + 1)} />;
  if (!snapshot) return <HomeLoading />;

  return (
    <div className="learning-orchestrator-page learning-dashboard" data-testid="student-home-orchestrator" data-visual-system="ochre-serif">
      <section className="home-opening" data-testid="home-opening">
        <PersonalOverview snapshot={snapshot} />
      </section>

      <section
        aria-label="今日学习"
        className="home-goal-route dashboard-desktop-grid"
        data-testid="home-goal-route"
      >
        <div className="dashboard-main-column">
          <div className="dashboard-task-row">
            <section className="home-action-workspace" data-testid="home-action-workspace">
              <CurrentTask snapshot={snapshot} />
            </section>
            <DashboardActivity snapshot={snapshot} />
          </div>
          <section className="home-course-rail" data-testid="home-course-rail">
            <AgentMatrix items={snapshot.course_priorities} />
          </section>
          <DashboardUpdates snapshot={snapshot} />
        </div>
      </section>
    </div>
  );
}
