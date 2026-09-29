import type {
  PastExamCatalogResponse,
  LearningProbeOffer,
  LearningProbeResult,
  LearningProbeSession,
  PilotTaskEvaluationResponse,
  PracticeMode,
  QuestionDto,
  StudentLearningTaskSettlement,
} from "@xuetu/contracts";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Filter,
  ImageUp,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  ApiError,
  activateStudentLearningTask,
  completeStudentLearningTask,
  evaluatePilotChoiceTask,
  getPastExamCatalog,
  getLearningProbeOffer,
  getLearningProbeOfferForSession,
  getLearningProbeSession,
  getQuestionBankQuestions,
  skipLearningProbe,
  startLearningProbe,
  submitQuestionAnswer,
  submitLearningProbe,
  type QuestionEvaluationBundle,
  type QuestionSelectionData,
} from "../../api/client";
import { notifyStudyAgentEvidenceUpdated } from "../../components/study-agent-controller";
import { AiWorkflowSlot } from "../ai/ai-workflow-slot";
import { MockExamSession } from "./mock-exam-session";
import { PastExamLibrary, PastExamPaperNavigator } from "./past-exam-library";
import { PracticeModeNav } from "./practice-mode-nav";
import { QuestionAssets } from "./question-assets";
import { QuestionNotebookTools } from "../notebook/notebook-editor";
import { StudyToolsNav, StudyQueueNav } from "../study-library/study-tools";

interface AppliedFilters {
  subject: CourseSubject;
  concept_id?: string;
  question_id?: string;
  year?: number;
  type: "choice" | "subjective";
  tags: string[];
}

type CourseSubject = "数据结构" | "组成原理" | "操作系统" | "计算机网络";

const COURSE_SUBJECTS: CourseSubject[] = ["数据结构", "组成原理", "操作系统", "计算机网络"];

const COURSE_BACK_LINKS: Record<CourseSubject, string> = {
  数据结构: "/student/courses/data-structures",
  组成原理: "/student/courses/computer-organization",
  操作系统: "/student/courses/operating-systems",
  计算机网络: "/student/courses/computer-networks",
};

const COURSE_IDS_BY_SUBJECT: Record<CourseSubject, string> = {
  数据结构: "course_408_ds",
  组成原理: "course_408_co",
  操作系统: "course_408_os",
  计算机网络: "course_408_cn",
};

function courseSubject(value: string | null): CourseSubject {
  return COURSE_SUBJECTS.includes(value as CourseSubject)
    ? (value as CourseSubject)
    : "数据结构";
}

function practiceMode(value: string | null): Exclude<PracticeMode, "diagnostic"> {
  if (value === "past_exam" || value === "mock_exam" || value === "mistake_review") return value;
  return "targeted";
}

const MODE_INTRO: Record<Exclude<PracticeMode, "diagnostic">, string> = {
  targeted: "围绕科目、知识点和标签练习，优先展示更适合当前复习进度的题目。",
  past_exam: "按年份与原题号顺序练习，提交后逐题查看结果与解析。",
  mock_exam: "按本场题组限时作答，交卷前不显示答案，交卷后统一结算。",
  mistake_review: "集中练习你尚未完成复习的错题。",
};

const DEFAULT_FILTERS: AppliedFilters = {
  subject: "数据结构",
  type: "choice",
  tags: [],
};

function parseTags(value: string) {
  return [...new Set(
    value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  )];
}

function pastExamYear(value: string | null) {
  if (!value || !/^\d{4}$/u.test(value)) return null;
  const year = Number(value);
  return year >= 1900 && year <= 2100 ? year : null;
}

function pastExamQuestionNumber(value: string | null) {
  if (!value || !/^\d{1,3}$/u.test(value)) return 1;
  const number = Number(value);
  return number >= 1 ? Math.min(number, 47) : 1;
}

function readableError(prefix: string, error: unknown) {
  if (error instanceof ApiError) return `${prefix}：${error.message}`;
  return `${prefix}，请稍后重试。`;
}

function optionLabel(option: QuestionDto["options"][number]) {
  return `${option.option_id}. ${option.text}`;
}

function newQuestionEvaluationIdempotencyKey() {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `question-evaluation-${suffix}`;
}

function withOrchestrationTaskId(href: string, taskId: string) {
  const [pathAndQuery = "", hash = ""] = href.split("#", 2);
  const [path, query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  // Probe sessions use their own lifecycle endpoint and must never be
  // represented as regular assignment links.
  if (params.has("probe_session_id")) {
    params.delete("orchestration_task_id");
  } else {
    params.set("orchestration_task_id", taskId);
  }
  const search = params.toString();
  return `${path}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

function reviewDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function mistakeReviewHref(settlement: StudentLearningTaskSettlement) {
  const params = new URLSearchParams({ course_id: settlement.course_id });
  if (settlement.concept_id) params.set("concept_id", settlement.concept_id);
  return `/student/mistakes?${params.toString()}`;
}

interface LearningProbePanelProps {
  offer: LearningProbeOffer | null;
  result: LearningProbeResult | null;
  loading: boolean;
  error: string | null;
  decision: "idle" | "later" | "skipped" | "none";
  selectedOptionIds: string[];
  submitting: boolean;
  onChooseOption: (optionId: string) => void;
  onStart: () => void;
  onLater: () => void;
  onSkip: () => void;
  onSubmit: () => void;
}

function LearningProbePanel({
  offer,
  result,
  loading,
  error,
  decision,
  selectedOptionIds,
  submitting,
  onChooseOption,
  onStart,
  onLater,
  onSkip,
  onSubmit,
}: LearningProbePanelProps) {
  if (loading) {
    return (
      <section className="learning-probe-panel loading" role="status" aria-live="polite">
        <strong>正在准备验证题…</strong>
        <p>保留当前错题，马上就好。</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="learning-probe-panel error" role="alert">
        <strong>{error}</strong>
        <p>原题结果和错题复习不受影响。</p>
      </section>
    );
  }

  if (result) {
    return (
      <section className="learning-probe-panel result" aria-label="验证结果" role="region">
        <header>
          <CheckCircle2 aria-hidden="true" size={20} />
          <div>
            <span>对照验证</span>
            <h3>这次验证留下了一条新记录</h3>
          </div>
          <strong>{result.evaluation.is_correct ? "答对" : "待复习"}</strong>
        </header>
        <p className="learning-probe-evidence-kind">
          {result.evidence_kind === "concept_evidence" ? "知识点表现" : "题目复习记录"}
        </p>
        <p>{result.evidence_statement}</p>
        {result.session.evidence.unknowns.length ? (
          <ul className="learning-probe-unknowns">
            {result.session.evidence.unknowns.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
        {result.next_task ? (
          <Link className="secondary-button" to={result.next_task.href}>{result.next_task.label}<ArrowRight aria-hidden="true" size={15} /></Link>
        ) : null}
      </section>
    );
  }

  if (decision === "later") {
    return (
      <section className="learning-probe-panel note" role="status" aria-live="polite">
        <strong>已保留在错题复习中，之后仍可回来验证。</strong>
      </section>
    );
  }

  if (decision === "skipped") {
    return (
      <section className="learning-probe-panel note" role="status" aria-live="polite">
        <strong>本次已跳过，不影响错题复习和后续学习。</strong>
      </section>
    );
  }

  if (decision === "none" || !offer) {
    return (
      <section className="learning-probe-panel fallback" role="region" aria-label="普通错题复习">
        <p>当前没有合格的对照题，这次错题已保留在普通错题复习中。</p>
        <Link className="secondary-button" to="/student/mistakes">进入错题复习<ArrowRight aria-hidden="true" size={15} /></Link>
      </section>
    );
  }

  const question = offer.question.question;
  const started = offer.status === "started";
  return started ? (
    <section className="learning-probe-panel question" aria-label="对照验证题" role="region">
      <header>
        <div>
          <span>同一知识点 · 换一道题</span>
          <h3>换一道题确认</h3>
        </div>
        <strong>可跳过</strong>
      </header>
      <p className="learning-probe-surface-difference">{offer.surface_difference}</p>
      <p className="question-stem">{question.question}</p>
      <QuestionAssets
        altPrefix="对照题图示"
        assets={question.assets.filter((asset) => asset.role === "question")}
        key={`${question.id}:probe-assets`}
        questionId={question.id}
      />
      <fieldset className="question-options" disabled={submitting}>
        <legend>{question.multiple ? "选择所有正确选项" : "选择一个答案"}</legend>
        {question.options.map((option) => (
          <div className={`question-option-row ${selectedOptionIds.includes(option.option_id) ? "selected-option" : ""}`} key={option.option_id}>
            <label>
              <input
                aria-label={`${option.option_id}. ${option.text}`}
                checked={selectedOptionIds.includes(option.option_id)}
                name="learning-probe-answer"
                onChange={() => onChooseOption(option.option_id)}
                type={question.multiple ? "checkbox" : "radio"}
                value={option.option_id}
              />
              <span className="option-key">{option.option_id}</span>
              <span className="option-text">{option.text}</span>
            </label>
          </div>
        ))}
      </fieldset>
      <footer>
        <button className="secondary-button" disabled={submitting} onClick={onSkip} type="button">先跳过</button>
        <button className="first-release-primary-action" disabled={selectedOptionIds.length === 0 || submitting} onClick={onSubmit} type="button">
          {submitting ? "正在保存…" : "提交验证"}<ArrowRight aria-hidden="true" size={15} />
        </button>
      </footer>
    </section>
  ) : (
    <section className="learning-probe-panel offer" aria-label="待确认的知识点" role="region">
      <header>
        <div>
          <span>{offer.concept_title}</span>
          <h3>这次先记为一个待确认信号</h3>
        </div>
        <strong>不增加负担</strong>
      </header>
      <p>要不要用另一道题确认是不是同一处卡点？</p>
      <div className="learning-probe-actions">
        <button className="first-release-primary-action" onClick={onStart} type="button">现在验证</button>
        <button className="secondary-button" onClick={onLater} type="button">稍后复习</button>
        <button className="text-button" onClick={onSkip} type="button">跳过</button>
      </div>
    </section>
  );
}

export function PracticePage() {
  const [params] = useSearchParams();
  // A different practice selection owns its answer, evaluation and note state.
  // Probe/task parameters change during settlement and must keep that session alive.
  const selectionKey = JSON.stringify(["mode", "subject", "type", "tags", "concept_id", "question_id", "pilot_task_id"].map((name) => params.get(name)));
  return <PracticeSession key={selectionKey} />;
}

function PracticeSession() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMode = practiceMode(searchParams.get("mode"));
  const selectedPastExamYear = activeMode === "past_exam"
    ? pastExamYear(searchParams.get("year"))
    : null;
  const selectedPastExamQuestion = activeMode === "past_exam"
    ? pastExamQuestionNumber(searchParams.get("question"))
    : 1;
  const initialSubject = courseSubject(searchParams.get("subject"));
  const initialConceptId = searchParams.get("concept_id")?.trim() || undefined;
  const initialQuestionId = searchParams.get("question_id")?.trim() || undefined;
  const initialType = searchParams.get("type") === "subjective" ? "subjective" : "choice";
  const probeSessionIdFromUrl = searchParams.get("probe_session_id")?.trim() || null;
  const orchestrationTaskIdFromUrl = searchParams.get("orchestration_task_id")?.trim() || null;
  // A probe is settled by the probe endpoint; an old link may still carry the
  // regular task id, which must not create or complete a second assignment.
  const orchestrationTaskId = probeSessionIdFromUrl ? null : orchestrationTaskIdFromUrl;
  const pilotTaskId = searchParams.get("pilot_task_id")?.trim() || null;
  const [draftSubject, setDraftSubject] = useState<CourseSubject>(initialSubject);
  const [draftType, setDraftType] = useState<"choice" | "subjective">(initialType);
  const [draftTags, setDraftTags] = useState(searchParams.get("tags") ?? "");
  const [filters] = useState<AppliedFilters>({
    ...DEFAULT_FILTERS,
    subject: initialSubject,
    type: initialType,
    tags: parseTags(searchParams.get("tags") ?? ""),
    ...(initialConceptId ? { concept_id: initialConceptId } : {}),
    ...(initialQuestionId ? { question_id: initialQuestionId } : {}),
  });
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [pastExamCatalog, setPastExamCatalog] = useState<PastExamCatalogResponse | null>(null);
  const [pastExamCatalogLoading, setPastExamCatalogLoading] = useState(false);
  const [pastExamCatalogError, setPastExamCatalogError] = useState<string | null>(null);
  const [selection, setSelection] = useState<QuestionSelectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [responseText, setResponseText] = useState("");
  const [submissionIdempotencyKey, setSubmissionIdempotencyKey] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<QuestionEvaluationBundle | null>(null);
  const [learningProbeOffer, setLearningProbeOffer] = useState<LearningProbeOffer | null>(null);
  const [learningProbeSession, setLearningProbeSession] = useState<LearningProbeSession | null>(null);
  const [learningProbeResult, setLearningProbeResult] = useState<LearningProbeResult | null>(null);
  const [learningProbeLoading, setLearningProbeLoading] = useState(false);
  const [learningProbeError, setLearningProbeError] = useState<string | null>(null);
  const [learningProbeDecision, setLearningProbeDecision] = useState<"idle" | "later" | "skipped" | "none">("idle");
  const [learningProbeRequested, setLearningProbeRequested] = useState(false);
  const [learningProbeOptionIds, setLearningProbeOptionIds] = useState<string[]>([]);
  const [learningProbeSubmissionKey, setLearningProbeSubmissionKey] = useState<string | null>(null);
  const [pilotEvaluation, setPilotEvaluation] = useState<PilotTaskEvaluationResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<"idle" | "activating" | "active" | "completed" | "error">(orchestrationTaskId ? "activating" : "idle");
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<StudentLearningTaskSettlement | null>(null);
  const [settlementError, setSettlementError] = useState(false);
  const [pilotCompletionStatus, setPilotCompletionStatus] = useState<"idle" | "completing" | "completed" | "error">("idle");
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const selectedPaper = selectedPastExamYear === null
    ? null
    : pastExamCatalog?.items.find((paper) => paper.year === selectedPastExamYear) ?? null;
  const selectedPaperQuestionCount = selectedPaper?.question_count ?? null;
  const selectedPaperIsComplete = selectedPaper?.is_complete === true;
  const hasPastExamCatalog = pastExamCatalog !== null;
  const pastExamCatalogFailed = pastExamCatalogError !== null;
  const pastExamCatalogPending = !hasPastExamCatalog && !pastExamCatalogFailed;

  useEffect(() => {
    let active = true;
    if (activeMode !== "past_exam") {
      setPastExamCatalog(null);
      setPastExamCatalogLoading(false);
      setPastExamCatalogError(null);
      return () => { active = false; };
    }
    setPastExamCatalogLoading(true);
    setPastExamCatalogError(null);
    getPastExamCatalog()
      .then((catalog) => {
        if (!active) return;
        setPastExamCatalog(catalog);
        setPastExamCatalogLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPastExamCatalogError(readableError("真题目录加载失败", error));
        setPastExamCatalogLoading(false);
      });
    return () => { active = false; };
  }, [activeMode, catalogReloadKey]);

  useEffect(() => {
    if (activeMode !== "past_exam" || selectedPastExamYear === null) return;
    if (pastExamCatalogFailed) {
      if (!selectedPaperIsComplete) {
        setSearchParams({ mode: "past_exam" }, { replace: true });
      }
      return;
    }
    if (!hasPastExamCatalog) return;
    if (!selectedPaperIsComplete || selectedPaperQuestionCount === null) {
      setSearchParams({ mode: "past_exam" }, { replace: true });
      return;
    }
    const canonicalQuestion = String(Math.min(
      selectedPastExamQuestion,
      selectedPaperQuestionCount,
    ));
    if (searchParams.get("question") !== canonicalQuestion) {
      setSearchParams({
        mode: "past_exam",
        year: String(selectedPastExamYear),
        question: canonicalQuestion,
      }, { replace: true });
    }
  }, [
    activeMode,
    hasPastExamCatalog,
    pastExamCatalogFailed,
    searchParams,
    selectedPaperIsComplete,
    selectedPaperQuestionCount,
    selectedPastExamQuestion,
    selectedPastExamYear,
    setSearchParams,
  ]);

  useEffect(() => {
    let active = true;
    if (probeSessionIdFromUrl && activeMode !== "mock_exam" && activeMode !== "past_exam") {
      setLoading(false);
      setLoadError(null);
      if (!evaluation) setSelection(null);
      return () => { active = false; };
    }
    if (activeMode === "mock_exam" || (activeMode === "past_exam" && selectedPastExamYear === null)) {
      setLoading(false);
      setLoadError(null);
      setSelection(null);
      return () => { active = false; };
    }
    if (activeMode === "past_exam" && selectedPastExamYear !== null) {
      if (!selectedPaperIsComplete || selectedPaperQuestionCount === null) {
        setLoading(pastExamCatalogPending);
        setLoadError(null);
        setSelection(null);
        return () => { active = false; };
      }
    }
    setLoading(true);
    setLoadError(null);
    setSelection(null);
    setSelectedOptionIds([]);
    setResponseText("");
    setSubmissionIdempotencyKey(null);
    setEvaluation(null);
    setLearningProbeOffer(null);
    setLearningProbeSession(null);
    setLearningProbeResult(null);
    setLearningProbeError(null);
    setLearningProbeDecision("idle");
    setLearningProbeRequested(false);
    setLearningProbeOptionIds([]);
    setLearningProbeSubmissionKey(null);
    setPilotEvaluation(null);
    setSubmissionError(null);
    setSettlement(null);
    setSettlementError(false);
    setPilotCompletionStatus("idle");

    const request = activeMode === "past_exam"
      ? {
          mode: "past_exam" as const,
          year: selectedPastExamYear!,
          tag_match: "all" as const,
          limit: 1,
          offset: selectedPastExamQuestion - 1,
        }
      : {
          mode: activeMode,
          subject: filters.subject,
          type: filters.type,
          tags: filters.tags,
          ...((activeMode === "targeted" || activeMode === "mistake_review") && filters.concept_id
            ? { concept_id: filters.concept_id }
            : {}),
          ...((activeMode === "targeted" || activeMode === "mistake_review") && filters.question_id
            ? { question_id: filters.question_id }
            : {}),
          tag_match: "all" as const,
          limit: 1,
          offset,
        };
    getQuestionBankQuestions(request)
      .then((result) => {
        if (!active) return;
        setSelection(result);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(readableError("题目加载失败", error));
        setLoading(false);
      });

    return () => { active = false; };
  }, [
    activeMode,
    filters,
    pastExamCatalogPending,
    offset,
    reloadKey,
    selectedPaperIsComplete,
    selectedPaperQuestionCount,
    selectedPastExamQuestion,
    selectedPastExamYear,
    probeSessionIdFromUrl,
  ]);

  useEffect(() => {
    let active = true;
    if (!probeSessionIdFromUrl || activeMode === "mock_exam" || activeMode === "past_exam") return () => { active = false; };
    if (learningProbeOffer?.probe_session_id === probeSessionIdFromUrl) return () => { active = false; };
    setLearningProbeLoading(true);
    setLearningProbeRequested(true);
    setLearningProbeError(null);
    getLearningProbeSession(probeSessionIdFromUrl)
      .then(async (session) => {
        if (!active) return;
        setLearningProbeSession(session);
        if (session.status === "completed" || session.status === "skipped" || session.status === "expired") {
          setLearningProbeLoading(false);
          return;
        }
        const offer = await getLearningProbeOfferForSession(probeSessionIdFromUrl);
        if (!active) return;
        setLearningProbeOffer(offer);
        setLearningProbeLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLearningProbeError(readableError("验证任务加载失败", error));
        setLearningProbeLoading(false);
      });
    return () => { active = false; };
  }, [activeMode, learningProbeOffer, probeSessionIdFromUrl]);

  useEffect(() => {
    let active = true;
    if (!orchestrationTaskId) {
      setTaskStatus("idle");
      return () => { active = false; };
    }
    setTaskStatus("activating");
    activateStudentLearningTask(orchestrationTaskId)
      .then(() => { if (active) setTaskStatus("active"); })
      .catch(() => { if (active) { setTaskStatus("error"); setTaskMessage("任务进度暂未同步，仍可继续作答。"); } });
    return () => { active = false; };
  }, [orchestrationTaskId]);

  const practiceItem = selection?.items[0] ?? null;
  const question = practiceItem?.question ?? null;
  const hasStudyQueue = searchParams.has("library_collection") || searchParams.has("library_map");
  const paperQuestionCount = selectedPaperQuestionCount ?? selection?.total ?? 47;
  const visibleQuestionNumber = activeMode === "past_exam"
    ? selectedPastExamQuestion
    : offset + 1;

  useEffect(() => {
    if (question && !loading) questionHeadingRef.current?.focus();
  }, [question, loading]);

  useEffect(() => {
    if (evaluation || pilotEvaluation) resultHeadingRef.current?.focus();
  }, [evaluation, pilotEvaluation]);

  const hasEvaluation = Boolean(evaluation || pilotEvaluation);

  const correctOptionIds = useMemo(
    () => evaluation?.evaluation.correct_option_ids ?? [],
    [evaluation],
  );

  const chooseLearningProbeOption = (optionId: string) => {
    if (!learningProbeOffer || learningProbeOffer.question.question.type !== "choice" || learningProbeResult || learningProbeLoading) return;
    if (!learningProbeOffer.question.question.multiple) {
      setLearningProbeOptionIds([optionId]);
      return;
    }
    setLearningProbeOptionIds((current) => current.includes(optionId)
      ? current.filter((item) => item !== optionId)
      : [...current, optionId]);
    setLearningProbeSubmissionKey(null);
  };

  const startLearningProbeSession = async () => {
    if (!learningProbeOffer) return;
    setLearningProbeLoading(true);
    setLearningProbeError(null);
    try {
      const started = await startLearningProbe(learningProbeOffer.probe_session_id);
      if (!started) throw new Error("empty probe offer");
      setLearningProbeOffer(started);
      setLearningProbeDecision("idle");
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("probe_session_id", started.probe_session_id);
      nextParams.delete("orchestration_task_id");
      setSearchParams(nextParams, { replace: true });
    } catch (error) {
      setLearningProbeError(readableError("验证任务加载失败", error));
    } finally {
      setLearningProbeLoading(false);
    }
  };

  const deferLearningProbe = () => {
    setLearningProbeDecision("later");
  };

  const skipLearningProbeSession = async () => {
    if (!learningProbeOffer) return;
    setLearningProbeLoading(true);
    setLearningProbeError(null);
    try {
      const session = await skipLearningProbe(learningProbeOffer.probe_session_id);
      setLearningProbeSession(session);
      setLearningProbeDecision("skipped");
    } catch (error) {
      setLearningProbeError(readableError("跳过验证失败", error));
    } finally {
      setLearningProbeLoading(false);
    }
  };

  const submitLearningProbeAnswer = async () => {
    if (!learningProbeOffer || learningProbeOptionIds.length === 0 || learningProbeLoading) return;
    const idempotencyKey = learningProbeSubmissionKey ?? newQuestionEvaluationIdempotencyKey();
    if (!learningProbeSubmissionKey) setLearningProbeSubmissionKey(idempotencyKey);
    setLearningProbeLoading(true);
    setLearningProbeError(null);
    try {
      const result = await submitLearningProbe(
        learningProbeOffer.probe_session_id,
        {
          question_id: learningProbeOffer.question.question.id,
          answer_type: "choice",
          selected_option_ids: learningProbeOptionIds,
        },
        idempotencyKey,
      );
      setLearningProbeResult(result);
      setLearningProbeSession(result.session);
      notifyStudyAgentEvidenceUpdated();
    } catch (error) {
      setLearningProbeError(readableError("验证提交失败", error));
    } finally {
      setLearningProbeLoading(false);
    }
  };

  const applyFilters = () => {
    setSearchParams({ mode: activeMode, subject: draftSubject, type: draftType, ...(draftTags.trim() ? { tags: parseTags(draftTags).join(",") } : {}) }, { replace: true });
    if (draftSubject === filters.subject && draftType === filters.type && parseTags(draftTags).join(",") === filters.tags.join(",") && !filters.question_id && !filters.concept_id) {
      setOffset(0);
      setReloadKey((value) => value + 1);
    }
  };

  const clearFilters = () => {
    setDraftTags("");
    setSearchParams({ mode: activeMode, subject: draftSubject, type: draftType }, { replace: true });
    if (draftSubject === filters.subject && draftType === filters.type && !filters.tags.length && !filters.question_id && !filters.concept_id) {
      setOffset(0);
      setReloadKey((value) => value + 1);
    }
  };

  const chooseOption = (optionId: string) => {
    if (!question || question.type !== "choice" || hasEvaluation || submitting) return;
    setSubmissionIdempotencyKey(null);
    if (!question.multiple) {
      setSelectedOptionIds([optionId]);
      return;
    }
    setSelectedOptionIds((current) =>
      current.includes(optionId)
        ? current.filter((item) => item !== optionId)
        : [...current, optionId],
    );
  };

  const submitAnswer = async () => {
    if (!question || submitting || hasEvaluation) return;
    if (question.type === "choice" && selectedOptionIds.length === 0) return;
    if (question.type === "subjective" && !responseText.trim()) return;
    const idempotencyKey = submissionIdempotencyKey ?? newQuestionEvaluationIdempotencyKey();
    if (!submissionIdempotencyKey) setSubmissionIdempotencyKey(idempotencyKey);
    setSubmitting(true);
    setSubmissionError(null);
    try {
      if (pilotTaskId && question.type === "choice") {
        setPilotCompletionStatus("completing");
        const result = await evaluatePilotChoiceTask(
          pilotTaskId,
          { selected_option_ids: selectedOptionIds },
          idempotencyKey,
        );
        setPilotEvaluation(result);
        setPilotCompletionStatus("completed");
      } else {
        const result = await submitQuestionAnswer(
          question.type === "choice"
            ? {
                question_id: question.id,
                ...(filters.concept_id ? { concept_id: filters.concept_id } : {}),
                answer_type: "choice",
                selected_option_ids: selectedOptionIds,
              }
            : {
                question_id: question.id,
                ...(filters.concept_id ? { concept_id: filters.concept_id } : {}),
                answer_type: "subjective",
                response_text: responseText.trim(),
              },
          idempotencyKey,
        );
        setEvaluation(result);
        if (
          question.type === "choice"
          && activeMode !== "past_exam"
          && result.evaluation.is_correct === false
          && result.evidence.eligible_for_learning_state_update
        ) {
          setLearningProbeLoading(true);
          setLearningProbeRequested(true);
          setLearningProbeError(null);
          getLearningProbeOffer(result.attempt.attempt_id)
            .then((offer) => {
              setLearningProbeOffer(offer);
              setLearningProbeDecision(offer ? "idle" : "none");
            })
            .catch((error: unknown) => setLearningProbeError(readableError("验证任务暂时不可用", error)))
            .finally(() => setLearningProbeLoading(false));
        }
        if (activeMode === "past_exam") {
          setCatalogReloadKey((value) => value + 1);
        }
      }
       if (orchestrationTaskId) {
         try {
           const completion = await completeStudentLearningTask(orchestrationTaskId);
           setTaskStatus("completed");
            setSettlement(completion.settlement);
            setSettlementError(false);
          } catch {
            setSettlementError(true);
            setTaskMessage("评测已完成，但今日任务尚未结算；刷新首页后可重试。");
          }
       }
      notifyStudyAgentEvidenceUpdated();
    } catch (error) {
      setSubmissionError(readableError("评测提交失败", error));
    } finally {
      setSubmitting(false);
    }
  };

  const goToPastExamQuestion = (questionNumber: number) => {
    if (selectedPastExamYear === null) return;
    const boundedQuestion = Math.min(Math.max(questionNumber, 1), paperQuestionCount);
    setSearchParams({
      mode: "past_exam",
      year: String(selectedPastExamYear),
      question: String(boundedQuestion),
    });
  };

  const continueToNextQuestion = () => {
    if (activeMode === "past_exam" && selectedPastExamYear !== null) {
      if (selectedPastExamQuestion >= paperQuestionCount) {
        setSearchParams({ mode: "past_exam" });
      } else {
        goToPastExamQuestion(selectedPastExamQuestion + 1);
      }
      return;
    }
    const nextOffset = selection && offset + 1 < selection.total ? offset + 1 : 0;
    if (orchestrationTaskId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("orchestration_task_id");
      setSearchParams(nextParams, { replace: true });
      setTaskStatus("idle");
      setTaskMessage(null);
    }
    setOffset(nextOffset);
    setSelectedOptionIds([]);
    setResponseText("");
    setSubmissionIdempotencyKey(null);
    setEvaluation(null);
    setLearningProbeOffer(null);
    setLearningProbeSession(null);
    setLearningProbeResult(null);
    setLearningProbeLoading(false);
    setLearningProbeError(null);
    setLearningProbeDecision("idle");
    setLearningProbeRequested(false);
    setLearningProbeOptionIds([]);
    setLearningProbeSubmissionKey(null);
    setPilotEvaluation(null);
    setSubmissionError(null);
    setSettlement(null);
    setSettlementError(false);
  };

  return (
    <div className="page-inner question-practice-center first-release-workspace" data-visual-system="ochre-serif">
      <header className="practice-center-heading">
        <div>
          {activeMode === "past_exam" ? (
            <Link className="practice-course-back" to="/student/courses">返回课程中心</Link>
          ) : (
            <Link className="practice-course-back" to={COURSE_BACK_LINKS[filters.subject]}>
              返回{filters.subject}课程
            </Link>
          )}
          <span className="first-release-kicker">
            {activeMode === "past_exam"
              ? selectedPastExamYear === null ? "408 · 历年真题" : `408 · ${selectedPastExamYear} 年真题`
              : `408 · ${filters.subject} · ${filters.type === "choice" ? "选择题" : "主观题"}`}
          </span>
          <h1>
            {activeMode === "mock_exam"
              ? "408 限时训练"
              : activeMode === "past_exam"
                ? selectedPastExamYear === null ? "408 历年真题" : `${selectedPastExamYear} 年 408 真题`
                : `${filters.subject}课程训练`}
          </h1>
          <p>
            {pilotTaskId
              ? "独立完成当前固定题，提交后返回课程试点流程。"
              : MODE_INTRO[activeMode]}
          </p>
          {selection?.context ? (
            <p className="practice-concept-context">
              {`知识点练习：${selection.context.concept_title}`}
            </p>
          ) : null}
        </div>
      </header>

      {!pilotTaskId ? <PracticeModeNav activeMode={activeMode} subject={filters.subject} /> : null}
      {!pilotTaskId ? <StudyToolsNav /> : null}
      {hasStudyQueue ? <StudyQueueNav {...(question ? {questionId: question.id} : {})} /> : null}

      {!pilotTaskId && activeMode !== "past_exam" ? (
        <aside className="photo-tutor-entry" aria-label="平台外题目工具">
          <ImageUp aria-hidden="true" size={20} strokeWidth={1.7} />
          <div>
            <strong>拍照讲题</strong>
            <span>核对识别内容后，再选择讲解深度。</span>
          </div>
          <Link to="/student/practice/photo-tutor">
            上传题目图片 <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </aside>
      ) : null}

      {activeMode === "mock_exam" && !pilotTaskId ? (
        <MockExamSession />
      ) : (
      <>

      {pilotTaskId ? (
        <section className="question-filter-bar pilot-fixed-question" aria-label="课程固定题目">
          <ClipboardCheck aria-hidden="true" size={18} />
          <div>
            <strong>课程固定题目</strong>
            <span>科目、知识点与题目已由课程试点方案锁定。</span>
          </div>
          <Link className="secondary-button" to="/student/pilot-study">退出课程题目</Link>
        </section>
      ) : !hasStudyQueue && activeMode === "past_exam" && selectedPastExamYear !== null ? (
        <PastExamPaperNavigator
          currentQuestion={selectedPastExamQuestion}
          onSelectQuestion={goToPastExamQuestion}
          questionCount={paperQuestionCount}
          year={selectedPastExamYear}
        />
      ) : !hasStudyQueue && activeMode !== "past_exam" ? (
      <form
        className={`question-filter-bar practice-filter-${activeMode}`}
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <span className="filter-bar-title"><Filter aria-hidden="true" size={16} />筛选本轮题目</span>
        <label>
          科目
          <select
            aria-label="科目"
            onChange={(event) => setDraftSubject(event.target.value as CourseSubject)}
            value={draftSubject}
          >
            {COURSE_SUBJECTS.map((subject) => <option key={subject}>{subject}</option>)}
          </select>
        </label>
        <label>
          题型
          <select
            aria-label="题型"
            onChange={(event) => setDraftType(event.target.value as "choice" | "subjective")}
            value={draftType}
          >
            <option value="choice">选择题</option>
            <option value="subjective">主观题</option>
          </select>
        </label>
        <label className="tag-filter-field">
          知识标签
          <input
            aria-label="知识标签"
            onChange={(event) => setDraftTags(event.target.value)}
            placeholder="如：线性表，栈"
            value={draftTags}
          />
        </label>
        <button type="submit">应用筛选</button>
      </form>
      ) : null}

      {probeSessionIdFromUrl && !evaluation ? (
        <LearningProbePanel
          decision={learningProbeSession?.status === "skipped" ? "skipped" : learningProbeDecision}
          error={learningProbeError}
          loading={learningProbeLoading}
          offer={learningProbeOffer}
          onChooseOption={chooseLearningProbeOption}
          onLater={deferLearningProbe}
          onSkip={skipLearningProbeSession}
          onStart={startLearningProbeSession}
          onSubmit={submitLearningProbeAnswer}
          result={learningProbeResult}
          selectedOptionIds={learningProbeOptionIds}
          submitting={learningProbeLoading}
        />
      ) : activeMode === "past_exam" && selectedPastExamYear === null ? (
        <PastExamLibrary
          catalog={pastExamCatalog}
          error={pastExamCatalogError}
          loading={pastExamCatalogLoading}
          onRetry={() => setCatalogReloadKey((value) => value + 1)}
        />
      ) : loading ? (
        <section className="practice-load-state" role="status" aria-live="polite">
          <span className="load-rule" aria-hidden="true" />
          <strong>正在加载题目…</strong>
          <p>请稍候，加载完成后即可作答。</p>
        </section>
      ) : loadError ? (
        <section className="practice-load-state error" role="alert">
          <CircleAlert aria-hidden="true" size={22} />
          <strong>{loadError}</strong>
          <button onClick={() => setReloadKey((value) => value + 1)} type="button">重新读取</button>
        </section>
      ) : !question || !practiceItem || !selection ? (
        <section className="practice-load-state empty" aria-labelledby="empty-question-title">
          <h2 id="empty-question-title">
            {filters.concept_id ? "该知识点暂无关联题目" : "当前筛选没有可用题目"}
          </h2>
          <p>
            {filters.concept_id
              ? "可以进入本课程综合训练，继续练习相关内容。"
              : `清除年份和标签后，可回到${filters.subject}选择题全集。`}
          </p>
          {filters.concept_id ? (
            <>
              <Link
                className="first-release-primary-action"
                to={`/student/practice?subject=${encodeURIComponent(filters.subject)}`}
              >
                进入{filters.subject}综合训练
              </Link>
              <Link className="secondary-button" to={COURSE_BACK_LINKS[filters.subject]}>返回课程学习</Link>
            </>
          ) : (
            <button onClick={clearFilters} type="button">清除年份与标签</button>
          )}
        </section>
      ) : (
        <section className="question-session-workspace" aria-label="当前练习">
          <article className="question-sheet">
            <header className="question-sheet-heading">
              <span>
                {activeMode === "past_exam" && selectedPastExamYear !== null
                  ? `${selectedPastExamYear} 年真题 · 第 ${visibleQuestionNumber} / ${selection.total} 题`
                  : `本组第 ${visibleQuestionNumber} 题 / 共 ${selection.total} 题`}
              </span>
              <h2 ref={questionHeadingRef} tabIndex={-1}>
                第 {visibleQuestionNumber} 题 · {question.year === null ? `自编第 ${question.number} 题` : `${question.year} 年第 ${question.number} 题`}
              </h2>
              <div className="question-metadata">
                <span>{question.type === "subjective" ? "主观题" : question.multiple ? "多选" : "单选"}</span>
                {question.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </header>

            {!pilotTaskId && !probeSessionIdFromUrl ? <QuestionNotebookTools question={question} /> : null}
            {practiceItem.ranking ? (
              <details aria-label="本题推荐依据" className="question-ranking-note" role="note">
                <summary>为什么推荐这道题</summary>
                <ul>
                  {practiceItem.ranking.reason_lines.slice(0, 2).map((line) => <li key={line}>{line}</li>)}
                </ul>
              </details>
            ) : null}

            <p className="question-stem">{question.question}</p>
            <QuestionAssets
              altPrefix={`第 ${question.number} 题图示`}
              assets={question.assets.filter((asset) => asset.role === "question")}
              key={`${question.id}:question-assets`}
              questionId={question.id}
            />

            {question.type === "choice" ? (
              <fieldset className="question-options" disabled={submitting || hasEvaluation}>
                <legend>{question.multiple ? "选择所有正确选项" : "选择一个答案"}</legend>
                {question.options.map((option) => {
                  const selected = selectedOptionIds.includes(option.option_id);
                  const correct = !pilotTaskId && correctOptionIds.includes(option.option_id);
                  const incorrectSelection = !pilotTaskId && Boolean(evaluation) && selected && !correct;
                  const stateClass = correct
                    ? "correct-option"
                    : incorrectSelection
                      ? "incorrect-option"
                      : selected
                        ? "selected-option"
                        : "";
                  return (
                    <div className={`question-option-row ${stateClass}`.trim()} key={option.option_id}>
                      <label>
                        <input
                          aria-label={optionLabel(option)}
                          checked={selected}
                          name="question-answer"
                          onChange={() => chooseOption(option.option_id)}
                          type={question.multiple ? "checkbox" : "radio"}
                          value={option.option_id}
                        />
                        <span className="option-key">{option.option_id}</span>
                        <span className="option-text">{option.text}</span>
                        {correct ? <span className="option-verdict">正确答案</span> : null}
                        {incorrectSelection ? <span className="option-verdict">你的选择</span> : null}
                      </label>
                      <QuestionAssets
                        altPrefix={`${option.option_id} 选项图示`}
                        assets={option.assets.filter((asset) => asset.role === "option")}
                        key={`${question.id}:${option.option_id}:assets`}
                        questionId={question.id}
                      />
                    </div>
                  );
                })}
              </fieldset>
            ) : (
              <label className="practice-subjective-answer">
                <span>写出你的推导过程与结论</span>
                <textarea
                  aria-label="主观题作答"
                  disabled={submitting || hasEvaluation}
                  onChange={(event) => {
                    setSubmissionIdempotencyKey(null);
                    setResponseText(event.target.value);
                  }}
                  placeholder={activeMode === "past_exam"
                    ? "请保留关键步骤，提交后对照参考解答"
                    : "请保留关键步骤，提交后进入教师审核"}
                  value={responseText}
                />
              </label>
            )}

            {submissionError ? <p className="practice-inline-error" role="alert">{submissionError}</p> : null}
            {taskMessage ? <p className="practice-inline-note" role="status">{taskMessage}</p> : null}

            {!hasEvaluation ? (
              <footer className="question-submit-row">
                <p>{pilotTaskId
                  ? "提交后记录本次结果，不展示答案或解析。"
                  : question.type === "choice"
                    ? "提交后查看答案与解析，学习记录会同步更新。"
                    : activeMode === "past_exam"
                      ? "提交后显示参考解答，本题不自动判分。"
                      : "提交后进入教师审核。"}</p>
                <button
                  className="first-release-primary-action"
                  disabled={(question.type === "choice" ? selectedOptionIds.length === 0 : !responseText.trim()) || submitting}
                  onClick={submitAnswer}
                  type="button"
                >
                  {submitting
                    ? question.type === "choice" ? "正在判分…" : "正在保存…"
                    : submissionError
                      ? "重新提交"
                      : question.type === "choice" ? "提交并查看结果" : "提交主观题作答"}
                </button>
              </footer>
            ) : pilotTaskId && pilotEvaluation ? (
              <section
                className="deterministic-result pilot-measurement-result"
                aria-labelledby="evaluation-result-title"
              >
                <header>
                  <CheckCircle2 aria-hidden="true" size={22} />
                  <div>
                    <span>课程试点</span>
                    <h3 id="evaluation-result-title" ref={resultHeadingRef} tabIndex={-1}>
                      作答已记录
                    </h3>
                  </div>
                </header>
                <p>
                  本题结果与用时已记录，本页不展示答案或解析。
                </p>
                {pilotCompletionStatus === "error" ? (
                  <p className="practice-inline-error" role="alert">
                    作答已保存，但课程试点任务暂未更新。返回课程试点流程后可重试。
                  </p>
                ) : (
                  <p className="practice-inline-note" role="status">
                    {pilotCompletionStatus === "completed"
                      ? "课程试点任务已核验"
                      : "正在核验课程试点任务…"}
                  </p>
                )}
                <footer>
                  <span><CheckCircle2 aria-hidden="true" size={16} />作答已记录</span>
                  <Link className="first-release-primary-action" to="/student/pilot-study">
                    返回课程试点流程 <ArrowRight aria-hidden="true" size={16} />
                  </Link>
                </footer>
              </section>
            ) : evaluation ? (
              <section
                className={`deterministic-result ${evaluation.evaluation.status === "pending_review" ? "pending" : evaluation.evaluation.is_correct ? "correct" : "incorrect"}`}
                aria-labelledby="evaluation-result-title"
              >
                <header>
                  {evaluation.evaluation.status === "pending_review"
                    ? <ClipboardCheck aria-hidden="true" size={22} />
                    : evaluation.evaluation.is_correct
                    ? <CheckCircle2 aria-hidden="true" size={22} />
                    : <CircleAlert aria-hidden="true" size={22} />}
                  <div>
                    <span>{evaluation.evaluation.status === "pending_review"
                      ? activeMode === "past_exam" ? "主观题自查" : "主观题"
                      : "选择题结果"}</span>
                    <h3 id="evaluation-result-title" ref={resultHeadingRef} tabIndex={-1}>
                      {evaluation.evaluation.status === "pending_review"
                        ? activeMode === "past_exam"
                          ? "作答已保存，请对照参考解答自查"
                          : "作答已提交，等待教师审核"
                        : evaluation.evaluation.is_correct
                          ? "回答正确"
                          : "这题未答对"}
                    </h3>
                  </div>
                  {evaluation.evaluation.status === "pending_review"
                    ? <strong>{activeMode === "past_exam" ? "待自查" : "待审核"}</strong>
                    : <strong>{evaluation.evaluation.score} 分</strong>}
                </header>
                {evaluation.evaluation.status === "pending_review" ? (
                  <>
                    <p className="subjective-submission-summary">
                      已保存 {responseText.trim().length} 个字符的作答过程。
                      {activeMode === "past_exam"
                        ? "本题不自动判分，也不计入客观题掌握度。"
                        : "本次不生成对错、分数或答案提示。"}
                    </p>
                    <p className="grading-boundary">
                      {activeMode === "past_exam" ? "参考解答仅用于自查。" : "作答将由任课教师审核。"}
                    </p>
                    {evaluation.evaluation.reference_solution ? (
                      <div className="evaluation-reference-solution">
                        <strong>参考解答（用于自查）</strong>
                        <p>{evaluation.evaluation.reference_solution}</p>
                        <QuestionAssets
                          altPrefix="参考解答图"
                          assets={evaluation.evaluation.answer_assets.filter((asset) => asset.role === "solution")}
                          attemptId={evaluation.attempt.attempt_id}
                          key={`${question.id}:${evaluation.attempt.attempt_id}:solution-assets`}
                          questionId={question.id}
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="answer-comparison">
                      <span>你的选择：{selectedOptionIds.join("、")}</span>
                      <span>正确答案：{correctOptionIds.join("、")}</span>
                    </p>
                    <div className="evaluation-explanation">
                      <strong>题目解析</strong>
                      <p>{evaluation.evaluation.explanation ?? "本题暂未提供文字解析。"}</p>
                      <QuestionAssets
                        altPrefix="题目解析图"
                        assets={evaluation.evaluation.answer_assets.filter((asset) => asset.role === "explanation")}
                        attemptId={evaluation.attempt.attempt_id}
                        key={`${question.id}:${evaluation.attempt.attempt_id}:explanation-assets`}
                        questionId={question.id}
                      />
                    </div>
                  </>
                )}
                {learningProbeRequested && evaluation.evaluation.is_correct === false ? (
                  <LearningProbePanel
                    decision={learningProbeDecision}
                    error={learningProbeError}
                    loading={learningProbeLoading}
                    offer={learningProbeOffer}
                    onChooseOption={chooseLearningProbeOption}
                    onLater={deferLearningProbe}
                    onSkip={skipLearningProbeSession}
                    onStart={startLearningProbeSession}
                    onSubmit={submitLearningProbeAnswer}
                    result={learningProbeResult}
                    selectedOptionIds={learningProbeOptionIds}
                    submitting={learningProbeLoading}
                  />
                ) : null}
                {orchestrationTaskId && (settlement || settlementError) ? (
                  <section aria-label="本关结算" className="practice-challenge-settlement">
                    {settlement ? (
                      <>
                        <header className="practice-settlement-heading">
                          <div>
                            <span>本题结果</span>
                            <h4>{settlement.result_title}</h4>
                            <p>{settlement.result_detail}</p>
                          </div>
                          <strong className={`practice-settlement-outcome ${settlement.outcome}`}>
                            {settlement.outcome === "correct"
                              ? "本次正确"
                              : settlement.outcome === "incorrect"
                                ? "进入复习"
                                : "完成"}
                          </strong>
                        </header>

                        <dl className="practice-settlement-facts">
                          <div>
                            <dt>学习记录</dt>
                            <dd>
                              <strong>{settlement.evidence_update.summary}</strong>
                              <span>当前有效记录累计 {settlement.evidence_update.objective_total} 条</span>
                            </dd>
                          </div>
                          <div>
                            <dt>画像变化</dt>
                            <dd>
                              <strong>{settlement.profile_update.title}</strong>
                              <span>{settlement.profile_update.detail}</span>
                            </dd>
                          </div>
                          <div>
                            <dt>复习状态</dt>
                            <dd>
                              <strong>{settlement.review_update.summary}</strong>
                              {settlement.review_update.next_review_at ? (
                                <span>下次复习：{reviewDate(settlement.review_update.next_review_at)}</span>
                              ) : (
                                <span>状态会随作答与复习结果更新</span>
                              )}
                              {settlement.review_update.status === "needs_review"
                              || settlement.review_update.status === "in_progress" ? (
                                <Link to={mistakeReviewHref(settlement)}>查看错题</Link>
                              ) : null}
                            </dd>
                          </div>
                        </dl>

                        {settlement.plan_progress.tracked ? (
                          <div className="practice-settlement-progress">
                            <span>七日路径 {settlement.plan_progress.completed_task_count} / {settlement.plan_progress.total_task_count}</span>
                            <div aria-label={`七日路径完成 ${settlement.plan_progress.completion_percent}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={settlement.plan_progress.completion_percent}>
                              <span style={{ width: `${settlement.plan_progress.completion_percent}%` }} />
                            </div>
                          </div>
                        ) : null}

                        {settlement.next_task ? (
                          <div className="practice-settlement-next">
                            <div>
                              <span>下一关</span>
                              <h4>{settlement.next_task.title}</h4>
                              <p>{settlement.next_task.reason}</p>
                              <small>预计用时 {settlement.next_task.estimated_minutes} 分钟</small>
                            </div>
                            <Link
                              className="first-release-primary-action"
                              to={withOrchestrationTaskId(
                                settlement.next_task.href,
                                settlement.next_task.task_id,
                              )}
                            >
                              进入下一关 <ArrowRight aria-hidden="true" size={16} />
                            </Link>
                          </div>
                        ) : (
                          <div className="practice-settlement-fallback">
                            <p>本轮关卡已完成，返回学习首页查看新的安排。</p>
                            <Link className="secondary-button" to="/student">返回学习首页</Link>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="practice-settlement-fallback">
                        <p>作答与判分已完成，本关结算暂时无法读取。</p>
                        <Link className="secondary-button" to="/student">返回学习首页</Link>
                      </div>
                    )}
                  </section>
                ) : null}
                <footer>
                  <span><CheckCircle2 aria-hidden="true" size={16} />学习记录已更新{orchestrationTaskId && taskStatus === "completed" ? " · 本关已结算" : ""}</span>
                  {evaluation.evaluation.is_correct === false ? (
                    <Link className="secondary-button" to="/student/mistakes">查看错题复习</Link>
                  ) : null}
                  {hasStudyQueue ? <StudyQueueNav questionId={question.id} /> : <button className="first-release-primary-action" onClick={continueToNextQuestion} type="button">
                    {activeMode === "past_exam" && selectedPastExamQuestion >= paperQuestionCount
                      ? "返回真题目录"
                      : filters.question_id ? "再次作答" : "继续下一题"}
                    <ArrowRight aria-hidden="true" size={16} />
                  </button>}
                </footer>
              </section>
            ) : null}
          </article>

          <aside className="attempt-context-rail" aria-label="本轮作答轨迹">
            <div>
              <span className="first-release-kicker">本轮作答轨迹</span>
              <ol className="attempt-timeline">
                <li className="complete"><span>1</span><div><strong>{activeMode === "past_exam" ? "真题位置已确定" : "筛选已确定"}</strong><small>{activeMode === "past_exam" && selectedPastExamYear !== null ? `${selectedPastExamYear} 年 · 第 ${visibleQuestionNumber} 题` : `${filters.subject} · ${filters.type === "choice" ? "选择题" : "主观题"}`}</small></div></li>
                <li className={hasEvaluation ? "complete" : "active"}><span>2</span><div><strong>{hasEvaluation ? "作答已评测" : "完成当前题"}</strong><small>{hasEvaluation ? "结果已返回" : "选择后提交"}</small></div></li>
                <li className={evaluation?.evidence.persistence_status === "persisted" || pilotEvaluation ? "complete" : ""}><span>3</span><div><strong>{hasEvaluation ? "记录已更新" : "等待作答"}</strong><small>用于安排后续学习</small></div></li>
              </ol>
            </div>

            {!pilotTaskId ? <AiWorkflowSlot
              compact
              invocation={evaluation ? {
                contract_version: "0.2",
                capability: "diagnose",
                course_id: COURSE_IDS_BY_SUBJECT[courseSubject(question.subject)],
                concept_id: filters.concept_id ?? null,
                qa_id: null,
                attempt_id: evaluation.attempt.attempt_id,
                user_message: null,
              } : null}
              slot="practice_reflection"
              title="问题分析与下一题"
            /> : null}

            {evaluation && !pilotTaskId ? (
              <button className="practice-reset-action" onClick={() => {
                setSelectedOptionIds([]);
                setResponseText("");
                setSubmissionIdempotencyKey(null);
                setEvaluation(null);
                setSubmissionError(null);
                requestAnimationFrame(() => questionHeadingRef.current?.focus());
              }} type="button">
                <RotateCcw aria-hidden="true" size={15} />重做本题
              </button>
            ) : null}
          </aside>
        </section>
      )}
      </>
      )}
    </div>
  );
}
