import type {
  OnboardingState,
  PersonalLearningCourse,
  PersonalLearningDashboard,
  PersonalLearningDimensionKey,
} from "@xuetu/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getPersonalLearningDashboard: vi.fn(),
  getStudentOnboardingState: vi.fn(),
  getStudentMistakeRecommendations: vi.fn(),
  getStudentCarePreference: vi.fn(),
  getStudentCareStatus: vi.fn(),
  runStudentProfileWorkflow: vi.fn(),
  updateStudentCarePreference: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

import { PersonalLearningPage } from "./personal-learning-page";

const dimensionLabels: Record<PersonalLearningDimensionKey, string> = {
  knowledge_coverage: "知识覆盖",
  practice_coverage: "练习覆盖",
  answer_accuracy: "作答准确",
  mistake_recovery: "错题修复",
  mastery_stability: "掌握稳定",
};

function course(
  courseId: string,
  title: string,
  withEvidence: boolean,
): PersonalLearningCourse {
  const scores = withEvidence ? [75, 50, 67, 0, 50] : [0, 0, null, null, null];
  const keys = Object.keys(dimensionLabels) as PersonalLearningDimensionKey[];
  return {
    course_id: courseId,
    title,
    concept_count: 4,
    started_concept_count: withEvidence ? 3 : 0,
    practice_attempt_count: withEvidence ? 3 : 0,
    correct_count: withEvidence ? 2 : 0,
    incorrect_count: withEvidence ? 1 : 0,
    needs_review_count: withEvidence ? 1 : 0,
    mastered_count: 0,
    evidence_level: withEvidence ? "grounded" : "none",
    dimensions: keys.map((key, index) => ({
      key,
      label: dimensionLabels[key],
      score: scores[index] ?? null,
      evidence_count: withEvidence ? Math.max(1, index) : 0,
      evidence_level: withEvidence ? "limited" : "none",
      explanation: withEvidence ? `${dimensionLabels[key]}来自真实学习证据。` : "当前证据不足。",
      recommendation: `继续提升${dimensionLabels[key]}。`,
    })),
    strongest_dimension_key: withEvidence ? "knowledge_coverage" : null,
    priority_dimension_key: withEvidence ? "mistake_recovery" : null,
    priority_concept: withEvidence ? {
      concept_id: "ds_c02_02",
      title: "顺序表的存储表示",
      status: "needs_review",
      attempt_count: 3,
      correct_count: 2,
      incorrect_count: 1,
      mistake_count: 1,
      practice_question_count: 3,
    } : null,
    recent_mistakes: withEvidence ? [{
      mistake_id: "mistake_001",
      course_id: courseId,
      course_title: title,
      question_id: "2026-01",
      question_year: 2026,
      question_number: 1,
      subject: title,
      concept_id: "ds_c02_02",
      concept_title: "顺序表的存储表示",
      matched_tag: "顺序表",
      match_method: "exact_question_tag",
      first_incorrect_attempt_id: "attempt_001",
      last_incorrect_attempt_id: "attempt_001",
      last_incorrect_evaluation_id: "evaluation_001",
      wrong_count: 1,
      status: "needs_review",
      latest_attempt_outcome: "incorrect",
      first_incorrect_at: "2026-08-01T00:00:00.000Z",
      last_incorrect_at: "2026-08-02T00:00:00.000Z",
      mastered_at: null,
      updated_at: "2026-08-02T00:00:00.000Z",
    }] : [],
    next_action: withEvidence ? {
      kind: "review_mistakes",
      label: "复习 1 个待巩固知识点",
      concept_id: "ds_c02_02",
    } : {
      kind: "start_course",
      label: "从课程知识地图开始学习",
      concept_id: null,
    },
  };
}

const dashboard: PersonalLearningDashboard = {
  generated_at: "2026-08-07T00:00:00.000Z",
  totals: {
    course_count: 4,
    concept_count: 206,
    started_concept_count: 3,
    practice_attempt_count: 3,
    correct_count: 2,
    incorrect_count: 1,
    needs_review_count: 1,
  },
  courses: [
    course("course_408_ds", "数据结构", true),
    course("course_408_co", "计算机组成原理", false),
    course("course_408_os", "操作系统", false),
    course("course_408_cn", "计算机网络", false),
  ],
};

const onboardingStateWithProfile: OnboardingState = {
  status: "completed",
  current_step: "plan",
  goals: null,
  self_assessments: [],
  profile: {
    profile_id: "initial_profile_001",
    version: 1,
    confidence: "low",
    evidence_status: "accumulating",
    confidence_explanation: "目前只依据起步设置和筛查信号，正式学习记录正在积累。",
    generated_at: "2026-08-07T00:00:00.000Z",
    objective_evidence_count: 0,
    subjective_evidence_count: 4,
    priority_courses: [
      { course_id: "course_408_ds", course_title: "数据结构", priority: "focus", self_assessment: "weak", evidence_level: "screening_signal", evidence_refs: ["screening:q1"], rationale: "先从数据结构开始；这不是能力分。", screening_signal: "observed_gap" },
      { course_id: "course_408_co", course_title: "计算机组成原理", priority: "strengthen", self_assessment: "average", evidence_level: "self_report_only", evidence_refs: ["self_assessment:course_408_co"], rationale: "安排基础巩固。", screening_signal: "needs_evidence" },
      { course_id: "course_408_os", course_title: "操作系统", priority: "maintain", self_assessment: "good", evidence_level: "self_report_only", evidence_refs: ["self_assessment:course_408_os"], rationale: "保持当前节奏。", screening_signal: "none" },
      { course_id: "course_408_cn", course_title: "计算机网络", priority: "maintain", self_assessment: "good", evidence_level: "self_report_only", evidence_refs: ["self_assessment:course_408_cn"], rationale: "保持当前节奏。", screening_signal: "none" },
    ],
    boundary_note: "起步方向只用于安排第一次学习，不等同于正式能力评价。",
    screening: {
      status: "completed",
      answered_count: 8,
      correct_count: 5,
      incorrect_count: 3,
      unsure_count: 0,
      skipped_count: 0,
      risk_concepts: [],
    },
  },
  plan: null,
  diagnostic: { total_count: 8, saved_count: 8, completed_at: "2026-08-07T00:00:00.000Z" },
  updated_at: "2026-08-07T00:00:00.000Z",
};

describe("PersonalLearningPage", () => {
  beforeEach(() => {
    apiMocks.getPersonalLearningDashboard.mockReset().mockResolvedValue(dashboard);
    apiMocks.getStudentOnboardingState.mockReset().mockResolvedValue({
      ...onboardingStateWithProfile,
      profile: null,
    });
    apiMocks.getStudentMistakeRecommendations.mockReset().mockResolvedValue({ items: [] });
    apiMocks.getStudentCarePreference.mockReset().mockResolvedValue({
      enabled: true,
      updated_at: null,
    });
    apiMocks.getStudentCareStatus.mockReset().mockResolvedValue({
      kind: "none",
      preference_enabled: true,
    });
    apiMocks.updateStudentCarePreference.mockReset();
    apiMocks.runStudentProfileWorkflow.mockReset().mockResolvedValue({
      contract_version: "0.2",
      request_id: "profile_req_001",
      status: "unavailable",
      profile_summary: "AI 画像解读暂不可用，确定性画像仍可查看。",
      course_progress: [],
      strengths: [],
      priority_gaps: [],
      evidence_summary: {
        objective_evidence_count: 3,
        subjective_evidence_count: 4,
        reading_progress_count: 1,
        practice_attempt_count: 3,
        needs_review_count: 1,
        explanation: "画像只依据平台内真实学习记录和学习设置。",
      },
      next_tasks: [],
      failure: {
        code: "WORKFLOW_NOT_CONNECTED",
        message: "画像工作流尚未接入。",
        retryable: true,
        fallback_message: "雷达图、证据和课程入口仍可继续使用。",
      },
    });
  });

  it("shows a low-confidence starting direction when formal learning records are absent", async () => {
    const emptyDashboard = structuredClone(dashboard);
    emptyDashboard.totals = {
      ...emptyDashboard.totals,
      started_concept_count: 0,
      practice_attempt_count: 0,
      correct_count: 0,
      incorrect_count: 0,
      needs_review_count: 0,
    };
    emptyDashboard.courses = emptyDashboard.courses.map((item) => course(item.course_id, item.title, false));
    apiMocks.getPersonalLearningDashboard.mockResolvedValue(emptyDashboard);
    apiMocks.getStudentOnboardingState.mockResolvedValue(onboardingStateWithProfile);

    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    const startingDirection = await screen.findByRole("region", { name: "起步学习方向" });
    expect(within(startingDirection).getByText("数据结构")).toBeInTheDocument();
    expect(within(startingDirection).getByText("优先开始 · 先从数据结构开始。"))
      .toBeInTheDocument();
    expect(within(startingDirection).queryByText(/能力分|起步参考/)).not.toBeInTheDocument();
    expect(screen.queryByText("还没有课程学习记录。完成一个知识点或一道选择题后，这里会更新。"))
      .not.toBeInTheDocument();
  });

  it("keeps the starting direction separate after formal learning evidence appears", async () => {
    apiMocks.getStudentOnboardingState.mockResolvedValue(onboardingStateWithProfile);

    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    const startingDirection = await screen.findByRole("region", { name: "起步学习方向" });
    expect(within(startingDirection).queryByText(/初始参考|正式画像只看后续课程记录/))
      .not.toBeInTheDocument();
    expect(screen.getByText("选择题作答").nextElementSibling).toHaveTextContent("3");
  });

  it("keeps the learning dashboard available when the starting direction cannot load", async () => {
    apiMocks.getStudentOnboardingState.mockRejectedValue(new Error("offline"));

    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "我的学习" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "起步学习方向" })).not.toBeInTheDocument();
  });

  it("keeps the deterministic profile primary without calling the optional workflow", async () => {
    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    const summary = await screen.findByRole("region", { name: "当前学习画像" });
    expect(within(summary).getByText("数据结构")).toBeInTheDocument();
    expect(within(summary).queryByText("学习记录较完整")).not.toBeInTheDocument();
    expect(within(summary).getByText("知识覆盖")).toBeInTheDocument();
    expect(within(summary).getByText("错题修复")).toBeInTheDocument();
    expect(within(summary).getByRole("link", { name: "开始这一项" }))
      .toHaveAttribute("href", "/student/mistakes");
    expect(screen.queryByText(/EVIDENCE PROFILE|学习证据门槛|确定性学习记录|不是 AI 诊断/iu)).not.toBeInTheDocument();
    expect(apiMocks.runStudentProfileWorkflow).not.toHaveBeenCalled();
  });

  it("does not describe a low answer accuracy as an advantage", async () => {
    const lowAccuracy = structuredClone(dashboard);
    const first = lowAccuracy.courses[0]!;
    first.strongest_dimension_key = "answer_accuracy";
    first.practice_attempt_count = 15; first.correct_count = 3; first.incorrect_count = 12;
    first.dimensions.find((dimension) => dimension.key === "answer_accuracy")!.score = 20;
    apiMocks.getPersonalLearningDashboard.mockResolvedValue(lowAccuracy);
    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);
    const summary = await screen.findByRole("region", { name: "当前学习画像" });
    expect(within(summary).getByText("当前表现")).toBeInTheDocument();
    expect(within(summary).getByText("作答准确率 20%")).toBeInTheDocument();
    expect(screen.queryByText("当前优势")).not.toBeInTheDocument();
  });

  it("switches one evidence-based radar across all four 408 courses", async () => {
    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "我的学习" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /数据结构/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "数据结构课程学习画像" })).toBeInTheDocument();
    const dataStructuresProfile = screen.getByRole("region", { name: "数据结构学习画像" });
    expect(within(dataStructuresProfile).getByText("维度解读")).toBeInTheDocument();
    expect(within(dataStructuresProfile).getByText("0%", { selector: ".personal-dimension-detail b" })).toBeInTheDocument();
    expect(within(dataStructuresProfile).queryByText("当前表现")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /计算机网络/ }));

    expect(screen.getByRole("button", { name: /计算机网络/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "计算机网络课程学习画像" })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "当前学习画像" });
    expect(within(summary).getByText("计算机网络")).toBeInTheDocument();
    expect(within(summary).queryByText("记录待积累")).not.toBeInTheDocument();
    expect(within(summary).getByText("画像正在形成")).toBeInTheDocument();
    expect(screen.getAllByText("待积累").length).toBeGreaterThan(0);
    expect(screen.getByText("先开始这门课程")).toBeInTheDocument();
  });

  it("opens the course with actionable evidence instead of blindly selecting the first row", async () => {
    apiMocks.getPersonalLearningDashboard.mockResolvedValue({
      ...dashboard,
      courses: [
        course("course_408_co", "计算机组成原理", false),
        course("course_408_ds", "数据结构", true),
        course("course_408_os", "操作系统", false),
        course("course_408_cn", "计算机网络", false),
      ],
    });

    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    expect(await screen.findByRole("button", { name: /数据结构/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "数据结构课程学习画像" })).toBeInTheDocument();
  });

  it("connects the weak concept, recent mistake, full mistake book and account actions", async () => {
    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    expect((await screen.findAllByText("顺序表的存储表示")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /练习薄弱知识点/ })).toHaveAttribute(
      "href",
      "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02",
    );
    expect(screen.getByRole("link", { name: "查看全部错题" })).toHaveAttribute("href", "/student/mistakes");
    expect(screen.getByRole("link", { name: "重练顺序表的存储表示" })).toHaveAttribute(
      "href",
      "/student/practice?mode=mistake_review&subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=2026-01",
    );
    expect(screen.getByRole("link", { name: "账户与安全" })).toHaveAttribute("href", "/student/account?tab=account");
  });

  it("surfaces the highest-priority due mistake without replacing the learning dashboard", async () => {
    apiMocks.getStudentMistakeRecommendations.mockResolvedValue({
      algorithm_version: "evidence_weighted_v1",
      generated_at: "2026-08-16T00:00:00.000Z",
      items: [{
        mistake_id: "mistake_001", course_id: "course_408_ds", course_title: "数据结构",
        question_id: "2026-01", question_number: 1, concept_id: "ds_c02_02",
        concept_title: "顺序表的存储表示", priority_score: 92,
        algorithm_version: "evidence_weighted_v1", next_review_at: "2026-08-16T00:00:00.000Z",
        due_status: "due", evidence_level: "grounded", reason_lines: ["已到复习时间", "核心知识点"],
        evidence_refs: ["mistake:mistake_001"],
        practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=2026-01",
      }],
    });

    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "我的学习" })).toBeInTheDocument();
    expect(screen.getByText("建议先练")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "复习第 1 题" })).toHaveAttribute(
      "href",
      "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=2026-01",
    );
  });

  it("keeps the learning dashboard available when priority ranking cannot load", async () => {
    apiMocks.getStudentMistakeRecommendations.mockRejectedValue(new Error("offline"));
    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "我的学习" })).toBeInTheDocument();
    expect(screen.getByText("优先排序暂时不可用，学习概览仍可继续使用。")).toBeInTheDocument();
  });

  it("falls back to course-wide practice when the priority concept has no reliable question", async () => {
    const dashboardWithoutConceptPractice = structuredClone(dashboard);
    const dataStructures = dashboardWithoutConceptPractice.courses[0];
    if (!dataStructures?.priority_concept) throw new Error("expected a priority concept fixture");
    dataStructures.priority_concept.practice_question_count = 0;
    apiMocks.getPersonalLearningDashboard.mockResolvedValue(dashboardWithoutConceptPractice);

    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "我的学习" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "练习薄弱知识点" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "进入课程综合训练" })[0]).toHaveAttribute(
      "href",
      "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84",
    );
  });

  it("provides a retryable error instead of fabricated fallback scores", async () => {
    apiMocks.getPersonalLearningDashboard.mockRejectedValue(new Error("offline"));
    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    expect(await screen.findByRole("alert")).toHaveTextContent("学习数据暂时无法读取，请稍后重试。");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/API|PostgreSQL/iu);
    expect(screen.getByRole("button", { name: "重新读取" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows a compact source-bound interpretation without replacing the deterministic radar", async () => {
    apiMocks.runStudentProfileWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "profile_req_002",
      status: "ready",
      profile_summary: "你已开始建立知识覆盖，下一步优先修复错题证据。",
      course_progress: [],
      strengths: [{ course_id: "course_408_ds", title: "知识覆盖", detail: "数据结构已有阅读记录。", evidence_ids: ["reading:course_408_ds"] }],
      priority_gaps: [{ course_id: "course_408_ds", title: "错题修复", detail: "近期错误记录仍需回看。", evidence_ids: ["mistake:course_408_ds"] }],
      evidence_summary: {
        objective_evidence_count: 3,
        subjective_evidence_count: 4,
        reading_progress_count: 1,
        practice_attempt_count: 3,
        needs_review_count: 1,
        explanation: "仅依据当前账户的学习记录。",
      },
      next_tasks: [{
        title: "复习顺序表",
        reason: "先处理待复习证据。",
        course_id: "course_408_ds",
        concept_id: "ds_c02_02",
        estimated_minutes: 20,
        evidence_ids: ["mistake:course_408_ds"],
      }],
      failure: null,
    });

    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    await screen.findByRole("region", { name: "当前学习画像" });
    expect(apiMocks.runStudentProfileWorkflow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成学习解读" }));

    const aiSupplement = screen.getByRole("region", { name: "学习解读" });
    expect(await within(aiSupplement).findByText("你已开始建立知识覆盖，下一步优先修复错题证据。"))
      .toBeInTheDocument();
    expect(aiSupplement).toHaveTextContent("复习顺序表");
    expect(apiMocks.runStudentProfileWorkflow).toHaveBeenCalledTimes(1);
    expect(apiMocks.runStudentProfileWorkflow).toHaveBeenCalledWith("course_408_ds");
    expect(screen.getByRole("img", { name: "数据结构课程学习画像" })).toBeInTheDocument();
    expect(screen.queryByText("reading:course_408_co")).not.toBeInTheDocument();
    expect(aiSupplement).not.toHaveTextContent(/AI 补充解读|确定性画像|平台规则|服务未连接/iu);
  });

  it("does not present an upstream empty selection as an empty student portrait", async () => {
    apiMocks.runStudentProfileWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "profile_req_003",
      status: "ready",
      profile_summary: "画像摘要已生成，课程证据仍由平台规则维护。",
      course_progress: [],
      strengths: [],
      priority_gaps: [],
      evidence_summary: {
        objective_evidence_count: 3,
        subjective_evidence_count: 4,
        reading_progress_count: 1,
        practice_attempt_count: 3,
        needs_review_count: 1,
        explanation: "仅依据当前账户的学习记录。",
      },
      next_tasks: [],
      failure: null,
    });

    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    await screen.findByRole("region", { name: "当前学习画像" });
    fireEvent.click(screen.getByRole("button", { name: "生成学习解读" }));

    expect(await screen.findByText("画像摘要已生成，课程证据仍由平台规则维护。"))
      .toBeInTheDocument();
    expect(screen.getByText("详细建议暂未生成，请先按上方学习安排继续。"))
      .toBeInTheDocument();
    expect(screen.queryByText("证据正在形成")).not.toBeInTheDocument();
  });

  it("keeps a clear retry state when the profile workflow request fails", async () => {
    apiMocks.runStudentProfileWorkflow.mockRejectedValue(new Error("offline"));
    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    await screen.findByRole("region", { name: "当前学习画像" });
    expect(apiMocks.runStudentProfileWorkflow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成学习解读" }));

    const aiSupplement = screen.getByRole("region", { name: "学习解读" });
    expect(await within(aiSupplement).findByText("学习解读暂时无法生成，请稍后重试。"))
      .toBeInTheDocument();
    expect(within(aiSupplement).getByRole("button", { name: "重试学习解读" }))
      .toBeInTheDocument();
    expect(screen.getByRole("img", { name: "数据结构课程学习画像" })).toBeInTheDocument();
  });

  it("lets a student re-enable care reminders without sending profile evidence", async () => {
    apiMocks.getStudentCarePreference.mockResolvedValue({
      enabled: false,
      updated_at: "2026-08-21T08:00:00.000Z",
    });
    apiMocks.updateStudentCarePreference.mockResolvedValue({
      enabled: true,
      updated_at: "2026-08-21T08:05:00.000Z",
    });
    render(<MemoryRouter><PersonalLearningPage /></MemoryRouter>);

    const switchControl = await screen.findByRole("switch", { name: "主动关怀提醒" });
    expect(apiMocks.getStudentCarePreference).toHaveBeenCalledTimes(1);
    expect(apiMocks.getStudentCareStatus).not.toHaveBeenCalled();
    expect(switchControl).toHaveAttribute("aria-checked", "false");
    fireEvent.click(switchControl);

    await waitFor(() => expect(apiMocks.updateStudentCarePreference).toHaveBeenCalledWith(true));
    expect(switchControl).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/学习节奏明显变化/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "体验关怀互动" })).toHaveAttribute(
      "href",
      "/student/home?care_preview=1",
    );
  });
});
