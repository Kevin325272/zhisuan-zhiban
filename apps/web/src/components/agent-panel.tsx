import type { AgentEvent, Citation, Diagnosis } from "@xuetu/contracts";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    "run.started": "开始整理上下文",
    "stage.started": "正在分析运行结果",
    "retrieval.completed": "课程内容已找到",
    "assistant.delta": "诊断已整理",
    "diagnosis.completed": "结构化诊断完成",
    "run.completed": "本轮助学完成",
    "run.failed": "诊断暂时不可用",
  };
  return labels[type] ?? type;
}

export function AgentPanel({
  diagnosis,
  sources,
  events,
  loading,
  onRetry,
}: {
  diagnosis: Diagnosis | null;
  sources: Citation[];
  events: AgentEvent[];
  loading: boolean;
  onRetry?: () => void;
}) {
  const failure = events.find((item) => item.type === "run.failed");
  const degradedRetrieval = events.find(
    (item) => item.type === "retrieval.completed" && item.payload.degraded === true,
  );
  const citationIds = Array.isArray(degradedRetrieval?.payload.citation_ids)
    ? degradedRetrieval.payload.citation_ids
    : [];
  const emptyRetrieval = degradedRetrieval && citationIds.length === 0;
  const lowConfidenceRetrieval = degradedRetrieval && citationIds.length > 0;
  const assistantText = events
    .filter((item) => item.type === "assistant.delta")
    .map((item) => String(item.payload.delta ?? ""))
    .join("");

  return (
    <aside className="agent-panel" aria-label="学习诊断">
      <div className="agent-panel-heading">
        <span className="agent-icon"><Sparkles aria-hidden="true" size={17} /></span>
        <div>
          <h2>助学诊断</h2>
        </div>
      </div>

      {loading ? (
        <div className="agent-empty" role="status">
          <LoaderCircle className="spin" aria-hidden="true" size={20} />
          正在整理运行结果与课程内容
        </div>
      ) : null}

      {!loading && !diagnosis && events.length === 0 ? (
        <div className="agent-empty">提交代码后，这里会展示问题和下一步。</div>
      ) : null}

      {failure ? (
        <div className="degradation-state" role="alert">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <strong>诊断服务响应超时</strong>
            <p>运行结果已经保留，可以稍后重试。</p>
            <button type="button" onClick={onRetry} disabled={!onRetry}>
              <RefreshCw aria-hidden="true" size={14} />重新诊断
            </button>
          </div>
        </div>
      ) : null}

      {emptyRetrieval ? (
        <div className="degradation-state" role="status">
          <BookOpenCheck aria-hidden="true" size={18} />
          <div>
            <strong>暂时没有匹配的课程内容</strong>
            <p>先按运行结果给出建议。</p>
            <a href="#evidence-heading">查看运行结果</a>
          </div>
        </div>
      ) : null}

      {lowConfidenceRetrieval ? (
        <div className="degradation-state low-confidence" role="status">
          <BookOpenCheck aria-hidden="true" size={18} />
          <div>
            <strong>课程内容需要核对</strong>
            <p>可结合失败用例复核。</p>
            <a href="#evidence-heading">查看运行结果</a>
          </div>
        </div>
      ) : null}

      {diagnosis ? (
        <div className="diagnosis-content">
          <section>
            <h3>观察事实</h3>
            {diagnosis.observations.map((observation) => (
              <p key={observation.text}>{observation.text}</p>
            ))}
          </section>
          <section>
            <h3>可能原因</h3>
            <p>{diagnosis.primary_hypothesis.summary}</p>
          </section>
          <section>
            <h3>下一步</h3>
            <p>{diagnosis.next_action.label}</p>
          </section>
        </div>
      ) : null}

      {assistantText ? <p className="assistant-copy">{assistantText}</p> : null}

      {sources.length > 0 ? (
        <section className="citation-list" aria-labelledby="citation-heading">
          <h3 id="citation-heading">相关课程</h3>
          {sources.map((source) => (
            <a key={source.source_id} href={source.viewer_url} target="_blank" rel="noreferrer">
              <BookOpenCheck aria-hidden="true" size={16} />
              <span>
                <strong>{source.title}</strong>
                <small>{source.section}</small>
              </span>
            </a>
          ))}
        </section>
      ) : null}

      {events.length > 0 ? (
        <ol className="agent-event-list" aria-label="诊断进度">
          {events.map((item) => (
            <li key={`${item.sequence}-${item.type}`}>
              <CheckCircle2 aria-hidden="true" size={14} />
              {eventLabel(item.type)}
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  );
}
