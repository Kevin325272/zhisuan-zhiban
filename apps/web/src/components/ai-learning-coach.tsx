import {
  programmingLanguageMeta,
  type AgentEvent,
  type AlgorithmTraceStep,
  type Citation,
  type CodeRunResult,
  type Diagnosis,
  type ProgrammingLanguage,
  type TraceVariant,
} from "@xuetu/contracts";
import {
  AlertTriangle,
  ArrowUp,
  BrainCircuit,
  BookOpenCheck,
  Bot,
  Braces,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  Database,
  FlaskConical,
  GitBranch,
  ListChecks,
  LoaderCircle,
  LocateFixed,
  MessageCircleQuestion,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  askCourseQuestion,
  getSource,
  type SubmissionData,
  type TutorHintLevel,
  type TutorWorkspaceContext,
} from "../api/client";
import { addGeneratedReviewCard, loadLearningOutputs } from "../lib/learning-output-store";

export type AiCoachPhase =
  | "context_ready"
  | "evaluating"
  | "evidence_ready"
  | "diagnosing"
  | "coaching"
  | "verification_ready"
  | "degraded";

interface CoachPhaseInput {
  running: boolean;
  submitting: boolean;
  runResult: CodeRunResult | null;
  submission: SubmissionData | null;
  diagnosis: Diagnosis | null;
  events: AgentEvent[];
}

export function deriveCoachPhase({
  running,
  submitting,
  runResult,
  submission,
  diagnosis,
  events,
}: CoachPhaseInput): AiCoachPhase {
  if (events.some((event) => event.type === "run.failed")) return "degraded";
  if (submission?.validation_id) return "verification_ready";
  if (running) return "evaluating";
  if (submitting || (submission && !diagnosis && events.length === 0)) return "diagnosing";
  if (diagnosis || events.some((event) => event.type === "run.completed")) return "coaching";
  if (runResult) return "evidence_ready";
  return "context_ready";
}

const phaseMeta: Record<AiCoachPhase, { label: string; detail: string }> = {
  context_ready: {
    label: "已同步当前任务",
    detail: "可以直接提问。",
  },
  evaluating: {
    label: "正在读取运行结果",
    detail: "等待运行结果。",
  },
  evidence_ready: {
    label: "运行结果已返回",
    detail: "可以查看失败用例并继续分析。",
  },
  diagnosing: {
    label: "正在形成助学诊断",
    detail: "正在整理问题线索。",
  },
  coaching: {
    label: "诊断与建议已就绪",
    detail: "核对后选择下一步学习动作。",
  },
  verification_ready: {
    label: "等待独立验证",
    detail: "修复已经通过，接下来确认是否真正掌握。",
  },
  degraded: {
    label: "部分助学能力暂不可用",
    detail: "运行结果已保留，可以稍后重试。",
  },
};

const stageLabels = [
  { key: "evidence", label: "检查代码与运行结果", icon: Code2 },
  { key: "retrieval", label: "对照课程知识", icon: Database },
  { key: "diagnosis", label: "定位错误原因", icon: BrainCircuit },
  { key: "action", label: "给出下一步", icon: ListChecks },
] as const;

function completedStageCount(phase: AiCoachPhase) {
  const counts: Record<AiCoachPhase, number> = {
    context_ready: 0,
    evaluating: 0,
    evidence_ready: 1,
    diagnosing: 1,
    coaching: 4,
    verification_ready: 4,
    degraded: 1,
  };
  return counts[phase];
}

interface TutorTurn {
  id: number;
  question: string;
  answer: string | null;
  /** 流式增量文本：完整回答生成前逐段累积展示。 */
  partial: string | null;
  citations: Citation[];
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

export interface AiLearningCoachProps {
  collapsed: boolean;
  context: TutorWorkspaceContext;
  diagnosis: Diagnosis | null;
  events: AgentEvent[];
  onLocateError: () => void;
  onOpenTests: () => void;
  onOpenTrace: () => void;
  onRetry: () => void;
  onToggleCollapsed: () => void;
  runResult: CodeRunResult | null;
  running: boolean;
  sources: Citation[];
  submission: SubmissionData | null;
  submitting: boolean;
  traceStep: AlgorithmTraceStep | null;
  traceVariant: TraceVariant;
}

export function AiLearningCoach({
  collapsed,
  context,
  diagnosis,
  events,
  onLocateError,
  onOpenTests,
  onOpenTrace,
  onRetry,
  onToggleCollapsed,
  runResult,
  running,
  sources,
  submission,
  submitting,
  traceStep,
  traceVariant,
}: AiLearningCoachProps) {
  const [hintLevel, setHintLevel] = useState<TutorHintLevel>("clue");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [generatedTest, setGeneratedTest] = useState<GeneratedTutorTest | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"added" | "existing" | null>(null);
  const turnIdRef = useRef(0);
  const conversationRef = useRef<HTMLDivElement>(null);
  const phase = deriveCoachPhase({
    diagnosis,
    events,
    runResult,
    running,
    submission,
    submitting,
  });
  const meta = phaseMeta[phase];
  const completed = completedStageCount(phase);
  const activeStage = phase === "evaluating" ? 0 : phase === "diagnosing" ? 1 : -1;
  const failure = events.find((item) => item.type === "run.failed");
  const degradedRetrieval = events.find(
    (item) => item.type === "retrieval.completed" && item.payload.degraded === true,
  );
  const citationIds = Array.isArray(degradedRetrieval?.payload.citation_ids)
    ? degradedRetrieval.payload.citation_ids
    : [];
  const emptyRetrieval = Boolean(degradedRetrieval && citationIds.length === 0);
  const lowConfidenceRetrieval = Boolean(degradedRetrieval && citationIds.length > 0);
  const assistantText = events
    .filter((item) => item.type === "assistant.delta")
    .map((item) => String(item.payload.delta ?? ""))
    .join("");
  useEffect(() => {
    setGeneratedTest(null);
    setReviewStatus(null);
  }, [context.task_id]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    conversation.scrollTo?.({ behavior: "smooth", top: conversation.scrollHeight });
  }, [chatLoading, turns]);

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const content = question.trim();
    if (!content || chatLoading) return;

    const turnId = ++turnIdRef.current;
    setQuestion("");
    setTurns((current) => [
      ...current,
      {
        id: turnId,
        question: content,
        answer: null,
        partial: null,
        citations: [],
        error: null,
      },
    ]);
    setChatLoading(true);

    try {
      const responseEvents = await askCourseQuestion(content, "auto", {
        hintLevel,
        workspaceContext: context,
        onEvent: (streamEvent) => {
          if (streamEvent.type !== "assistant.delta") return;
          const delta = eventText(streamEvent.payload.delta);
          if (!delta) return;
          setTurns((current) => current.map((turn) => (
            turn.id === turnId
              ? { ...turn, partial: (turn.partial ?? "") + delta }
              : turn
          )));
        },
      });
      const failed = responseEvents.find((item) => item.type === "run.failed");
      if (failed) {
        const rawError = failed.payload.error;
        const message = rawError && typeof rawError === "object" && "message" in rawError
          ? eventText(rawError.message)
          : "这轮回答没有完成，请稍后再试。";
        throw new Error(message || "这轮回答没有完成，请稍后再试。");
      }

      const answer = responseEvents
        .filter((item) => item.type === "assistant.delta")
        .map((item) => eventText(item.payload.delta))
        .join("")
        .trim();
      const citationIds = [
        ...new Set(
          responseEvents
            .filter((item) => item.type === "retrieval.completed")
            .flatMap((item) => (
              Array.isArray(item.payload.citation_ids)
                ? item.payload.citation_ids.map(String)
                : []
            )),
        ),
      ];
      const citationResults = await Promise.allSettled(citationIds.map((sourceId) => getSource(sourceId)));
      const citations = citationResults.flatMap((result) => (
        result.status === "fulfilled" ? [result.value] : []
      ));
      setTurns((current) => current.map((turn) => (
        turn.id === turnId
          ? {
              ...turn,
              answer: answer || "我暂时没有生成有效回答，可以换一种问法。",
              citations,
            }
          : turn
      )));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "这轮回答没有完成，请稍后再试。";
      setTurns((current) => current.map((turn) => (
        turn.id === turnId ? { ...turn, error: message } : turn
      )));
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <aside
      aria-label="AI 学习教练"
      className={`ai-learning-coach${collapsed ? " is-collapsed" : ""}`}
      data-phase={phase}
    >
      <header className="ai-coach-heading">
        <span className="ai-coach-mark"><Sparkles aria-hidden="true" size={17} /></span>
        {!collapsed ? (
          <div>
            <small>代码讲解与诊断</small>
            <h2>AI 学习教练</h2>
          </div>
        ) : null}
        <button
          aria-label={collapsed ? "展开 AI 学习教练" : "折叠 AI 学习教练"}
          className="icon-button ai-coach-collapse"
          onClick={onToggleCollapsed}
          title={collapsed ? "展开 AI 学习教练" : "折叠 AI 学习教练"}
          type="button"
        >
          {collapsed ? <ChevronLeft aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
        </button>
      </header>

      {collapsed ? (
        <div className="ai-coach-collapsed-status" aria-live="polite">
          {phase === "evaluating" || phase === "diagnosing" ? (
            <LoaderCircle className="spin" aria-hidden="true" size={17} />
          ) : (
            <Circle aria-hidden="true" fill="currentColor" size={9} />
          )}
          <span>{meta.label}</span>
        </div>
      ) : (
        <>
          <section className="ai-coach-status" aria-live="polite">
            <span className="ai-coach-status-dot" aria-hidden="true" />
            <div>
              <strong>{meta.label}</strong>
              <p>{meta.detail}</p>
            </div>
          </section>

          <section className="ai-coach-context" aria-label="当前任务">
            <div>
              <span><Code2 aria-hidden="true" size={13} />{languageLabel(context.language)}</span>
              <span>{viewLabels[context.active_view]}</span>
            </div>
            <strong>{context.task_title ?? "当前课程任务"}</strong>
            <small>
              {context.error_line
                ? `失败位置：第 ${context.error_line} 行`
                : context.learner_weak_points.length > 0
                  ? `${context.learner_weak_points.length} 项待巩固内容`
                  : "任务与代码已就绪"}
            </small>
          </section>

          <ol className="ai-coach-progress" aria-label="处理进度">
            {stageLabels.map((stage, index) => {
              const StageIcon = stage.icon;
              const done = index < completed;
              const active = index === activeStage;
              return (
                <li className={done ? "is-complete" : active ? "is-active" : "is-waiting"} key={stage.key}>
                  <span aria-hidden="true">
                    {done ? <Check size={13} /> : active ? <LoaderCircle className="spin" size={13} /> : <StageIcon size={13} />}
                  </span>
                  <div>
                    <strong>{stage.label}</strong>
                    <small>{done ? "完成" : active ? "进行中" : "等待"}</small>
                  </div>
                </li>
              );
            })}
          </ol>

          {traceStep ? (
            <section className="ai-coach-trace" aria-labelledby="ai-coach-trace-heading">
              <div className="ai-coach-section-heading">
                <span><Braces aria-hidden="true" size={15} /></span>
                <div>
                  <small>运行结果</small>
                  <h3 id="ai-coach-trace-heading">
                    {traceStep.conflict ? "发现状态冲突" : "当前状态一致"}
                  </h3>
                </div>
                {traceStep.conflict ? (
                  <TriangleAlert aria-hidden="true" size={17} />
                ) : (
                  <CheckCircle2 aria-hidden="true" size={17} />
                )}
              </div>
              <p className="ai-coach-trace-version">
                {traceVariant === "visited-on-dequeue" ? "当前错误代码" : "已修复代码"}
              </p>
              <strong>{traceStep.action}</strong>
              <p>{traceStep.explanation}</p>
              {traceStep.conflict ? <blockquote>{traceStep.conflict.message}</blockquote> : null}
              <div className="ai-coach-evidence-lock">
                <span>代码第 {traceStep.code_line} 行</span>
                <span>Queue [{traceStep.queue.join(", ") || "空"}]</span>
              </div>
              <div className="ai-coach-guiding-question">
                <MessageCircleQuestion aria-hidden="true" size={15} />
                <p>{traceStep.guiding_question}</p>
              </div>
            </section>
          ) : null}

          {failure ? (
            <section className="ai-coach-degraded" role="alert">
              <AlertTriangle aria-hidden="true" size={18} />
              <div>
                <strong>诊断服务暂时不可用</strong>
                <p>评测证据已经保留，可以稍后重新生成诊断。</p>
                <button type="button" onClick={onRetry}>
                  <RefreshCw aria-hidden="true" size={14} />重新诊断
                </button>
              </div>
            </section>
          ) : null}

          {emptyRetrieval || lowConfidenceRetrieval ? (
            <section className="ai-coach-degraded" role="status">
              <BookOpenCheck aria-hidden="true" size={18} />
              <div>
                <strong>{emptyRetrieval ? "本轮未命中课程资料" : "课程资料需要复核"}</strong>
                <p>
                  {emptyRetrieval
                    ? "暂未找到对应课程内容，先按运行结果给出建议。"
                    : "引用已经保留，建议结合失败用例一起核对。"}
                </p>
              </div>
            </section>
          ) : null}

          {diagnosis ? (
            <section className="ai-coach-diagnosis" aria-labelledby="ai-coach-diagnosis-heading">
              <div className="ai-coach-section-heading">
                <span><BrainCircuit aria-hidden="true" size={15} /></span>
                <div>
                  <small>错因诊断</small>
                  <h3 id="ai-coach-diagnosis-heading">从现象定位到原因</h3>
                </div>
              </div>
              <div className="ai-coach-diagnosis-block">
                <h4>观察事实</h4>
                {diagnosis.observations.map((observation) => (
                  <p key={observation.text}>{observation.text}</p>
                ))}
              </div>
              <div className="ai-coach-diagnosis-block">
                <h4>可能原因</h4>
                <p>{diagnosis.primary_hypothesis.summary}</p>
              </div>
              <div className="ai-coach-diagnosis-block">
                <h4>下一步</h4>
                <p>{diagnosis.next_action.label}</p>
              </div>
              {assistantText ? <p className="ai-coach-assistant-copy">{assistantText}</p> : null}
            </section>
          ) : null}

          {sources.length > 0 ? (
            <section className="ai-coach-sources" aria-labelledby="ai-coach-sources-heading">
              <div className="ai-coach-section-heading">
                <span><BookOpenCheck aria-hidden="true" size={15} /></span>
                <div>
                  <h3 id="ai-coach-sources-heading">相关课程</h3>
                </div>
              </div>
              <div className="ai-coach-source-list">
                {sources.map((source) => (
                  <a key={source.source_id} href={source.viewer_url} target="_blank" rel="noreferrer">
                    <span>
                      <strong>{source.title}</strong>
                      <small>{source.section}</small>
                    </span>
                    <ChevronRight aria-hidden="true" size={14} />
                  </a>
                ))}
              </div>
            </section>
          ) : null}

            <section className="ai-coach-conversation" aria-label="与学习教练的对话">
            <div className="ai-coach-conversation-scroll" ref={conversationRef}>
              {turns.length === 0 ? (
                <div className="ai-coach-welcome">
                  <Bot aria-hidden="true" size={17} />
                  <div>
                    <strong>我已经读到当前任务状态</strong>
                    <p>可以直接问为什么失败、下一步看哪里，或让我对照轨迹讲解。</p>
                  </div>
                </div>
              ) : null}

              {turns.map((turn, index) => (
                <article className="ai-coach-turn" key={turn.id}>
                  <p className="ai-coach-user-message">{turn.question}</p>
                  {turn.answer ? (
                    <div className="ai-coach-answer">
                      <span className="ai-coach-answer-mark"><Sparkles aria-hidden="true" size={14} /></span>
                      <div>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown>
                        {turn.citations.length > 0 ? (
                            <div className="ai-coach-turn-sources" aria-label="相关课程">
                              <small>相关课程</small>
                            {turn.citations.map((citation) => (
                              <a key={citation.source_id} href={citation.viewer_url} target="_blank" rel="noreferrer">
                                <BookOpenCheck aria-hidden="true" size={13} />
                                <span>
                                  <strong>{citation.title}</strong>
                                  <small>{citation.section}</small>
                                </span>
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {index === turns.length - 1 ? (
                  <div className="ai-coach-actions" aria-label="下一步操作">
                            {context.error_line ? (
                              <button aria-label={`定位第 ${context.error_line} 行`} onClick={onLocateError} title={`定位第 ${context.error_line} 行`} type="button">
                                <LocateFixed aria-hidden="true" size={14} />
                              </button>
                            ) : null}
                            <button aria-label="查看测试结果" onClick={onOpenTests} title="查看测试结果" type="button">
                              <ListChecks aria-hidden="true" size={14} />
                            </button>
                            <button aria-label="打开运行轨迹" onClick={onOpenTrace} title="打开运行轨迹" type="button">
                              <GitBranch aria-hidden="true" size={14} />
                            </button>
                            <button aria-label="生成针对性测试" onClick={() => setGeneratedTest(buildTargetedTest(context))} title="生成针对性测试" type="button">
                              <FlaskConical aria-hidden="true" size={14} />
                            </button>
                            <button
                              aria-label="加入复习"
                              onClick={() => {
                                const reviewCard = {
                                  id: `tutor-review-${context.task_id ?? "current-task"}`,
                                  sourceId: context.task_title ?? "current-task",
                                  title: context.task_title?.includes("BFS")
                                    ? "BFS visited 标记时机"
                                    : "当前任务错因回看",
                                  course: "数据结构",
                                  minutes: 8,
                                  reason: context.test_summary
                                    ? `复习重点：${context.test_summary}`
                                    : "巩固本次讲解",
                                  href: `/student/tasks/${context.task_id ?? "task_bfs_bug_001"}?view=evidence`,
                                  scheduledFor: nextReviewDate(),
                                };
                                const alreadyScheduled = loadLearningOutputs().reviewCards.some(
                                  (item) => item.title === reviewCard.title
                                    && item.course === reviewCard.course
                                    && item.scheduledFor === reviewCard.scheduledFor,
                                );
                                addGeneratedReviewCard(reviewCard);
                                setReviewStatus(alreadyScheduled ? "existing" : "added");
                              }}
                              title="加入复习"
                              type="button"
                            >
                              <CalendarPlus aria-hidden="true" size={14} />
                            </button>
                          </div>
                        ) : null}
                        {index === turns.length - 1 && generatedTest ? (
                          <section className="ai-coach-generated-test" aria-labelledby="ai-coach-generated-test-title">
                            <header>
                              <div>
                                <span>规则建议</span>
                                <h3 id="ai-coach-generated-test-title">{generatedTest.title}</h3>
                              </div>
                            </header>
                            <dl>
                              <div><dt>输入</dt><dd><pre>{generatedTest.input}</pre></dd></div>
                              <div><dt>期望输出</dt><dd><pre>{generatedTest.expected}</pre></dd></div>
                            </dl>
                            <p>{generatedTest.check}</p>
                          </section>
                        ) : null}
                        {index === turns.length - 1 && reviewStatus ? (
                          <p aria-label="复习任务已创建" className="ai-coach-review-confirmation" role="status">
                            <CheckCircle2 aria-hidden="true" size={14} />
                            {reviewStatus === "existing"
                              ? "这项内容已在复习计划中。"
                              : "已加入复习计划，明天回看本次错因。"}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : turn.error ? (
                    <p className="ai-coach-chat-error" role="alert">{turn.error}</p>
                  ) : chatLoading && index === turns.length - 1 ? (
                    turn.partial ? (
                      <div className="ai-coach-answer" role="status">
                        <span className="ai-coach-answer-mark"><Sparkles aria-hidden="true" size={14} /></span>
                        <div>
                          <span className="ai-coach-answer-origin">正在生成…</span>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.partial}</ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <div className="ai-coach-thinking" role="status">
                        <LoaderCircle aria-hidden="true" className="spin" size={15} />
                        正在整理运行结果…
                      </div>
                    )
                  ) : null}
                </article>
              ))}
            </div>

            <form className="ai-coach-composer" onSubmit={submitQuestion}>
              <fieldset className="ai-coach-hint-levels">
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
              <div className="ai-coach-input">
                <textarea
                  aria-label="向学习教练提问"
                  autoComplete="off"
                  name="ai-coach-question"
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }}
                  placeholder="结合当前代码或结果提问…"
                  rows={2}
                  spellCheck={false}
                  value={question}
                />
                <button
                  aria-label="发送给学习教练"
                  disabled={!question.trim() || chatLoading}
                  title="发送"
                  type="submit"
                >
                  {chatLoading ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : <ArrowUp aria-hidden="true" size={16} />}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </aside>
  );
}
