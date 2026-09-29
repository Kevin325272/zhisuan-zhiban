import type {
  PilotFeedbackRequest,
  PilotStudentStudy,
  PilotTask,
} from "@xuetu/contracts";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  ApiError,
  completePilotTask,
  getPilotStudy,
  recordPilotConsent,
  startPilotTask,
  submitPilotFeedback,
} from "../../api/client";

const stageLabels: Record<PilotTask["stage"], string> = {
  baseline: "基线",
  guided: "引导阅读",
  transfer: "迁移",
};

const scoreOptions = [1, 2, 3, 4, 5] as const;

function readableError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "课程试点记录暂时无法读取，请稍后重试。";
}

function withPilotTaskId(href: string, taskId: string) {
  const [pathAndQuery = "", hash = ""] = href.split("#", 2);
  const [path, query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("pilot_task_id", taskId);
  const search = params.toString();
  return `${path}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

function taskStateLabel(task: PilotTask, consented: boolean) {
  if (task.status === "completed") return "已完成";
  if (task.status === "started") return "进行中";
  if (task.status === "ready") return "可开始";
  if (!consented && task.ordinal === 1) return "未解锁";
  if (task.ordinal === 2) return "等待前序任务";
  return "尚未开放";
}

function TaskRail({ tasks, consented }: { tasks: PilotTask[]; consented: boolean }) {
  return (
    <ol aria-label="三阶段课程试点进度" className="pilot-protocol-rail">
      {tasks.map((task) => (
        <li className={`pilot-protocol-step ${task.status}`} key={task.task_id}>
          <span className="pilot-step-index" aria-hidden="true">
            {task.status === "completed" ? <Check size={16} /> : task.ordinal}
          </span>
          <div>
            <small>{stageLabels[task.stage]}</small>
            <strong>{task.title}</strong>
            <span>{taskStateLabel(task, consented)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RatingSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        value={value}
      >
        {scoreOptions.map((score) => (
          <option key={score} value={score}>{score} 分</option>
        ))}
      </select>
    </label>
  );
}

const previewSteps = [
  {
    stage: "基线",
    title: "基线题",
    detail: "先独立作答，记录没有讲解帮助时的起点表现。",
    evidence: "作答结果",
    minutes: "约 3 分钟",
  },
  {
    stage: "引导阅读",
    title: "引导阅读",
    detail: "打开课程讲解，完成指定知识点阅读。",
    evidence: "阅读进度",
    minutes: "约 8 分钟",
  },
  {
    stage: "迁移",
    title: "迁移题",
    detail: "再独立完成一题，观察能否把刚才的理解迁移过去。",
    evidence: "作答结果",
    minutes: "约 3 分钟",
  },
] as const;

function PilotStudyPreview() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStep = previewSteps[activeIndex] ?? null;

  return (
    <div className="page-inner pilot-study-page pilot-study-preview" data-visual-system="ochre-serif">
      <header className="pilot-study-heading">
        <div>
          <span className="first-release-kicker"><ClipboardCheck aria-hidden="true" size={15} />课程试点 · 流程预览</span>
          <h1>课程试点流程示例</h1>
          <p>先了解流程，再决定是否参加。管理员登记匿名编号后，学生按顺序完成三步课程任务。</p>
        </div>
        <div className="pilot-preview-status">
          <strong>{activeStep ? `第 ${activeIndex + 1} / ${previewSteps.length} 步` : "示例已走完"}</strong>
          <span>流程预览</span>
        </div>
      </header>

      <section aria-labelledby="pilot-preview-purpose-title" className="pilot-preview-purpose">
        <span>你实际要做什么</span>
        <h2 id="pilot-preview-purpose-title">课程任务：先做一题，再看讲解，再做一题</h2>
        <p>系统会比较引导前后的作答情况与阅读进度，最后收集一份匿名反馈。</p>
      </section>

      <ol aria-label="课程试点示例进度" className="pilot-preview-rail">
        {previewSteps.map((step, index) => (
          <li className={index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : "is-locked"} key={step.title}>
            <span aria-hidden="true">{index < activeIndex ? <Check size={15} /> : index + 1}</span>
            <div><small>{step.stage}</small><strong>{step.title}</strong><em>{index < activeIndex ? "已完成" : index === activeIndex ? "当前步骤" : "等待前一步"}</em></div>
          </li>
        ))}
      </ol>

      {activeStep ? (
        <section aria-live="polite" className="pilot-preview-step" aria-labelledby="pilot-preview-step-title">
          <header>
            <div><span>当前步骤</span><h2 id="pilot-preview-step-title">{activeStep.title}</h2></div>
            <strong>{activeStep.minutes}</strong>
          </header>
          <p>{activeStep.detail}</p>
          <dl>
            <div><dt>完成后记录</dt><dd>{activeStep.evidence}</dd></div>
          </dl>
          <button className="first-release-primary-action" onClick={() => setActiveIndex((index) => index + 1)} type="button">
            继续下一步 <ArrowRight aria-hidden="true" size={16} />
          </button>
        </section>
      ) : (
        <section aria-live="polite" className="pilot-preview-step pilot-preview-complete">
          <CheckCircle2 aria-hidden="true" size={28} />
          <div><h2>流程已完成</h2><p>完成三步后，提交一份简短反馈。需要参加时，请让管理员先登记你的匿名编号。</p></div>
          <Link className="secondary-button" to="/student/pilot-study">回到课程试点流程</Link>
        </section>
      )}

      <Link className="pilot-preview-back" to="/student/pilot-study">返回课程试点流程 <ArrowRight aria-hidden="true" size={15} /></Link>
    </div>
  );
}

export function PilotStudyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const previewMode = searchParams.get("pilot_preview") === "1";
  const [study, setStudy] = useState<PilotStudentStudy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [baselineConfidence, setBaselineConfidence] = useState(3);
  const [feedback, setFeedback] = useState<PilotFeedbackRequest>({
    ease_of_use: 3,
    guidance_helpfulness: 3,
    confidence_after: 3,
    continued_use_intent: 3,
    open_feedback: "",
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStudy(await getPilotStudy());
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (previewMode) return;
    void load();
  }, [previewMode]);

  const activeTask = useMemo(
    () => study?.kind === "enrolled"
      ? study.tasks.find((task) => task.status !== "completed") ?? null
      : null,
    [study],
  );

  const updateStudy = async (
    actionKey: string,
    action: () => Promise<PilotStudentStudy>,
  ) => {
    setBusy(actionKey);
    setError(null);
    try {
      const updated = await action();
      setStudy(updated);
      return updated;
    } catch (actionError) {
      setError(readableError(actionError));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const submitConsent = async (event: FormEvent) => {
    event.preventDefault();
    if (!accepted || study?.kind !== "enrolled") return;
    await updateStudy("consent", () => recordPilotConsent({
      accepted: true,
      notice_version: study.study.notice_version,
      baseline_confidence: baselineConfidence,
    }));
  };

  const beginTask = async (task: PilotTask) => {
    const updated = await updateStudy(task.task_id, () => startPilotTask(task.task_id));
    if (updated) navigate(withPilotTaskId(task.href, task.task_id));
  };

  const verifyReading = async (task: PilotTask) => {
    await updateStudy(task.task_id, () => completePilotTask(task.task_id, {}));
  };

  const submitFeedback = async (event: FormEvent) => {
    event.preventDefault();
    if (!feedback.open_feedback.trim()) return;
    await updateStudy("feedback", () => submitPilotFeedback({
      ...feedback,
      open_feedback: feedback.open_feedback.trim(),
    }));
  };

  if (previewMode) return <PilotStudyPreview />;

  if (loading) {
    return (
      <section className="page-inner pilot-study-state" role="status">
        <Clock3 aria-hidden="true" size={20} />
        <strong>正在读取课程试点记录…</strong>
      </section>
    );
  }

  if (!study && error) {
    return (
      <section className="page-inner pilot-study-state error" role="alert">
        <strong>{error}</strong>
        <button onClick={() => void load()} type="button">
          <RefreshCw aria-hidden="true" size={16} />重新读取
        </button>
      </section>
    );
  }

  if (study?.kind === "not_enrolled") {
    return (
      <section className="page-inner pilot-study-state empty pilot-not-enrolled-state" aria-labelledby="pilot-not-enrolled-title">
        <div className="pilot-empty-heading">
          <span className="first-release-kicker"><ClipboardCheck aria-hidden="true" size={15} />固定三阶段 · 需要登记</span>
          <h1 id="pilot-not-enrolled-title">当前账户尚未登记</h1>
          <p>“课程试点”不是日常课程任务，而是一套用于观察可用性和任务变化的固定课程试点。</p>
        </div>
        <section aria-labelledby="pilot-empty-purpose-title" className="pilot-empty-purpose">
          <div>
            <span>先知道它做什么</span>
            <h2 id="pilot-empty-purpose-title">这不是日常课程任务</h2>
          </div>
          <p>每位参与者按同一顺序完成任务，系统只记录你的作答、阅读位置和反馈，不会改写日常学习路径。</p>
        </section>
        <ol aria-label="课程试点开始步骤" className="pilot-empty-steps">
          <li><b>01</b><div><strong>管理员登记 · 匿名编号</strong><span>用编号绑定已有学生账户。</span></div></li>
          <li><b>02</b><div><strong>本人确认</strong><span>阅读说明并填写开始前信心。</span></div></li>
          <li><b>03</b><div><strong>完成三阶段</strong><span>基线题 → 引导阅读 → 迁移题，再提交反馈。</span></div></li>
        </ol>
        <div className="pilot-empty-boundary">
          <ShieldCheck aria-hidden="true" size={18} />
          <p><strong>当前状态</strong>请联系现场管理员使用匿名编号登记；登记后刷新本页即可开始。小样本只用于观察流程，不代表提分结论。</p>
        </div>
        <div className="pilot-empty-actions">
          <Link className="first-release-primary-action" to="/student/pilot-study?pilot_preview=1">
            先看一个课程试点示例 <ArrowRight aria-hidden="true" size={15} />
          </Link>
          <Link className="secondary-button" to="/student/home">返回我的学习 <ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      </section>
    );
  }

  if (!study || study.kind !== "enrolled") return null;

  const consented = Boolean(study.participant.consented_at)
    && study.participant.consent_notice_version === study.study.notice_version;
  const consentVersionStale = Boolean(study.participant.consented_at) && !consented;
  const allTasksCompleted = study.tasks.every((task) => task.status === "completed");

  return (
    <div className="page-inner pilot-study-page" data-visual-system="ochre-serif">
      <header className="pilot-study-heading">
        <div>
          <span className="first-release-kicker">408 · 课程试点</span>
          <h1>{study.study.title}</h1>
          <p>按顺序完成 3 项课程任务，作答、阅读和用时会自动记录。</p>
        </div>
        <dl className="pilot-participant-mark">
          <div><dt>匿名编号</dt><dd>{study.participant.participant_code}</dd></div>
          <div><dt>身份标签</dt><dd>{study.participant.role_label}</dd></div>
        </dl>
      </header>

      <section aria-label="课程试点流程说明" className="pilot-purpose-strip">
        <div><span>课程试点和日常学习的区别</span><strong>固定课程任务、按序完成、独立反馈</strong></div>
        <p>课程试点流程只用于观察可用性与任务变化，不会替代你的日常学习计划，也不自动生成提分结论。</p>
      </section>

      <TaskRail consented={consented} tasks={study.tasks} />

      {error ? <p className="pilot-inline-error" role="alert">{error}</p> : null}

      {!consented ? (
        <section className="pilot-action-surface" aria-labelledby="pilot-consent-title">
          <header>
            <ShieldCheck aria-hidden="true" size={21} />
            <div>
              <span>参加前确认</span>
              <h2 id="pilot-consent-title">阅读知情说明</h2>
            </div>
          </header>
          {consentVersionStale ? (
            <p className="pilot-inline-warning" role="status">知情说明版本已更新，请重新确认当前版本。</p>
          ) : null}
          <p className="pilot-notice-text">{study.study.notice_text}</p>
          <p className="pilot-claim-boundary">本次小样本仅用于观察可用性与任务变化，不作统计显著性结论。</p>
          <form className="pilot-consent-form" onSubmit={submitConsent}>
            <fieldset>
              <legend>开始前，你对完成这类题的信心</legend>
              <div className="pilot-rating-options">
                {scoreOptions.map((score) => (
                  <label key={score}>
                    <input
                      checked={baselineConfidence === score}
                      name="baseline-confidence"
                      onChange={() => setBaselineConfidence(score)}
                      type="radio"
                    />
                    <span>{score} 分</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="pilot-consent-check">
              <input
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                type="checkbox"
              />
              <span>同意参加本次课程试点</span>
            </label>
            <button
              className="first-release-primary-action"
              disabled={!accepted || busy === "consent"}
              type="submit"
            >
              {busy === "consent" ? "正在记录…" : consentVersionStale ? "重新确认并继续课程试点" : "同意并开始课程试点"}
            </button>
          </form>
        </section>
      ) : !allTasksCompleted && activeTask ? (
        <section className="pilot-action-surface" aria-labelledby="pilot-active-task-title">
          <header>
            {activeTask.status === "locked"
              ? <LockKeyhole aria-hidden="true" size={21} />
              : <ClipboardCheck aria-hidden="true" size={21} />}
            <div>
              <span>{stageLabels[activeTask.stage]} · 第 {activeTask.ordinal} 项</span>
              <h2 id="pilot-active-task-title">{activeTask.title}</h2>
            </div>
          </header>
          <p>{activeTask.instructions}</p>
          <dl className="pilot-evidence-boundary">
            <div>
              <dt>完成标准</dt>
              <dd>{activeTask.evidence_kind === "verified_course_reading" ? "完成指定阅读位置" : "提交本题作答"}</dd>
            </div>
            <div>
              <dt>辅助规则</dt>
              <dd>{activeTask.assistance_policy === "independent" ? "独立完成" : "使用课程讲解"}</dd>
            </div>
          </dl>
          <div className="pilot-action-row">
            {activeTask.status === "ready" ? (
              <button
                className="first-release-primary-action"
                disabled={busy === activeTask.task_id}
                onClick={() => void beginTask(activeTask)}
                type="button"
              >
                {busy === activeTask.task_id ? "正在开始…" : `开始${activeTask.title}`}
                <ArrowRight aria-hidden="true" size={16} />
              </button>
            ) : activeTask.status === "started"
              && activeTask.evidence_kind === "verified_course_reading" ? (
                <>
                  <Link
                    className="secondary-button"
                    to={withPilotTaskId(activeTask.href, activeTask.task_id)}
                  >
                    返回课程讲解
                  </Link>
                  <button
                    className="first-release-primary-action"
                    disabled={busy === activeTask.task_id}
                    onClick={() => void verifyReading(activeTask)}
                    type="button"
                  >
                    {busy === activeTask.task_id ? "正在记录…" : "记录阅读完成"}
                  </button>
                </>
              ) : activeTask.status === "started" ? (
                <Link
                  className="first-release-primary-action"
                  to={withPilotTaskId(activeTask.href, activeTask.task_id)}
                >
                  继续作答 <ArrowRight aria-hidden="true" size={16} />
                </Link>
              ) : null}
          </div>
        </section>
      ) : study.feedback ? (
        <section className="pilot-action-surface pilot-complete-state" aria-live="polite">
          <CheckCircle2 aria-hidden="true" size={26} />
          <div>
            <h2>反馈已记录</h2>
            <p>本次课程试点记录已按匿名编号保存。</p>
          </div>
          <Link className="secondary-button" to="/student/home">返回学习首页</Link>
        </section>
      ) : (
        <section className="pilot-action-surface" aria-labelledby="pilot-feedback-title">
          <header>
            <CheckCircle2 aria-hidden="true" size={21} />
            <div>
              <span>三项课程任务已完成</span>
              <h2 id="pilot-feedback-title">提交匿名反馈</h2>
            </div>
          </header>
          <p className="pilot-privacy-note">请勿填写姓名、学号、联系方式或密钥。</p>
          <form className="pilot-feedback-form" onSubmit={submitFeedback}>
            <div className="pilot-feedback-ratings">
              <RatingSelect label="流程易用性" onChange={(value) => setFeedback((current) => ({ ...current, ease_of_use: value }))} value={feedback.ease_of_use} />
              <RatingSelect label="讲解帮助程度" onChange={(value) => setFeedback((current) => ({ ...current, guidance_helpfulness: value }))} value={feedback.guidance_helpfulness} />
              <RatingSelect label="完成后的信心" onChange={(value) => setFeedback((current) => ({ ...current, confidence_after: value }))} value={feedback.confidence_after} />
              <RatingSelect label="继续使用意愿" onChange={(value) => setFeedback((current) => ({ ...current, continued_use_intent: value }))} value={feedback.continued_use_intent} />
            </div>
            <label className="pilot-feedback-copy">
              <span>补充反馈</span>
              <textarea
                aria-label="补充反馈"
                maxLength={500}
                onChange={(event) => setFeedback((current) => ({ ...current, open_feedback: event.target.value }))}
                rows={4}
                value={feedback.open_feedback}
              />
              <small>{feedback.open_feedback.length} / 500</small>
            </label>
            <button
              className="first-release-primary-action"
              disabled={!feedback.open_feedback.trim() || busy === "feedback"}
              type="submit"
            >
              {busy === "feedback" ? "正在提交…" : "提交匿名反馈"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
