import type { Citation } from "@xuetu/contracts";
import {
  BookOpen,
  CheckCircle2,
  FileSearch,
  FileText,
  LoaderCircle,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import {
  Fragment,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import { Link, useSearchParams } from "react-router-dom";
import remarkGfm from "remark-gfm";

import {
  askCourseQuestion,
  getSource,
  type TutorHintLevel,
} from "../../api/client";
import { GradientButton } from "../../components/ui/gradient-button";

interface AnswerState {
  answer: string;
  confidence: string;
  citations: Citation[];
  mode: "rag" | "general" | "guided" | "unavailable";
  notice: string | null;
}

interface ConversationTurn {
  id: number;
  question: string;
  status: "pending" | "complete" | "error";
  answer: AnswerState | null;
  /** 流式增量文本：回答尚未完成时逐段累积展示。 */
  partial: string | null;
  error: string | null;
}

const suggestions = [
  "为什么 BFS 可以求无权图最短路？",
  "visited 应该在入队还是出队时标记？",
  "BFS 与 DFS 的适用场景有什么区别？",
];

const hintLevels: Array<{ value: TutorHintLevel; label: string }> = [
  { value: "direction", label: "只给方向" },
  { value: "clue", label: "关键线索" },
  { value: "steps", label: "分步讲解" },
  { value: "complete", label: "完整解释" },
];

function stringPayload(value: unknown) {
  return typeof value === "string" ? value : "";
}

function citationIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeModelMarkdown(value: string) {
  return value.replace(/(\*\*[^*\r\n]+\*\*)(?=[\p{L}\p{N}])/gu, "$1 ");
}

function AssistantAnswer({ answer }: { answer: AnswerState }) {
  const answerLabel =
    answer.mode === "guided"
      ? "学习引导"
      : answer.mode === "general"
        ? "智能回答"
        : answer.confidence === "high"
          ? "课程增强"
          : answer.confidence === "low"
            ? "需核对"
            : "助学回答";
  return (
    <article className="ai-message assistant answer">
      <span><Sparkles aria-hidden="true" size={15} /></span>
      <div>
        <header>
          <strong>智算助学助手</strong>
          <small className={`confidence-tag ${answer.mode === "rag" ? `confidence-${answer.confidence}` : "confidence-general"}`}>
            {answerLabel}
          </small>
        </header>
        <div className="ai-answer-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeModelMarkdown(answer.answer)}</ReactMarkdown>
          {answer.citations.length ? <sup>[01]</sup> : null}
        </div>
        {answer.notice ? <div className="answer-notice" role="status">{answer.notice}</div> : null}

        {answer.mode !== "guided" && answer.citations.length > 0 ? (
          <p className="answer-reference-summary">
            已附 {answer.citations.length} 条参考资料，可在右侧查看。
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function AskPage() {
  const [searchParams] = useSearchParams();
  const [question, setQuestion] = useState(() => searchParams.get("q")?.trim() ?? "");
  const [hintLevel, setHintLevel] = useState<TutorHintLevel>("clue");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const conversationBodyRef = useRef<HTMLDivElement>(null);
  const turnIdRef = useRef(0);
  const answer = turns[turns.length - 1]?.answer ?? null;

  useEffect(() => {
    const body = conversationBodyRef.current;
    if (!body) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    body.scrollTo?.({ behavior: reduceMotion ? "auto" : "smooth", top: body.scrollHeight });
  }, [turns]);

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const content = question.trim();
    if (!content || loading) return;

    const turnId = ++turnIdRef.current;
    setQuestion("");
    setTurns((current) => [
      ...current,
      {
        id: turnId,
        question: content,
        status: "pending",
        answer: null,
        partial: null,
        error: null,
      },
    ]);
    setLoading(true);
    try {
      const events = await askCourseQuestion(content, "auto", {
        hintLevel,
        onEvent: (event) => {
          if (event.type !== "assistant.delta") return;
          const delta = stringPayload(event.payload.delta);
          if (!delta) return;
          setTurns((current) =>
            current.map((turn) =>
              turn.id === turnId
                ? { ...turn, partial: (turn.partial ?? "") + delta }
                : turn,
            ),
          );
        },
      });
      const failed = events.find((item) => item.type === "run.failed");
      if (failed) {
        const rawError = failed.payload.error;
        const message =
          rawError && typeof rawError === "object" && "message" in rawError
            ? stringPayload(rawError.message)
            : "本次回答生成失败，请稍后重试。";
        throw new Error(message || "本次回答生成失败，请稍后重试。");
      }

      const retrieval = events.find((item) => item.type === "retrieval.completed");
      const sourceIds = citationIds(retrieval?.payload.citation_ids);
      const sources = (
        await Promise.allSettled(sourceIds.map((sourceId) => getSource(sourceId)))
      ).flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const answerEvents = events.filter((item) => item.type === "assistant.delta");
      const answerText = answerEvents
        .map((item) => stringPayload(item.payload.delta))
        .join("");
      const confidence = stringPayload(retrieval?.payload.confidence_level) || "unknown";
      const degraded = retrieval?.payload.degraded === true;
      const reportedMode = answerEvents
        .map((item) => stringPayload(item.payload.answer_mode))
        .find((item) => ["rag", "general", "guided", "unavailable"].includes(item));
      const mode: AnswerState["mode"] =
        reportedMode === "rag" ||
        reportedMode === "general" ||
        reportedMode === "guided" ||
        reportedMode === "unavailable"
          ? reportedMode
          : sourceIds.length > 0
            ? "rag"
            : answerEvents.some((item) => item.payload.generated_by === "model")
              ? "general"
              : "unavailable";

      const completedAnswer: AnswerState = {
        answer: answerText || "暂时没有生成可展示的回答。",
        confidence,
        citations: sources,
        mode,
        notice:
          sourceIds.length === 0
            ? mode === "unavailable"
              ? "讲解暂时不可用，请稍后重试。"
              : null
            : degraded
              ? "测试来源匹配度较低，请结合原文和运行证据核对。"
              : null,
      };
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? { ...turn, status: "complete", answer: completedAnswer }
            : turn,
        ),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "本次回答生成失败，请稍后重试。";
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? { ...turn, status: "error", error: message } : turn,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="page-inner ai-tutor-page readability-upgraded">
      <header className="cs-page-header ai-page-header">
        <div>
          <p className="cs-workspace-kicker">数据结构 · 广度优先搜索</p>
          <h1>BFS 讲解助手</h1>
          <p>围绕广度优先搜索回答概念、代码与错因问题，有资料依据时会附上参考内容。</p>
        </div>
        <span className="major-badge"><BookOpen aria-hidden="true" size={13} /> 数据结构 · BFS</span>
      </header>

      <section aria-label="当前学习上下文" className="ai-learning-context">
        <div className="ai-context-heading">
          <span><Sparkles aria-hidden="true" size={17} /></span>
           <div><small>当前主题</small><h2>当前学习主题</h2></div>
          <em>BFS 专题</em>
        </div>
        <dl>
          <div><dt>课程</dt><dd>数据结构</dd></div>
          <div><dt>参考材料</dt><dd>BFS 课程资料</dd></div>
          <div><dt>当前任务</dt><dd>理解概念、代码与常见错因</dd></div>
          <div><dt>回答范围</dt><dd>当前仅支持 BFS 专题</dd></div>
        </dl>
        <div className="ai-context-actions">
          <Link to="/student/courses/data-structures">返回数据结构课程</Link>
          <Link to="/student/profile">查看学习记录</Link>
        </div>
        <p className="ai-context-boundary">
          涉及 BFS 课程事实时会附上参考内容；其他主题可作为一般问题提问。
        </p>
      </section>

      <div className="ai-workbench">
        <section className="ai-conversation-console" aria-label="课程问答对话">
          <header className="ai-console-header">
            <span className="ai-console-avatar"><BookOpen aria-hidden="true" size={18} /></span>
            <div>
              <strong>课程讲解</strong>
              <small>BFS 专题讲解</small>
            </div>
            <span className="ai-ready-state offline">
              <i /> 可提问
            </span>
          </header>

          <div className="ai-conversation-body" aria-live="polite" ref={conversationBodyRef}>
            <article className="ai-message assistant">
              <span><Sparkles aria-hidden="true" size={15} /></span>
              <div>
                <header><strong>智算助学助手</strong><small>BFS 专题</small></header>
                <p>你可以问概念、代码过程或常见错误，我会尽量给出分步说明。</p>
              </div>
            </article>

            {turns.length ? (
              turns.map((turn) => (
                <Fragment key={turn.id}>
                  <article className="ai-message student"><p>{turn.question}</p></article>
                  {turn.status === "pending" ? (
                    <article
                      aria-label="助学助手正在回答"
                      className="ai-message assistant answer pending"
                      role="status"
                    >
                      <span><LoaderCircle aria-hidden="true" className="spin" size={15} /></span>
                      <div>
                        <header>
                          <strong>智算助学助手</strong>
                          <small>{turn.partial ? "正在逐段生成" : "正在思考"}</small>
                        </header>
                        {turn.partial ? (
                          <div className="ai-answer-markdown">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {normalizeModelMarkdown(turn.partial)}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <div className="ai-thinking-state">
                            <span aria-hidden="true"><i /><i /><i /></span>
                            <p>正在理解问题并组织回答…</p>
                          </div>
                        )}
                      </div>
                    </article>
                  ) : turn.status === "error" ? (
                    <article className="ai-message assistant answer failed">
                      <span><BookOpen aria-hidden="true" size={15} /></span>
                      <div className="ai-turn-error" role="alert">
                        <header><strong>本轮回答未完成</strong><small>可以重新发送</small></header>
                        <p>{turn.error}</p>
                        <button onClick={() => setQuestion(turn.question)} type="button">重新编辑问题</button>
                      </div>
                    </article>
                  ) : turn.answer ? (
                    <AssistantAnswer answer={turn.answer} />
                  ) : null}
                </Fragment>
              ))
            ) : (
              <div className="ai-question-starters" aria-label="推荐问题">
                <span>推荐追问</span>
                {suggestions.map((item) => <button key={item} type="button" onClick={() => setQuestion(item)}>{item}</button>)}
              </div>
            )}
          </div>

          <form className="ai-composer" onSubmit={submitQuestion}>
            <div className="ai-composer-heading">
              <label htmlFor="course-question">输入课程问题</label>
              <fieldset className="tutor-hint-levels">
                <legend>提示深度</legend>
                {hintLevels.map((item) => (
                  <button
                    aria-pressed={hintLevel === item.value}
                    className={hintLevel === item.value ? "active" : undefined}
                    key={item.value}
                    onClick={() => setHintLevel(item.value)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </fieldset>
            </div>
            <textarea
              id="course-question"
              autoComplete="off"
              name="course-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="例如：解释一个知识点、分析一道题，或帮我梳理下一步学习…"
              rows={2}
            />
            <div className="ai-composer-actions">
              <span className="composer-scope"><BookOpen aria-hidden="true" size={12} /> 当前主题 · BFS</span>
              <GradientButton
                className="ml-auto"
                variant="variant"
                size="compact"
                type="submit"
                disabled={!question.trim() || loading}
              >
                {loading ? "正在思考…" : "发送问题"} <Send aria-hidden="true" size={14} />
              </GradientButton>
            </div>
          </form>
        </section>

        <aside className="ai-evidence-console" aria-labelledby="answer-source-title">
          <header>
            <span><FileSearch aria-hidden="true" size={16} /></span>
            <div><h2 id="answer-source-title">学习依据</h2><p>{answer?.citations.length ?? 0} 条课程证据</p></div>
          </header>

          <div className="retrieval-scope">
            <p>学习范围</p>
            <dl>
              <div><dt>专业</dt><dd>计算机科学与技术</dd></div>
              <div><dt>课程</dt><dd>数据结构</dd></div>
              <div><dt>知识节点</dt><dd>广度优先遍历</dd></div>
            </dl>
          </div>

          {answer?.citations.length ? (
            <ol className="ai-source-list">
              {answer.citations.map((citation, index) => (
                <li key={citation.source_id}>
                  <header><span>课程资料 {String(index + 1).padStart(2, "0")}</span><i>相关度 {Math.round((citation.relevance ?? 0) * 100)}%</i></header>
                  <strong>{citation.title}</strong>
                  <small>
                    {citation.source_type === "test_fixture" ? "示例资料" : "课程资料"}
                    {citation.author ? ` · ${citation.author}` : " · 作者未标注"}
                    {` · ${citation.section}`}
                    {citation.page ? ` · 第 ${citation.page} 页` : ""}
                  </small>
                  <p>{citation.snippet}</p>
                  <a href={citation.viewer_url} target="_blank" rel="noreferrer">
                    查看原文 <Target aria-hidden="true" size={12} />
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            answer?.mode === "guided" ? (
              <div className="ai-source-empty"><FileText aria-hidden="true" size={24} /><strong>已结合当前问题</strong><p>可以继续补充题意，我会按当前主题接着讲。</p></div>
            ) : answer?.mode === "general" ? (
              <div className="ai-source-empty"><FileText aria-hidden="true" size={24} /><strong>本轮无需课程引用</strong><p>这是一般性讲解；涉及课程事实时会附上参考内容。</p></div>
            ) : answer ? (
              <div className="ai-source-empty"><FileText aria-hidden="true" size={24} /><strong>讲解暂时不可用</strong><p>保留当前问题，稍后可以重新发送。</p></div>
            ) : (
              <div className="ai-source-empty"><FileText aria-hidden="true" size={24} /><strong>按需调用课程资料</strong><p>涉及课程知识时，相关教材与资料会显示在这里。</p></div>
            )
          )}

          <footer><CheckCircle2 aria-hidden="true" size={13} /> BFS 专题资料</footer>
        </aside>
      </div>
    </div>
  );
}
