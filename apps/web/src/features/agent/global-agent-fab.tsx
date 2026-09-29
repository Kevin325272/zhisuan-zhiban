import { Send, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useLocation } from "react-router-dom";

import { QUICK_PROMPTS, agentContextForPath } from "./agent-quick-prompts";
import { AgentAvatar } from "./agent-avatar";
import { streamAgentReply } from "./agent-live-chat";
import { mockReplyFor, streamMockReply } from "./agent-mock-replies";
import "./global-agent.css";

export const OPEN_AGENT_EVENT = "xuetu:open-agent";

interface AgentTurn {
  id: number;
  role: "student" | "agent";
  text: string;
  source?: "live" | "demo";
}

let turnSequence = 0;

interface TriggerPosition {
  left: number;
  top: number;
}

interface DragState extends TriggerPosition {
  active: boolean;
  moved: boolean;
  startX: number;
  startY: number;
  pointerId: number;
}

function clampTriggerPosition(position: TriggerPosition, width: number, height: number): TriggerPosition {
  const margin = 8;
  return {
    left: Math.max(margin, Math.min(position.left, Math.max(margin, window.innerWidth - width - margin))),
    top: Math.max(margin, Math.min(position.top, Math.max(margin, window.innerHeight - height - margin))),
  };
}

export function GlobalAgentFab({ hidden = false }: { hidden?: boolean }) {
  const location = useLocation();
  const context = agentContextForPath(location.pathname);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSource, setStreamingSource] = useState<"live" | "demo" | null>(null);
  const [question, setQuestion] = useState("");
  const streamSignalRef = useRef({ cancelled: false });
  const conversationEndRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState>({
    active: false,
    moved: false,
    left: 0,
    top: 0,
    startX: 0,
    startY: 0,
    pointerId: -1,
  });
  const [triggerPosition, setTriggerPosition] = useState<TriggerPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  // 课程中枢「AI 学伴答疑」等入口通过该事件打开全局 Agent。
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_AGENT_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_AGENT_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns, streamingText, thinking]);

  useEffect(() => {
    if (!triggerPosition) return;
    const keepTriggerInViewport = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setTriggerPosition((current) => current
        ? clampTriggerPosition(current, rect.width, rect.height)
        : current);
    };
    window.addEventListener("resize", keepTriggerInViewport);
    return () => window.removeEventListener("resize", keepTriggerInViewport);
  }, [triggerPosition]);

  const beginTriggerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "touch" && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      active: true,
      moved: false,
      left: rect.left,
      top: rect.top,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveTrigger = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    drag.moved = true;
    setDragging(true);
    const rect = event.currentTarget.getBoundingClientRect();
    setTriggerPosition(clampTriggerPosition({
      left: drag.left + deltaX,
      top: drag.top + deltaY,
    }, rect.width, rect.height));
    event.preventDefault();
  };

  const endTriggerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    drag.active = false;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const openOrIgnoreAfterDrag = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setOpen(true);
  };

  const sendQuestion = async (content: string) => {
    if (!content.trim() || thinking) return;
    const text = content.trim();
    setQuestion("");
    setTurns((current) => [...current, { id: ++turnSequence, role: "student", text }]);
    setThinking(true);
    setStreamingSource(null);
    streamSignalRef.current.cancelled = false;
    // 真实智能体优先：SSE 首段到达即结束思考占位；失败时退回本地演示回复。
    const liveText = await streamAgentReply(context, text, (chunk) => {
      setThinking(false);
      setStreamingSource("live");
      setStreamingText(chunk);
    }, streamSignalRef.current);
    if (liveText === null) {
      // 离线兜底：保留固定思考节拍后流式输出本地演示话术。
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      setThinking(false);
      setStreamingSource("demo");
      let accumulated = "";
      await streamMockReply(mockReplyFor(context, text), (chunk) => {
        accumulated += chunk;
        setStreamingText(accumulated);
      }, streamSignalRef.current);
      setStreamingText("");
      setStreamingSource(null);
      setTurns((current) => [...current, { id: ++turnSequence, role: "agent", text: accumulated, source: "demo" }]);
      return;
    }
    setStreamingText("");
    setStreamingSource(null);
    setTurns((current) => [...current, { id: ++turnSequence, role: "agent", text: liveText, source: "live" }]);
  };

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendQuestion(question);
  };

  const showQuickPrompts = turns.length === 0 && !thinking && !streamingText;

  if (hidden) return null;

  if (!open) {
    return (
      <button
        aria-label="打开 408 专家 Agent"
        className={"global-agent-trigger" + (dragging ? " is-dragging" : "")}
        onClick={openOrIgnoreAfterDrag}
        onPointerCancel={endTriggerDrag}
        onPointerDown={beginTriggerDrag}
        onPointerMove={moveTrigger}
        onPointerUp={endTriggerDrag}
        ref={triggerRef}
        style={triggerPosition ? { left: triggerPosition.left, top: triggerPosition.top, right: "auto", bottom: "auto" } : undefined}
        title="点击打开，拖动调整位置"
        type="button"
      >
        <AgentAvatar />
        <span aria-hidden="true" className="global-agent-identity">AI 助教</span>
        <span className="global-agent-tooltip">打开 408 专家 Agent</span>
      </button>
    );
  }

  return (
    <aside aria-label="408 专家 Agent" className="global-agent-drawer">
      <header className="global-agent-header">
        <AgentAvatar compact />
        <div>
          <strong>408 专家 Agent</strong>
          <small>计算机考研智能体 · 支持本地演示</small>
        </div>
        <button
          aria-label="关闭 408 专家 Agent"
          className="global-agent-close"
          onClick={() => setOpen(false)}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="global-agent-body" aria-live="polite">
        <div className="global-agent-conversation">
          {turns.map((turn) => (
            <article className={`global-agent-turn is-${turn.role}`} key={turn.id}>
              {turn.role === "agent" ? <span className="agent-ai-label">{turn.source === "demo" ? "[本地演示回复·未连接智能体]" : "[AI 生成内容]"}</span> : null}
              <span className="global-agent-turn-speaker">
                {turn.role === "student" ? "你" : turn.source === "demo" ? "演示学伴" : "408 专家 Agent"}
              </span>
              <p>{turn.text}</p>
            </article>
          ))}
          {streamingText ? (
            <article className="global-agent-turn is-agent">
              <span className="agent-ai-label">{streamingSource === "demo" ? "[本地演示回复·未连接智能体]" : "[AI 生成内容]"}</span>
              <span className="global-agent-turn-speaker">{streamingSource === "demo" ? "演示学伴" : "408 专家 Agent"}</span>
              <p>{streamingText}<span className="global-agent-caret" aria-hidden="true" /></p>
            </article>
          ) : null}
          {thinking ? (
            <div className="global-agent-thinking" role="status">
              <span className="global-agent-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
              <span>正在思考…</span>
            </div>
          ) : null}
          <span aria-hidden="true" className="global-agent-conversation-end" ref={conversationEndRef} />
        </div>

        {showQuickPrompts ? (
          <nav aria-label="快捷提问" className="global-agent-quick-prompts">
            {QUICK_PROMPTS[context].map((prompt) => (
              <button key={prompt} onClick={() => void sendQuestion(prompt)} type="button">
                {prompt}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      <footer className="global-agent-footer">
        <form className="global-agent-composer" onSubmit={submitQuestion}>
          <input
            aria-label="向 408 专家 Agent 提问"
            autoComplete="off"
            disabled={thinking}
            maxLength={1_000}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="问我课程、错题或学习方法…"
            value={question}
          />
          <button aria-label="发送问题" disabled={thinking || !question.trim()} type="submit">
            <Send aria-hidden="true" size={15} />
          </button>
        </form>
        <p className="global-agent-compliance">智能体回复仅供学习参考；演示回复会单独标注</p>
      </footer>
    </aside>
  );
}
