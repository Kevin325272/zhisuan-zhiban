import { programmingLanguageMeta, type ProgrammingLanguage } from "@xuetu/contracts";
import {
  ArrowUp,
  Bot,
  CalendarPlus,
  CheckCircle2,
  Code2,
  FlaskConical,
  GitBranch,
  ListChecks,
  LoaderCircle,
  LocateFixed,
  Sparkles,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  askCourseQuestion,
  type TutorHintLevel,
  type TutorWorkspaceContext,
} from "../api/client";
import { addGeneratedReviewCard, loadLearningOutputs } from "../lib/learning-output-store";

interface ContextTutorPanelProps {
  context: TutorWorkspaceContext;
  open: boolean;
  onClose: () => void;
  onLocateError: () => void;
  onOpenTests: () => void;
  onOpenTrace: () => void;
}

interface TutorTurn {
  id: number;
  question: string;
  answer: string | null;
  error: string | null;
}

interface GeneratedTutorTest {
  title: string;
  input: string;
  expected: string;
  check: string;
}

const hintLevels: Array<{ value: TutorHintLevel; label: string; shortLabel: string }> = [
  { value: "direction", label: "只给方向", shortLabel: "方向" },
  { value: "clue", label: "关键线索", shortLabel: "线索" },
  { value: "steps", label: "分步讲解", shortLabel: "分步" },
  { value: "complete", label: "完整解释", shortLabel: "完整" },
];

const viewLabels: Record<TutorWorkspaceContext["active_view"], string> = {
  code: "代码编辑",
  trace: "运行轨迹",
  tests: "测试结果",
  evidence: "学习证据",
  history: "提交记录",
  ask: "课程问答",
};

function languageLabel(language: string | null) {
  if (!language || !(language in programmingLanguageMeta)) return language ?? "未选择语言";
  return programmingLanguageMeta[language as ProgrammingLanguage].label;
}

function eventText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function buildTargetedTest(context: TutorWorkspaceContext): GeneratedTutorTest {
  if (context.test_summary?.includes("菱形汇聚图") || context.task_title?.includes("BFS")) {
    return {
      title: "菱形汇聚图专项测试",
      input: "start=1\n1 2\n1 3\n2 4\n3 4",
      expected: "1 2 3 4",
      check: "节点 4 只能入队一次，重点观察第二条汇聚边被扫描时的 visited。",
    };
  }

  return {
    title: "当前任务边界测试",
    input: "空输入 / 单节点 / 重复边各执行一次",
    expected: "结果稳定且不产生重复状态",
    check: "先记录失败输入，再比较修复前后的状态变化。",
  };
}

function nextReviewDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function ContextTutorPanel({
  context,
  open,
  onClose,
  onLocateError,
  onOpenTests,
  onOpenTrace,
}: ContextTutorPanelProps) {
  const [hintLevel, setHintLevel] = useState<TutorHintLevel>("clue");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatedTest, setGeneratedTest] = useState<GeneratedTutorTest | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"added" | "existing" | null>(null);
  const turnIdRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setGeneratedTest(null);
    setReviewStatus(null);
  }, [context.task_title]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    conversation.scrollTo?.({ behavior: "smooth", top: conversation.scrollHeight });
  }, [loading, turns]);

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const content = question.trim();
    if (!content || loading) return;

    const turnId = ++turnIdRef.current;
    setQuestion("");
    setTurns((current) => [
      ...current,
      { id: turnId, question: content, answer: null, error: null },
    ]);
    setLoading(true);

    try {
      const events = await askCourseQuestion(content, "auto", {
        hintLevel,
        workspaceContext: context,
      });
      const failure = events.find((item) => item.type === "run.failed");
      if (failure) {
        const rawError = failure.payload.error;
        const message =
          rawError && typeof rawError === "object" && "message" in rawError
            ? eventText(rawError.message)
            : "这轮回答没有完成，请稍后再试。";
        throw new Error(message || "这轮回答没有完成，请稍后再试。");
      }

      const answer = events
        .filter((item) => item.type === "assistant.delta")
        .map((item) => eventText(item.payload.delta))
        .join("")
        .trim();
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? { ...turn, answer: answer || "我暂时没有生成有效回答，可以换一种问法。" }
            : turn,
        ),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "这轮回答没有完成，请稍后再试。";
      setTurns((current) =>
        current.map((turn) => (turn.id === turnId ? { ...turn, error: message } : turn)),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside
      aria-label="上下文助学助手"
      className={`context-tutor-panel${open ? " open" : ""}`}
      hidden={!open}
    >
      <header className="context-tutor-heading">
        <span><Sparkles aria-hidden="true" size={17} /></span>
        <div>
          <h2>当前任务助手</h2>
          <small><i /> 当前任务</small>
        </div>
        <button aria-label="关闭上下文助学助手" className="icon-button" onClick={onClose} type="button">
          <X aria-hidden="true" size={17} />
        </button>
      </header>

      <div className="context-tutor-snapshot" aria-label="当前任务">
        <span><Code2 aria-hidden="true" size={14} />{viewLabels[context.active_view]} · {languageLabel(context.language)}</span>
        <small>
          {context.error_line
            ? `失败位置：第 ${context.error_line} 行`
            : "代码与任务已就绪"}
        </small>
      </div>

      <div className="context-tutor-conversation" ref={conversationRef}>
        {turns.length === 0 ? (
          <div className="context-tutor-welcome">
            <Bot aria-hidden="true" size={18} />
            <div>
              <strong>我已经看到你正在处理的内容</strong>
              <p>直接问“为什么失败”或“下一步看哪里”。</p>
            </div>
          </div>
        ) : null}

        {turns.map((turn, index) => (
          <div className="context-tutor-turn" key={turn.id}>
            <p className="context-tutor-user">{turn.question}</p>
            {turn.answer ? (
              <div className="context-tutor-answer">
                <span><Sparkles aria-hidden="true" size={14} /></span>
                <div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown>
                  {index === turns.length - 1 ? (
                    <div className="context-tutor-actions">
                      {context.error_line ? (
                        <button onClick={onLocateError} type="button">
                          <LocateFixed aria-hidden="true" size={13} />定位第 {context.error_line} 行
                        </button>
                      ) : null}
                      <button onClick={onOpenTests} type="button">
                        <ListChecks aria-hidden="true" size={13} />查看测试结果
                      </button>
                      <button onClick={onOpenTrace} type="button">
                        <GitBranch aria-hidden="true" size={13} />打开运行轨迹
                      </button>
                      <button onClick={() => setGeneratedTest(buildTargetedTest(context))} type="button">
                        <FlaskConical aria-hidden="true" size={13} />生成针对性测试
                      </button>
                      <button
                        onClick={() => {
                          const reviewCard = {
                            id: "tutor-review-bfs-visited",
                            sourceId: context.task_title ?? "current-task",
                            title: context.task_title?.includes("BFS")
                              ? "BFS visited 标记时机"
                              : "当前任务错因回看",
                            course: "数据结构",
                            minutes: 8,
                            reason: context.test_summary
                              ? `复习重点：${context.test_summary}`
                              : "巩固本次讲解",
                            href: "/student/tasks/task_bfs_bug_001?view=evidence",
                            scheduledFor: nextReviewDate(),
                          };
                          const alreadyScheduled = loadLearningOutputs().reviewCards.some(
                            (item) =>
                              item.title === reviewCard.title &&
                              item.course === reviewCard.course &&
                              item.scheduledFor === reviewCard.scheduledFor,
                          );
                          addGeneratedReviewCard(reviewCard);
                          setReviewStatus(alreadyScheduled ? "existing" : "added");
                        }}
                        type="button"
                      >
                        <CalendarPlus aria-hidden="true" size={13} />加入复习
                      </button>
                    </div>
                  ) : null}
                  {index === turns.length - 1 && generatedTest ? (
                    <section className="context-tutor-generated-test" aria-labelledby="generated-test-title">
                      <header>
                        <span><FlaskConical aria-hidden="true" size={14} /></span>
                        <div><h3 id="generated-test-title">{generatedTest.title}</h3></div>
                      </header>
                      <dl>
                        <div><dt>输入</dt><dd><pre>{generatedTest.input}</pre></dd></div>
                        <div><dt>期望输出</dt><dd><pre>{generatedTest.expected}</pre></dd></div>
                      </dl>
                      <p>{generatedTest.check}</p>
                    </section>
                  ) : null}
                  {index === turns.length - 1 && reviewStatus ? (
                    <p aria-label="复习任务已创建" className="context-tutor-review-confirmation" role="status">
                      <CheckCircle2 aria-hidden="true" size={14} />
                      {reviewStatus === "existing"
                        ? "这项内容已在复习计划中，无需重复添加。"
                        : "已加入复习计划，明天回看本次错因。"}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : turn.error ? (
              <p className="context-tutor-error" role="alert">{turn.error}</p>
            ) : loading && index === turns.length - 1 ? (
              <div className="context-tutor-thinking" role="status">
                <LoaderCircle aria-hidden="true" className="spin" size={15} />
                正在整理运行结果…
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <form className="context-tutor-composer" onSubmit={submitQuestion}>
        <fieldset className="context-tutor-hints">
          <legend>回答深度</legend>
          {hintLevels.map((item) => (
            <button
              aria-label={item.label}
              aria-pressed={hintLevel === item.value}
              className={hintLevel === item.value ? "active" : undefined}
              key={item.value}
              onClick={() => setHintLevel(item.value)}
              title={item.label}
              type="button"
            >
              {item.shortLabel}
            </button>
          ))}
        </fieldset>
        <div className="context-tutor-input">
          <textarea
            aria-label="向上下文助学助手提问"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder="结合当前页面提问…"
            ref={inputRef}
            rows={2}
            value={question}
          />
          <button
            aria-label="发送给上下文助学助手"
            disabled={!question.trim() || loading}
            title="发送"
            type="submit"
          >
            {loading ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : <ArrowUp aria-hidden="true" size={16} />}
          </button>
        </div>
      </form>
    </aside>
  );
}
