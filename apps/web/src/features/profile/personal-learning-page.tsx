import type {
  MistakeRecommendation,
  OnboardingState,
  PersonalLearningCourse,
  PersonalLearningDashboard,
  PersonalLearningDimensionKey,
  PracticeMistakeRecord,
  StudentProfileWorkflowResponse,
} from "@xuetu/contracts";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  HeartHandshake,
  KeyRound,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  getPersonalLearningDashboard,
  getStudentOnboardingState,
  getStudentCarePreference,
  getStudentMistakeRecommendations,
  runStudentProfileWorkflow,
  updateStudentCarePreference,
} from "../../api/client";
import { CourseLearningRadar } from "./course-learning-radar";
import { compactStartingRationale } from "../onboarding/starting-direction-copy";
import { useAiPreferences } from "../ai/ai-preferences-context";

const COURSE_ROUTES: Record<string, string> = {
  course_408_ds: "/student/courses/data-structures",
  course_408_co: "/student/courses/computer-organization",
  course_408_os: "/student/courses/operating-systems",
  course_408_cn: "/student/courses/computer-networks",
};

const COURSE_SUBJECTS: Record<string, string> = {
  course_408_ds: "数据结构",
  course_408_co: "计算机组成原理",
  course_408_os: "操作系统",
  course_408_cn: "计算机网络",
};

const STARTING_PRIORITY_LABELS = {
  focus: "优先开始",
  strengthen: "随后巩固",
  maintain: "保持节奏",
} as const;

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function practiceHref(course: PersonalLearningCourse) {
  const params = new URLSearchParams({
    subject: COURSE_SUBJECTS[course.course_id] ?? course.title,
  });
  const priorityConcept = course.priority_concept;
  if (priorityConcept && (priorityConcept.practice_question_count ?? 0) > 0) {
    params.set("concept_id", priorityConcept.concept_id);
  }
  return `/student/practice?${params.toString()}`;
}

function mistakePracticeHref(course: PersonalLearningCourse, mistake: PracticeMistakeRecord) {
  const params = new URLSearchParams({
    mode: "mistake_review",
    subject: COURSE_SUBJECTS[course.course_id] ?? course.title,
  });
  if (mistake.concept_id) params.set("concept_id", mistake.concept_id);
  params.set("question_id", mistake.question_id);
  return `/student/practice?${params.toString()}`;
}

function initialCourse(courses: PersonalLearningCourse[]) {
  return courses.find((course) => course.needs_review_count > 0)
    ?? courses.find((course) => course.practice_attempt_count > 0)
    ?? courses.find((course) => course.started_concept_count > 0)
    ?? courses[0]
    ?? null;
}

function hasReliablePriorityPractice(course: PersonalLearningCourse) {
  return (course.priority_concept?.practice_question_count ?? 0) > 0;
}

function courseHref(course: PersonalLearningCourse) {
  return COURSE_ROUTES[course.course_id] ?? "/student/courses";
}

function nextActionHref(course: PersonalLearningCourse) {
  if (course.next_action.kind === "review_mistakes") return "/student/mistakes";
  if (course.next_action.kind === "practice_concept") return practiceHref(course);
  return courseHref(course);
}

export function PersonalLearningPage() {
  const aiPreferences = useAiPreferences();
  const aiEnabled = aiPreferences.status === "ready" && aiPreferences.preferences.collaboration_enabled;
  const [dashboard, setDashboard] = useState<PersonalLearningDashboard | null>(null);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [priorityRecommendation, setPriorityRecommendation] = useState<MistakeRecommendation | null>(null);
  const [priorityRecommendationUnavailable, setPriorityRecommendationUnavailable] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedDimensionKey, setSelectedDimensionKey] = useState<PersonalLearningDimensionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [profileInterpretation, setProfileInterpretation] = useState<StudentProfileWorkflowResponse | null>(null);
  const [profileInterpretationLoading, setProfileInterpretationLoading] = useState(false);
  const [profileInterpretationError, setProfileInterpretationError] = useState(false);
  const [profileInterpretationRequestKey, setProfileInterpretationRequestKey] = useState<number | null>(null);
  const [carePreferenceEnabled, setCarePreferenceEnabled] = useState<boolean | null>(null);
  const [carePreferenceSaving, setCarePreferenceSaving] = useState(false);
  const [carePreferenceMessage, setCarePreferenceMessage] = useState<string | null>(null);
  const [carePreferenceError, setCarePreferenceError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDashboard(null);
    setOnboardingState(null);
    setPriorityRecommendation(null);
    setPriorityRecommendationUnavailable(false);
    setError(null);
    getPersonalLearningDashboard()
      .then((result) => {
        if (!active) return;
        setDashboard(result);
        const startingCourse = initialCourse(result.courses);
        setSelectedCourseId(startingCourse?.course_id ?? null);
        setSelectedDimensionKey(
          startingCourse?.priority_dimension_key ?? startingCourse?.dimensions[0]?.key ?? null,
        );
      })
      .catch(() => {
        if (active) setError("学习数据暂时无法读取，请稍后重试。");
      });
    getStudentMistakeRecommendations({ limit: 1 })
      .then((result) => {
        if (active) setPriorityRecommendation(result.items[0] ?? null);
      })
      .catch(() => {
        if (active) setPriorityRecommendationUnavailable(true);
      });
    return () => { active = false; };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    getStudentOnboardingState()
      .then((result) => {
        if (active) setOnboardingState(result);
      })
      .catch(() => {
        if (active) setOnboardingState(null);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    setCarePreferenceEnabled(null);
    setCarePreferenceMessage(null);
    setCarePreferenceError(null);
    getStudentCarePreference()
      .then((result) => {
        if (active) setCarePreferenceEnabled(result.enabled);
      })
      .catch(() => {
        if (active) setCarePreferenceEnabled(null);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (profileInterpretationRequestKey === null || !selectedCourseId || !aiEnabled) {
      setProfileInterpretationLoading(false);
      return;
    }
    let active = true;
    setProfileInterpretationLoading(true);
    setProfileInterpretationError(false);
    setProfileInterpretation(null);
    runStudentProfileWorkflow(selectedCourseId)
      .then((result) => {
        if (!active) return;
        setProfileInterpretation(result);
        setProfileInterpretationLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setProfileInterpretation(null);
        setProfileInterpretationLoading(false);
        setProfileInterpretationError(true);
      });
    return () => { active = false; };
  }, [aiEnabled, profileInterpretationRequestKey, selectedCourseId]);

  const selectedCourse = useMemo(
    () => dashboard?.courses.find((course) => course.course_id === selectedCourseId) ?? null,
    [dashboard, selectedCourseId],
  );
  const selectedDimension = useMemo(
    () => selectedCourse?.dimensions.find((dimension) => dimension.key === selectedDimensionKey)
      ?? selectedCourse?.dimensions[0]
      ?? null,
    [selectedCourse, selectedDimensionKey],
  );
  const deterministicStrength = selectedCourse?.dimensions.find(
    (dimension) => dimension.key === selectedCourse.strongest_dimension_key,
  ) ?? null;
  const deterministicPriority = selectedCourse?.dimensions.find(
    (dimension) => dimension.key === selectedCourse.priority_dimension_key,
  ) ?? null;
  const performanceLabel = deterministicStrength?.key === "answer_accuracy" && deterministicStrength.score !== null
    ? `作答准确率 ${deterministicStrength.score}%`
    : deterministicStrength?.label ?? "待积累";
  const aiStrength = profileInterpretation?.strengths.find(
    (item) => item.course_id === selectedCourseId,
  ) ?? null;
  const aiPriorityGap = profileInterpretation?.priority_gaps.find(
    (item) => item.course_id === selectedCourseId,
  ) ?? null;
  const aiNextTask = profileInterpretation?.next_tasks.find(
    (item) => item.course_id === selectedCourseId,
  ) ?? null;
  const hasStructuredProfileSelection = Boolean(aiStrength || aiPriorityGap || aiNextTask);
  const startingProfile = onboardingState?.profile ?? null;

  async function toggleCarePreference() {
    if (carePreferenceEnabled === null || carePreferenceSaving) return;
    const enabled = !carePreferenceEnabled;
    setCarePreferenceSaving(true);
    setCarePreferenceMessage(null);
    setCarePreferenceError(null);
    try {
      const result = await updateStudentCarePreference(enabled);
      setCarePreferenceEnabled(result.enabled);
      setCarePreferenceMessage(
        result.enabled
          ? "主动关怀提醒已开启。"
          : "主动关怀提醒已关闭。",
      );
    } catch {
      setCarePreferenceError("关怀提醒设置暂时没有保存，请稍后重试。");
    } finally {
      setCarePreferenceSaving(false);
    }
  }

  if (error) {
    return (
      <div className="page-inner page-surface personal-learning-page page-error" data-visual-system="ochre-serif" role="alert">
        <CircleAlert aria-hidden="true" size={22} />
        <strong>{error}</strong>
        <button onClick={() => setReloadKey((value) => value + 1)} type="button">重新读取</button>
      </div>
    );
  }
  if (!dashboard) {
    return <div className="page-inner page-surface personal-learning-page page-loading" data-visual-system="ochre-serif" role="status">正在汇总你的学习记录…</div>;
  }

  return (
    <div className="page-inner page-surface personal-learning-page learning-overview" data-visual-system="ochre-serif">
      <header className="personal-learning-header">
        <div>
          <h1>我的学习</h1>
        </div>
        <div className="personal-header-actions">
          <span><ShieldCheck aria-hidden="true" size={14} /> 更新于 {formatUpdatedAt(dashboard.generated_at)}</span>
          <Link to="/student/account?tab=account"><KeyRound aria-hidden="true" size={15} />账户与安全</Link>
        </div>
      </header>

      <section aria-label="个人学习总览" className="learning-stat-cards">
        <div><span><BookOpen size={17} />已开始知识点</span><strong>{dashboard.totals.started_concept_count}<small> / {dashboard.totals.concept_count}</small></strong><p>已读或已练的知识点</p></div>
        <div><span><CheckCircle2 size={17} />选择题作答</span><strong>{dashboard.totals.practice_attempt_count}</strong><p>{dashboard.totals.correct_count} 对 / {dashboard.totals.incorrect_count} 错</p></div>
        <div><span><RotateCcw size={17} />待复习知识点</span><strong>{dashboard.totals.needs_review_count}</strong><p>来自你的待复习错题</p></div>
        <div><span><Target size={17} />课程范围</span><strong>{dashboard.totals.course_count}</strong><p>408 核心课程</p></div>
      </section>

      <div className="learning-preference-row">

      {carePreferenceEnabled !== null ? (
        <section aria-label="关怀提醒设置" className="personal-care-preference">
          <div>
            <HeartHandshake aria-hidden="true" size={18} />
            <span>
              <strong>主动关怀提醒</strong>
            </span>
          </div>
          <button
            aria-checked={carePreferenceEnabled}
            aria-label="主动关怀提醒"
            disabled={carePreferenceSaving}
            onClick={() => void toggleCarePreference()}
            role="switch"
            type="button"
          >
            <span aria-hidden="true" className="personal-care-switch-track"><i /></span>
            <span>{carePreferenceEnabled ? "已开启" : "已关闭"}</span>
          </button>
          {carePreferenceEnabled ? (
            <p className="personal-care-status" role="status">
              {carePreferenceMessage ? <span>{carePreferenceMessage}</span> : null}
              <Link
                aria-label="体验关怀互动"
                className="personal-care-preview-link"
                to="/student/home?care_preview=1"
                title="打开关怀互动"
              >
                <HeartHandshake aria-hidden="true" size={14} />体验关怀互动 <ArrowRight aria-hidden="true" size={13} />
              </Link>
            </p>
          ) : carePreferenceMessage ? <p role="status">{carePreferenceMessage}</p> : null}
          {carePreferenceError ? <p className="is-error" role="status">{carePreferenceError}</p> : null}
        </section>
      ) : null}

      {startingProfile ? (
        <section aria-label="起步学习方向" className="personal-starting-direction">
          <details>
          <summary className="personal-starting-direction-header">
            <h2>起步学习方向</h2>
            <span>查看起步自评</span>
          </summary>
          <ol className="personal-starting-direction-list">
            {startingProfile.priority_courses.map((course) => (
              <li key={course.course_id}>
                <span className="personal-starting-direction-order" aria-hidden="true" />
                <div>
                  <strong>{course.course_title}</strong>
                  <small>{STARTING_PRIORITY_LABELS[course.priority]} · {compactStartingRationale(course.rationale)}</small>
                </div>
              </li>
            ))}
          </ol>
          </details>
        </section>
      ) : null}
      </div>

      <nav aria-label="切换课程画像" className="learning-course-tabs">
        {dashboard.courses.map((course) => <button aria-pressed={selectedCourseId === course.course_id} key={course.course_id} type="button" onClick={() => {
          setProfileInterpretation(null); setProfileInterpretationError(false); setProfileInterpretationLoading(false); setProfileInterpretationRequestKey(null);
          setSelectedCourseId(course.course_id); setSelectedDimensionKey(course.priority_dimension_key ?? course.dimensions[0]?.key ?? null);
        }}><strong>{course.title}</strong><span>{course.started_concept_count}/{course.concept_count} 已开始</span></button>)}
      </nav>

      {selectedCourse ? (
        <section aria-label="当前学习画像" className="learning-focus-card">

          <div className="learning-focus-heading">
            <div><span>当前学习重点</span><h2>{selectedCourse.title}</h2></div>
            <p>
              {selectedCourse.evidence_level === "none"
                ? "画像正在形成"
                : selectedCourse.priority_concept
                  ? `先巩固“${selectedCourse.priority_concept.title}”。`
                  : "继续完成课程阅读和练习。"}
            </p>
          </div>

          <div className="learning-focus-grid">
            <section>
              <span><CheckCircle2 aria-hidden="true" size={15} />当前表现</span>
              <strong>{performanceLabel}</strong>
              {deterministicStrength?.explanation ? <p>{deterministicStrength.explanation}</p> : null}
            </section>
            <section>
              <span><Target aria-hidden="true" size={15} />优先补强</span>
              <strong>{deterministicPriority?.label ?? "待积累"}</strong>
              {deterministicPriority?.recommendation ? <p>{deterministicPriority.recommendation}</p> : null}
            </section>
            <section className="learning-focus-action">
              <span><ArrowRight aria-hidden="true" size={15} />下一步</span>
              <strong>{selectedCourse.next_action.label}</strong>
              <Link to={nextActionHref(selectedCourse)}>开始这一项<ArrowRight aria-hidden="true" size={15} /></Link>
            </section>
          </div>

          <section aria-label="学习解读" className="personal-profile-ai-supplement">
            <details>
              <summary>
                <span><Sparkles aria-hidden="true" size={15} />学习解读</span>
              </summary>
              <div className="personal-profile-ai-body">
                {!aiEnabled ? <p className="ai-workflow-disabled">{aiPreferences.status === "loading" ? "正在读取学习偏好…" : aiPreferences.status === "error" ? "请先检查 AI 学习设置。" : "AI 多智能体协作已关闭。"}<Link to="/student/account">前往设置</Link></p> : profileInterpretationLoading ? (
                  <p className="personal-profile-interpretation-status" role="status">正在整理学习情况…</p>
                ) : profileInterpretationError ? (
                  <div className="personal-profile-interpretation-status is-error" role="status">
                    <span>学习解读暂时无法生成，请稍后重试。</span>
                    <button onClick={() => setProfileInterpretationRequestKey((value) => (value ?? 0) + 1)} type="button">重试学习解读</button>
                  </div>
                ) : profileInterpretation?.status === "ready" ? (
                  <div className="personal-profile-interpretation-ready">
                    <p className="personal-profile-interpretation-summary">{profileInterpretation.profile_summary}</p>
                    {!hasStructuredProfileSelection ? (
                      <p className="personal-profile-interpretation-status" role="status">
                        详细建议暂未生成，请先按上方学习安排继续。
                      </p>
                    ) : (
                      <div className="personal-profile-ai-observations">
                        {aiStrength ? <p><strong>优势解释</strong>{aiStrength.title}：{aiStrength.detail}</p> : null}
                        {aiPriorityGap ? <p><strong>补强解释</strong>{aiPriorityGap.title}：{aiPriorityGap.detail}</p> : null}
                        {aiNextTask ? (
                          <p>
                            <strong>补充建议</strong>
                            {aiNextTask.title}：{aiNextTask.reason}
                            （约 {aiNextTask.estimated_minutes} 分钟）
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : profileInterpretation ? (
                  <div className="personal-profile-interpretation-status" role="status">
                    <span>学习解读暂时无法生成，请稍后重试。</span>
                    {profileInterpretation.failure?.retryable ? (
                      <button onClick={() => setProfileInterpretationRequestKey((value) => (value ?? 0) + 1)} type="button">重试学习解读</button>
                    ) : null}
                  </div>
                ) : (
                  <div className="personal-profile-ai-prompt">
                    <button onClick={() => setProfileInterpretationRequestKey(1)} type="button">
                      <Sparkles aria-hidden="true" size={15} />生成学习解读
                    </button>
                  </div>
                )}
              </div>
            </details>
          </section>
        </section>
      ) : null}

      {priorityRecommendation ? (
        <section className="personal-priority-callout" aria-label="建议先练">
          <div>
            <span>建议先练</span>
            <strong>{priorityRecommendation.course_title} · {priorityRecommendation.concept_title}</strong>
            <small>{priorityRecommendation.reason_lines.slice(0, 2).join(" · ")}</small>
          </div>
          <Link to={priorityRecommendation.practice_href}>复习第 {priorityRecommendation.question_number} 题<ArrowRight aria-hidden="true" size={15} /></Link>
        </section>
      ) : priorityRecommendationUnavailable ? (
        <p className="personal-priority-unavailable" role="status">优先排序暂时不可用，学习概览仍可继续使用。</p>
      ) : null}

      {dashboard.courses.length === 0 ? (
        <section className="empty-state">
          <h2>还没有可展示的课程记录</h2>
          <Link className="primary-button" to="/student/courses">查看课程</Link>
        </section>
      ) : (
        <>
          {selectedCourse && selectedDimension ? (
            <>
              <section aria-label={`${selectedCourse.title}学习画像`} className="learning-radar-workspace">
                <div className="personal-radar-panel">
                  <header>
                    <div><h2>{selectedCourse.title}学习画像</h2></div>
                  </header>
                  <CourseLearningRadar
                    courseTitle={selectedCourse.title}
                    dimensions={selectedCourse.dimensions}
                    onSelect={setSelectedDimensionKey}
                    selectedKey={selectedDimensionKey}
                  />
                </div>

                <aside className="personal-diagnosis-panel">
                  {selectedCourse.evidence_level === "none" ? (
                    <div className="personal-no-evidence">
                      <BookOpen aria-hidden="true" size={20} />
                      <span>当前判断</span>
                      <h2>先开始这门课程</h2>
                    </div>
                  ) : null}

                  <section aria-live="polite" className="personal-dimension-detail">
                    <header><span>维度解读</span><strong>{selectedDimension.label}</strong></header>
                    <div><b>{selectedDimension.score === null ? "待积累" : `${selectedDimension.score}%`}</b><small>{selectedDimension.evidence_count} 条相关记录</small></div>
                    <div className="dimension-progress" aria-hidden="true"><span style={{ width: `${selectedDimension.score ?? 0}%` }} /></div>
                    <p>{selectedDimension.explanation}</p>
                    <div className="dimension-next-step"><Target size={18} /><div><strong>怎么继续</strong><p>{selectedDimension.recommendation}</p></div></div>
                  </section>
                </aside>
              </section>

              <section aria-label="下一步学习行动" className="learning-action-row">
                <div><h2>继续学习</h2></div>
                <div>
                  <Link to={courseHref(selectedCourse)}><BookOpen aria-hidden="true" size={15} />继续课程</Link>
                  {selectedCourse.priority_concept ? (
                    <Link to={practiceHref(selectedCourse)}>
                      <Target aria-hidden="true" size={15} />
                      {hasReliablePriorityPractice(selectedCourse) ? "练习薄弱知识点" : "进入课程综合训练"}
                    </Link>
                  ) : null}
                </div>
              </section>

              <div className="personal-review-grid">
                <section className="personal-priority-concept">
                  <header><div><h2>当前优先知识点</h2></div><Link to={courseHref(selectedCourse)}>查看课程</Link></header>
                  {selectedCourse.priority_concept ? (
                    <div>
                      <span data-status={selectedCourse.priority_concept.status}>待处理</span>
                      <h3>{selectedCourse.priority_concept.title}</h3>
                      <p>{selectedCourse.priority_concept.attempt_count} 次作答 · {selectedCourse.priority_concept.correct_count} 对 / {selectedCourse.priority_concept.incorrect_count} 错</p>
                      <Link to={practiceHref(selectedCourse)}>
                        {hasReliablePriorityPractice(selectedCourse) ? "开始针对练习" : "进入课程综合训练"}
                        <ArrowRight aria-hidden="true" size={14} />
                      </Link>
                    </div>
                  ) : (
                    <div className="personal-section-empty"><BookOpen aria-hidden="true" size={18} /><strong>尚未形成优先知识点</strong></div>
                  )}
                </section>

                <section className="personal-recent-mistakes">
                  <header><div><h2>最近错题</h2></div><Link to="/student/mistakes">查看全部错题</Link></header>
                  {selectedCourse.recent_mistakes.length > 0 ? (
                    <ol>
                      {selectedCourse.recent_mistakes.map((mistake) => (
                        <li key={mistake.mistake_id}>
                          <span><RotateCcw aria-hidden="true" size={15} /></span>
                          <div><strong>{mistake.concept_title ?? `${selectedCourse.title}课程题目`}</strong><small>第 {mistake.question_number} 题 · {formatDate(mistake.updated_at)} · 错 {mistake.wrong_count} 次</small></div>
                          <Link aria-label={`重练${mistake.concept_title ?? "该知识点"}`} to={mistakePracticeHref(selectedCourse, mistake)}><ArrowRight aria-hidden="true" size={15} /></Link>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="personal-section-empty"><CheckCircle2 aria-hidden="true" size={18} /><strong>这门课暂时没有错题记录</strong></div>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
