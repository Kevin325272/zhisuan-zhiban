import type { OnboardingDiagnosticQuestionSetResponse, OnboardingState } from "@xuetu/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getState: vi.fn(),
  getDiagnostic: vi.fn(),
  saveGoals: vi.fn(),
  saveAssessments: vi.fn(),
  saveDiagnosticAnswer: vi.fn(),
  completeDiagnostic: vi.fn(),
  complete: vi.fn(),
  getEnrollment: vi.fn(),
  submitEnrollment: vi.fn(),
  cancelEnrollment: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  getStudentOnboardingState: api.getState,
  getStudentOnboardingDiagnosticQuestions: api.getDiagnostic,
  saveStudentOnboardingGoals: api.saveGoals,
  saveStudentOnboardingSelfAssessments: api.saveAssessments,
  saveStudentOnboardingDiagnosticAnswer: api.saveDiagnosticAnswer,
  completeStudentOnboardingDiagnostic: api.completeDiagnostic,
  completeStudentOnboarding: api.complete,
  getStudentClassEnrollmentStatus: api.getEnrollment,
  submitStudentClassEnrollmentRequest: api.submitEnrollment,
  cancelStudentClassEnrollmentRequest: api.cancelEnrollment,
}));

import { StudentOnboardingPage } from "./student-onboarding-page";
import { ApiError } from "../../api/client";

const courseIds = [
  "course_408_ds",
  "course_408_co",
  "course_408_os",
  "course_408_cn",
] as const;
const courseTitles = ["数据结构", "计算机组成原理", "操作系统", "计算机网络"];

function diagnosticQuestionSet(): OnboardingDiagnosticQuestionSetResponse {
  return {
    set_version: "408-v2",
    summary: { total_count: 8 as const, saved_count: 0, completed_at: null },
    items: Array.from({ length: 8 }, (_, index) => ({
      ordinal: index + 1,
      course_id: courseIds[Math.floor(index / 2)]!,
      course_title: courseTitles[Math.floor(index / 2)]!,
      response_status: null,
      selected_option_ids: [],
      question: {
        id: `question_${index + 1}`,
        year: 2025,
        number: index + 1,
        subject: courseTitles[Math.floor(index / 2)]!,
        type: "choice" as const,
        multiple: false,
        question: `第 ${index + 1} 道起步筛查题`,
        options: [
          { option_id: "A", text: "选项 A", assets: [] },
          { option_id: "B", text: "选项 B", assets: [] },
        ],
        tags: [],
        assets: [],
        content_format: "plain_text" as const,
        source: {
          provider: "test",
          dataset_id: "test",
          source_url: "https://example.com/question",
          license_status: "unverified" as const,
          usage_scope: "local_demo_only" as const,
        },
      },
    })),
  };
}

function state(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    status: "not_started",
    current_step: "goals",
    goals: null,
    self_assessments: [],
    profile: null,
    plan: null,
    updated_at: "2026-08-12T08:00:00.000Z",
    ...overrides,
  };
}

const completedState = state({
  status: "completed",
  current_step: "plan",
  goals: {
    target_exam_year: 2027,
    preparation_stage: "foundation",
    daily_minutes: 60,
    target_school: null,
    target_score: null,
    saved_at: "2026-08-12T08:01:00.000Z",
  },
  self_assessments: courseIds.map((course_id) => ({ course_id, level: "average" })),
  profile: {
    profile_id: "profile_1",
    version: 1,
    confidence: "low",
    evidence_status: "accumulating",
    confidence_explanation: "目前只依据学习设置形成起步方向，客观学习证据正在积累。",
    generated_at: "2026-08-12T08:02:00.000Z",
    objective_evidence_count: 0,
    subjective_evidence_count: 4,
    priority_courses: courseIds.map((course_id, index) => ({
      course_id,
      course_title: courseTitles[index]!,
      priority: index === 0 ? "focus" : index === 1 ? "strengthen" : "maintain",
      self_assessment: "average",
      evidence_level: "self_report_only",
      evidence_refs: [`self:${course_id}`],
      rationale: "当前仅依据学生自评安排起步顺序。",
    })),
    boundary_note: "这不是能力测评，不代表分数、排名、录取概率或提分效果。",
  },
  plan: {
    plan_id: "plan_1",
    version: 1,
    source: "deterministic_fallback",
    ai_status: "unavailable",
    ai_status_message: "个性化解释服务待连接，当前使用可验证基础路径。",
    start_date: "2026-08-12",
    daily_minutes: 60,
    generated_at: "2026-08-12T08:02:00.000Z",
    today_task_id: "task_1",
    tasks: Array.from({ length: 7 }, (_, index) => ({
      task_id: `task_${index + 1}`,
      day_index: index + 1,
      task_date: `2026-08-${String(12 + index).padStart(2, "0")}`,
      order: 1,
      course_id: courseIds[index % 4]!,
      course_title: courseTitles[index % 4]!,
      concept_id: index === 0 ? "ds_c03_01" : null,
      concept_title: index === 0 ? "栈的抽象与存储" : null,
      task_type: "course_reading",
      estimated_minutes: 45,
      title: index === 0 ? "理解栈的抽象与存储" : `第 ${index + 1} 天课程任务`,
      reason: "根据当前学习阶段和课程自评安排。",
      completion_criteria: "完成讲解并进入一次训练。",
      href: index === 0 ? "/student/courses/data-structures" : "/student/courses",
      evidence_refs: [`self:${courseIds[index % 4]}`],
      status: "pending",
    })),
  },
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/student/onboarding"]}>
      <Routes>
        <Route path="/student/onboarding" element={<StudentOnboardingPage />} />
        <Route path="/student/home" element={<p>student homepage</p>} />
        <Route path="/student/courses/data-structures" element={<p>today task destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StudentOnboardingPage", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getEnrollment.mockResolvedValue({ membership: null, request: null });
    api.cancelEnrollment.mockResolvedValue({ cancelled: true });
  });

  it("offers a self-assessment plan when the server confirms the screening is unavailable", async () => {
    api.getState.mockResolvedValue(state({ status: "in_progress", current_step: "diagnostic", goals: completedState.goals, self_assessments: completedState.self_assessments }));
    api.getDiagnostic.mockRejectedValue(new ApiError("题组不可用", "ONBOARDING_DIAGNOSTIC_UNAVAILABLE", true, {}));
    api.complete.mockResolvedValue(completedState);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "先生成学习计划" }));
    expect(await screen.findByText("初始学习方向")).toBeInTheDocument();
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(api.completeDiagnostic).not.toHaveBeenCalled();
    expect(api.saveDiagnosticAnswer).not.toHaveBeenCalled();
    expect(screen.getByText("起步筛查 · 暂未进行")).toBeInTheDocument();
  });

  it("does not offer screening bypass for a network or authentication error", async () => {
    api.getState.mockResolvedValue(state({ status: "in_progress", current_step: "diagnostic", goals: completedState.goals, self_assessments: completedState.self_assessments }));
    api.getDiagnostic.mockRejectedValue(new Error("网络连接失败"));
    renderPage();
    expect(await screen.findByRole("button", { name: "重新加载题组" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "先生成学习计划" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回课程自评" }));
    expect(screen.getByRole("heading", { name: "四门课目前学到哪里" })).toBeInTheDocument();
  });

  it("lets a student retry generating a plan without losing saved settings", async () => {
    api.getState.mockResolvedValue(state({ status: "in_progress", current_step: "diagnostic", goals: completedState.goals, self_assessments: completedState.self_assessments }));
    api.getDiagnostic.mockRejectedValue(new ApiError("题组不可用", "ONBOARDING_DIAGNOSTIC_UNAVAILABLE", true, {}));
    api.complete.mockRejectedValueOnce(new Error("计划保存失败")).mockResolvedValueOnce(completedState);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "先生成学习计划" }));
    expect(await screen.findByText("计划保存失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "先生成学习计划" }));
    expect(await screen.findByText("初始学习方向")).toBeInTheDocument();
    expect(api.complete).toHaveBeenCalledTimes(2);
  });

  it("shows an updated plan after changing a completed student's settings without reloading screening questions", async () => {
    api.getState.mockResolvedValue(completedState);
    api.saveGoals.mockResolvedValue({ ...completedState, status: "in_progress", current_step: "self_assessment" });
    api.saveAssessments.mockResolvedValue(completedState);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "调整学习设置" }));
    fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
    fireEvent.click(await screen.findByRole("button", { name: "生成学习方向" }));
    expect(await screen.findByText("初始学习方向")).toBeInTheDocument();
    expect(api.getDiagnostic).not.toHaveBeenCalled();
  });

  it("lets a new student request class enrollment without blocking learning setup", async () => {
    api.getState.mockResolvedValue(state());
    api.submitEnrollment.mockResolvedValue({
      membership: null,
      request: {
        request_id: "enrollment_request_1",
        status: "pending",
        student_number: "2315929354",
        class_id: "class_se_2301",
        class_name: "软件工程2301班",
        course_id: "course_408_ds",
        course_title: "数据结构",
        submitted_at: "2026-08-26T08:00:00.000Z",
        reviewed_at: null,
      },
    });
    api.saveGoals.mockResolvedValue(state({
      status: "in_progress",
      current_step: "self_assessment",
      goals: {
        target_exam_year: 2027,
        preparation_stage: "foundation",
        daily_minutes: 60,
        target_school: null,
        target_score: null,
        saved_at: "2026-08-26T08:00:00.000Z",
      },
    }));

    renderPage();

    expect(await screen.findByRole("heading", { name: "加入老师班级" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("班级邀请码"), { target: { value: "abcd7k9m" } });
    fireEvent.change(screen.getByLabelText("学号"), { target: { value: "2315929354" } });
    fireEvent.click(screen.getByRole("button", { name: "提交入班申请" }));

    await waitFor(() => expect(api.submitEnrollment).toHaveBeenCalledWith({
      invite_code: "ABCD-7K9M",
      student_number: "2315929354",
    }));
    expect(await screen.findByText("等待老师确认")).toBeInTheDocument();
    expect(screen.getByText(/软件工程2301班/)).toBeInTheDocument();
    expect(api.saveGoals).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
    await waitFor(() => expect(api.saveGoals).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "四门课目前学到哪里" })).toBeInTheDocument();
  });

  it("restores and cancels a pending class request", async () => {
    api.getState.mockResolvedValue(state());
    api.getEnrollment.mockResolvedValue({
      membership: null,
      request: {
        request_id: "enrollment_request_1",
        status: "pending",
        student_number: "2315929354",
        class_id: "class_se_2301",
        class_name: "软件工程2301班",
        course_id: "course_408_ds",
        course_title: "数据结构",
        submitted_at: "2026-08-26T08:00:00.000Z",
        reviewed_at: null,
      },
    });

    renderPage();

    expect(await screen.findByText("等待老师确认")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤回申请" }));
    await waitFor(() => expect(api.cancelEnrollment).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText("班级邀请码")).toBeInTheDocument();
    expect(screen.queryByText("等待老师确认")).not.toBeInTheDocument();
  });

  it("requires the eight-question screening before generating the learning path", async () => {
    api.getState.mockResolvedValue(state());
    api.saveGoals.mockResolvedValue(state({
      status: "in_progress",
      current_step: "self_assessment",
      goals: {
        target_exam_year: 2027,
        preparation_stage: "foundation",
        daily_minutes: 60,
        target_school: "中国科学技术大学",
        target_score: 120,
        saved_at: "2026-08-12T08:01:00.000Z",
      },
    }));
    api.saveAssessments.mockResolvedValue(state({
      status: "in_progress",
      current_step: "diagnostic",
      self_assessments: courseIds.map((course_id) => ({ course_id, level: "average" })),
    }));
    api.getDiagnostic.mockResolvedValue(diagnosticQuestionSet());
    api.saveDiagnosticAnswer.mockResolvedValue(state({ status: "in_progress", current_step: "diagnostic" }));
    api.completeDiagnostic.mockResolvedValue(completedState);

    const view = renderPage();
    expect(view.container.querySelector("main")).toHaveAttribute("data-visual-system", "ochre-serif");
    expect(await screen.findByRole("heading", { name: "先确定你的复习约束" })).toBeInTheDocument();
    expect(screen.queryByText(/约 60 秒/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("目标院校（选填）"), { target: { value: "中国科学技术大学" } });
    fireEvent.change(screen.getByLabelText("目标专业课分数（选填）"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));

    expect(await screen.findByRole("heading", { name: "四门课目前学到哪里" })).toBeInTheDocument();
    expect(screen.queryByText(/这里只记录你的主观学习状态/)).not.toBeInTheDocument();
    expect(screen.queryByText(/选择最接近你当前状态的一项/)).not.toBeInTheDocument();
    for (const title of courseTitles) {
      fireEvent.change(screen.getByLabelText(`${title}自评`), { target: { value: "average" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "生成学习方向" }));

    expect(await screen.findByRole("heading", { name: "完成 8 题起步筛查" })).toBeInTheDocument();
    expect(screen.queryByText(/它只帮助系统确定第一周从哪里开始/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.getDiagnostic).toHaveBeenCalledTimes(1));
    expect(screen.getByText("第 1 道起步筛查题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "不确定" }));
    expect(api.saveDiagnosticAnswer).toHaveBeenCalledWith({
      question_id: "question_1",
      response_status: "unsure",
      selected_option_ids: [],
    });
    expect(await screen.findByText("第 2 道起步筛查题")).toBeInTheDocument();
    for (let index = 2; index <= 8; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "跳过" }));
      await waitFor(() => expect(api.saveDiagnosticAnswer).toHaveBeenCalledTimes(index));
      if (index < 8) await screen.findByText(`第 ${index + 1} 道起步筛查题`);
    }

    await waitFor(() => expect(api.completeDiagnostic).toHaveBeenCalledTimes(1));
    expect(api.complete).not.toHaveBeenCalled();
    expect(await screen.findByText("初始学习方向")).toBeInTheDocument();
    expect(screen.queryByText(/课程顺序综合了你的自评和起步筛查结果/)).not.toBeInTheDocument();
    expect(screen.queryByText("student homepage")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看 7 日基础路径/ }));
    expect(await screen.findByRole("link", { name: /开始今天的第一项任务/ })).toHaveAttribute(
      "href",
      "/student/courses/data-structures",
    );
    expect(api.saveAssessments).toHaveBeenCalledWith({
      items: courseIds.map((course_id) => ({ course_id, level: "average" })),
    });
  });

  it("restores an unfinished diagnostic state at the screening step", async () => {
    api.getState.mockResolvedValue(state({
      status: "in_progress",
      current_step: "diagnostic",
      goals: {
        target_exam_year: 2027,
        preparation_stage: "foundation",
        daily_minutes: 60,
        target_school: null,
        target_score: null,
        saved_at: "2026-08-12T08:01:00.000Z",
      },
      self_assessments: courseIds.map((course_id) => ({ course_id, level: "average" })),
    }));
    api.getDiagnostic.mockResolvedValue(diagnosticQuestionSet());

    renderPage();

    expect(await screen.findByRole("heading", { name: "完成 8 题起步筛查" })).toBeInTheDocument();
  });

  it("shows a retry action instead of a permanent spinner when the screening set fails to load", async () => {
    api.getState.mockResolvedValue(state({
      status: "in_progress",
      current_step: "diagnostic",
      goals: {
        target_exam_year: 2027,
        preparation_stage: "foundation",
        daily_minutes: 60,
        target_school: null,
        target_score: null,
        saved_at: "2026-08-12T08:01:00.000Z",
      },
      self_assessments: courseIds.map((course_id) => ({ course_id, level: "average" })),
    }));
    api.getDiagnostic
      .mockRejectedValueOnce(new Error("起步筛查题组暂不可用"))
      .mockResolvedValueOnce(diagnosticQuestionSet());

    renderPage();

    expect(await screen.findByRole("button", { name: "重新加载题组" })).toBeInTheDocument();
    expect(screen.queryByText("正在准备起步筛查题组…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载题组" }));
    expect(await screen.findByRole("heading", { name: "完成 8 题起步筛查" })).toBeInTheDocument();
    expect(api.getDiagnostic).toHaveBeenCalledTimes(2);
  });

  it("keeps the final screening question retryable when atomic completion fails", async () => {
    const almostFinished = diagnosticQuestionSet();
    almostFinished.summary.saved_count = 7;
    almostFinished.items = almostFinished.items.map((item, index) => (
      index < 7 ? { ...item, response_status: "skipped" as const } : item
    ));
    api.getState.mockResolvedValue(state({
      status: "in_progress",
      current_step: "diagnostic",
      goals: {
        target_exam_year: 2027,
        preparation_stage: "foundation",
        daily_minutes: 60,
        target_school: null,
        target_score: null,
        saved_at: "2026-08-12T08:01:00.000Z",
      },
      self_assessments: courseIds.map((course_id) => ({ course_id, level: "average" })),
    }));
    api.getDiagnostic.mockResolvedValue(almostFinished);
    api.saveDiagnosticAnswer.mockResolvedValue(state({ status: "in_progress", current_step: "diagnostic" }));
    api.completeDiagnostic
      .mockRejectedValueOnce(new Error("路径生成暂时失败，请重试"))
      .mockResolvedValueOnce(completedState);

    renderPage();
    expect(await screen.findByText("第 8 道起步筛查题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("路径生成暂时失败，请重试");
    expect(screen.getByText("第 8 道起步筛查题")).toBeInTheDocument();
    expect(screen.getByText("已保存 8 / 8")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    expect(await screen.findByText("初始学习方向")).toBeInTheDocument();
    expect(api.completeDiagnostic).toHaveBeenCalledTimes(2);
    expect(api.complete).not.toHaveBeenCalled();
  });

  it("resumes at the final saved screening question after refresh so completion can be retried", async () => {
    const finishedDiagnostic = diagnosticQuestionSet();
    finishedDiagnostic.summary.saved_count = 8;
    finishedDiagnostic.items = finishedDiagnostic.items.map((item) => ({
      ...item,
      response_status: "skipped" as const,
    }));
    api.getState.mockResolvedValue(state({
      status: "in_progress",
      current_step: "diagnostic",
      goals: {
        target_exam_year: 2027,
        preparation_stage: "foundation",
        daily_minutes: 60,
        target_school: null,
        target_score: null,
        saved_at: "2026-08-12T08:01:00.000Z",
      },
      self_assessments: courseIds.map((course_id) => ({ course_id, level: "average" })),
    }));
    api.getDiagnostic.mockResolvedValue(finishedDiagnostic);
    api.saveDiagnosticAnswer.mockResolvedValue(state({ status: "in_progress", current_step: "diagnostic" }));
    api.completeDiagnostic.mockResolvedValue(completedState);

    renderPage();

    expect(await screen.findByText("第 8 道起步筛查题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "跳过" }));

    await waitFor(() => expect(api.completeDiagnostic).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("初始学习方向")).toBeInTheDocument();
  });

  it("automatically resumes a legacy profile step that has no generated result", async () => {
    api.getState.mockResolvedValue(state({
      status: "in_progress",
      current_step: "profile",
      goals: {
        target_exam_year: 2027,
        preparation_stage: "foundation",
        daily_minutes: 60,
        target_school: null,
        target_score: null,
        saved_at: "2026-08-12T08:01:00.000Z",
      },
      self_assessments: courseIds.map((course_id) => ({ course_id, level: "average" })),
    }));
    api.complete.mockResolvedValue(completedState);

    renderPage();

    expect(await screen.findByText("初始学习方向")).toBeInTheDocument();
    expect(api.complete).toHaveBeenCalledTimes(1);
  });

  it("shows the learning direction and a real first-task link without implementation notes", async () => {
    api.getState.mockResolvedValue(completedState);

    renderPage();

    expect(await screen.findByText("初始学习方向")).toBeInTheDocument();
    expect(screen.getByText("7 日基础路径")).toBeInTheDocument();
    const action = screen.getByRole("link", { name: /开始今天的第一项任务/ });
    expect(action).toHaveAttribute("href", "/student/courses/data-structures");
    expect(screen.queryByText(/学习记录正在积累|你的起步路径|雷达|能力分|上岸率|正确率|薄弱知识点|结果边界|不是能力测评|客观证据|确定性|真实学习证据|个性化解释服务|可验证基础路径/u)).not.toBeInTheDocument();
  });

  it("labels screening-driven priorities without presenting the screening as an ability score", async () => {
    api.getState.mockResolvedValue({
      ...completedState,
      profile: {
        ...completedState.profile!,
        confidence_explanation: "课程顺序综合四门自评与 8 题起步筛查信号。",
        screening: {
          status: "completed",
          answered_count: 5,
          correct_count: 4,
          incorrect_count: 1,
          unsure_count: 1,
          skipped_count: 2,
          risk_concepts: [{
            concept_id: "cn_c06_01",
            concept_title: "DNS 层次命名与解析",
            course_id: "course_408_cn",
            evidence_refs: ["screening:course_408_cn:q_cn_1"],
            note: "仅用于安排首个复习方向。",
          }],
        },
        priority_courses: completedState.profile!.priority_courses.map((course) => (
          course.course_id === "course_408_cn"
            ? {
                ...course,
                evidence_level: "screening_signal" as const,
                screening_signal: "observed_gap" as const,
                rationale: "起步筛查把 DNS 标为先复习方向。",
              }
            : course
        )),
      },
    });

    renderPage();

    expect(await screen.findByText("8 道起步筛查")).toBeInTheDocument();
    expect(screen.getByText(/1 个先复习知识点/)).toBeInTheDocument();
    expect(screen.queryByText(/自评 \+ 起步筛查|能力分|正确率|上岸率/u)).not.toBeInTheDocument();
  });

  it("recovers a legacy completed marker with no saved setup instead of rendering an empty plan", async () => {
    api.getState.mockResolvedValue(state({
      status: "completed",
      current_step: "plan",
    }));

    renderPage();

    expect(await screen.findByRole("heading", { name: "补全你的复习约束" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存并继续" })).toBeInTheDocument();
    expect(screen.queryByText("7 日基础路径")).not.toBeInTheDocument();
  });

  it("lets a completed student reopen the setup with the saved goals instead of forcing a diagnostic", async () => {
    api.getState.mockResolvedValue({
      ...completedState,
      goals: {
        ...completedState.goals!,
        target_school: "中国科学技术大学",
        target_score: 120,
      },
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "7 日基础路径" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "调整学习设置" }));

    expect(screen.getByRole("heading", { name: "调整你的复习约束" })).toBeInTheDocument();
    expect(screen.getByLabelText("目标院校（选填）")).toHaveValue("中国科学技术大学");
    expect(screen.getByLabelText("目标专业课分数（选填）")).toHaveValue(120);
    expect(screen.queryByRole("heading", { name: "完成 8 题起步筛查" })).not.toBeInTheDocument();
  });
});
