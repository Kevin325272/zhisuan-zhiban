import type { AlgorithmTraceStep, TraceVariant } from "@xuetu/contracts";
import {
  BookOpenCheck,
  Braces,
  CheckCircle2,
  MessageCircleQuestion,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

export function TraceCoachPanel({
  step,
  variant,
}: {
  step: AlgorithmTraceStep;
  variant: TraceVariant;
}) {
  const hasConflict = step.conflict !== null;

  return (
    <aside className="trace-coach-panel" aria-label="运行轨迹教练">
      <header>
        <span className="section-icon coral">
          <Sparkles aria-hidden="true" size={17} />
        </span>
        <div>
          <small>步骤提示</small>
          <strong>轨迹教练</strong>
        </div>
        <span className="trace-grounded-badge">运行结果</span>
      </header>

      <section className={`trace-coach-finding${hasConflict ? " conflict" : " consistent"}`}>
        <span>
          {hasConflict ? (
            <TriangleAlert aria-hidden="true" size={18} />
          ) : (
            <CheckCircle2 aria-hidden="true" size={18} />
          )}
        </span>
        <div>
          <small>{variant === "visited-on-dequeue" ? "当前错误代码" : "已修复代码"}</small>
          <h2>{hasConflict ? "发现状态冲突" : "当前状态一致"}</h2>
        </div>
      </section>

      <section className="trace-coach-section">
        <div className="trace-coach-section-title">
          <Braces aria-hidden="true" size={14} />
          <span>本步发生了什么</span>
        </div>
        <strong>{step.action}</strong>
        <p>{step.explanation}</p>
        {step.conflict ? <blockquote>{step.conflict.message}</blockquote> : null}
        <div className="trace-evidence-lock">
          <span>代码第 {step.code_line} 行</span>
          <span>Queue [{step.queue.join(", ") || "空"}]</span>
        </div>
      </section>

      <section className="trace-coach-section trace-question-section">
        <div className="trace-coach-section-title">
          <MessageCircleQuestion aria-hidden="true" size={14} />
          <span>想一想</span>
        </div>
        <p>{step.guiding_question}</p>
      </section>

      <section className="trace-coach-section trace-source-section">
        <div className="trace-coach-section-title">
          <BookOpenCheck aria-hidden="true" size={14} />
          <span>相关课程</span>
        </div>
        <strong>教材 6.2.1 · 广度优先遍历</strong>
        <p>顶点首次入队时即标记为已访问，避免经由其他边重复入队。</p>
      </section>
    </aside>
  );
}
