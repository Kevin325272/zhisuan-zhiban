import type {
  AnswerSubmission,
  MockExamSession as MockExamSessionData,
  MockExamSubmissionResult,
  QuestionDto,
} from "@xuetu/contracts";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileCheck2,
  RotateCcw,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  startMockExam,
  submitMockExam,
} from "../../api/client";
import { clearMockExamDraft, readMockExamDraft, saveMockExamDraft } from "../../lib/mock-exam-draft-store";
import { useAuth } from "../auth/auth-context";

function readableError(prefix: string, error: unknown) {
  if (error instanceof ApiError) return `${prefix}：${error.message}`;
  return `${prefix}，请稍后重试。`;
}

function newSubmissionKey() {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `mock-exam-submit-${suffix}`;
}

function remainingSeconds(expiresAt: string, now: number) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1_000));
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function optionLabel(option: QuestionDto["options"][number]) {
  return `${option.option_id}. ${option.text}`;
}

export function MockExamSession() {
  const owner = useAuth().account?.user_id ?? null;
  const [sessionOwner, setSessionOwner] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [session, setSession] = useState<MockExamSessionData | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [choiceDrafts, setChoiceDrafts] = useState<Record<string, string[]>>({});
  const [subjectiveDrafts, setSubjectiveDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionKey, setSubmissionKey] = useState<string | null>(null);
  const [result, setResult] = useState<MockExamSubmissionResult | null>(null);

  useEffect(() => {
    if (!session || result) return undefined;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [result, session]);

  const secondsLeft = session
    ? remainingSeconds(session.expires_at, now + serverClockOffsetMs)
    : 0;
  const expired = Boolean(session && secondsLeft === 0);
  const currentItem = session?.questions[activeIndex] ?? null;
  const currentQuestion = currentItem?.question ?? null;

  useEffect(() => {
    if (!session || sessionOwner !== owner) return;
    if (result || expired) {
      if (owner) clearMockExamDraft(owner);
      setDraftSaved(false);
      return;
    }
    setDraftSaved(saveMockExamDraft(owner, session, {
      choices: choiceDrafts, subjective: subjectiveDrafts, activeIndex, submissionKey,
    }));
  }, [activeIndex, choiceDrafts, expired, owner, result, session, sessionOwner, subjectiveDrafts, submissionKey]);

  useEffect(() => {
    if (sessionOwner !== owner) {
      setSession(null);
      setConfirmOpen(false);
      setResult(null);
    }
  }, [owner, sessionOwner]);

  const answers = useMemo<AnswerSubmission[]>(() => {
    if (!session) return [];
    const collected: AnswerSubmission[] = [];
    for (const { question } of session.questions) {
      if (question.type === "choice") {
        const selected = choiceDrafts[question.id] ?? [];
        if (selected.length > 0) {
          collected.push({
            question_id: question.id,
            answer_type: "choice",
            selected_option_ids: selected,
          });
        }
        continue;
      }
      const response = subjectiveDrafts[question.id]?.trim() ?? "";
      if (response) {
        collected.push({
          question_id: question.id,
          answer_type: "subjective",
          response_text: response,
        });
      }
    }
    return collected;
  }, [choiceDrafts, session, subjectiveDrafts]);

  const answeredIds = useMemo(
    () => new Set(answers.map((answer) => answer.question_id)),
    [answers],
  );
  const unansweredCount = session ? session.questions.length - answeredIds.size : 0;

  const receiveSession = (started: MockExamSessionData) => {
    const clientNow = Date.now();
    const restored = readMockExamDraft(owner, started);
    setSessionOwner(owner);
    setSession(started);
    setNow(clientNow);
    setServerClockOffsetMs(new Date(started.server_now).getTime() - clientNow);
    setActiveIndex(restored.activeIndex);
    setChoiceDrafts(restored.choices);
    setSubjectiveDrafts(restored.subjective);
    setSubmissionError(null);
    setSubmissionKey(restored.submissionKey);
    setConfirmOpen(false);
    setResult(null);
  };

  const beginExam = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const started = await startMockExam({});
      receiveSession(started);
    } catch (error) {
      setStartError(readableError("模考启动失败", error));
    } finally {
      setStarting(false);
    }
  };

  const restartExpiredExam = async () => {
    if (!session || !expired || starting) return;
    setStarting(true);
    setSubmissionError(null);
    try {
      receiveSession(await startMockExam({ year: session.year }));
    } catch (error) {
      setSubmissionError(readableError("模考重开失败", error));
    } finally {
      setStarting(false);
    }
  };

  const chooseOption = (question: QuestionDto, optionId: string) => {
    if (expired || submitting || result) return;
    setSubmissionKey(null);
    setChoiceDrafts((current) => {
      const selected = current[question.id] ?? [];
      const next = question.multiple
        ? selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId]
        : [optionId];
      return { ...current, [question.id]: next };
    });
  };

  const performSubmit = async () => {
    if (!session || expired || submitting || result) return;
    const key = submissionKey ?? newSubmissionKey();
    if (!submissionKey) setSubmissionKey(key);
    setConfirmOpen(false);
    setSubmitting(true);
    setSubmissionError(null);
    try {
      setResult(await submitMockExam(session.session_id, { answers }, key));
    } catch (error) {
      setSubmissionError(readableError("交卷失败", error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!session || sessionOwner !== owner) {
    return (
      <section aria-labelledby="mock-exam-start-title" className="mock-exam-start-sheet">
        <div className="mock-exam-start-copy">
          <span className="first-release-kicker">408 · 限时训练</span>
          <h2 id="mock-exam-start-title">408 限时模考</h2>
          <p>开始后显示本场题量与时长。交卷前不显示答案、解析或对错状态。</p>
          <ul>
            <li>答题过程中持续计时，倒计时结束后作答锁定。</li>
            <li>题目覆盖 408 四门课程，用于阶段复习与节奏训练。</li>
            <li>交卷后统一结算客观题得分，并保留错题记录。</li>
          </ul>
        </div>
        <form
          className="mock-exam-start-control"
          onSubmit={(event) => {
            event.preventDefault();
            void beginExam();
          }}
        >
          <Clock3 aria-hidden="true" size={28} />
          <strong>限时作答</strong>
          <span>按本场题组计时 · 不可暂停</span>
          <button className="first-release-primary-action" disabled={starting} type="submit">
            {starting ? "正在建立考场…" : startError ? "重新开始" : "开始限时模考"}
          </button>
          {startError ? <p className="practice-inline-error" role="alert">{startError}</p> : null}
        </form>
      </section>
    );
  }

  if (result) {
    return (
      <section aria-label="模考结果" className="mock-exam-result" role="region">
        <header>
          <FileCheck2 aria-hidden="true" size={28} />
          <div>
            <span>本次限时模考已提交</span>
            <h2>本场只结算可确定部分</h2>
          </div>
        </header>
        <dl>
          <div><dt>客观题</dt><dd>{result.objective.score} / {result.objective.max_score} 分</dd></div>
          <div><dt>主观题</dt><dd>{result.subjective.pending_review_count} 道待审核</dd></div>
          <div><dt>作答情况</dt><dd>{result.unanswered_count} 道未作答</dd></div>
        </dl>
        <p>当前结果不是 408 完整总分；主观题完成教师审核前，不合成总成绩。</p>
        <button className="secondary-button" onClick={() => setSession(null)} type="button">返回模考入口</button>
      </section>
    );
  }

  if (!currentQuestion) return null;
  const currentChoice = choiceDrafts[currentQuestion.id] ?? [];

  return (
    <section className="mock-exam-workspace" aria-label="限时模考答题区">
      <article className="mock-exam-paper">
        <header className="mock-exam-paper-heading">
          <span>第 {activeIndex + 1} / {session.questions.length} 题</span>
          <h2>{session.questions.every(item => item.learning_metadata.source_type === "past_exam")
            ? `${session.year} 年 408 真题模考`
            : session.questions.every(item => item.learning_metadata.source_type === "self_authored_practice")
              ? "平台自编综合卷" : "408 综合模考"}</h2>
          <p>{currentQuestion.subject} · {currentItem?.learning_metadata.source_type === "past_exam" ? `${currentQuestion.year} 年真题` : currentItem?.learning_metadata.source_type === "self_authored_practice" ? "平台自编题" : "模拟题"} · 原题号 {currentQuestion.number} · {currentQuestion.type === "choice" ? (currentQuestion.multiple ? "多选题" : "单选题") : "主观题"}</p>
        </header>
        <p className="question-stem">{currentQuestion.question}</p>
        {currentQuestion.type === "choice" ? (
          <fieldset className="question-options" disabled={expired || submitting}>
            <legend>{currentQuestion.multiple ? "选择所有正确选项" : "选择一个答案"}</legend>
            {currentQuestion.options.map((option) => (
              <label className={currentChoice.includes(option.option_id) ? "selected-option" : ""} key={option.option_id}>
                <input
                  aria-label={optionLabel(option)}
                  checked={currentChoice.includes(option.option_id)}
                  name={`mock-answer-${currentQuestion.id}`}
                  onChange={() => chooseOption(currentQuestion, option.option_id)}
                  type={currentQuestion.multiple ? "checkbox" : "radio"}
                />
                <span className="option-key">{option.option_id}</span>
                <span className="option-text">{option.text}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label className="mock-subjective-answer">
            <span>第 {activeIndex + 1} 题作答</span>
            <textarea
              aria-label={`第 ${activeIndex + 1} 题作答`}
              disabled={expired || submitting}
              onChange={(event) => {
                setSubmissionKey(null);
                setSubjectiveDrafts((current) => ({ ...current, [currentQuestion.id]: event.target.value }));
              }}
              placeholder="在此写出推导过程与最终结论"
              value={subjectiveDrafts[currentQuestion.id] ?? ""}
            />
          </label>
        )}
        <footer className="mock-exam-question-controls">
          <button disabled={activeIndex === 0} onClick={() => setActiveIndex((index) => index - 1)} type="button">
            <ChevronLeft aria-hidden="true" size={17} />上一题
          </button>
          <span>{expired ? "本场已结束，重开将清除作答" : draftSaved ? "草稿已保存，当前标签页刷新后可恢复；退出登录会清除" : "草稿仅保留在当前页面，刷新会丢失"}</span>
          <button disabled={activeIndex === session.questions.length - 1} onClick={() => setActiveIndex((index) => index + 1)} type="button">
            下一题<ChevronRight aria-hidden="true" size={17} />
          </button>
        </footer>
      </article>

      <aside className="mock-exam-rail">
        <div className={`mock-exam-timer${secondsLeft <= 15 * 60 ? " urgent" : ""}`}>
          <span>剩余时间</span>
          <strong aria-label="剩余时间" role="timer">{formatDuration(secondsLeft)}</strong>
          <small>以本场倒计时为准</small>
        </div>
        {expired ? (
          <p className="mock-exam-expired" role="alert"><AlertTriangle aria-hidden="true" size={17} />本场模考时间已结束，作答已锁定。</p>
        ) : null}
        <div className="mock-question-index" aria-label="题号导航">
          {session.questions.map(({ question }, index) => (
            <button
              aria-label={`第 ${index + 1} 题`}
              aria-current={index === activeIndex ? "true" : undefined}
              className={answeredIds.has(question.id) ? "answered" : ""}
              key={question.id}
              onClick={() => setActiveIndex(index)}
              type="button"
            >
              {index + 1}
            </button>
          ))}
        </div>
        <div className="mock-exam-progress">
          <span>已答 {answeredIds.size} / {session.questions.length}</span>
          <span>未答 {unansweredCount}</span>
        </div>
        {expired ? (
          <div className="mock-submit-error">
            {submissionError ? <p role="alert">{submissionError}</p> : null}
            <button className="first-release-primary-action" disabled={starting} onClick={() => void restartExpiredExam()} type="button">
              <RotateCcw aria-hidden="true" size={17} />{starting ? "正在重新开场…" : "重新开始本场"}
            </button>
          </div>
        ) : submissionError ? (
          <div className="mock-submit-error">
            <p role="alert">{submissionError}</p>
            <button className="first-release-primary-action" disabled={submitting || expired} onClick={() => void performSubmit()} type="button">
              {submitting ? "正在重新交卷…" : "重新交卷"}
            </button>
          </div>
        ) : (
          <button className="mock-submit-button" disabled={submitting || expired} onClick={() => setConfirmOpen(true)} type="button">
            <Send aria-hidden="true" size={17} />{submitting ? "正在交卷…" : "交卷"}
          </button>
        )}
      </aside>

      {confirmOpen ? (
        <div aria-label="确认交卷" aria-modal="true" className="mock-submit-dialog" role="dialog">
          <div>
            <AlertTriangle aria-hidden="true" size={24} />
            <h3>确认交卷</h3>
            <p>{unansweredCount > 0 ? `还有 ${unansweredCount} 道题未作答。` : "所有题目均已作答。"}交卷后不能修改本场答案。</p>
            <footer>
              <button className="secondary-button" onClick={() => setConfirmOpen(false)} type="button">继续检查</button>
              <button className="first-release-primary-action" onClick={() => void performSubmit()} type="button">确认交卷</button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
