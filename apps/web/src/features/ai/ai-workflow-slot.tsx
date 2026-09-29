import type {
  AiWorkflowInvocation,
  AiWorkflowResponse,
  AiWorkflowSlot as AiWorkflowSlotId,
} from "@xuetu/contracts";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { invokeAiWorkflow } from "../../api/client";
import { useAiPreferences } from "./ai-preferences-context";
import { LearningDiagramView } from "./learning-diagram";
import { Link } from "react-router-dom";

interface AiWorkflowSlotProps {
  slot: AiWorkflowSlotId;
  title: string;
  compact?: boolean;
  invocation?: AiWorkflowInvocation | null;
  manual?: boolean;
  actionLabel?: string;
}

type WorkflowViewState =
  | { kind: "idle"; response: null }
  | { kind: "loading"; response: null }
  | { kind: "loaded"; response: AiWorkflowResponse }
  | { kind: "network_error"; response: null };

export function AiWorkflowSlot({
  slot,
  title,
  compact = false,
  invocation = null,
  manual = false,
  actionLabel = "生成学习解读",
}: AiWorkflowSlotProps) {
  const { preferences, status: preferenceStatus } = useAiPreferences();
  const enabled = preferenceStatus === "ready" && preferences.collaboration_enabled;
  const requestKey = invocation ? JSON.stringify(invocation) : null;
  const requestSequence = useRef(0);
  const [state, setState] = useState<WorkflowViewState>({
    kind: "idle",
    response: null,
  });

  const runWorkflow = useCallback(() => {
    if (!requestKey || !enabled) return;
    const sequence = ++requestSequence.current;
    setState({ kind: "loading", response: null });
    invokeAiWorkflow(JSON.parse(requestKey) as AiWorkflowInvocation)
      .then((response) => {
        if (requestSequence.current === sequence) {
          setState({ kind: "loaded", response });
        }
      })
      .catch(() => {
        if (requestSequence.current === sequence) {
          setState({ kind: "network_error", response: null });
        }
      });
  }, [requestKey, enabled]);

  useEffect(() => {
    if (!requestKey || manual || !enabled) {
      requestSequence.current += 1;
      setState({ kind: "idle", response: null });
      return undefined;
    }
    runWorkflow();
    return () => {
      requestSequence.current += 1;
    };
  }, [enabled, manual, requestKey, runWorkflow]);

  useEffect(() => () => {
    requestSequence.current += 1;
  }, []);

  const response = state.kind === "loaded" ? state.response : null;
  const hasWorkflowContent = response
    && (response.status === "ready" || response.status === "degraded");
  const manualRetryAvailable = state.kind === "network_error"
    || (state.kind === "loaded" && state.response.failure?.retryable === true);
  const showManualAction = manual
    && requestKey !== null
    && (state.kind === "idle" || manualRetryAvailable);

  if (requestKey && manual && !enabled) {
    return <aside className="ai-workflow-disabled"><Sparkles size={17} /><span>{preferenceStatus === "loading" ? "正在读取学习偏好…" : preferenceStatus === "error" ? "请先检查 AI 学习设置。" : "AI 多智能体协作已关闭。"}</span><Link to="/student/account">前往设置</Link></aside>;
  }

  if (!requestKey || (!manual && !hasWorkflowContent)) {
    return null;
  }

  const isLoading = state.kind === "loading";

  return (
    <aside
      className={`ai-workflow-slot${compact ? " is-compact" : ""}${hasWorkflowContent ? " has-content" : ""}`}
      data-workflow-slot={slot}
      role="note"
    >
      <Sparkles aria-hidden="true" size={16} />
      <div>
        <div className="ai-workflow-slot-heading">
          <strong>{title}</strong>
        </div>
        {isLoading ? (
          <div aria-live="polite" className="ai-workflow-manual-action" role="status">
            <small>正在生成学习解读…</small>
            <button disabled type="button">
              <Sparkles aria-hidden="true" className="is-spinning" size={14} />
              正在生成学习解读
            </button>
          </div>
        ) : showManualAction ? (
          <div className="ai-workflow-manual-action">
            {manualRetryAvailable ? (
              <small role="status">暂时无法生成，请稍后重试。</small>
            ) : null}
            <button onClick={runWorkflow} type="button">
              <Sparkles aria-hidden="true" size={14} />
              {manualRetryAvailable ? "重新生成学习解读" : actionLabel}
            </button>
          </div>
        ) : null}
        {manual && response && !hasWorkflowContent && !manualRetryAvailable ? (
          <p className="ai-workflow-unavailable" role="status">{response.status === "insufficient_context" ? "当前资料还不足以生成讲解，请先继续阅读课程内容。" : "这次未能生成讲解，请继续查看课程内容。"}</p>
        ) : null}
        {hasWorkflowContent ? (
          <div className="ai-workflow-content">
            {preferences.visual_explanations_enabled && response.diagram ? <LearningDiagramView key={response.request_id} diagram={response.diagram} /> : null}
            {response.display_blocks.map((block) => (
              <section data-block-kind={block.kind} key={block.block_id}>
                {block.title ? <strong>{block.title}</strong> : null}
                <p>{block.content}</p>
              </section>
            ))}
            {response.citations.length > 0 ? (
              <div className="ai-workflow-references">
                <strong>相关课程</strong>
                <ul>
                  {response.citations.map((citation) => (
                    <li key={citation.citation_id}>
                      {citation.label}{citation.locator ? ` · ${citation.locator}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {response.evidence_refs.length > 0 ? (
              <div className="ai-workflow-references">
                <strong>相关记录</strong>
                <ul>
                  {response.evidence_refs.map((evidence) => (
                    <li key={evidence.evidence_id}>
                      {evidence.label} · {evidence.summary}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {response.next_actions.length > 0 ? (
              <div className="ai-workflow-actions">
                <strong>下一步</strong>
                <ul>
                  {response.next_actions.map((action) => (
                    <li key={action.action_id}>{action.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
