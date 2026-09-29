import {
  ArrowRight,
  Bot,
  Clock3,
  Compass,
  Network,
  LoaderCircle,
  MessageCircleQuestion,
  RefreshCw,
  Send,
  Target,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  safeStudentAgentHref,
  useStudyAgent,
} from "./study-agent-controller";

export interface StudyAgentDockProps {
  autoOpen?: boolean;
  hidden?: boolean;
  userId?: string | null;
}

function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function autoOpenStorageKey(userId: string | null | undefined) {
  return `xuetu.study-agent.opened:${userId ?? "student"}:${localDate()}`;
}

function wasAutoOpened(key: string) {
  try {
    return window.sessionStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function rememberAutoOpen(key: string) {
  try {
    window.sessionStorage.setItem(key, "true");
  } catch {
    // The panel still works when browser storage is unavailable.
  }
}

export function StudyAgentDock({
  autoOpen = false,
  hidden = false,
  userId = null,
}: StudyAgentDockProps) {
  const storageKey = autoOpenStorageKey(userId);
  const [open, setOpen] = useState(
    () => autoOpen && !hidden && !wasAutoOpened(storageKey),
  );
  const [question, setQuestion] = useState("");
  const conversationEndRef = useRef<HTMLSpanElement>(null);
  const controller = useStudyAgent(open && !hidden);
  const snapshot = controller.snapshot;
  const taskHref = safeStudentAgentHref(snapshot?.current_task.href);
  const currentPriority = useMemo(() => snapshot?.course_priorities.find(
    (course) => course.course_id === snapshot.current_task.course_id,
  ) ?? null, [snapshot]);
  const rationale = currentPriority?.rationale ?? snapshot?.current_task.reason ?? null;

  useEffect(() => {
    if (!autoOpen || hidden || open || wasAutoOpened(storageKey)) return;
    setOpen(true);
  }, [autoOpen, hidden, open, storageKey]);

  useEffect(() => {
    if (!autoOpen || hidden || !open) return;
    rememberAutoOpen(storageKey);
  }, [autoOpen, hidden, open, storageKey]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [controller.aiLoading, controller.turns]);

  if (hidden) return null;

  const headerStatus = controller.snapshotLoading
    ? "正在整理今天的任务"
    : controller.snapshotError
      ? "任务读取暂时中断"
      : controller.aiLoading
        ? "正在整理"
        : "已整理当前学习安排";

  const quickQuestions = snapshot ? [
    "为什么先学这个？",
    "今天时间不够怎么办？",
    snapshot.current_task.task_type === "mistake_review"
      ? "复习完这道错题后做什么？"
      : "完成这一项后做什么？",
  ] : [];

  const sendQuestion = async (content: string) => {
    if (!content.trim() || controller.aiLoading) return;
    setQuestion("");
    await controller.submitQuestion(content);
  };

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    void sendQuestion(question);
  };

  if (!open) {
    return (
      <button
        aria-label="打开学习管家"
        className="study-agent-trigger"
        onClick={() => setOpen(true)}
        title="打开学习管家"
        type="button"
      >
        <span className="study-agent-orbit"><Compass aria-hidden="true" size={18} /></span>
      </button>
    );
  }

  return (
    <aside aria-label="学习管家" className="study-agent-dock">
      <header>
        <span className="study-agent-orbit"><Bot aria-hidden="true" size={18} /></span>
        <div>
          <strong>AI 学伴</strong>
          <small>{headerStatus} · 随时答疑</small>
        </div>
        <button
          aria-label="关闭学习管家"
          className="icon-button"
          onClick={() => setOpen(false)}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </header>

      <div className="study-agent-body">
        {controller.snapshotLoading && !snapshot ? (
          <div aria-live="polite" className="study-agent-loading" role="status">
            <LoaderCircle aria-hidden="true" className="is-spinning" size={18} />
            <span>正在加载今日安排…</span>
          </div>
        ) : controller.snapshotError && !snapshot ? (
          <div className="study-agent-error" role="alert">
            <p>{controller.snapshotError}</p>
            <button onClick={controller.reload} type="button">
              <RefreshCw aria-hidden="true" size={14} />重新读取任务
            </button>
          </div>
        ) : snapshot ? (
          <>
            {controller.refreshedNotice ? (
              <p className="study-agent-refresh-notice" role="status">{controller.refreshedNotice}</p>
            ) : null}

            <section className="study-agent-decision" aria-labelledby="study-agent-task-title">
              <span>{snapshot.current_task.course_title}</span>
              <h3 id="study-agent-task-title">今天先完成：{snapshot.current_task.title}</h3>
              {rationale ? <p>{rationale}</p> : null}
              <small><Clock3 aria-hidden="true" size={14} />约 {snapshot.current_task.estimated_minutes} 分钟</small>
            </section>

            <nav className="study-agent-capabilities" aria-label="AI 学伴功能">
              <Link to="/student/practice"><Target aria-hidden="true" size={15} /><span>智能出题</span><small>按薄弱点练习</small></Link>
              <Link to="/student/question-map"><Network aria-hidden="true" size={15} /><span>知识图谱</span><small>查看掌握路径</small></Link>
              <Link to="/student/ask"><MessageCircleQuestion aria-hidden="true" size={15} /><span>课程答疑</span><small>随时追问概念</small></Link>
            </nav>

            <section className="study-agent-conversation" aria-label="与学习管家的对话" aria-live="polite">
              {controller.turns.map((turn) => (
                <article className={`study-agent-turn is-${turn.role}`} key={turn.id}>
                  <span>{turn.role === "student" ? "你" : "学习管家"}</span>
                  <p>{turn.text}</p>
                </article>
              ))}
              {controller.aiLoading ? (
                <div className="study-agent-thinking" role="status">
                  <LoaderCircle aria-hidden="true" className="is-spinning" size={15} />
                  <span>正在整理…</span>
                </div>
              ) : null}
              {controller.aiError && !controller.aiLoading ? (
                <button className="study-agent-retry" onClick={controller.retryExplanation} type="button">
                  <RefreshCw aria-hidden="true" size={14} />重新整理
                </button>
              ) : null}
              <span aria-hidden="true" className="study-agent-conversation-end" ref={conversationEndRef} />
            </section>

            <div className="study-agent-suggestions" aria-label="快捷提问">
              {quickQuestions.map((item) => (
                <button
                  disabled={controller.aiLoading}
                  key={item}
                  onClick={() => void sendQuestion(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <footer className="study-agent-footer">
        <form className="study-agent-composer" onSubmit={submitQuestion}>
          <input
            aria-label="向学习管家提问"
            autoComplete="off"
            disabled={!snapshot || controller.aiLoading}
            maxLength={1_000}
            name="study-agent-question"
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="问我课程、错题或学习安排…"
            value={question}
          />
          <button
            aria-label="发送问题"
            disabled={!snapshot || !question.trim() || controller.aiLoading}
            type="submit"
          >
            <Send aria-hidden="true" size={16} />
          </button>
        </form>

        <div className="study-agent-actions">
          {taskHref ? (
            <Link className="study-agent-primary-action" to={taskHref}>
              <Target aria-hidden="true" size={15} />开始这项任务<ArrowRight aria-hidden="true" size={15} />
            </Link>
          ) : (
            <span className="study-agent-action-unavailable">当前任务入口暂不可用</span>
          )}
          <Link className="study-agent-profile-action" to="/student/profile">查看学习进度</Link>
        </div>
      </footer>
    </aside>
  );
}
