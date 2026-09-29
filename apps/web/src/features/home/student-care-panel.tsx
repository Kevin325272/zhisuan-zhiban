import {
  STUDENT_CARE_CRISIS_GUIDANCE,
  studentCareCrisisSignalPresent,
  type AiWorkflowResponse,
  type StudentCareLightStep,
  type StudentCareResponseAction,
  type StudentCareStatus,
} from "@xuetu/contracts";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  Feather,
  HeartHandshake,
  LoaderCircle,
  MessageCircle,
  Send,
  X,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  getStudentCareStatus,
  invokeAiWorkflow,
  respondToStudentCare,
} from "../../api/client";

interface StudentCarePanelProps {
  currentTask: {
    title: string;
    href: string;
  };
  mode?: "live" | "preview";
}

type CareWorkflowState =
  | { kind: "idle"; response: null }
  | { kind: "loading"; response: null }
  | { kind: "loaded"; response: AiWorkflowResponse }
  | { kind: "network_error"; response: null };

interface VisibleCareExchange {
  exchangeId: string;
  userMessage: string;
  response: AiWorkflowResponse;
}

const CARE_OFFLINE_FALLBACK =
  "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。";

const previewInvitation: Extract<StudentCareStatus, { kind: "invitation" }> = {
  kind: "invitation",
  preference_enabled: true,
  interaction_id: "care_preview_invitation",
  signal_code: "rhythm_drop",
  greeting: "最近的学习节奏有点满。你可以先从一个十分钟的小步骤开始，也可以照常继续。",
  reason_summary: "这是一次关怀示例，不会影响你的学习安排。平时只有学习节奏明显变化时，才会出现提醒。",
  actions: ["continue", "lighten", "talk", "dismiss", "disable"],
  presented_at: "2026-08-23T08:00:00.000Z",
  expires_at: "2026-08-24T08:00:00.000Z",
};

function previewLightStep(currentTask: StudentCarePanelProps["currentTask"]): StudentCareLightStep {
  return {
    task_id: "care_preview_step",
    task_type: "course_reading",
    course_id: "course_408_ds",
    course_title: "当前课程",
    title: "先完成一个轻量步骤",
    detail: `从“${currentTask.title}”开始看一小段即可；这个示例不会提交作答，也不会改写你的学习记录。`,
    estimated_minutes: 10,
    href: currentTask.href,
  };
}

function previewLightSession(currentTask: StudentCarePanelProps["currentTask"]): Extract<StudentCareStatus, { kind: "light_session" }> {
  return {
    kind: "light_session",
    preference_enabled: true,
    interaction_id: previewInvitation.interaction_id,
    signal_code: previewInvitation.signal_code,
    message: "先做一个十分钟的小步骤，完成后再决定是否继续。",
    step: previewLightStep(currentTask),
    expires_at: previewInvitation.expires_at,
  };
}

function previewWorkflowResponse(requestId: string, userMessage: string): AiWorkflowResponse {
  const crisis = studentCareCrisisSignalPresent(userMessage);
  return {
    contract_version: "0.2",
    request_id: requestId,
    capability: "care",
    slot: "supportive_check_in",
    status: "ready",
    display_blocks: [{
      block_id: `${requestId}_reply`,
      kind: crisis ? "notice" : "summary",
      title: crisis ? "先确保你的安全" : "示例学伴",
      content: crisis
        ? STUDENT_CARE_CRISIS_GUIDANCE
        : "谢谢你愿意说出来。先不用要求自己一下子解决全部问题。你可以继续聊一会儿，也可以把今天的学习放轻一点。现在只做一步：打开当前任务，看十分钟。",
    }],
    citations: [],
    evidence_refs: [],
    next_actions: [],
    failure: null,
  };
}

function isCrisisGuidanceResponse(response: AiWorkflowResponse) {
  return response.capability === "care"
    && response.display_blocks.some(
      (block) => block.kind === "notice" && block.content === STUDENT_CARE_CRISIS_GUIDANCE,
    );
}

const invitationActions: Array<{
  action: Extract<StudentCareResponseAction, "continue" | "lighten" | "talk">;
  label: string;
  icon: typeof BookOpen;
}> = [
  { action: "continue", label: "照常学习", icon: BookOpen },
  { action: "lighten", label: "今天轻一点", icon: Feather },
  { action: "talk", label: "和学伴聊聊", icon: MessageCircle },
];

export function StudentCarePanel({ currentTask, mode = "live" }: StudentCarePanelProps) {
  const [status, setStatus] = useState<StudentCareStatus | null>(
    mode === "preview" ? previewInvitation : null,
  );
  const [busyAction, setBusyAction] = useState<StudentCareResponseAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [talkCourseId, setTalkCourseId] = useState<string | null>(null);
  const [talkConversationId, setTalkConversationId] = useState<string | null>(null);
  const [talkFallbackStep, setTalkFallbackStep] = useState<StudentCareLightStep | null>(null);
  const [visibleExchanges, setVisibleExchanges] = useState<VisibleCareExchange[]>([]);
  const [message, setMessage] = useState("");
  const [reasonOpen, setReasonOpen] = useState(false);
  const [workflow, setWorkflow] = useState<CareWorkflowState>({ kind: "idle", response: null });
  const [announcement, setAnnouncement] = useState("");
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    if (mode === "preview") {
      setStatus(previewInvitation);
      return;
    }

    let active = true;
    getStudentCareStatus()
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, [mode]);

  async function respond(action: StudentCareResponseAction): Promise<boolean> {
    if (busyAction !== null) return false;

    if (mode === "preview") {
      setBusyAction(action);
      setActionError(null);
      if (action === "lighten") {
        setStatus(previewLightSession(currentTask));
        setNotice(null);
        setAnnouncement("已切换到轻量步骤。");
      } else if (action === "talk") {
        setStatus({ kind: "none", preference_enabled: true });
        const localStep = previewLightStep(currentTask);
        setTalkCourseId(localStep.course_id);
        setTalkConversationId("care_preview_conversation");
        setTalkFallbackStep(localStep);
        setNotice("可以输入一句话，和学伴聊聊。");
        setAnnouncement("已进入关怀交流。");
      } else if (action === "continue") {
        setStatus({ kind: "none", preference_enabled: true });
        setNotice("已保留原学习任务。");
        setAnnouncement("已保留原任务。");
      } else if (action === "disable") {
        setStatus({ kind: "none", preference_enabled: false });
        setNotice("已关闭本次关怀示例。");
        setAnnouncement("已关闭本次关怀示例。");
      } else {
        setStatus({ kind: "none", preference_enabled: true });
        setNotice(null);
        setAnnouncement("示例提示已收起。");
      }
      setBusyAction(null);
      return true;
    }

    if (status?.kind !== "invitation" || busyAction !== null) return false;
    setBusyAction(action);
    setActionError(null);
    try {
      const result = await respondToStudentCare(status.interaction_id, action);
      setStatus(result.status);
      if (action === "talk" && result.talk) {
        setTalkCourseId(result.talk.course_id);
        setTalkConversationId(result.talk.conversation_id);
        setTalkFallbackStep(result.talk.fallback_step);
        setNotice("可以，从你现在最想说的一件事开始。");
        setAnnouncement("已进入学伴交流，可以开始留言。");
      } else if (action === "disable") {
        setNotice("关怀提醒已关闭，可在“我的学习”中重新开启。");
        setAnnouncement("关怀提醒已关闭，可在“我的学习”中重新开启。");
      } else if (action === "continue") {
        setNotice("已保留原任务，今天照常学习。");
        setAnnouncement("已保留原任务，今天照常学习。");
      } else if (action === "dismiss") {
        setNotice(null);
        setAnnouncement("这次提示已收起。");
      } else {
        setNotice(null);
        if (result.status.kind === "light_session") {
          setAnnouncement(`已切换到今天的轻量步骤：${result.status.step.title}。`);
        }
      }
      return true;
    } catch (caught) {
      if (
        caught instanceof ApiError
        && [
          "CARE_INTERACTION_ALREADY_RESPONDED",
          "CARE_INTERACTION_EXPIRED",
          "CARE_INTERACTION_NOT_FOUND",
        ].includes(caught.code)
      ) {
        let changedMessage = "这条关怀提示的状态已变化，已为你刷新。";
        setStatus(null);
        try {
          setStatus(await getStudentCareStatus());
        } catch {
          changedMessage = "这条关怀提示的状态已变化，旧提示已收起，请稍后刷新页面确认。";
        }
        setNotice(changedMessage);
        setAnnouncement(changedMessage);
      } else {
        const failureMessage = "关怀选择暂时没有保存，原学习任务仍可继续。";
        setActionError(failureMessage);
        setAnnouncement(failureMessage);
      }
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function closePopover() {
    if (busyAction !== null) return;
    if (mode === "preview") {
      setIsOpen(false);
      return;
    }
    if (status?.kind === "invitation" && !await respond("dismiss")) return;
    setIsOpen(false);
  }

  function handlePopoverKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || busyAction !== null) return;
    event.preventDefault();
    event.stopPropagation();
    void closePopover();
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userMessage = message.trim();
    if (!talkCourseId || !talkConversationId || !userMessage || workflow.kind === "loading") return;

    if (mode === "preview") {
      const response = previewWorkflowResponse(
        `care_preview_reply_${visibleExchanges.length + 1}`,
        userMessage,
      );
      setWorkflow({ kind: "loaded", response });
      const exchange = { exchangeId: response.request_id, userMessage, response };
      setVisibleExchanges((current) => (
        isCrisisGuidanceResponse(response)
          ? [exchange]
          : [...current, exchange].slice(-3)
      ));
      setMessage("");
      setAnnouncement(
        isCrisisGuidanceResponse(response)
          ? "已显示安全提示。"
          : "学伴已回复。",
      );
      return;
    }

    setWorkflow({ kind: "loading", response: null });
    try {
      const response = await invokeAiWorkflow({
        contract_version: "0.2",
        capability: "care",
        course_id: talkCourseId,
        concept_id: null,
        qa_id: null,
        attempt_id: null,
        conversation_id: talkConversationId,
        user_message: userMessage,
      });
      setWorkflow({ kind: "loaded", response });
      if (response.status === "ready" || response.status === "degraded") {
        const exchange = {
          exchangeId: response.request_id,
          userMessage,
          response,
        };
        setVisibleExchanges((current) => (
          isCrisisGuidanceResponse(response)
            ? [exchange]
            : [...current, exchange].slice(-3)
        ));
        setMessage("");
      }
      setAnnouncement(
        isCrisisGuidanceResponse(response)
          ? "已显示安全提示。"
          : response.status === "ready" || response.status === "degraded"
          ? "学伴已回复。"
          : response.failure?.fallback_message ?? CARE_OFFLINE_FALLBACK,
      );
    } catch {
      setWorkflow({ kind: "network_error", response: null });
      setAnnouncement(CARE_OFFLINE_FALLBACK);
    }
  }

  const hasVisibleContent = mode === "preview"
    || status?.kind === "invitation"
    || status?.kind === "light_session"
    || talkCourseId !== null
    || notice !== null;
  const showEnabledLauncher = mode === "live"
    && status?.kind === "none"
    && status.preference_enabled;
  if ((!hasVisibleContent || !isOpen) && showEnabledLauncher) {
    return (
      <section aria-label="关怀模式状态" className="student-care-launcher" role="status">
        <div className="student-care-launcher-copy">
          <HeartHandshake aria-hidden="true" size={17} />
          <span><strong>关怀模式已开启</strong></span>
        </div>
        <Link className="student-care-launcher-link" to="/student/home?care_preview=1">
          体验关怀互动 <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </section>
    );
  }
  if (!hasVisibleContent || !isOpen) return null;

  const workflowFallback = workflow.kind === "network_error"
    ? CARE_OFFLINE_FALLBACK
    : workflow.kind === "loaded"
      && workflow.response.status !== "ready"
      && workflow.response.status !== "degraded"
      ? workflow.response.failure?.fallback_message ?? CARE_OFFLINE_FALLBACK
      : null;
  const crisisGuidanceVisible = workflow.kind === "loaded"
    && isCrisisGuidanceResponse(workflow.response);
  return (
    <section
      aria-busy={busyAction !== null || workflow.kind === "loading"}
      aria-label={mode === "preview" ? "学习关怀互动" : "学习关怀"}
      aria-modal="false"
      aria-labelledby="student-care-title"
      className="student-care-panel"
      onKeyDown={handlePopoverKeyDown}
      role="dialog"
    >
      <div className="student-care-heading">
        <div className="student-care-heading-label">
          <HeartHandshake aria-hidden="true" size={18} />
          <span id="student-care-title">{mode === "preview" ? "学习关怀互动" : "学习关怀"}</span>
        </div>
        <button
          aria-busy={busyAction === "dismiss"}
          aria-label="关闭本次关怀"
          className="student-care-close"
          disabled={busyAction !== null}
          onClick={() => void closePopover()}
          title="关闭本次关怀"
          type="button"
        >
          {busyAction === "dismiss"
            ? <LoaderCircle aria-hidden="true" className="student-care-spinner" size={16} />
            : <X aria-hidden="true" size={17} />}
        </button>
      </div>

      {status?.kind === "invitation" ? (
        <div className="student-care-invitation">
          <h2>{status.greeting}</h2>
          <div aria-label="选择今天的学习方式" className="student-care-actions" role="group">
            {invitationActions.map(({ action, icon: Icon, label }) => (
              <button
                aria-busy={busyAction === action}
                disabled={busyAction !== null}
                key={action}
                onClick={() => void respond(action)}
                type="button"
              >
                {busyAction === action
                  ? <LoaderCircle aria-hidden="true" className="student-care-spinner" size={15} />
                  : <Icon aria-hidden="true" size={15} />}
                {label}
              </button>
            ))}
          </div>
          <details className="student-care-reason" open={reasonOpen}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                setReasonOpen((open) => !open);
              }}
            >
              为什么看到这个提示
              <ChevronDown aria-hidden="true" size={15} />
            </summary>
            {reasonOpen ? (
              <div>
                <p>{status.reason_summary}</p>
                <div className="student-care-quiet-actions">
                  <button disabled={busyAction !== null} onClick={() => void closePopover()} type="button">
                    <X aria-hidden="true" size={14} />暂不需要
                  </button>
                  <button disabled={busyAction !== null} onClick={() => void respond("disable")} type="button">
                    关闭关怀提醒
                  </button>
                </div>
              </div>
            ) : null}
          </details>
        </div>
      ) : null}

      {status?.kind === "light_session" ? (
        <div className="student-care-light-step">
          <div>
            <span>今天的轻量步骤</span>
            <h2>{status.step.title}</h2>
            <p>{status.message}</p>
            <small>{status.step.detail}</small>
          </div>
          <div className="student-care-light-action">
            <span>{status.step.estimated_minutes} 分钟</span>
            <Link to={status.step.href}>开始轻量步骤<ArrowRight aria-hidden="true" size={15} /></Link>
          </div>
        </div>
      ) : null}

      {talkCourseId ? (
        <div className="student-care-talk">
          {!crisisGuidanceVisible ? (
            <>
              <p>{notice}</p>
              <form onSubmit={(event) => void submitMessage(event)}>
                <label htmlFor="student-care-message">想和学伴说什么</label>
                <div>
                  <textarea
                    aria-label="想和学伴说什么"
                    autoComplete="off"
                    id="student-care-message"
                    maxLength={2_000}
                    name="student-care-message"
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="写下此刻最想说明的学习状态"
                    rows={3}
                    value={message}
                  />
                  <button disabled={!message.trim() || workflow.kind === "loading"} type="submit">
                    {workflow.kind === "loading"
                      ? <LoaderCircle aria-hidden="true" className="student-care-spinner" size={15} />
                      : <Send aria-hidden="true" size={15} />}
                    发送给学伴
                  </button>
                </div>
              </form>
            </>
          ) : null}
          {workflow.kind === "loading" ? <p role="status">学伴正在阅读你的留言…</p> : null}
          {visibleExchanges.length > 0 ? (
            <div aria-label="与学伴的对话" className="student-care-thread">
              {visibleExchanges.map((exchange) => (
                <div className="student-care-exchange" key={exchange.exchangeId}>
                  <section className="student-care-user-turn">
                    <strong>你</strong>
                    <p>{exchange.userMessage}</p>
                  </section>
                  <div className="student-care-reply">
                    {exchange.response.display_blocks.map((block) => (
                      <section key={block.block_id}>
                        {block.title ? <strong>{block.title}</strong> : null}
                        <p>{block.content}</p>
                      </section>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {workflowFallback ? <p className="student-care-fallback">{workflowFallback}</p> : null}
          {workflowFallback && talkFallbackStep && !crisisGuidanceVisible ? (
            <Link
              aria-label="开始轻量步骤"
              className="student-care-talk-fallback-step"
              to={talkFallbackStep.href}
            >
              <span>
                <small>今天的轻量步骤 · {talkFallbackStep.estimated_minutes} 分钟</small>
                <strong>{talkFallbackStep.title}</strong>
              </span>
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          ) : null}
          {!crisisGuidanceVisible ? (
            <Link aria-label="继续原任务" className="student-care-original-task" to={currentTask.href}>
              继续原任务：{currentTask.title}<ArrowRight aria-hidden="true" size={14} />
            </Link>
          ) : null}
        </div>
      ) : null}

      {!talkCourseId && notice ? <p className="student-care-notice">{notice}</p> : null}
      {actionError ? <p className="student-care-error">{actionError}</p> : null}
      <div aria-atomic="true" aria-live="polite" className="student-care-live">{announcement}</div>
    </section>
  );
}
