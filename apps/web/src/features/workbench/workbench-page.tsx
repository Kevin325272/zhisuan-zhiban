import {
  programmingLanguageMeta,
  type AgentEvent,
  type AlgorithmTrace,
  type AlgorithmTraceStep,
  type Citation,
  type CodeTemplate,
  type CodeRunResult,
  type Diagnosis,
  type ProgrammingLanguage,
  type SubmissionHistoryItem,
  type Task,
  type TraceVariant,
} from "@xuetu/contracts";
import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronRight,
  Code2,
  Database,
  FlaskConical,
  GitBranch,
  History,
  ListChecks,
  LocateFixed,
  Maximize2,
  MemoryStick,
  Minimize2,
  Play,
  RefreshCw,
  Route,
  RotateCcw,
  Send,
  ShieldCheck,
  Terminal,
  Timer,
  TrendingUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import {
  ApiError,
  getAlgorithmTrace,
  getCourseMap,
  getDiagnosis,
  getSource,
  getTask,
  getTaskSubmissions,
  runTask,
  runDiagnosis,
  submitTask,
  submitValidation,
  type CourseMapData,
  type SubmissionData,
  type TutorWorkspaceContext,
  type ValidationData,
} from "../../api/client";
import { AiLearningCoach } from "../../components/ai-learning-coach";
import { CodeEditor, type CodeEditorHandle } from "../../components/code-editor";
import { CourseTree } from "../../components/course-tree";
import { StatusBadge } from "../../components/status-badge";
import { SubmissionHistoryPanel } from "../../components/submission-history-panel";
import { TraceExperience } from "../../components/trace-experience";
import { GradientButton } from "../../components/ui/gradient-button";
import { loadCodeDrafts, saveCodeDraft } from "../../lib/code-draft-store";
import { addGeneratedReviewCard } from "../../lib/learning-output-store";

function formatMetric(value: number | null, unit: string) {
  return value === null ? "—" : `${value} ${unit}`;
}

function runStatusLabel(result: CodeRunResult) {
  switch (result.status) {
    case "passed":
      return "运行通过";
    case "compile_error":
      return "编译检查未通过";
    case "runtime_error":
      return "程序运行时异常";
    case "time_limit_exceeded":
      return "程序运行超时";
    case "memory_limit_exceeded":
      return "程序超过内存限制";
    case "internal_error":
      return "评测服务未完成运行";
    default:
      return `${result.total_count - result.passed_count} 个用例未通过`;
  }
}

function testStatusLabel(status: CodeRunResult["test_cases"][number]["status"]) {
  const labels = {
    passed: "通过",
    failed: "失败",
    compile_error: "编译错误",
    runtime_error: "运行错误",
    time_limit_exceeded: "超时",
    memory_limit_exceeded: "超内存",
    internal_error: "服务异常",
  } as const;
  return labels[status];
}

function provenanceLabel(result: CodeRunResult) {
  if (result.execution_mode === "sandbox") return "隔离沙箱评测";
  if (result.execution_mode === "mock_fallback") return "临时评测结果";
  return "基础评测";
}

const fixedBfsCode = `#include <queue>
#include <vector>
using namespace std;

vector<int> bfs(const vector<vector<int>>& graph, int start) {
  vector<bool> visited(graph.size(), false);
  vector<int> order;
  queue<int> pending;
  pending.push(start);
  visited[start] = true;

  while (!pending.empty()) {
    const int current = pending.front();
    pending.pop();
    order.push_back(current);

    for (const int next : graph[current]) {
      if (!visited[next]) {
        visited[next] = true;
        pending.push(next);
      }
    }
  }
  return order;
}`;

type WorkbenchView = "code" | "trace" | "tests" | "evidence" | "history";

const RUN_RESULT_HOLD_MS = 500;
const VIEW_EXIT_MS = 120;

// Judge0 基础设施类故障（不含语言不支持这类需换语言解决的错误）。
function isEvaluatorOutage(caught: unknown) {
  return (
    caught instanceof ApiError &&
    caught.code.startsWith("EVALUATOR_") &&
    caught.code !== "EVALUATOR_LANGUAGE_UNAVAILABLE"
  );
}

function validationCaseStatusLabel(status: "passed" | "failed" | "error") {
  if (status === "passed") return "通过";
  if (status === "failed") return "未通过";
  return "运行异常";
}

function getTaskCodeTemplates(task: Task): CodeTemplate[] {
  if (task.code_templates?.length) return task.code_templates;
  if (!task.language || !task.starter_code) return [];

  return [
    {
      language: task.language,
      file_name: task.language === "cpp" ? "bfs.cpp" : `bfs.${task.language}`,
      starter_code: task.starter_code,
      fixed_code: task.language === "cpp" ? fixedBfsCode : task.starter_code,
    },
  ];
}

function formatReviewDate(value: string) {
  const [, month = "--", day = "--"] = value.split("-");
  return `${month} 月 ${day} 日`;
}

export function WorkbenchPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const requestedTaskId = taskId ?? "task_bfs_bug_001";
  const requestedView: WorkbenchView =
    searchParams.get("view") === "trace"
      ? "trace"
      : searchParams.get("view") === "history"
        ? "history"
        : "code";
  const [task, setTask] = useState<Task | null>(null);
  const [courseMap, setCourseMap] = useState<CourseMapData | null>(null);
  const [variant, setVariant] = useState<TraceVariant>("visited-on-dequeue");
  const [selectedPreset, setSelectedPreset] = useState<TraceVariant | "custom">(
    "visited-on-dequeue",
  );
  const [activeView, setActiveView] = useState<WorkbenchView>(requestedView);
  const [focusMode, setFocusMode] = useState(true);
  const [coachCollapsed, setCoachCollapsed] = useState(false);
  const [trace, setTrace] = useState<AlgorithmTrace | null>(null);
  const [traceInput, setTraceInput] = useState<string | null>(null);
  const [comparisonTrace, setComparisonTrace] = useState<AlgorithmTrace | null>(null);
  const [comparisonTraceInput, setComparisonTraceInput] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [traceStep, setTraceStep] = useState<AlgorithmTraceStep | null>(null);
  const [traceLoading, setTraceLoading] = useState(requestedView === "trace");
  const [submission, setSubmission] = useState<SubmissionData | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [sources, setSources] = useState<Citation[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [validation, setValidation] = useState<ValidationData | null>(null);
  const [validationTask, setValidationTask] = useState<Task | null>(null);
  const [validationLanguage, setValidationLanguage] = useState<ProgrammingLanguage>("cpp");
  const [validationDrafts, setValidationDrafts] = useState<
    Partial<Record<ProgrammingLanguage, string>>
  >({});
  const [validationSource, setValidationSource] = useState("");
  const [validationSubmitting, setValidationSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [evaluatorUnavailable, setEvaluatorUnavailable] = useState(false);
  const [activeLanguage, setActiveLanguage] = useState<ProgrammingLanguage>("cpp");
  const [languageDrafts, setLanguageDrafts] = useState<
    Partial<Record<ProgrammingLanguage, string>>
  >({});
  const [sourceCode, setSourceCode] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [runResult, setRunResult] = useState<CodeRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [preparingRunResult, setPreparingRunResult] = useState(false);
  const [viewLeaving, setViewLeaving] = useState(false);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string | null>(null);
  const [pendingFocusLine, setPendingFocusLine] = useState<number | null>(null);
  const [submissionHistory, setSubmissionHistory] = useState<SubmissionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [restoredSubmissionSequence, setRestoredSubmissionSequence] = useState<number | null>(
    null,
  );
  const editorRef = useRef<CodeEditorHandle>(null);
  const validationFetchIdRef = useRef<string | null>(null);
  const runResultHandoffTimerRef = useRef<number | null>(null);
  const viewExitTimerRef = useRef<number | null>(null);
  const diagnosisRequestIdRef = useRef(0);
  const codeTemplates = task ? getTaskCodeTemplates(task) : [];

  useEffect(() => {
    let cancelled = false;
    setError(null);

    Promise.all([getTask(requestedTaskId), getCourseMap()])
      .then(async ([taskData, mapData]) => {
        if (cancelled) return;
        setTask(taskData);
        setCourseMap(mapData);
        const templates = getTaskCodeTemplates(taskData);
        const defaultLanguage = taskData.language ?? templates[0]?.language ?? "cpp";
        const savedDrafts = loadCodeDrafts(taskData.task_id);
        const drafts = {
          ...(Object.fromEntries(
            templates.map((template) => [template.language, template.starter_code]),
          ) as Partial<Record<ProgrammingLanguage, string>>),
          ...savedDrafts,
        };
        setActiveLanguage(defaultLanguage);
        setLanguageDrafts(drafts);
        setSourceCode(drafts[defaultLanguage] ?? taskData.starter_code ?? "");
        if (savedDrafts[defaultLanguage]) setSelectedPreset("custom");

        getTaskSubmissions(taskData.task_id)
          .then((history) => {
            if (!cancelled) setSubmissionHistory(history.items);
          })
          .catch((caught) => {
            if (!cancelled) {
              setError(caught instanceof Error ? caught.message : "提交记录加载失败。");
            }
          })
          .finally(() => {
            if (!cancelled) setHistoryLoading(false);
          });

        if (requestedView === "trace") {
          try {
            const traceData = await getAlgorithmTrace(
              taskData.task_id,
              defaultLanguage,
              "visited-on-dequeue",
            );
            if (cancelled) return;
            setTrace(traceData);
            setTraceStep(traceData.steps[0] ?? null);
          } finally {
            if (!cancelled) setTraceLoading(false);
          }
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        setTraceLoading(false);
        setError(caught instanceof Error ? caught.message : "学习工作台加载失败。");
      });

    return () => {
      cancelled = true;
    };
  }, [requestedTaskId, requestedView, reloadKey]);

  useEffect(() => {
    if (activeView !== "code" || pendingFocusLine === null) return;
    editorRef.current?.focusLine(pendingFocusLine);
    setPendingFocusLine(null);
  }, [activeView, pendingFocusLine]);

  const validationId = submission?.validation_id ?? null;
  useEffect(() => {
    if (!validationId || validationFetchIdRef.current === validationId) return;
    validationFetchIdRef.current = validationId;
    let cancelled = false;
    getTask(validationId)
      .then((data) => {
        if (cancelled) return;
        setValidationTask(data);
        const templates = data.code_templates ?? [];
        const savedDrafts = loadCodeDrafts(data.task_id);
        const drafts = {
          ...(Object.fromEntries(
            templates.map((template) => [template.language, template.starter_code]),
          ) as Partial<Record<ProgrammingLanguage, string>>),
          ...savedDrafts,
        };
        const defaultLanguage = data.language ?? templates[0]?.language ?? "cpp";
        setValidationDrafts(drafts);
        setValidationLanguage(defaultLanguage);
        setValidationSource(drafts[defaultLanguage] ?? data.starter_code ?? "");
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          validationFetchIdRef.current = null;
          setValidationError(
            caught instanceof Error ? caught.message : "独立验证任务加载失败。",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [validationId]);

  function handleValidationSourceChange(value: string) {
    setValidationSource(value);
    setValidationDrafts((current) => ({ ...current, [validationLanguage]: value }));
    if (validationTask) saveCodeDraft(validationTask.task_id, validationLanguage, value);
  }

  function handleValidationLanguageChange(nextLanguage: ProgrammingLanguage) {
    const template = validationTask?.code_templates?.find(
      (item) => item.language === nextLanguage,
    );
    const nextSource = validationDrafts[nextLanguage] ?? template?.starter_code ?? "";
    setValidationDrafts((current) => ({
      ...current,
      [validationLanguage]: validationSource,
      [nextLanguage]: current[nextLanguage] ?? nextSource,
    }));
    setValidationLanguage(nextLanguage);
    setValidationSource(nextSource);
  }

  useEffect(
    () => () => {
      if (runResultHandoffTimerRef.current !== null) {
        window.clearTimeout(runResultHandoffTimerRef.current);
      }
      if (viewExitTimerRef.current !== null) {
        window.clearTimeout(viewExitTimerRef.current);
      }
      diagnosisRequestIdRef.current += 1;
    },
    [],
  );

  function cancelRunResultHandoff() {
    if (runResultHandoffTimerRef.current !== null) {
      window.clearTimeout(runResultHandoffTimerRef.current);
      runResultHandoffTimerRef.current = null;
    }
    setPreparingRunResult(false);
  }

  function transitionToView(nextView: WorkbenchView) {
    if (viewExitTimerRef.current !== null) {
      window.clearTimeout(viewExitTimerRef.current);
      viewExitTimerRef.current = null;
    }
    if (nextView === activeView) {
      setViewLeaving(false);
      return;
    }

    setViewLeaving(true);
    viewExitTimerRef.current = window.setTimeout(() => {
      setActiveView(nextView);
      setViewLeaving(false);
      viewExitTimerRef.current = null;
    }, VIEW_EXIT_MS);
  }

  function handleViewChange(nextView: WorkbenchView) {
    cancelRunResultHandoff();
    transitionToView(nextView);
  }

  async function handleOpenTrace(preferredVariant?: TraceVariant | null) {
    if (!task) return;
    cancelRunResultHandoff();
    const targetVariant = preferredVariant ?? runResult?.trace_variant ?? variant;
    const requestedInput = customInput.trim() || null;
    if (trace?.variant === targetVariant && traceInput === requestedInput) {
      transitionToView("trace");
      setTraceStep(trace.steps[0] ?? null);
      return;
    }

    setTraceLoading(true);
    setError(null);
    transitionToView("trace");
    try {
      const traceData = requestedInput
        ? await getAlgorithmTrace(task.task_id, activeLanguage, targetVariant, requestedInput)
        : await getAlgorithmTrace(task.task_id, activeLanguage, targetVariant);
      const previousTrace = trace;
      const previousTraceInput = traceInput;
      setVariant(targetVariant);
      setTrace(traceData);
      setTraceInput(requestedInput);
      setComparisonTrace(
        previousTrace &&
          previousTrace.variant !== targetVariant &&
          previousTraceInput === requestedInput
          ? previousTrace
          : null,
      );
      setComparisonTraceInput(
        previousTrace &&
          previousTrace.variant !== targetVariant &&
          previousTraceInput === requestedInput
          ? previousTraceInput
          : null,
      );
      setComparisonError(null);
      setTraceStep(traceData.steps[0] ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "运行轨迹加载失败。");
    } finally {
      setTraceLoading(false);
    }
  }

  async function handleLoadComparisonTrace() {
    if (!task || !trace || comparisonLoading) return;
    const targetVariant: TraceVariant =
      trace.variant === "visited-on-dequeue"
        ? "visited-on-enqueue"
        : "visited-on-dequeue";
    const requestedInput = customInput.trim() || null;
    if (comparisonTrace?.variant === targetVariant && comparisonTraceInput === requestedInput) return;

    setComparisonLoading(true);
    setComparisonError(null);
    try {
      const traceData = requestedInput
        ? await getAlgorithmTrace(task.task_id, activeLanguage, targetVariant, requestedInput)
        : await getAlgorithmTrace(task.task_id, activeLanguage, targetVariant);
      setComparisonTrace(traceData);
      setComparisonTraceInput(requestedInput);
    } catch (caught) {
      setComparisonError(
        caught instanceof Error ? caught.message : "另一条运行轨迹加载失败。",
      );
    } finally {
      setComparisonLoading(false);
    }
  }

  function handleVariantChange(nextVariant: TraceVariant) {
    cancelRunResultHandoff();
    const activeTemplate = codeTemplates.find(
      (template) => template.language === activeLanguage,
    );
    const nextSource =
      nextVariant === "visited-on-enqueue"
        ? (activeTemplate?.fixed_code ?? sourceCode)
        : (activeTemplate?.starter_code ?? sourceCode);
    setVariant(nextVariant);
    setSelectedPreset(nextVariant);
    setSourceCode(nextSource);
    setLanguageDrafts((current) => ({ ...current, [activeLanguage]: nextSource }));
    setRunResult(null);
    setSelectedTestCaseId(null);
    setTrace(null);
    setComparisonTrace(null);
    setComparisonLoading(false);
    setComparisonError(null);
    setTraceStep(null);
    setRestoredSubmissionSequence(null);
    setError(null);
    setActiveView("code");
  }

  function handleSourceChange(value: string) {
    cancelRunResultHandoff();
    setSourceCode(value);
    setLanguageDrafts((current) => ({ ...current, [activeLanguage]: value }));
    if (task) saveCodeDraft(task.task_id, activeLanguage, value);
    setSelectedPreset("custom");
    setRunResult(null);
    setSelectedTestCaseId(null);
    setTrace(null);
    setComparisonTrace(null);
    setComparisonLoading(false);
    setComparisonError(null);
    setTraceStep(null);
    setError(null);
  }

  function handleLanguageChange(nextLanguage: ProgrammingLanguage) {
    cancelRunResultHandoff();
    const nextTemplate = codeTemplates.find(
      (template) => template.language === nextLanguage,
    );
    const nextSource = languageDrafts[nextLanguage] ?? nextTemplate?.starter_code ?? "";
    setLanguageDrafts((current) => ({
      ...current,
      [activeLanguage]: sourceCode,
      [nextLanguage]: current[nextLanguage] ?? nextSource,
    }));
    setActiveLanguage(nextLanguage);
    setSourceCode(nextSource);
    setVariant("visited-on-dequeue");
    setSelectedPreset("visited-on-dequeue");
    setRunResult(null);
    setSelectedTestCaseId(null);
    setTrace(null);
    setComparisonTrace(null);
    setComparisonLoading(false);
    setComparisonError(null);
    setTraceStep(null);
    setRestoredSubmissionSequence(null);
    setError(null);
    setActiveView("code");
  }

  async function handleRun() {
    if (!task || !sourceCode.trim()) return;
    cancelRunResultHandoff();
    setRunning(true);
    setEvaluatorUnavailable(false);
    setError(null);
    try {
      const result = await runTask(
        task.task_id,
        activeLanguage,
        sourceCode,
        customInput.trim() ? customInput : null,
      );
      setRunResult(result);
      if (result.detected_variant) setVariant(result.detected_variant);
      const selectedCase =
        result.test_cases.find((testCase) => testCase.status === "failed") ??
        result.test_cases[0];
      setSelectedTestCaseId(selectedCase?.test_case_id ?? null);
      setPreparingRunResult(true);
      runResultHandoffTimerRef.current = window.setTimeout(() => {
        setPreparingRunResult(false);
        runResultHandoffTimerRef.current = null;
        transitionToView("tests");
      }, RUN_RESULT_HOLD_MS);
    } catch (caught) {
      if (isEvaluatorOutage(caught)) {
        setEvaluatorUnavailable(true);
      } else {
        setError(caught instanceof Error ? caught.message : "代码运行失败，请稍后重试。");
      }
    } finally {
      setRunning(false);
    }
  }

  function handleCustomInputChange(value: string) {
    cancelRunResultHandoff();
    setCustomInput(value);
    setRunResult(null);
    setSelectedTestCaseId(null);
    setTrace(null);
    setTraceInput(null);
    setComparisonTrace(null);
    setComparisonTraceInput(null);
    setComparisonLoading(false);
    setComparisonError(null);
    setTraceStep(null);
    setError(null);
  }

  function handleLocateError() {
    if (!runResult?.error_line) return;
    setPendingFocusLine(runResult.error_line);
    setActiveView("code");
  }

  async function refreshSubmissionHistory(taskId: string) {
    setHistoryLoading(true);
    try {
      const history = await getTaskSubmissions(taskId);
      setSubmissionHistory(history.items);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `提交已保存，但记录刷新失败：${caught.message}`
          : "提交已保存，但记录刷新失败。",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleRestoreSubmission(item: SubmissionHistoryItem) {
    setActiveLanguage(item.code.language);
    setSourceCode(item.code.source);
    setLanguageDrafts((current) => ({
      ...current,
      [item.code.language]: item.code.source,
    }));
    setSelectedPreset("custom");
    setRunResult(null);
    setSelectedTestCaseId(null);
    setTrace(null);
    setComparisonTrace(null);
    setComparisonLoading(false);
    setComparisonError(null);
    setTraceStep(null);
    setRestoredSubmissionSequence(item.sequence);
    setError(null);
    setActiveView("code");
  }

  async function handleSubmit() {
    if (!task) return;
    const diagnosisRequestId = diagnosisRequestIdRef.current + 1;
    diagnosisRequestIdRef.current = diagnosisRequestId;
    setDiagnosing(false);
    setSubmitting(true);
    setEvaluatorUnavailable(false);
    setError(null);
    setDiagnosis(null);
    setSources([]);
    setEvents([]);
    setValidation(null);
    try {
      const result = await submitTask(
        task.task_id,
        task.version,
        activeLanguage,
        sourceCode,
        customInput.trim() ? customInput : null,
      );
      result.learning_update.review_changes.forEach((review) => {
        addGeneratedReviewCard({
          id: review.id,
          sourceId: result.submission_id,
          title: review.title,
          course: "数据结构",
          minutes: review.minutes,
          reason: review.reason,
          href: `/student/tasks/${task.task_id}?view=evidence`,
          scheduledFor: review.scheduled_for,
        });
      });
      setSubmission(result);
      setRestoredSubmissionSequence(null);
      void refreshSubmissionHistory(task.task_id);
      transitionToView("evidence");
      if (result.diagnosis_id) {
        const failedTestCases = result.evaluation.test_cases.filter(
          (testCase) => testCase.status !== "passed",
        );
        const diagnosisContext: TutorWorkspaceContext = {
          ...workspaceContext,
          active_view: "evidence",
          language: activeLanguage,
          submission_id: result.submission_id,
          code_excerpt: sourceCode.slice(0, 4000),
          test_summary: `${result.evaluation.passed_count}/${result.evaluation.total_count} 个用例通过；${failedTestCases.map((testCase) => testCase.summary).join("；")}`,
          selected_test_case_id:
            failedTestCases[0]?.test_case_id ?? workspaceContext.selected_test_case_id,
          failed_test_cases: failedTestCases.map(
            (testCase) => `${testCase.label}：${testCase.summary}`,
          ),
          learner_weak_points: result.learning_update.review_changes.map(
            (review) => review.title,
          ),
        };
        const diagnosisData = await getDiagnosis(result.diagnosis_id);
        const citationData = (
          await Promise.allSettled(diagnosisData.citation_ids.map(getSource))
        ).flatMap((settled) => (settled.status === "fulfilled" ? [settled.value] : []));
        setDiagnosis(diagnosisData);
        setSources(citationData);
        setDiagnosing(true);
        void runDiagnosis(
          result.submission_id,
          "normal",
          diagnosisContext,
          (event) => {
            if (diagnosisRequestIdRef.current === diagnosisRequestId) {
              setEvents((current) => [...current, event]);
            }
          },
        )
          .then((runEvents) => {
            if (diagnosisRequestIdRef.current === diagnosisRequestId) {
              setEvents(runEvents);
            }
          })
          .catch((caught: unknown) => {
            if (diagnosisRequestIdRef.current === diagnosisRequestId) {
              setError(caught instanceof Error ? caught.message : "诊断暂时未完成。");
            }
          })
          .finally(() => {
            if (diagnosisRequestIdRef.current === diagnosisRequestId) {
              setDiagnosing(false);
            }
          });
      }
    } catch (caught) {
      if (isEvaluatorOutage(caught)) {
        setEvaluatorUnavailable(true);
      } else {
        setError(caught instanceof Error ? caught.message : "提交失败，请稍后重试。");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDiagnosisRetry() {
    if (!submission) return;
    const diagnosisRequestId = diagnosisRequestIdRef.current + 1;
    diagnosisRequestIdRef.current = diagnosisRequestId;
    setDiagnosing(true);
    setError(null);
    setEvents([]);
    try {
      const runEvents = await runDiagnosis(
        submission.submission_id,
        "normal",
        {
          ...workspaceContext,
          active_view: "evidence",
          submission_id: submission.submission_id,
        },
        (event) => {
          if (diagnosisRequestIdRef.current === diagnosisRequestId) {
            setEvents((current) => [...current, event]);
          }
        },
      );
      if (diagnosisRequestIdRef.current === diagnosisRequestId) {
        setEvents(runEvents);
      }
    } catch (caught) {
      if (diagnosisRequestIdRef.current === diagnosisRequestId) {
        setError(caught instanceof Error ? caught.message : "重新诊断失败。");
      }
    } finally {
      if (diagnosisRequestIdRef.current === diagnosisRequestId) {
        setDiagnosing(false);
      }
    }
  }

  async function handleValidation() {
    if (!submission?.validation_id || !validationTask || !validationSource.trim()) return;
    setValidationSubmitting(true);
    setValidationError(null);
    try {
      const result = await submitValidation(
        submission.validation_id,
        validationTask.version,
        submission.learning_state_version,
        validationLanguage,
        validationSource,
      );
      setValidation(result);
    } catch (caught) {
      if (isEvaluatorOutage(caught)) {
        setValidationError("运行暂时未完成，代码草稿已保留，可稍后重试。");
      } else {
        setValidationError(
          caught instanceof Error ? caught.message : "独立验证提交失败。",
        );
      }
    } finally {
      setValidationSubmitting(false);
    }
  }

  if (!task || !courseMap) {
    if (error) return (
      <div className="page-inner page-surface student-load-failure" role="alert">
        <Route aria-hidden="true" size={32} />
        <h1>学习工作台暂时无法打开</h1>
        <p>{error} 你可以先进入实验中心继续学习。</p>
        <div><button className="primary-button" type="button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button><Link className="secondary-button" to="/student/programming-experiments">前往实验中心</Link></div>
      </div>
    );
    return (
      <div className="page-inner page-loading" role="status">
        正在打开学习工作台…
      </div>
    );
  }

  const selectedRunTest =
    runResult?.test_cases.find((testCase) => testCase.test_case_id === selectedTestCaseId) ??
    runResult?.test_cases[0] ??
    null;
  const activeLanguageMeta = programmingLanguageMeta[activeLanguage];
  const learningUpdatePassed = submission?.learning_update?.trigger === "passed_submission";
  const failedTestLabels = runResult?.test_cases
    .filter((testCase) => testCase.status !== "passed")
    .map((testCase) => testCase.label)
    .join("、");
  const workspaceContext: TutorWorkspaceContext = {
    active_view: activeView,
    language: activeLanguage,
    task_title: task.title,
    task_id: task.task_id,
    learning_node_id: "node_bfs_001",
    submission_id: submission?.submission_id ?? null,
    code_excerpt: sourceCode.slice(0, 4000),
    test_summary: runResult
      ? `${runResult.passed_count}/${runResult.total_count} 个用例通过${failedTestLabels ? `；失败用例：${failedTestLabels}` : ""}`
      : submission
        ? `${submission.evaluation.passed_count}/${submission.evaluation.total_count} 个评测用例通过`
        : null,
    trace_summary: traceStep
      ? `第 ${traceStep.step_index + 1} 步：${traceStep.action}；Queue=[${traceStep.queue.join(", ")}], Visited=[${traceStep.visited.join(", ")}]`
      : null,
    error_line: runResult?.error_line ?? null,
    selected_test_case_id: selectedTestCaseId,
    failed_test_cases: runResult?.test_cases
      .filter((testCase) => testCase.status !== "passed")
      .map((testCase) => `${testCase.label}：${testCase.summary}`) ?? [],
    execution_mode: runResult?.execution_mode ?? null,
    evaluator_label: runResult?.evaluator_label ?? null,
    runtime_summary:
      runResult?.test_cases.map(
        (testCase) =>
          `${testCase.label}：${testCase.duration_ms ?? "未知"} ms / ${testCase.memory_kb ?? "未知"} KB`,
      ) ?? [],
    evaluator_error: runResult?.stderr ?? null,
    trace_variant: trace?.variant ?? runResult?.trace_variant ?? variant,
    learner_weak_points: diagnosis
      ? [diagnosis.primary_hypothesis.summary]
      : submission?.learning_update?.review_changes.map((review) => review.title) ?? [],
  };

  return (
    <div
      className="page-inner page-surface workbench-page"
      data-coach-collapsed={coachCollapsed ? "true" : "false"}
      data-focus={focusMode ? "true" : "false"}
    >
      <nav className="breadcrumbs" aria-label="面包屑">
        <span>数据结构</span>
        <ChevronRight aria-hidden="true" size={14} />
        <span>图遍历</span>
        <ChevronRight aria-hidden="true" size={14} />
        <strong>BFS</strong>
      </nav>

      <div className="workbench-grid">
        <aside className="workbench-course-pane" aria-label="课程路径">
          <div className="pane-heading">
            <span>课程进度</span>
            <strong>{courseMap.course.progress_percent}%</strong>
          </div>
          <CourseTree nodes={courseMap.nodes} currentNodeId="node_bfs_001" />
        </aside>

        <section className={`task-pane${activeView === "history" ? " history-expanded" : ""}`}>
          <header className="task-heading">
            <div>
              <p>代码任务 · BFS</p>
              <h1>{task.title}</h1>
            </div>
            <div className="task-heading-actions">
              <StatusBadge status={submission?.learning_node_status ?? "in_progress"} />
              <button
                aria-label={focusMode ? "退出专注模式" : "进入专注模式"}
                className="icon-button task-focus-toggle"
                onClick={() => setFocusMode((current) => !current)}
                title={focusMode ? "退出专注模式" : "进入专注模式"}
                type="button"
              >
                {focusMode ? <Minimize2 aria-hidden="true" size={16} /> : <Maximize2 aria-hidden="true" size={16} />}
              </button>
            </div>
          </header>
          <p className="task-prompt">{task.prompt_markdown}</p>

          <nav className="workbench-view-tabs" aria-label="工作台视图">
            <button className={activeView === "code" ? "active" : undefined} onClick={() => handleViewChange("code")} type="button">
              <Code2 aria-hidden="true" size={14} />代码
            </button>
            <button className={activeView === "trace" ? "active" : undefined} onClick={() => void handleOpenTrace()} type="button">
              <GitBranch aria-hidden="true" size={14} />运行轨迹
            </button>
            <button className={activeView === "tests" ? "active" : undefined} onClick={() => handleViewChange("tests")} type="button">
              <ListChecks aria-hidden="true" size={14} />测试结果
            </button>
            <button className={activeView === "evidence" ? "active" : undefined} onClick={() => handleViewChange("evidence")} type="button">
              <Database aria-hidden="true" size={14} />学习记录
            </button>
            <button className={activeView === "history" ? "active" : undefined} onClick={() => handleViewChange("history")} type="button">
              <History aria-hidden="true" size={14} />提交记录
            </button>
          </nav>

          <div
            aria-busy={preparingRunResult || viewLeaving}
            className={`workbench-view-stage${viewLeaving ? " is-leaving" : ""}${preparingRunResult ? " is-preparing-result" : ""}`}
            data-view={activeView}
            key={activeView}
          >

          {activeView !== "history" ? (
            <div className="workbench-toolbar">
              <div className="segmented-control" aria-label="代码版本">
              <button
                aria-pressed={selectedPreset === "visited-on-dequeue"}
                className={selectedPreset === "visited-on-dequeue" ? "active" : ""}
                onClick={() => handleVariantChange("visited-on-dequeue")}
                type="button"
              >
                当前错误代码
              </button>
              <button
                aria-pressed={selectedPreset === "visited-on-enqueue"}
                className={selectedPreset === "visited-on-enqueue" ? "active" : ""}
                onClick={() => handleVariantChange("visited-on-enqueue")}
                type="button"
              >
                已修复代码
              </button>
              </div>
            </div>
          ) : null}

          {evaluatorUnavailable ? (
            <div className="evaluator-unavailable" role="alert">
              <AlertCircle aria-hidden="true" size={18} />
              <div>
                <strong>运行暂时未完成</strong>
                <p>代码草稿已保留，可稍后重试。</p>
              </div>
              <button
                onClick={() => {
                  setEvaluatorUnavailable(false);
                  setActiveView("code");
                }}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} />重新检查
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="inline-error" role="alert">
              <AlertCircle aria-hidden="true" size={17} />
              {error}
            </div>
          ) : null}

          {activeView === "code" ? (
            <>
              {restoredSubmissionSequence ? (
                <div className="restored-draft-notice" role="status">
                  <RotateCcw aria-hidden="true" size={14} />
                  已载入版本 {String(restoredSubmissionSequence).padStart(2, "0")}，尚未产生新提交
                </div>
              ) : null}
              <CodeEditor
                errorLine={runResult?.error_line ?? null}
                language={activeLanguage}
                onChange={handleSourceChange}
                onLanguageChange={handleLanguageChange}
                ref={editorRef}
                templates={codeTemplates}
                value={sourceCode}
              />

              <details className="custom-input-panel">
                <summary>
                  自定义图输入
                  <small>可选</small>
                </summary>
                <div>
                  <label htmlFor="custom-graph-input">每行一条有向边</label>
                  <textarea
                    id="custom-graph-input"
                    autoComplete="off"
                    name="custom-graph-input"
                    onChange={(event) => handleCustomInputChange(event.target.value)}
                    placeholder={"start=1\n1 2\n1 3\n2 4\n3 4"}
                    spellCheck={false}
                    value={customInput}
                  />
                </div>
              </details>

              <div className="task-actions">
                <div
                  aria-label={preparingRunResult ? "运行完成，正在整理测试结果" : undefined}
                  className={`submission-language-status${preparingRunResult ? " preparing-result" : ""}`}
                  role="status"
                >
                  {preparingRunResult ? (
                    <>
                      <span className="run-handoff-mark"><Check aria-hidden="true" size={14} /></span>
                      <div>
                        <strong>运行完成</strong>
                        <small>正在整理测试结果…</small>
                      </div>
                      <span className="run-handoff-progress" aria-hidden="true"><i /></span>
                    </>
                  ) : (
                    <>
                      <Code2 aria-hidden="true" size={16} />
                      <div>
                        <span>{`提交语言：${activeLanguageMeta.label} · ${activeLanguageMeta.version}`}</span>
                      </div>
                    </>
                  )}
                </div>
                <button
                  className="secondary-button"
                  disabled={running || preparingRunResult || !sourceCode.trim()}
                  onClick={() => void handleRun()}
                  type="button"
                >
                  {preparingRunResult ? <Check aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
                  {preparingRunResult ? "整理结果…" : running ? "正在运行…" : "运行代码"}
                </button>
                <GradientButton
                  variant="variant"
                  size="compact"
                  disabled={submitting || running || preparingRunResult || evaluatorUnavailable}
                  onClick={handleSubmit}
                  type="button"
                >
                  <Send aria-hidden="true" size={16} />{submitting ? "正在评测" : "提交评测"}
                </GradientButton>
              </div>
            </>
          ) : null}

          {activeView === "trace" ? (
            traceLoading ? (
              <div className="workbench-view-loading" role="status">正在生成运行轨迹…</div>
            ) : trace ? (
              <TraceExperience
                comparisonError={comparisonError}
                comparisonLoading={comparisonLoading}
                comparisonTrace={comparisonTrace}
                onRequestComparison={() => void handleLoadComparisonTrace()}
                onStepChange={setTraceStep}
                trace={trace}
              />
            ) : (
              <div className="workbench-empty-view">当前轨迹不可用，请返回代码后重试。</div>
            )
          ) : null}

          {activeView === "tests" ? (
            <section className="workbench-result-view" aria-labelledby="test-results-heading">
              <header>
                <div className="result-heading-copy">
                  <h2 id="test-results-heading">测试结果</h2>
                  <p>{runResult ? "当前代码的运行结果" : "提交后返回题目用例结果"}</p>
                  {runResult ? (
                    <span className={`result-provenance ${runResult.execution_mode}`}>
                      {runResult.execution_mode === "sandbox" ? (
                        <ShieldCheck aria-hidden="true" size={13} />
                      ) : (
                        <AlertCircle aria-hidden="true" size={13} />
                      )}
                      <strong>{provenanceLabel(runResult)}</strong>
                      <small>{runResult.evaluator_label}</small>
                    </span>
                  ) : null}
                </div>
                {runResult ? (
                  <strong className={`result-score ${runResult.passed_count === runResult.total_count ? "passed" : "failed"}`}>
                    {runResult.passed_count} / {runResult.total_count}
                  </strong>
                ) : submission ? (
                  <strong className={`result-score ${submission.evaluation.passed_count === submission.evaluation.total_count ? "passed" : "failed"}`}>
                    {submission.evaluation.passed_count} / {submission.evaluation.total_count}
                  </strong>
                ) : null}
              </header>

              {runResult ? (
                <>
                  {runResult.degraded_reason ? (
                    <div className="result-degraded-note" role="status">
                      <AlertCircle aria-hidden="true" size={14} />
                      <strong>基础检查结果</strong>
                      <span>{runResult.degraded_reason}</span>
                    </div>
                  ) : null}
                  <div className={`run-summary-strip ${runResult.status}`}>
                    <div className="run-status-copy">
                      <span>
                        {runResult.status === "passed" ? (
                          <Check aria-hidden="true" size={16} />
                        ) : (
                          <AlertCircle aria-hidden="true" size={16} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {runStatusLabel(runResult)}
                        </strong>
                        <small>
                          {runResult.detected_variant === "visited-on-enqueue"
                            ? "检测到：入队时标记 visited"
                            : runResult.detected_variant === "visited-on-dequeue"
                              ? "检测到：出队时标记 visited"
                              : "源码结构需要修正"}
                        </small>
                      </div>
                    </div>
                    <dl className="run-metrics">
                      <div>
                        <dt><Timer aria-hidden="true" size={13} />耗时</dt>
                        <dd>{formatMetric(runResult.duration_ms, "ms")}</dd>
                      </div>
                      <div>
                        <dt><MemoryStick aria-hidden="true" size={13} />内存</dt>
                        <dd>{formatMetric(runResult.memory_kb, "KB")}</dd>
                      </div>
                    </dl>
                    <div className="run-result-actions">
                      {runResult.error_line ? (
                        <button onClick={handleLocateError} type="button">
                          <LocateFixed aria-hidden="true" size={14} />定位第 {runResult.error_line} 行
                        </button>
                      ) : null}
                      {runResult.trace_available && runResult.trace_variant ? (
                        <button
                          onClick={() => void handleOpenTrace(runResult.trace_variant)}
                          type="button"
                        >
                          <GitBranch aria-hidden="true" size={14} />查看本次轨迹
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {runResult.stderr ? (
                    <div className="run-diagnostic" role="alert">
                      <Terminal aria-hidden="true" size={15} />
                      <pre>{runResult.stderr}</pre>
                    </div>
                  ) : null}

                  {runResult.test_cases.length > 0 ? (
                    <>
                      <ul className="test-result-list run-test-list">
                        {runResult.test_cases.map((testCase) => (
                          <li
                            className={`${selectedRunTest?.test_case_id === testCase.test_case_id ? "selected " : ""}${testCase.status === "passed" ? "test-passed" : testCase.status === "internal_error" ? "test-warning" : "test-failed"}`}
                            key={testCase.test_case_id}
                          >
                            <button
                              onClick={() => setSelectedTestCaseId(testCase.test_case_id)}
                              type="button"
                            >
                              <span className={`test-status-icon ${testCase.status}`} aria-hidden="true">
                                {testCase.status === "passed" ? <Check size={12} /> : <AlertCircle size={12} />}
                              </span>
                              <strong>{testCase.label}</strong>
                              <small>{testCase.summary}</small>
                              <span className="test-duration">
                                <Timer aria-hidden="true" size={12} />
                                <span>{formatMetric(testCase.duration_ms, "ms")}</span>
                              </span>
                              <b className={testCase.status === "passed" ? "passed" : "failed"}>
                                {testStatusLabel(testCase.status)}
                              </b>
                            </button>
                          </li>
                        ))}
                      </ul>

                      {selectedRunTest ? (
                        <section className="test-io-detail" aria-label="用例输入输出">
                          <header>
                            <strong>用例详情</strong>
                            <span>{formatMetric(selectedRunTest.duration_ms, "ms")}</span>
                          </header>
                          <div className="test-io-grid">
                            <div>
                              <span>输入</span>
                              <pre>{selectedRunTest.input}</pre>
                            </div>
                            <div className="expected-output">
                              <span>期望输出</span>
                              <pre>{selectedRunTest.expected_output}</pre>
                            </div>
                            <div className={selectedRunTest.status === "failed" ? "actual-output actual-failed" : "actual-output actual-passed"}>
                              <span>实际输出</span>
                              <pre>{selectedRunTest.actual_output}</pre>
                            </div>
                          </div>
                        </section>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : submission?.evaluation.test_cases.length ? (
                <ul className="test-result-list">
                  {submission.evaluation.test_cases.map((testCase) => (
                    <li className={testCase.status === "passed" ? "test-passed" : "test-failed"} key={testCase.test_case_id}>
                      <span className={`test-status-icon ${testCase.status === "passed" ? "passed" : "failed"}`} aria-hidden="true">
                        {testCase.status === "passed" ? <Check size={12} /> : <AlertCircle size={12} />}
                      </span>
                      <strong>{testCase.label}</strong>
                      <small>{testCase.summary}</small>
                      <span className="test-duration">
                        <Timer aria-hidden="true" size={12} />
                        <span>{formatMetric(testCase.duration_ms, "ms")}</span>
                      </span>
                      <b className={testCase.status === "passed" ? "passed" : "failed"}>
                        {testCase.status === "passed" ? "通过" : "失败"}
                      </b>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="workbench-empty-view">运行或提交代码后显示逐项测试结果。</div>
              )}
            </section>
          ) : null}

          {activeView === "evidence" ? (
            <>
              {submission ? (
                <section className="evaluation-section" aria-labelledby="evidence-heading">
                  <div className="evaluation-summary">
                    <span className={submission.evaluation.passed_count === submission.evaluation.total_count ? "score-pass" : "score-fail"}>
                      {submission.evaluation.passed_count} / {submission.evaluation.total_count}
                    </span>
                    <div>
                      <h2 id="evidence-heading">运行记录</h2>
                      <p>本次提交的用例结果与学习记录</p>
                    </div>
                  </div>
                  {submission.evidence.length > 0 ? (
                    <ul className="evidence-list">
                      {submission.evidence.map((item) => (
                        <li key={item.evidence_id}>
                          <FlaskConical aria-hidden="true" size={17} />
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.summary}</small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="all-tests-pass">
                      <Check aria-hidden="true" size={18} />全部评测用例通过，进入独立验证。
                    </div>
                  )}
                </section>
              ) : !evaluatorUnavailable ? (
                <div className="workbench-empty-view">提交评测后可查看本次结果。</div>
              ) : null}

              {submission?.learning_update ? (
                <section
                  className={`learning-action-section ${learningUpdatePassed ? "passed" : "failed"}`}
                  aria-labelledby="learning-update-heading"
                >
                  <header>
                    <span className="learning-action-state" aria-hidden="true">
                      {learningUpdatePassed ? <Check size={18} /> : <Route size={18} />}
                    </span>
                    <div>
                      <small>{learningUpdatePassed ? "评测通过后的学习安排" : "评测失败后的学习安排"}</small>
                      <h2 id="learning-update-heading">
                        {learningUpdatePassed ? "修复通过，继续完成迁移验证" : "这次失败后，按 3 步继续"}
                      </h2>
                      <p>{submission.learning_update.title}</p>
                    </div>
                    <span className="learning-action-origin">
                      依据 {submission.evaluation.passed_count}/{submission.evaluation.total_count} 评测生成
                    </span>
                  </header>

                  <ol className="learning-action-list">
                    <li>
                      <span className="learning-step-number">01</span>
                      <span className="learning-step-icon" aria-hidden="true"><TrendingUp size={16} /></span>
                      <div className="learning-step-body">
                        <small>已经记录</small>
                        <h3>你这次练到了什么</h3>
                        <div className="learning-change-list">
                          {submission.learning_update.ability_changes.map((change) => (
                            <div className="learning-change" key={change.key}>
                              <p>
                                <strong>{change.label}</strong>
                                <span className="learning-delta">+{change.delta}</span>
                                <span className="learning-score">{change.before} → {change.after}</span>
                              </p>
                              <small>{change.reason}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                      <Link className="learning-step-action" to="/student/profile">
                        查看能力图<ChevronRight aria-hidden="true" size={14} />
                      </Link>
                    </li>

                    <li>
                      <span className="learning-step-number">02</span>
                      <span className="learning-step-icon" aria-hidden="true"><Route size={16} /></span>
                      <div className="learning-step-body">
                        <small>现在处理</small>
                        <h3>{learningUpdatePassed ? "下一步去哪里" : "先回看哪个错因"}</h3>
                        <div className="learning-change-list">
                          {submission.learning_update.plan_changes.map((change) => (
                            <div className="learning-change" key={change.label}>
                              <p><strong>{change.label}</strong></p>
                              <small>{change.detail}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                      {learningUpdatePassed && submission.validation_id ? (
                        <a className="learning-step-action" href="#validation-heading">
                          开始独立验证<ChevronRight aria-hidden="true" size={14} />
                        </a>
                      ) : (
                        <button
                          className="learning-step-action"
                          onClick={() => void handleOpenTrace(runResult?.trace_variant ?? variant)}
                          type="button"
                        >
                          回看运行轨迹<ChevronRight aria-hidden="true" size={14} />
                        </button>
                      )}
                    </li>

                    <li>
                      <span className="learning-step-number">03</span>
                      <span className="learning-step-icon" aria-hidden="true"><CalendarClock size={16} /></span>
                      <div className="learning-step-body">
                        <small>之后巩固</small>
                        <h3>什么时候再练一次</h3>
                        <div className="learning-change-list">
                          {submission.learning_update.review_changes.length ? (
                            submission.learning_update.review_changes.map((change) => (
                              <div className="learning-change" key={change.id}>
                                <p>
                                  <strong>{change.title}</strong>
                                  <span className="learning-review-time">
                                    <time dateTime={change.scheduled_for}>{formatReviewDate(change.scheduled_for)}</time>
                                    <em>{change.minutes} 分钟</em>
                                  </span>
                                </p>
                                <small>{change.reason}</small>
                              </div>
                            ))
                          ) : (
                            <div className="learning-change">
                              <p><strong>无需追加复习</strong></p>
                              <small>保持当前复习节奏。</small>
                            </div>
                          )}
                        </div>
                      </div>
                      <Link className="learning-step-action" to="/student/mistakes">
                        查看错题复习<ChevronRight aria-hidden="true" size={14} />
                      </Link>
                    </li>
                  </ol>
                </section>
              ) : null}

              {submission?.validation_id ? (
                <section className="validation-section" aria-labelledby="validation-heading">
                  <div className="validation-heading-row">
                    <span className="section-icon teal">
                      <ShieldCheck aria-hidden="true" size={18} />
                    </span>
                    <div>
                      <h2 id="validation-heading">独立验证 · 无提示</h2>
                      <p>
                        {validationTask?.prompt_markdown ??
                          "在新图中完成无权最短路径任务，本环节不提供代码提示。"}
                      </p>
                    </div>
                  </div>

                  {validation?.passed ? (
                    <div className="mastery-result" aria-label="验证结果：已掌握" role="status">
                      <Check aria-hidden="true" size={18} />
                      <strong>已掌握</strong>
                      <span>
                        {validation.evaluation.passed_count}/{validation.evaluation.total_count}{" "}
                        个隐藏用例通过 · {validation.evaluation.evaluator_label}
                      </span>
                      <span>下一步：深度优先遍历</span>
                    </div>
                  ) : validationTask ? (
                    <>
                      <CodeEditor
                        ariaLabel="独立验证代码"
                        errorLine={null}
                        languageSelectAriaLabel="独立验证提交语言"
                        language={validationLanguage}
                        onChange={handleValidationSourceChange}
                        onLanguageChange={handleValidationLanguageChange}
                        templates={validationTask.code_templates ?? []}
                        value={validationSource}
                      />
                      {validation && !validation.passed ? (
                        <div className="validation-attempt-result" role="status">
                          <AlertCircle aria-hidden="true" size={16} />
                          <div>
                            <strong>
                              未通过：{validation.evaluation.passed_count}/
                              {validation.evaluation.total_count} 个隐藏用例（
                              {validation.evaluation.evaluator_label}）
                            </strong>
                            <ul>
                              {validation.evaluation.test_cases.map((testCase) => (
                                <li key={testCase.test_case_id}>
                                  <span>{testCase.label}</span>
                                  <em data-status={testCase.status}>
                                    {validationCaseStatusLabel(testCase.status)}
                                  </em>
                                </li>
                              ))}
                            </ul>
                            <small>验证环节不提供提示，请独立修改后重新提交。</small>
                          </div>
                        </div>
                      ) : null}
                      {validationError ? (
                        <div className="inline-error" role="alert">
                          <AlertCircle aria-hidden="true" size={17} />
                          {validationError}
                        </div>
                      ) : null}
                      <button
                        className="primary-button"
                        disabled={validationSubmitting || !validationSource.trim()}
                        onClick={() => void handleValidation()}
                        type="button"
                      >
                        <ShieldCheck aria-hidden="true" size={16} />
                        {validationSubmitting ? "正在评测…" : "提交独立验证"}
                      </button>
                    </>
                  ) : validationError ? (
                    <div className="inline-error" role="alert">
                      <AlertCircle aria-hidden="true" size={17} />
                      {validationError}
                    </div>
                  ) : (
                    <div className="workbench-view-loading" role="status">
                      正在加载独立验证任务…
                    </div>
                  )}
                </section>
              ) : null}
            </>
          ) : null}

          {activeView === "history" ? (
            historyLoading ? (
              <div className="workbench-view-loading" role="status">正在加载提交记录…</div>
            ) : (
              <SubmissionHistoryPanel
                items={submissionHistory}
                language={activeLanguage}
                onRestore={handleRestoreSubmission}
              />
            )
          ) : null}
          </div>
        </section>

        <AiLearningCoach
          collapsed={coachCollapsed}
          context={workspaceContext}
          diagnosis={diagnosis}
          events={events}
          onLocateError={handleLocateError}
          onOpenTests={() => handleViewChange("tests")}
          onOpenTrace={() => void handleOpenTrace(runResult?.trace_variant ?? variant)}
          onRetry={() => void handleDiagnosisRetry()}
          onToggleCollapsed={() => setCoachCollapsed((current) => !current)}
          runResult={runResult}
          running={running}
          sources={sources}
          submission={submission}
          submitting={diagnosing}
          traceStep={activeView === "trace" ? traceStep : null}
          traceVariant={trace?.variant ?? runResult?.trace_variant ?? variant}
        />
      </div>
    </div>
  );
}
