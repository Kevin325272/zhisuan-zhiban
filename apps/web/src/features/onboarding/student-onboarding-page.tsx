import type {
  OnboardingDiagnosticAnswer,
  OnboardingDiagnosticQuestionSetResponse,
  OnboardingCourseId,
  OnboardingGoalInput,
  OnboardingInitialProfile,
  OnboardingLearningPlan,
  OnboardingPreparationStage,
  OnboardingSelfAssessmentLevel,
  OnboardingState,
  OnboardingStep,
  StudentClassEnrollmentStatus,
} from "@xuetu/contracts";
import {
  ArrowRight,
  Check,
  Clock3,
  Compass,
  LoaderCircle,
  RotateCcw,
  Target,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  completeStudentOnboarding,
  completeStudentOnboardingDiagnostic,
  getStudentOnboardingState,
  getStudentOnboardingDiagnosticQuestions,
  getStudentClassEnrollmentStatus,
  submitStudentClassEnrollmentRequest,
  cancelStudentClassEnrollmentRequest,
  saveStudentOnboardingGoals,
  saveStudentOnboardingDiagnosticAnswer,
  saveStudentOnboardingSelfAssessments,
} from "../../api/client";
import { compactStartingRationale } from "./starting-direction-copy";

const COURSE_OPTIONS: Array<{ id: OnboardingCourseId; title: string }> = [
  { id: "course_408_ds", title: "数据结构" },
  { id: "course_408_co", title: "计算机组成原理" },
  { id: "course_408_os", title: "操作系统" },
  { id: "course_408_cn", title: "计算机网络" },
];

const STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: "goals", label: "学习目标" },
  { id: "self_assessment", label: "课程自评" },
  { id: "diagnostic", label: "起步筛查" },
  { id: "profile", label: "学习方向" },
  { id: "plan", label: "7 日路径" },
];

const STAGE_OPTIONS: Array<{ value: OnboardingPreparationStage; label: string; note: string }> = [
  { value: "preparing", label: "准备开始", note: "还在收集信息与资料" },
  { value: "foundation", label: "基础阶段", note: "正在系统学习四门课程" },
  { value: "strengthening", label: "强化阶段", note: "开始专题训练与查漏补缺" },
  { value: "sprint", label: "冲刺阶段", note: "以真题、错题和速度为主" },
];

const SELF_LEVELS: Array<{ value: OnboardingSelfAssessmentLevel; label: string }> = [
  { value: "not_started", label: "尚未开始" },
  { value: "weak", label: "学过但基础较弱" },
  { value: "average", label: "有一定基础" },
  { value: "good", label: "基础较好" },
  { value: "reinforcing", label: "正在强化" },
];

const PRIORITY_LABELS = {
  focus: "优先开始",
  strengthen: "重点安排",
  maintain: "保持节奏",
} as const;

const TASK_TYPE_LABELS = {
  course_reading: "课程学习",
  choice_practice: "选择题训练",
  mistake_review: "错题复习",
} as const;

function createDefaultAssessments(): Record<OnboardingCourseId, OnboardingSelfAssessmentLevel> {
  return Object.fromEntries(
    COURSE_OPTIONS.map((course) => [course.id, "not_started"]),
  ) as Record<OnboardingCourseId, OnboardingSelfAssessmentLevel>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

function hasCompleteLearningSetup(state: OnboardingState) {
  return state.status === "completed"
    && state.goals !== null
    && state.profile !== null
    && state.plan !== null
    && state.plan.tasks.length > 0;
}

function normalizeInvitationCode(value: string) {
  const compact = value.replace(/[\s-]/gu, "").toUpperCase();
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : value.trim().toUpperCase();
}

export function StudentOnboardingPage() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [viewStep, setViewStep] = useState<OnboardingStep>("goals");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRevisingSetup, setIsRevisingSetup] = useState(false);
  const [diagnostic, setDiagnostic] = useState<OnboardingDiagnosticQuestionSetResponse | null>(null);
  const [diagnosticLoadStatus, setDiagnosticLoadStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [diagnosticLoadError, setDiagnosticLoadError] = useState<string | null>(null);
  const [diagnosticUnavailable, setDiagnosticUnavailable] = useState(false);
  const [diagnosticIndex, setDiagnosticIndex] = useState(0);
  const [diagnosticSelection, setDiagnosticSelection] = useState<string[]>([]);
  const [setupRecoveryStatus, setSetupRecoveryStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [setupRecoveryError, setSetupRecoveryError] = useState<string | null>(null);
  const [classEnrollment, setClassEnrollment] = useState<StudentClassEnrollmentStatus>({
    membership: null,
    request: null,
  });
  const [enrollmentLoading, setEnrollmentLoading] = useState(true);
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [invitationCode, setInvitationCode] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const diagnosticRequest = useRef<Promise<void> | null>(null);
  const setupRecoveryRequest = useRef<Promise<void> | null>(null);

  const nextYear = Math.max(2027, new Date().getFullYear() + 1);
  const [targetExamYear, setTargetExamYear] = useState(nextYear);
  const [preparationStage, setPreparationStage] = useState<OnboardingPreparationStage>("foundation");
  const [dailyMinutes, setDailyMinutes] = useState(60);
  const [targetSchool, setTargetSchool] = useState("");
  const [targetScore, setTargetScore] = useState("");
  const [assessments, setAssessments] = useState(createDefaultAssessments);

  const applyState = useCallback((next: OnboardingState, step?: OnboardingStep) => {
    setState(next);
    const hasCompleteSetup = hasCompleteLearningSetup(next);
    if (hasCompleteSetup) setIsRevisingSetup(false);
    if (next.goals) {
      setTargetExamYear(next.goals.target_exam_year);
      setPreparationStage(next.goals.preparation_stage);
      setDailyMinutes(next.goals.daily_minutes);
      setTargetSchool(next.goals.target_school ?? "");
      setTargetScore(next.goals.target_score === null || next.goals.target_score === undefined
        ? ""
        : String(next.goals.target_score));
    }
    if (next.self_assessments.length > 0) {
      setAssessments((current) => ({
        ...current,
        ...Object.fromEntries(next.self_assessments.map((item) => [item.course_id, item.level])),
      }));
    }
    setViewStep(step ?? (hasCompleteSetup ? "plan" : next.current_step === "plan" ? "goals" : next.current_step));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyState(await getStudentOnboardingState());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  const loadDiagnostic = useCallback(() => {
    if (diagnosticRequest.current) return diagnosticRequest.current;
    const request = (async () => {
      setDiagnosticLoadStatus("loading");
      setDiagnosticLoadError(null);
      setDiagnosticUnavailable(false);
      try {
        const next = await getStudentOnboardingDiagnosticQuestions();
        setDiagnostic(next);
        const firstUnanswered = next.items.findIndex((item) => item.response_status === null);
        const index = firstUnanswered >= 0 ? firstUnanswered : Math.max(0, next.items.length - 1);
        setDiagnosticIndex(index);
        setDiagnosticSelection(next.items[index]?.selected_option_ids ?? []);
        setDiagnosticLoadStatus("ready");
      } catch (cause) {
        setDiagnosticLoadError(errorMessage(cause));
        setDiagnosticUnavailable(cause instanceof ApiError && cause.code === "ONBOARDING_DIAGNOSTIC_UNAVAILABLE");
        setDiagnosticLoadStatus("error");
      }
    })();
    diagnosticRequest.current = request;
    void request.finally(() => {
      if (diagnosticRequest.current === request) diagnosticRequest.current = null;
    });
    return request;
  }, []);

  const recoverIncompleteSetup = useCallback(() => {
    if (setupRecoveryRequest.current) return setupRecoveryRequest.current;
    const request = (async () => {
      setSetupRecoveryStatus("loading");
      setSetupRecoveryError(null);
      try {
        applyState(await completeStudentOnboarding(), "profile");
        setSetupRecoveryStatus("ready");
      } catch (cause) {
        setSetupRecoveryError(errorMessage(cause));
        setSetupRecoveryStatus("error");
      }
    })();
    setupRecoveryRequest.current = request;
    void request.finally(() => {
      if (setupRecoveryRequest.current === request) setupRecoveryRequest.current = null;
    });
    return request;
  }, [applyState]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    setEnrollmentLoading(true);
    void getStudentClassEnrollmentStatus()
      .then((next) => {
        if (cancelled) return;
        setClassEnrollment(next);
        if (next.request?.student_number) setStudentNumber(next.request.student_number);
        if (next.membership?.student_number) setStudentNumber(next.membership.student_number);
      })
      .catch((cause) => {
        if (!cancelled) setEnrollmentError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setEnrollmentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (viewStep === "diagnostic" && !diagnostic && diagnosticLoadStatus === "idle") {
      void loadDiagnostic();
    }
  }, [diagnostic, diagnosticLoadStatus, loadDiagnostic, viewStep]);

  useEffect(() => {
    if (
      state?.status === "in_progress"
      && state.current_step === "profile"
      && state.profile === null
      && state.plan === null
      && setupRecoveryStatus === "idle"
    ) {
      void recoverIncompleteSetup();
    }
  }, [recoverIncompleteSetup, setupRecoveryStatus, state]);

  const saveGoals = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input: OnboardingGoalInput = {
      target_exam_year: targetExamYear,
      preparation_stage: preparationStage,
      daily_minutes: dailyMinutes,
      target_school: targetSchool.trim() || null,
      target_score: targetScore.trim() ? Number(targetScore) : null,
    };
    setSaving(true);
    setError(null);
    try {
      applyState(await saveStudentOnboardingGoals(input), "self_assessment");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveAssessments = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const nextState = await saveStudentOnboardingSelfAssessments({
        items: COURSE_OPTIONS.map((course) => ({
          course_id: course.id,
          level: assessments[course.id],
        })),
      });
      setDiagnostic(null);
      setDiagnosticLoadStatus("idle");
      setDiagnosticLoadError(null);
      setDiagnosticUnavailable(false);
      applyState(nextState, hasCompleteLearningSetup(nextState) ? "profile" : "diagnostic");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const continueWithoutDiagnostic = async () => {
    if (saving || !diagnosticUnavailable) return;
    setSaving(true);
    setError(null);
    try {
      applyState(await completeStudentOnboarding(), "profile");
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.code === "ONBOARDING_DIAGNOSTIC_REQUIRED") {
        // The set may have become available since the failed request.
        setDiagnosticUnavailable(false);
        setDiagnosticLoadStatus("idle");
      }
    } finally {
      setSaving(false);
    }
  };

  const submitEnrollment = async () => {
    const normalizedCode = normalizeInvitationCode(invitationCode);
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u.test(normalizedCode)) {
      setEnrollmentError("请输入老师提供的 8 位班级邀请码。");
      return;
    }
    if (!/^\d{10}$/u.test(studentNumber.trim())) {
      setEnrollmentError("请输入 10 位学号。");
      return;
    }
    setEnrollmentBusy(true);
    setEnrollmentError(null);
    try {
      const next = await submitStudentClassEnrollmentRequest({
        invite_code: normalizedCode,
        student_number: studentNumber.trim(),
      });
      setClassEnrollment(next);
      setInvitationCode("");
    } catch (cause) {
      setEnrollmentError(errorMessage(cause));
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const cancelEnrollment = async () => {
    setEnrollmentBusy(true);
    setEnrollmentError(null);
    try {
      await cancelStudentClassEnrollmentRequest();
      setClassEnrollment({ membership: null, request: null });
    } catch (cause) {
      setEnrollmentError(errorMessage(cause));
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const submitDiagnosticAnswer = async (responseStatus: OnboardingDiagnosticAnswer["response_status"]) => {
    const question = diagnostic?.items[diagnosticIndex];
    if (!question || saving) return;
    if (responseStatus === "answered" && question.question.multiple === false && diagnosticSelection.length === 0) {
      setError("请选择一个答案，或选择“不确定”。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveStudentOnboardingDiagnosticAnswer({
        question_id: question.question.id,
        response_status: responseStatus,
        selected_option_ids: responseStatus === "answered" ? diagnosticSelection : [],
      });
      const savedItems = diagnostic.items.map((item, index) => index === diagnosticIndex
        ? { ...item, response_status: responseStatus, selected_option_ids: responseStatus === "answered" ? diagnosticSelection : [] }
        : item);
      setDiagnostic({
        ...diagnostic,
        items: savedItems,
        summary: { ...diagnostic.summary, saved_count: savedItems.filter((item) => item.response_status !== null).length },
      });
      const isLast = diagnosticIndex === diagnostic.items.length - 1;
      if (!isLast) {
        const nextIndex = diagnosticIndex + 1;
        setDiagnosticIndex(nextIndex);
        setDiagnosticSelection(diagnostic.items[nextIndex]?.selected_option_ids ?? []);
      } else {
        const completed = await completeStudentOnboardingDiagnostic();
        applyState(completed, "profile");
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const currentStepIndex = STEPS.findIndex((step) => step.id === viewStep);
  const hasCompleteSetup = state ? hasCompleteLearningSetup(state) : false;
  const needsSetupRecovery = state?.status === "completed" && !hasCompleteSetup;
  const setupTitle = needsSetupRecovery ? "补全学习设置" : isRevisingSetup ? "调整学习设置" : "首次学习设置";

  if (loading && !state) {
    return (
      <main className="student-onboarding-page onboarding-centered-state" aria-busy="true" data-visual-system="ochre-serif">
        <LoaderCircle className="onboarding-spin" aria-hidden="true" size={25} />
        <p>正在恢复你的学习设置…</p>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="student-onboarding-page onboarding-centered-state" data-visual-system="ochre-serif">
        <h1>首次学习设置暂时无法打开</h1>
        <p role="alert">{error ?? "服务暂时不可用，现有学习数据没有被修改。"}</p>
        <button type="button" onClick={() => void load()}>
          <RotateCcw aria-hidden="true" size={17} />重新加载
        </button>
      </main>
    );
  }

  return (
    <main className="student-onboarding-page" data-visual-system="ochre-serif">
      <header className="onboarding-header">
        <div className="onboarding-brand">
          <span className="onboarding-brand-mark">学</span>
          <div><strong>智算智伴</strong><span>{setupTitle}</span></div>
        </div>
      </header>

      <nav className="onboarding-steps" aria-label="首次学习设置进度">
        {STEPS.map((step, index) => {
          const completed = index < currentStepIndex || hasCompleteSetup;
          const current = step.id === viewStep;
          const deferred = step.id === "diagnostic" && completed && !current
            && state.profile !== null && !state.profile.screening;
          return (
            <div
              className={deferred ? "is-deferred" : completed ? "is-complete" : current ? "is-current" : ""}
              aria-current={current ? "step" : undefined}
              key={step.id}
            >
              <span>{deferred ? "—" : completed && !current ? <Check aria-hidden="true" size={14} /> : index + 1}</span>
              <strong>{deferred ? "起步筛查 · 暂未进行" : step.label}</strong>
            </div>
          );
        })}
      </nav>

      {error ? (
        <div className="onboarding-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      ) : null}

      <section className="onboarding-workspace">
        {viewStep === "goals" ? (
          <form className="onboarding-stage onboarding-goals-stage" onSubmit={saveGoals}>
            <StageHeading
              eyebrow="01 · 目标与时间"
              title={needsSetupRecovery ? "补全你的复习约束" : isRevisingSetup ? "调整你的复习约束" : "先确定你的复习约束"}
              icon={<Target aria-hidden="true" size={22} />}
            />
            <ClassEnrollmentPanel
              busy={enrollmentBusy}
              enrollment={classEnrollment}
              error={enrollmentError}
              invitationCode={invitationCode}
              loading={enrollmentLoading}
              studentNumber={studentNumber}
              onCancel={() => void cancelEnrollment()}
              onInvitationCodeChange={setInvitationCode}
              onStudentNumberChange={setStudentNumber}
              onSubmit={() => void submitEnrollment()}
            />
            <div className="onboarding-form-grid">
              <label>
                <span>目标考试年份</span>
                <select value={targetExamYear} onChange={(event) => setTargetExamYear(Number(event.target.value))}>
                  {Array.from({ length: 5 }, (_, index) => nextYear + index).map((year) => (
                    <option value={year} key={year}>{year} 年</option>
                  ))}
                </select>
              </label>
              <label>
                <span>每日可用于 408 的时间</span>
                <select value={dailyMinutes} onChange={(event) => setDailyMinutes(Number(event.target.value))}>
                  {[30, 45, 60, 90, 120, 150, 180].map((minutes) => (
                    <option value={minutes} key={minutes}>{minutes} 分钟</option>
                  ))}
                </select>
              </label>
              <label>
                <span>目标院校（选填）</span>
                <input value={targetSchool} maxLength={120} onChange={(event) => setTargetSchool(event.target.value)} placeholder="例如：中国科学技术大学" />
              </label>
              <label>
                <span>目标专业课分数（选填）</span>
                <input value={targetScore} min={0} max={150} onChange={(event) => setTargetScore(event.target.value)} placeholder="0–150" type="number" />
              </label>
            </div>
            <fieldset className="onboarding-stage-options">
              <legend>当前备考阶段</legend>
              {STAGE_OPTIONS.map((option) => (
                <label className={preparationStage === option.value ? "is-selected" : ""} key={option.value}>
                  <input checked={preparationStage === option.value} name="preparation-stage" onChange={() => setPreparationStage(option.value)} type="radio" value={option.value} />
                  <span><strong>{option.label}</strong><small>{option.note}</small></span>
                </label>
              ))}
            </fieldset>
            {isRevisingSetup && state.status === "completed" ? (
              <button
                className="onboarding-subtle-action"
                onClick={() => {
                  setIsRevisingSetup(false);
                  setViewStep("plan");
                }}
                type="button"
              >
                返回当前路径
              </button>
            ) : null}
            <StageActions
              note={needsSetupRecovery || isRevisingSetup ? "已有学习记录会保留" : undefined}
              saving={saving}
              primaryLabel="保存并继续"
            />
          </form>
        ) : null}

        {viewStep === "self_assessment" ? (
          <form className="onboarding-stage" onSubmit={saveAssessments}>
            <StageHeading
              eyebrow="02 · 学习现状"
              title="四门课目前学到哪里"
              icon={<Compass aria-hidden="true" size={22} />}
            />
            <div className="onboarding-course-assessments">
              {COURSE_OPTIONS.map((course, index) => (
                <label key={course.id}>
                  <span className="onboarding-course-index">0{index + 1}</span>
                  <span><strong>{course.title}</strong></span>
                  <select
                    aria-label={`${course.title}自评`}
                    value={assessments[course.id]}
                    onChange={(event) => setAssessments((current) => ({
                      ...current,
                      [course.id]: event.target.value as OnboardingSelfAssessmentLevel,
                    }))}
                  >
                    {SELF_LEVELS.map((level) => <option value={level.value} key={level.value}>{level.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <StageActions saving={saving} primaryLabel="生成学习方向" />
          </form>
        ) : null}

        {viewStep === "diagnostic" ? (
          <DiagnosticStage
            diagnostic={diagnostic}
            diagnosticIndex={diagnosticIndex}
            diagnosticSelection={diagnosticSelection}
            loadError={diagnosticLoadError}
            loadStatus={diagnosticLoadStatus}
            unavailable={diagnosticUnavailable}
            saving={saving}
            onRetry={() => void loadDiagnostic()}
            onContinue={() => void continueWithoutDiagnostic()}
            onBack={() => setViewStep("self_assessment")}
            onSelectionChange={setDiagnosticSelection}
            onSubmit={submitDiagnosticAnswer}
          />
        ) : null}

        {viewStep === "profile" && !state.profile ? (
          <SetupRecoveryStage
            error={setupRecoveryError}
            status={setupRecoveryStatus}
            onRetry={() => void recoverIncompleteSetup()}
          />
        ) : null}

        {viewStep === "profile" && state.profile ? (
          <section className="onboarding-stage">
            <ProfileSummary profile={state.profile} />
            <div className="onboarding-profile-action">
              <button className="onboarding-primary-action" onClick={() => setViewStep("plan")} type="button">
                查看 7 日基础路径<ArrowRight aria-hidden="true" size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {viewStep === "plan" && state.profile && state.plan ? (
          <section className="onboarding-stage onboarding-plan-stage">
            <ProfileSummary profile={state.profile} compact />
            <LearningPlan
              onEdit={() => {
                setError(null);
                setIsRevisingSetup(true);
                setViewStep("goals");
              }}
              plan={state.plan}
            />
          </section>
        ) : null}
      </section>
    </main>
  );
}

function ClassEnrollmentPanel({
  busy,
  enrollment,
  error,
  invitationCode,
  loading,
  studentNumber,
  onCancel,
  onInvitationCodeChange,
  onStudentNumberChange,
  onSubmit,
}: {
  busy: boolean;
  enrollment: StudentClassEnrollmentStatus;
  error: string | null;
  invitationCode: string;
  loading: boolean;
  studentNumber: string;
  onCancel: () => void;
  onInvitationCodeChange: (value: string) => void;
  onStudentNumberChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const membership = enrollment.membership;
  const request = enrollment.request;
  const pending = request?.status === "pending";
  const approved = request?.status === "approved";

  return (
    <section className="onboarding-class-enrollment" aria-busy={loading || busy}>
      <header>
        <span aria-hidden="true"><UsersRound size={18} /></span>
        <div>
          <h2>加入老师班级</h2>
          <p>有老师发的邀请码时再填写；暂时不加入也可以继续学习设置。</p>
        </div>
      </header>

      {membership ? (
        <div className="onboarding-class-state is-joined">
          <strong>已加入 {membership.class_name}</strong>
          <span>{membership.cohort_year} 级 · {membership.major} · 学号 {membership.student_number}</span>
        </div>
      ) : pending ? (
        <div className="onboarding-class-state is-pending">
          <div>
            <strong>等待老师确认</strong>
            <span>{request.class_name} · {request.course_title} · 学号 {request.student_number}</span>
          </div>
          <button disabled={busy} onClick={onCancel} type="button">
            <X aria-hidden="true" size={15} />撤回申请
          </button>
        </div>
      ) : approved ? (
        <div className="onboarding-class-state is-pending">
          <strong>老师已确认，班级信息正在同步</strong>
          <span>{request.class_name} · {request.course_title}</span>
        </div>
      ) : (
        <div className="onboarding-class-fields">
          <label>
            <span>班级邀请码</span>
            <input
              autoComplete="off"
              disabled={busy}
              maxLength={16}
              onChange={(event) => onInvitationCodeChange(event.target.value)}
              placeholder="例如 ABCD-7K9M"
              value={invitationCode}
            />
          </label>
          <label>
            <span>学号</span>
            <input
              autoComplete="off"
              disabled={busy}
              inputMode="numeric"
              maxLength={10}
              onChange={(event) => onStudentNumberChange(event.target.value.replace(/\D/gu, ""))}
              placeholder="10 位学号"
              value={studentNumber}
            />
          </label>
          <button disabled={busy || loading} onClick={onSubmit} type="button">
            <UserPlus aria-hidden="true" size={16} />
            {busy ? "正在提交…" : "提交入班申请"}
          </button>
        </div>
      )}

      {request?.status === "rejected" ? (
        <p className="onboarding-class-note">上次申请未通过，请核对邀请码和学号后重新提交。</p>
      ) : null}
      {error ? <p className="onboarding-class-error" role="alert">{error}</p> : null}
    </section>
  );
}

function DiagnosticStage({
  diagnostic,
  diagnosticIndex,
  diagnosticSelection,
  loadError,
  loadStatus,
  unavailable,
  saving,
  onRetry,
  onContinue,
  onBack,
  onSelectionChange,
  onSubmit,
}: {
  diagnostic: OnboardingDiagnosticQuestionSetResponse | null;
  diagnosticIndex: number;
  diagnosticSelection: string[];
  loadError: string | null;
  loadStatus: "idle" | "loading" | "error" | "ready";
  unavailable: boolean;
  saving: boolean;
  onRetry: () => void;
  onContinue: () => void;
  onBack: () => void;
  onSelectionChange: (optionIds: string[]) => void;
  onSubmit: (responseStatus: OnboardingDiagnosticAnswer["response_status"]) => void;
}) {
  if (!diagnostic) {
    if (loadStatus === "error") {
      return (
        <section className={`onboarding-stage onboarding-inline-loading ${unavailable ? "is-unavailable" : "is-error"}`}>
          <h1>{unavailable ? "起步筛查暂未开放" : "起步筛查暂时无法加载"}</h1>
          <p role={unavailable ? "status" : "alert"}>{unavailable
            ? "你可以先根据课程自评生成 7 日学习计划，开始课程学习。"
            : loadError ?? "题组暂时不可用，请稍后重试。"}</p>
          <div className="onboarding-question-actions">
            <button className="onboarding-subtle-action" disabled={saving} onClick={onBack} type="button">返回课程自评</button>
            <button className={unavailable ? "onboarding-subtle-action" : "onboarding-primary-action"} disabled={saving} onClick={onRetry} type="button">
              <RotateCcw aria-hidden="true" size={17} />重新加载题组
            </button>
            {unavailable ? (
              <button className="onboarding-primary-action" disabled={saving} onClick={onContinue} type="button">
                {saving ? "正在生成…" : "先生成学习计划"}<ArrowRight aria-hidden="true" size={17} />
              </button>
            ) : null}
          </div>
        </section>
      );
    }
    return (
      <section className="onboarding-stage onboarding-inline-loading" aria-busy="true">
        <LoaderCircle className="onboarding-spin" aria-hidden="true" size={24} />
        <p>正在准备起步筛查题组…</p>
      </section>
    );
  }
  const item = diagnostic.items[diagnosticIndex];
  if (!item) return null;
  const isLast = diagnosticIndex === diagnostic.items.length - 1;
  const selected = new Set(diagnosticSelection);
  const toggleOption = (optionId: string) => {
    if (item.question.multiple) {
      onSelectionChange(selected.has(optionId)
        ? diagnosticSelection.filter((value) => value !== optionId)
        : [...diagnosticSelection, optionId]);
    } else {
      onSelectionChange([optionId]);
    }
  };
  return (
    <section className="onboarding-stage">
      <StageHeading
        eyebrow="03 · 起步筛查"
        title="完成 8 题起步筛查"
        icon={<Compass aria-hidden="true" size={22} />}
      />
      <div className="onboarding-question-layout">
        <article className="onboarding-question">
          <div className="onboarding-question-meta">
            <span>{item.course_title}</span>
            <span>第 {diagnosticIndex + 1} / {diagnostic.items.length} 题</span>
            <span>{item.question.multiple ? "多选题" : "单选题"}</span>
          </div>
          <h2>{item.question.question}</h2>
          {item.question.multiple ? <p className="onboarding-multiple-note">可选择多个答案</p> : null}
          <div className="onboarding-options">
            {item.question.options.map((option, index) => (
              <label className={selected.has(option.option_id) ? "is-selected" : ""} key={option.option_id}>
                <input
                  checked={selected.has(option.option_id)}
                  name={`diagnostic-${item.question.id}`}
                  onChange={() => toggleOption(option.option_id)}
                  type={item.question.multiple ? "checkbox" : "radio"}
                  value={option.option_id}
                />
                <span className="onboarding-option-key">{String.fromCharCode(65 + index)}</span>
                <span>{option.text}</span>
              </label>
            ))}
          </div>
          <div className="onboarding-question-actions">
            <button className="onboarding-subtle-action" disabled={saving} onClick={() => onSubmit("unsure")} type="button">不确定</button>
            <button className="onboarding-subtle-action" disabled={saving} onClick={() => onSubmit("skipped")} type="button">跳过</button>
            <button className="onboarding-primary-action" disabled={saving} onClick={() => onSubmit("answered")} type="button">
              {saving ? "正在保存…" : isLast ? "完成起步筛查" : "保存并下一题"}
              {saving ? <LoaderCircle className="onboarding-spin" aria-hidden="true" size={16} /> : <ArrowRight aria-hidden="true" size={17} />}
            </button>
          </div>
        </article>
        <aside className="onboarding-diagnostic-rail">
          <strong>筛查进度</strong>
          <div className="onboarding-question-dots" aria-label="起步筛查进度">
            {diagnostic.items.map((question, index) => (
              <span
                className={index === diagnosticIndex ? "is-current" : question.response_status !== null || index < diagnosticIndex ? "is-complete" : ""}
                key={question.question.id}
              >
                {index + 1}
              </span>
            ))}
          </div>
          <p>已保存 {Math.max(diagnostic.summary.saved_count, diagnosticIndex)} / 8</p>
        </aside>
      </div>
    </section>
  );
}

function SetupRecoveryStage({
  error,
  status,
  onRetry,
}: {
  error: string | null;
  status: "idle" | "loading" | "error" | "ready";
  onRetry: () => void;
}) {
  if (status === "error") {
    return (
      <section className="onboarding-stage onboarding-inline-loading is-error">
        <h1>学习方向暂时没有生成</h1>
        <p role="alert">{error ?? "已有设置已保存，可以重新生成。"}</p>
        <button className="onboarding-primary-action" onClick={onRetry} type="button">
          <RotateCcw aria-hidden="true" size={17} />重新生成学习方向
        </button>
      </section>
    );
  }
  return (
    <section className="onboarding-stage onboarding-inline-loading" aria-busy="true">
      <LoaderCircle className="onboarding-spin" aria-hidden="true" size={24} />
      <p>正在恢复你的学习方向和 7 日路径…</p>
    </section>
  );
}

function StageHeading({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
}) {
  return (
    <header className="onboarding-stage-heading">
      <span className="onboarding-stage-icon">{icon}</span>
      <div><span>{eyebrow}</span><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
    </header>
  );
}

function StageActions({
  note,
  saving,
  primaryLabel,
}: {
  note?: string | undefined;
  saving: boolean;
  primaryLabel: string;
}) {
  return (
    <div className="onboarding-stage-actions">
      {note ? <span>{note}</span> : null}
      <button className="onboarding-primary-action" disabled={saving} type="submit">
        {saving ? "正在保存…" : primaryLabel}<ArrowRight aria-hidden="true" size={17} />
      </button>
    </div>
  );
}

function ProfileSummary({ profile, compact = false }: { profile: OnboardingInitialProfile; compact?: boolean }) {
  return (
    <div className={compact ? "onboarding-profile is-compact" : "onboarding-profile"}>
      <header className="onboarding-profile-heading">
        <div>
          <span>04 · 课程起步顺序</span>
          <h1>初始学习方向</h1>
        </div>
        <div className="onboarding-evidence-counts">
          <span><strong>学习记录</strong><small>{profile.objective_evidence_count} 条</small></span>
          <span><strong>{profile.subjective_evidence_count} 门课程</strong><small>已完成课程自评</small></span>
          {profile.screening ? (
            <span>
              <strong>8 道起步筛查</strong>
              <small>已找到 {profile.screening.risk_concepts.length} 个先复习知识点</small>
            </span>
          ) : null}
        </div>
      </header>
      <div className="onboarding-priorities">
        {profile.priority_courses.map((course, index) => (
          <article key={course.course_id}>
            <span className="onboarding-priority-order">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <span>{PRIORITY_LABELS[course.priority]}</span>
              <h2>{course.course_title}</h2>
              <p>{compactStartingRationale(course.rationale)}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function LearningPlan({ onEdit, plan }: { onEdit: () => void; plan: OnboardingLearningPlan }) {
  const todayTask = plan.tasks.find((task) => task.task_id === plan.today_task_id) ?? plan.tasks[0];
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      tasks: plan.tasks.filter((task) => task.day_index === index + 1),
    })),
    [plan.tasks],
  );
  return (
    <div className="onboarding-plan">
      <header className="onboarding-plan-heading">
        <div><span>05 · 从今天开始</span><h1>7 日基础路径</h1><p>每天任务总时长不超过你设置的 {plan.daily_minutes} 分钟。</p></div>
        <div className="onboarding-plan-actions">
          <button className="onboarding-plan-edit" onClick={onEdit} type="button">调整学习设置</button>
        </div>
      </header>
      {todayTask ? (
        <section className="onboarding-today-task">
          <div>
            <span>今日第一项任务 · {todayTask.course_title}</span>
            <h2>{todayTask.title}</h2>
            <p>{todayTask.reason}</p>
            <small><Clock3 aria-hidden="true" size={15} />约 {todayTask.estimated_minutes} 分钟 · {todayTask.completion_criteria}</small>
          </div>
          <Link className="onboarding-primary-action" to={todayTask.href}>
            开始今天的第一项任务<ArrowRight aria-hidden="true" size={17} />
          </Link>
        </section>
      ) : null}
      <div className="onboarding-seven-days">
        {days.map(({ day, tasks }) => (
          <article className={day === 1 ? "is-today" : ""} key={day}>
            <header><span>DAY {String(day).padStart(2, "0")}</span><strong>{day === 1 ? "今天" : `第 ${day} 天`}</strong></header>
            <div>
              {tasks.map((task) => (
                <p key={task.task_id}>
                  <span>{TASK_TYPE_LABELS[task.task_type]}</span>
                  <strong>{task.title}</strong>
                  <small>{task.estimated_minutes} 分钟</small>
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
