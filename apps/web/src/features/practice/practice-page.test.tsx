import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { QuestionDto } from "@xuetu/contracts";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getPracticeTasks: vi.fn(),
  getPastExamCatalog: vi.fn(),
  getQuestionBankQuestions: vi.fn(),
  submitQuestionAnswer: vi.fn(),
  getLearningProbeOffer: vi.fn(),
  getLearningProbeOfferForSession: vi.fn(),
  getLearningProbeSession: vi.fn(),
  startLearningProbe: vi.fn(),
  skipLearningProbe: vi.fn(),
  submitLearningProbe: vi.fn(),
  evaluatePilotChoiceTask: vi.fn(),
  activateStudentLearningTask: vi.fn(),
  completeStudentLearningTask: vi.fn(),
  completePilotTask: vi.fn(),
  getStudentLearningOrchestration: vi.fn(),
  invokeAiWorkflow: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

import { PracticePage } from "./practice-page";
import { STUDY_AGENT_EVIDENCE_UPDATED } from "../../components/study-agent-controller";

const questionOne = {
  id: "2026-01",
  year: 2026,
  number: 1,
  subject: "数据结构",
  type: "choice" as const,
  multiple: false,
  question: "若用顺序表存储线性表，访问第 i 个元素的时间复杂度是？",
  options: [
    { option_id: "A", text: "O(1)", assets: [] },
    { option_id: "B", text: "O(log n)", assets: [] },
    { option_id: "C", text: "O(n)", assets: [] },
    { option_id: "D", text: "O(n²)", assets: [] },
  ],
  tags: ["线性表"],
  assets: [],
  content_format: "plain_text" as const,
  source: {
    provider: "csgraduates.com",
    dataset_id: "408_json_data",
    source_url: "https://www.csgraduates.com/question/2026-01",
    license_status: "unverified" as const,
    usage_scope: "local_demo_only" as const,
  },
};

const questionTwo = {
  ...questionOne,
  id: "2026-02",
  number: 2,
  question: "栈的插入和删除操作通常在哪一端完成？",
  tags: ["栈"],
};

function PracticeNavigation() {
  const location = useLocation();
  return <><Link to="/student/practice?subject=组成原理&question_id=co-bookmarked&type=subjective">打开收藏的组成原理题</Link><output aria-label="当前题库网址">{location.search}</output><PracticePage /></>;
}

describe("practice route selection", () => {
  it("loads the new subject, question and type when following a link within the practice route", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 });
    render(<MemoryRouter initialEntries={["/student/practice?subject=数据结构&concept_id=old-concept"]}><PracticeNavigation /></MemoryRouter>);
    await screen.findByText("该知识点暂无关联题目");
    fireEvent.click(screen.getByRole("link", { name: "打开收藏的组成原理题" }));
    await waitFor(() => expect(apiMocks.getQuestionBankQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "组成原理", question_id: "co-bookmarked", type: "subjective", offset: 0 })));
    expect(apiMocks.getQuestionBankQuestions.mock.lastCall?.[0]).not.toHaveProperty("concept_id");
    expect(screen.getByLabelText("科目")).toHaveValue("组成原理");
    expect(screen.getByLabelText("题型")).toHaveValue("subjective");
  });
  it("keeps applied type and tags in the URL so a refresh retains the same selection", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 });
    render(<MemoryRouter initialEntries={["/student/practice?subject=组成原理&type=subjective&tags=Cache,存储层次"]}><PracticeNavigation /></MemoryRouter>);
    await waitFor(() => expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledWith(expect.objectContaining({ type: "subjective", tags: ["Cache", "存储层次"] })));
    fireEvent.change(screen.getByLabelText("知识标签"), { target: { value: "流水线" } });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() => {
      const params = new URLSearchParams(screen.getByLabelText("当前题库网址").textContent!);
      expect(params.get("type")).toBe("subjective");
      expect(params.get("tags")).toBe("流水线");
    });
  });
});

const questionAsset = {
  asset_id: "asset_question_001",
  role: "question" as const,
  option_id: null,
  reference_kind: "embedded_source" as const,
  source_reference: "embedded:sha256:question",
  mime_type: "image/png",
  availability: "authenticated_api" as const,
};

const optionAsset = {
  ...questionAsset,
  asset_id: "asset_option_a_001",
  role: "option" as const,
  option_id: "A",
  source_reference: "embedded:sha256:option-a",
};

const explanationAsset = {
  ...questionAsset,
  asset_id: "asset_explanation_001",
  role: "explanation" as const,
  source_reference: "embedded:sha256:explanation",
};

const solutionAsset = {
  ...questionAsset,
  asset_id: "asset_solution_001",
  role: "solution" as const,
  source_reference: "embedded:sha256:solution",
};

const questionWithAssets = {
  ...questionOne,
  assets: [questionAsset],
  options: questionOne.options.map((option) => (
    option.option_id === "A" ? { ...option, assets: [optionAsset] } : option
  )),
};

const subjectiveQuestion = {
  ...questionOne,
  id: "2023-41",
  year: 2023,
  number: 41,
  type: "subjective" as const,
  question: "写出快速排序一次划分的过程。",
  options: [],
  tags: ["快速排序"],
};

const learningMetadata = {
  source_type: "past_exam" as const,
  allowed_modes: ["targeted", "past_exam", "mock_exam"] as const,
  paper_year: 2026,
  protect_full_paper: false,
  importance: "core" as const,
  content_review_status: "pending_teacher_review" as const,
};

function practiceItem(
  question: QuestionDto = questionOne,
  ranking: {
    algorithm_version: "fsrs_v6_weighted_v1";
    priority_score: number;
    evidence_level: "limited" | "grounded";
    components: {
      memory_risk: number;
      concept_weakness: number;
      repeated_error: number;
      importance: number;
      novelty: number;
    };
    reason_lines: string[];
  } | null = null,
) {
  return {
    question,
    learning_metadata: learningMetadata,
    ranking,
  };
}

function evaluation(status: "correct" | "incorrect" = "correct") {
  const isCorrect = status === "correct";
  return {
    attempt: {
      attempt_id: "attempt_001",
      user_id: "user_student_001",
      course_id: "course_408_001",
      question_id: questionOne.id,
      answer_type: "choice" as const,
      selected_option_ids: ["A"],
      response_text: null,
      status: "evaluated" as const,
      submitted_at: "2026-07-28T00:00:00.000Z",
    },
    evaluation: {
      evaluation_id: "evaluation_001",
      submission_id: "attempt_001",
      question_id: questionOne.id,
      grading_mode: "deterministic_choice" as const,
      status,
      is_correct: isCorrect,
      score: isCorrect ? (100 as const) : (0 as const),
      correct_option_ids: isCorrect ? ["A"] : ["B"],
      explanation: "顺序表支持按下标直接定位，因此访问复杂度为 O(1)。",
      reference_solution: null,
      answer_assets: [],
      review_required: false as const,
      created_at: "2026-07-28T00:00:00.000Z",
      source: questionOne.source,
    },
    evidence: {
      evidence_id: "evidence_001",
      evaluation_id: "evaluation_001",
      submission_id: "attempt_001",
      question_id: questionOne.id,
      subject: "数据结构",
      year: 2026,
      question_type: "choice" as const,
      outcome: status,
      grading_mode: "deterministic_choice" as const,
      selected_option_ids: ["A"],
      response_present: false,
      tags: ["线性表"],
      review_required: false,
      eligible_for_learning_state_update: true,
      persistence_status: "persisted" as const,
      created_at: "2026-07-28T00:00:00.000Z",
      source: questionOne.source,
    },
  };
}

function pendingEvaluation() {
  return {
    attempt: {
      attempt_id: "attempt_subjective_001",
      user_id: "user_student_001",
      course_id: "course_408_001",
      question_id: subjectiveQuestion.id,
      answer_type: "subjective" as const,
      selected_option_ids: null,
      response_text: "以首元素为枢轴，双指针完成一次划分。",
      status: "submitted" as const,
      submitted_at: "2026-08-24T00:00:00.000Z",
    },
    evaluation: {
      evaluation_id: "evaluation_subjective_001",
      submission_id: "attempt_subjective_001",
      question_id: subjectiveQuestion.id,
      grading_mode: "ai_or_teacher_review_required" as const,
      status: "pending_review" as const,
      is_correct: null,
      score: null,
      correct_option_ids: [],
      explanation: null,
      reference_solution: "以首元素为枢轴，从两端向中间扫描并交换，最终将枢轴放入正确位置。",
      answer_assets: [solutionAsset],
      review_required: true as const,
      created_at: "2026-08-24T00:00:00.000Z",
      source: subjectiveQuestion.source,
    },
    evidence: {
      evidence_id: "evidence_subjective_001",
      evaluation_id: "evaluation_subjective_001",
      submission_id: "attempt_subjective_001",
      question_id: subjectiveQuestion.id,
      subject: "数据结构",
      year: 2023,
      question_type: "subjective" as const,
      outcome: "pending_review" as const,
      grading_mode: "ai_or_teacher_review_required" as const,
      selected_option_ids: null,
      response_present: true,
      tags: ["快速排序"],
      review_required: true,
      eligible_for_learning_state_update: false,
      persistence_status: "persisted" as const,
      created_at: "2026-08-24T00:00:00.000Z",
      source: subjectiveQuestion.source,
    },
  };
}

const learningProbeOffer = {
  probe_session_id: "probe_session_001",
  course_id: "course_408_co",
  concept_id: "co_c04_01",
  concept_title: "存储系统基本概念",
  source_attempt_id: "attempt_001",
  anchor_question_id: "probe-co-storage-anchor-v1",
  question: {
    question: {
      ...questionOne,
      id: "probe-co-storage-contrast-v1",
      number: 2,
      subject: "组成原理",
      question: "若主存按字节编址，地址增加 1 表示跨过多少位数据？",
      options: [
        { option_id: "A", text: "1 位", assets: [] },
        { option_id: "B", text: "8 位", assets: [] },
        { option_id: "C", text: "16 位", assets: [] },
        { option_id: "D", text: "32 位", assets: [] },
      ],
      tags: ["存储系统"],
      source: {
        provider: "xuetu-local-review",
        dataset_id: "learning-probe-demo",
        source_url: null,
        license_status: "verified" as const,
        usage_scope: "authorized_product_use" as const,
      },
    },
    learning_metadata: {
      source_type: "self_authored_practice" as const,
      allowed_modes: ["targeted"] as const,
      paper_year: null,
      protect_full_paper: false,
      importance: "core" as const,
      content_review_status: "teacher_verified" as const,
    },
    ranking: null,
  },
  hypothesis_code: "concept_definition" as const,
  surface_difference: "从容量换算改为地址步长，检查是否理解按字节编址。",
  status: "offered" as const,
  fallback: false,
  fallback_reason: null,
};

const learningProbeSession = {
  probe_session_id: "probe_session_001",
  status: "started" as const,
  question_id: "probe-co-storage-contrast-v1",
  course_id: "course_408_co",
  concept_id: "co_c04_01",
  evidence: {
    status: "signal" as const,
    status_label: "待确认",
    statement: "目前只有一次错答信号，还不能判断是否理解这一概念。",
    independent_correct_count: 0,
    distinct_correct_question_count: 0,
    first_correct_at: null,
    last_correct_at: null,
    unknowns: ["还缺少不同题面的独立正确证据"],
  },
  next_review_at: null,
  completed_at: null,
};

const learningProbeResult = {
  session: {
    ...learningProbeSession,
    status: "completed" as const,
    evidence: {
      ...learningProbeSession.evidence,
      status: "developing" as const,
      status_label: "继续观察",
      statement: "已有一次新的正确证据，继续观察。",
      independent_correct_count: 1,
      distinct_correct_question_count: 1,
      first_correct_at: "2026-08-29T08:10:00.000Z",
      last_correct_at: "2026-08-29T08:10:00.000Z",
      unknowns: ["还需要跨日且来自不同题面的证据"],
    },
    completed_at: "2026-08-29T08:10:00.000Z",
  },
  evaluation: {
    evaluation_id: "evaluation_probe_001",
    submission_id: "attempt_probe_001",
    question_id: "probe-co-storage-contrast-v1",
    grading_mode: "deterministic_choice" as const,
    status: "correct" as const,
    is_correct: true,
    score: 100 as const,
    correct_option_ids: ["B"],
    explanation: "按字节编址时，一个地址对应 1 字节，也就是 8 位。",
    reference_solution: null,
    answer_assets: [],
    review_required: false as const,
    created_at: "2026-08-29T08:10:00.000Z",
    source: learningProbeOffer.question.question.source,
  },
  evidence_kind: "concept_evidence" as const,
  evidence_statement: "已有一次新的正确证据，继续观察。",
  next_task: null,
};

const pastExamCatalog = {
  items: Array.from({ length: 18 }, (_, index) => {
    const year = 2026 - index;
    const attemptedCount = year === 2026 ? 2 : 0;
    return {
      year,
      question_count: 47,
      choice_count: 40,
      subjective_count: 7,
      subjects: [
        { subject: "数据结构", question_count: 11 },
        { subject: "组成原理", question_count: 12 },
        { subject: "操作系统", question_count: 12 },
        { subject: "计算机网络", question_count: 12 },
      ],
      attempted_count: attemptedCount,
      next_question_number: attemptedCount === 0 ? 1 : 3,
      is_complete: true,
    };
  }),
};

function settlement(
  status: "correct" | "incorrect" = "correct",
  nextTaskHref = "/student/courses/data-structures?concept_id=ds_c02_03",
  nextTaskId = "next_task_001",
) {
  const incorrect = status === "incorrect";
  return {
    version: "challenge_settlement_v1" as const,
    task_type: "choice_practice" as const,
    course_id: "course_408_ds" as const,
    course_title: "数据结构",
    concept_id: "ds_c02_02",
    concept_title: "顺序表的存储表示",
    outcome: status,
    result_title: "本关已完成",
    result_detail: "本次选择题已完成判分。",
    evidence_update: {
      added_count: 1,
      objective_total: 4,
      summary: "新增 1 次选择题作答。",
    },
    profile_update: incorrect
      ? {
          kind: "practice_review" as const,
          title: "顺序表的存储表示进入待复习队列",
          detail: "本次错误作答已形成复习信号，后续任务会优先安排相关复习。",
        }
      : {
          kind: "practice_correct" as const,
          title: "顺序表的存储表示新增一次正确作答",
          detail: "本次结果已计入画像，仍需后续证据观察是否稳定掌握。",
        },
    review_update: incorrect
      ? {
          status: "needs_review" as const,
          mistake_id: "mistake_001",
          next_review_at: "2026-08-14T08:03:00.000Z",
          summary: "已加入错题复习，累计答错 1 次。",
        }
      : {
          status: "not_required" as const,
          mistake_id: null,
          next_review_at: null,
          summary: "本次正确作答未新增待复习记录。",
        },
    plan_progress: {
      tracked: true,
      completed_task_count: 2,
      total_task_count: 7,
      completion_percent: 29,
    },
    next_task: {
      task_id: nextTaskId,
      task_type: "course_reading" as const,
      course_id: "course_408_ds" as const,
      course_title: "数据结构",
      concept_id: "ds_c02_03",
      concept_title: "栈的基本操作",
      title: "继续学习：栈的基本操作",
      reason: "刚完成线性表训练，下一步补齐栈的基础操作。",
      estimated_minutes: 20,
      href: nextTaskHref,
    },
  };
}

function renderPractice(initialEntry = "/student/practice") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PracticePage />
    </MemoryRouter>,
  );
}

describe("PracticePage", () => {
  beforeEach(() => {
    apiMocks.getPracticeTasks.mockReset();
    apiMocks.getPastExamCatalog.mockReset();
    apiMocks.getQuestionBankQuestions.mockReset();
    apiMocks.submitQuestionAnswer.mockReset();
    apiMocks.getLearningProbeOffer.mockReset();
    apiMocks.getLearningProbeOfferForSession.mockReset();
    apiMocks.getLearningProbeSession.mockReset();
    apiMocks.startLearningProbe.mockReset();
    apiMocks.skipLearningProbe.mockReset();
    apiMocks.submitLearningProbe.mockReset();
    apiMocks.evaluatePilotChoiceTask.mockReset();
    apiMocks.activateStudentLearningTask.mockReset();
    apiMocks.completeStudentLearningTask.mockReset();
    apiMocks.completePilotTask.mockReset();
    apiMocks.getStudentLearningOrchestration.mockReset();
    apiMocks.invokeAiWorkflow.mockReset();
    apiMocks.getPracticeTasks.mockResolvedValue({
      course: { title: "数据结构", progress_percent: 0 },
      items: [],
    });
    apiMocks.getPastExamCatalog.mockResolvedValue(pastExamCatalog);
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem()],
      total: 197,
      limit: 1,
      offset: 0,
    });
    apiMocks.submitQuestionAnswer.mockResolvedValue(evaluation());
    apiMocks.getLearningProbeOffer.mockResolvedValue(null);
    apiMocks.getLearningProbeOfferForSession.mockResolvedValue(learningProbeOffer);
    apiMocks.getLearningProbeSession.mockResolvedValue(learningProbeSession);
    apiMocks.startLearningProbe.mockResolvedValue({
      ...learningProbeOffer,
      status: "started",
    });
    apiMocks.skipLearningProbe.mockResolvedValue({
      ...learningProbeSession,
      status: "skipped",
    });
    apiMocks.submitLearningProbe.mockResolvedValue(learningProbeResult);
    apiMocks.evaluatePilotChoiceTask.mockResolvedValue({
      task_id: "pilot_task_baseline",
      attempt_id: "attempt_001",
      question_id: "2026-01",
      outcome: "correct",
      score: 100,
      grading_mode: "deterministic_choice",
      evidence_at: "2026-07-28T00:00:00.000Z",
      task_completed: true,
    });
    apiMocks.activateStudentLearningTask.mockResolvedValue({
      task_id: "live_task_001",
      activated_at: "2026-08-17T08:00:00.000Z",
      idempotent: false,
    });
    apiMocks.completeStudentLearningTask.mockResolvedValue({
      task_id: "live_task_001",
      completed_at: "2026-08-17T08:05:00.000Z",
      evidence_refs: ["evidence:evidence_001"],
      idempotent: false,
      next_task_id: "next_task_001",
      settlement: settlement(),
    });
    apiMocks.completePilotTask.mockResolvedValue({ kind: "enrolled" });
    apiMocks.invokeAiWorkflow.mockResolvedValue({
      contract_version: "0.2",
      request_id: "workflow_practice_001",
      capability: "diagnose",
      slot: "practice_reflection",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "WORKFLOW_NOT_CONNECTED",
        message: "AI workflow service is not configured.",
        retryable: true,
        fallback_message: "AI 服务待连接，确定性判分结果与解析仍可正常使用。",
      },
    });
  });

  it("explains a task sync failure without exposing backend terminology", async () => {
    apiMocks.activateStudentLearningTask.mockRejectedValueOnce(new Error("offline"));
    renderPractice("/student/practice?subject=数据结构&orchestration_task_id=live_task_001");

    expect(await screen.findByText("任务进度暂未同步，仍可继续作答。")).toBeInTheDocument();
    expect(screen.queryByText(/服务端记录/u)).not.toBeInTheDocument();
  });

  it("shows one server-settled challenge result and its next task without a second orchestration request", async () => {
    apiMocks.getStudentLearningOrchestration.mockResolvedValue({
      current_task: {
        task_id: "next_task_001",
        title: "继续学习：栈的基本操作",
        reason: "刚完成线性表训练，下一步补齐栈的基础操作。",
        estimated_minutes: 20,
        href: "/student/courses/data-structures?concept_id=ds_c02",
      },
    });

    renderPractice("/student/practice?subject=数据结构&orchestration_task_id=live_task_001");
    await screen.findByText(questionOne.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    const challengeSettlement = await screen.findByRole("region", { name: "本关结算" });
    expect(challengeSettlement).toHaveTextContent("新增 1 次选择题作答");
    expect(challengeSettlement).toHaveTextContent("顺序表的存储表示新增一次正确作答");
    expect(challengeSettlement).toHaveTextContent("仍需后续证据观察是否稳定掌握");
    expect(challengeSettlement).toHaveTextContent("本次正确作答未新增待复习记录");
    expect(challengeSettlement).toHaveTextContent("七日路径 2 / 7");
    expect(challengeSettlement).toHaveTextContent("继续学习：栈的基本操作");
    expect(challengeSettlement).toHaveTextContent("刚完成线性表训练");
    expect(challengeSettlement).toHaveTextContent("20 分钟");
    expect(within(challengeSettlement).getByRole("link", { name: "进入下一关" })).toHaveAttribute(
      "href",
      "/student/courses/data-structures?concept_id=ds_c02_03&orchestration_task_id=next_task_001",
    );
    expect(apiMocks.getStudentLearningOrchestration).not.toHaveBeenCalled();
  });

  it("keeps a probe next-task link free of a regular orchestration task id", async () => {
    const probeHref = "/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86&concept_id=co_c04_01&probe_session_id=probe_session_001";
    apiMocks.completeStudentLearningTask.mockResolvedValueOnce({
      task_id: "live_task_001",
      completed_at: "2026-08-17T08:05:00.000Z",
      evidence_refs: ["evidence:evidence_001"],
      idempotent: false,
      next_task_id: "probe_probe_session_001",
      settlement: settlement("correct", probeHref, "probe_probe_session_001"),
    });

    renderPractice("/student/practice?subject=数据结构&orchestration_task_id=live_task_001");
    await screen.findByText(questionOne.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    const challengeSettlement = await screen.findByRole("region", { name: "本关结算" });
    expect(within(challengeSettlement).getByRole("link", { name: "进入下一关" }))
      .toHaveAttribute("href", probeHref);
  });

  it("keeps the evaluated result and offers home fallback when challenge settlement fails", async () => {
    apiMocks.completeStudentLearningTask.mockRejectedValueOnce(new Error("offline"));

    renderPractice("/student/practice?subject=数据结构&orchestration_task_id=live_task_001");
    await screen.findByText(questionOne.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(await screen.findByRole("region", { name: "本关结算" })).toHaveTextContent(
      "作答与判分已完成，本关结算暂时无法读取。",
    );
    expect(screen.getByRole("link", { name: "返回学习首页" })).toHaveAttribute("href", "/student");
    expect(screen.getByRole("heading", { name: "回答正确" })).toBeInTheDocument();
    expect(screen.getByText("学习记录已更新")).toBeInTheDocument();
  });

  it("notifies the learning manager after a successful persisted answer", async () => {
    const listener = vi.fn();
    window.addEventListener(STUDY_AGENT_EVIDENCE_UPDATED, listener);
    renderPractice();
    await screen.findByText(questionOne.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    window.removeEventListener(STUDY_AGENT_EVIDENCE_UPDATED, listener);
  });

  it("does not notify the learning manager when answer persistence fails", async () => {
    const listener = vi.fn();
    apiMocks.submitQuestionAnswer.mockRejectedValueOnce(new Error("network"));
    window.addEventListener(STUDY_AGENT_EVIDENCE_UPDATED, listener);
    renderPractice();
    await screen.findByText(questionOne.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("评测提交失败");
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(STUDY_AGENT_EVIDENCE_UPDATED, listener);
  });

  it("shows the deterministic mistake and review-date change for an incorrect challenge", async () => {
    apiMocks.submitQuestionAnswer.mockResolvedValueOnce(evaluation("incorrect"));
    apiMocks.completeStudentLearningTask.mockResolvedValueOnce({
      task_id: "live_task_001",
      completed_at: "2026-08-17T08:05:00.000Z",
      evidence_refs: ["evidence:evidence_001"],
      idempotent: false,
      next_task_id: "next_task_001",
      settlement: settlement("incorrect"),
    });

    renderPractice("/student/practice?subject=数据结构&orchestration_task_id=live_task_001");
    await screen.findByText(questionOne.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    const challengeSettlement = await screen.findByRole("region", { name: "本关结算" });
    expect(challengeSettlement).toHaveTextContent("进入待复习队列");
    expect(challengeSettlement).toHaveTextContent("已加入错题复习，累计答错 1 次");
    expect(challengeSettlement).toHaveTextContent("8月14日");
    expect(within(challengeSettlement).getByRole("link", { name: "查看错题" })).toHaveAttribute(
      "href",
      "/student/mistakes?course_id=course_408_ds&concept_id=ds_c02_02",
    );
  });

  it("shows a student-facing question loading state", () => {
    apiMocks.getQuestionBankQuestions.mockReturnValue(new Promise(() => undefined));
    renderPractice();

    expect(screen.getByRole("status")).toHaveTextContent("正在加载题目");
    expect(screen.getByRole("status")).not.toHaveTextContent(/PostgreSQL|API/iu);
  });

  it("renders one question without answer-bearing content before submission", async () => {
    renderPractice();

    expect(await screen.findByRole("heading", { name: "数据结构课程训练" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /第 1 题/ })).toBeInTheDocument();
    expect(screen.getByText(questionOne.question)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A. O(1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交并查看结果" })).toBeDisabled();
    expect(screen.queryByText(/正确答案/)).not.toBeInTheDocument();
    expect(screen.queryByText(questionOne.source.source_url)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    expect(screen.getByRole("button", { name: "提交并查看结果" })).toBeEnabled();
  });

  it("opens past exams as an 18-year paper catalog without loading a sliced question", async () => {
    renderPractice("/student/practice?mode=past_exam");

    const catalog = await screen.findByRole("region", { name: "历年真题目录" });
    expect(within(catalog).getAllByRole("heading", { name: /年真题/u })).toHaveLength(18);
    expect(within(catalog).getByText("已完成 2 / 47 题")).toBeInTheDocument();
    expect(within(catalog).getByRole("link", { name: "继续第 3 题" })).toHaveAttribute(
      "href",
      "/student/practice?mode=past_exam&year=2026&question=3",
    );
    expect(apiMocks.getPastExamCatalog).toHaveBeenCalledTimes(1);
    expect(apiMocks.getQuestionBankQuestions).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("科目")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("题型")).not.toBeInTheDocument();
  });

  it("offers a completed paper as a fresh practice instead of a nonexistent continuation", async () => {
    apiMocks.getPastExamCatalog.mockResolvedValue({
      items: pastExamCatalog.items.map((paper) => paper.year === 2026
        ? {
            ...paper,
            attempted_count: paper.question_count,
            next_question_number: null,
          }
        : paper),
    });
    renderPractice("/student/practice?mode=past_exam");

    const catalog = await screen.findByRole("region", { name: "历年真题目录" });
    expect(within(catalog).getByRole("link", { name: "重新练习" })).toHaveAttribute(
      "href",
      "/student/practice?mode=past_exam&year=2026&question=1",
    );
    expect(within(catalog).queryByRole("link", { name: "继续第 1 题" })).not.toBeInTheDocument();
  });

  it("retries the past-exam catalog without affecting the other practice modes", async () => {
    apiMocks.getPastExamCatalog
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(pastExamCatalog);
    renderPractice("/student/practice?mode=past_exam");

    expect(await screen.findByRole("alert")).toHaveTextContent("真题目录加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重新读取真题目录" }));
    expect(await screen.findByRole("region", { name: "历年真题目录" })).toBeInTheDocument();
    expect(apiMocks.getPastExamCatalog).toHaveBeenCalledTimes(2);
    expect(apiMocks.getQuestionBankQuestions).not.toHaveBeenCalled();
  });

  it("loads one whole paper without subject or type filters and exposes 47 stable question jumps", async () => {
    renderPractice("/student/practice?mode=past_exam&year=2026&question=1");

    await screen.findByText(questionOne.question);
    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledWith({
      mode: "past_exam",
      year: 2026,
      tag_match: "all",
      limit: 1,
      offset: 0,
    });
    const navigator = screen.getByRole("navigation", { name: "2026 年真题题号" });
    expect(within(navigator).getAllByRole("button", { name: /跳到第/u })).toHaveLength(47);
    fireEvent.click(within(navigator).getByRole("button", { name: "跳到第 47 题" }));
    await waitFor(() => expect(apiMocks.getQuestionBankQuestions).toHaveBeenLastCalledWith({
      mode: "past_exam",
      year: 2026,
      tag_match: "all",
      limit: 1,
      offset: 46,
    }));
  });

  it("bounds a direct question URL to the verified 47-question paper", async () => {
    renderPractice("/student/practice?mode=past_exam&year=2026&question=100");

    await screen.findByText(questionOne.question);
    expect(apiMocks.getQuestionBankQuestions).toHaveBeenLastCalledWith({
      mode: "past_exam",
      year: 2026,
      tag_match: "all",
      limit: 1,
      offset: 46,
    });
    expect(screen.getByText("第 47 / 47 题")).toBeInTheDocument();
  });

  it("returns an unknown direct year URL to the paper catalog", async () => {
    renderPractice("/student/practice?mode=past_exam&year=2027&question=1");

    expect(await screen.findByRole("region", { name: "历年真题目录" })).toBeInTheDocument();
    expect(apiMocks.getQuestionBankQuestions).not.toHaveBeenCalled();
  });

  it("renders authenticated question and option images before submission", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem(questionWithAssets)], total: 47, limit: 1, offset: 0,
    });
    renderPractice("/student/practice?mode=past_exam&year=2026&question=1");

    expect(await screen.findByAltText("第 1 题图示 1")).toHaveAttribute(
      "src",
      "/api/v1/question-bank/questions/2026-01/assets/asset_question_001",
    );
    expect(screen.getByAltText("A 选项图示 1")).toHaveAttribute(
      "src",
      "/api/v1/question-bank/questions/2026-01/assets/asset_option_a_001",
    );
    expect(screen.queryByText("本题图片暂时无法显示，请换一道题。")).not.toBeInTheDocument();
  });

  it("keeps an option-image retry action outside the answer label", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem(questionWithAssets)], total: 47, limit: 1, offset: 0,
    });
    renderPractice("/student/practice?mode=past_exam&year=2026&question=1");

    const optionImage = await screen.findByAltText("A 选项图示 1");
    fireEvent.error(optionImage);
    const retry = await screen.findByRole("button", { name: "重新加载" });
    const option = screen.getByRole("radio", { name: "A. O(1)" });
    expect(retry.closest("label")).toBeNull();

    fireEvent.click(retry);
    expect(option).not.toBeChecked();
    expect(screen.getByRole("button", { name: "提交并查看结果" })).toBeDisabled();
  });

  it("uses the matching attempt when revealing explanation images", async () => {
    apiMocks.submitQuestionAnswer.mockResolvedValue({
      ...evaluation(),
      evaluation: { ...evaluation().evaluation, answer_assets: [explanationAsset] },
    });
    renderPractice("/student/practice?mode=past_exam&year=2026&question=1");
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(await screen.findByAltText("题目解析图 1")).toHaveAttribute(
      "src",
      "/api/v1/question-bank/questions/2026-01/assets/asset_explanation_001?attempt_id=attempt_001",
    );
  });

  it("keeps the submitted result visible when the catalog refreshes with a new response object", async () => {
    let resolveCatalogRefresh: (value: typeof pastExamCatalog) => void = () => undefined;
    const refreshedCatalog = {
      items: pastExamCatalog.items.map((paper) => ({
        ...paper,
        subjects: paper.subjects.map((subject) => ({ ...subject })),
      })),
    };
    apiMocks.getPastExamCatalog
      .mockResolvedValueOnce(pastExamCatalog)
      .mockImplementationOnce(() => new Promise<typeof pastExamCatalog>((resolve) => {
        resolveCatalogRefresh = resolve;
      }));
    apiMocks.submitQuestionAnswer.mockResolvedValue({
      ...evaluation(),
      evaluation: { ...evaluation().evaluation, answer_assets: [explanationAsset] },
    });
    renderPractice("/student/practice?mode=past_exam&year=2026&question=1");
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    expect(await screen.findByAltText("题目解析图 1")).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getPastExamCatalog).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveCatalogRefresh(refreshedCatalog);
      await Promise.resolve();
    });

    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText("题目解析图 1")).toBeInTheDocument();
  });

  it("keeps the submitted result visible when the catalog progress refresh fails", async () => {
    let rejectCatalogRefresh: (reason?: unknown) => void = () => undefined;
    apiMocks.getPastExamCatalog
      .mockResolvedValueOnce(pastExamCatalog)
      .mockImplementationOnce(() => new Promise<typeof pastExamCatalog>((_resolve, reject) => {
        rejectCatalogRefresh = reject;
      }));
    apiMocks.submitQuestionAnswer.mockResolvedValue({
      ...evaluation(),
      evaluation: { ...evaluation().evaluation, answer_assets: [explanationAsset] },
    });
    renderPractice("/student/practice?mode=past_exam&year=2026&question=1");
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    expect(await screen.findByAltText("题目解析图 1")).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getPastExamCatalog).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectCatalogRefresh(new Error("offline"));
      await Promise.resolve();
    });

    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText("题目解析图 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2026 年 408 真题" })).toBeInTheDocument();
  });

  it("diagnoses a whole-paper question in the question's actual course", async () => {
    const organizationQuestion = {
      ...questionOne,
      id: "2026-12",
      number: 12,
      subject: "组成原理",
      question: "MAR 中保存的内容是什么？",
    };
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem(organizationQuestion)], total: 47, limit: 1, offset: 11,
    });
    renderPractice("/student/practice?mode=past_exam&year=2026&question=12");
    await screen.findByText(organizationQuestion.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    await waitFor(() => expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ course_id: "course_408_co" }),
    ));
  });

  it("opens as course-internal training and filters all four 408 subjects", async () => {
    const organizationQuestion = {
      ...questionOne,
      id: "2026-20",
      subject: "组成原理",
      question: "MAR 用于保存什么？",
      tags: ["存储器"],
    };
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem(organizationQuestion)], total: 217, limit: 1, offset: 0,
    });
    renderPractice("/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86");

    expect(await screen.findByRole("heading", { name: "组成原理课程训练" })).toBeInTheDocument();
    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledWith(expect.objectContaining({
      subject: "组成原理",
    }));
    expect(screen.getByRole("link", { name: "返回组成原理课程" })).toHaveAttribute(
      "href", "/student/courses/computer-organization",
    );

    fireEvent.change(screen.getByLabelText("科目"), { target: { value: "计算机网络" } });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() => expect(apiMocks.getQuestionBankQuestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ subject: "计算机网络" }),
    ));
  });

  it("keeps a concept-scoped practice session tied to its persisted association", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem()],
      total: 2,
      limit: 1,
      offset: 0,
      context: {
        concept_id: "ds_c02_02",
        concept_title: "顺序表的存储表示",
        course_id: "course_408_ds",
        course_title: "数据结构",
        subject: "数据结构",
        match_method: "exact_question_tag",
      },
    });
    renderPractice("/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02");

    expect(await screen.findByText("知识点练习：顺序表的存储表示")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    await waitFor(() => expect(apiMocks.submitQuestionAnswer).toHaveBeenCalledWith(
      {
        question_id: "2026-01",
        concept_id: "ds_c02_02",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
      expect.any(String),
    ));
  });

  it("keeps a direct re-practice session bound to the requested question", async () => {
    renderPractice("/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=2026-01");

    await waitFor(() => expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledWith(expect.objectContaining({
      subject: "数据结构",
      concept_id: "ds_c02_02",
      question_id: "2026-01",
      limit: 1,
    })));
  });

  it("clears direct-question constraints when switching to a paper mode", async () => {
    renderPractice("/student/practice?subject=数据结构&concept_id=ds_c02_02&question_id=2026-01");
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("link", { name: "历年真题" }));

    await screen.findByRole("region", { name: "历年真题目录" });
    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("知识点练习：顺序表的存储表示")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续第 3 题" })).toHaveAttribute(
      "href",
      "/student/practice?mode=past_exam&year=2026&question=3",
    );
  });

  it("submits a subjective response for teacher review without inventing a score", async () => {
    apiMocks.getQuestionBankQuestions
      .mockResolvedValueOnce({ items: [practiceItem()], total: 197, limit: 1, offset: 0 })
      .mockResolvedValueOnce({ items: [practiceItem(subjectiveQuestion)], total: 4, limit: 1, offset: 0 });
    apiMocks.submitQuestionAnswer.mockResolvedValueOnce(pendingEvaluation());
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.change(screen.getByLabelText("题型"), { target: { value: "subjective" } });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await screen.findByText(subjectiveQuestion.question);
    fireEvent.change(screen.getByLabelText("主观题作答"), {
      target: { value: "以首元素为枢轴，双指针完成一次划分。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交主观题作答" }));

    expect(apiMocks.submitQuestionAnswer).toHaveBeenCalledWith(
      {
        question_id: subjectiveQuestion.id,
        answer_type: "subjective",
        response_text: "以首元素为枢轴，双指针完成一次划分。",
      },
      expect.any(String),
    );
    const pendingHeading = await screen.findByRole("heading", { name: "作答已提交，等待教师审核" });
    const pendingResult = pendingHeading.closest("section");
    expect(pendingResult).not.toBeNull();
    expect(within(pendingResult!).queryByText(/正确答案|\d+ 分/)).not.toBeInTheDocument();
    expect(within(pendingResult!).getByText("参考解答（用于自查）")).toBeInTheDocument();
    expect(within(pendingResult!).getByText(/从两端向中间扫描/u)).toBeInTheDocument();
    expect(within(pendingResult!).getByAltText("参考解答图 1")).toHaveAttribute(
      "src",
      `/api/v1/question-bank/questions/${subjectiveQuestion.id}/assets/asset_solution_001?attempt_id=attempt_subjective_001`,
    );
  });

  it("frames a past-paper subjective submission as self-review instead of promising teacher grading", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValueOnce({
      items: [practiceItem(subjectiveQuestion)],
      total: 47,
      limit: 1,
      offset: 40,
    });
    apiMocks.submitQuestionAnswer.mockResolvedValueOnce(pendingEvaluation());
    renderPractice("/student/practice?mode=past_exam&year=2023&question=41");

    await screen.findByText(subjectiveQuestion.question);
    fireEvent.change(screen.getByLabelText("主观题作答"), {
      target: { value: "以首元素为枢轴，双指针完成一次划分。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交主观题作答" }));

    const resultHeading = await screen.findByRole("heading", { name: "作答已保存，请对照参考解答自查" });
    const result = resultHeading.closest("section");
    expect(result).not.toBeNull();
    expect(result).toHaveTextContent("本题不自动判分，也不计入客观题掌握度。");
    expect(within(result!).queryByText(/等待教师审核|将由任课教师审核/u)).not.toBeInTheDocument();
  });

  it("keeps the exact concept and question when opening a mistake review", async () => {
    renderPractice("/student/practice?mode=mistake_review&subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02&question_id=2026-01");

    await screen.findByText(questionOne.question);

    expect(apiMocks.getQuestionBankQuestions).toHaveBeenCalledWith(expect.objectContaining({
      mode: "mistake_review",
      concept_id: "ds_c02_02",
      question_id: "2026-01",
    }));
  });

  it("submits an answer, reveals the explanation, and updates the learning record", async () => {
    let resolveEvaluation!: (value: ReturnType<typeof evaluation>) => void;
    apiMocks.submitQuestionAnswer.mockReturnValue(
      new Promise((resolve) => { resolveEvaluation = resolve; }),
    );
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(screen.getByRole("button", { name: "正在判分…" })).toBeDisabled();
    expect(apiMocks.submitQuestionAnswer).toHaveBeenCalledWith(
      {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
      expect.any(String),
    );

    resolveEvaluation(evaluation());
    const resultHeading = await screen.findByRole("heading", { name: "回答正确" });
    expect(screen.getByText("正确答案：A")).toBeInTheDocument();
    expect(screen.getByText(/顺序表支持按下标直接定位/)).toBeInTheDocument();
    expect(screen.getByText("学习记录已更新")).toBeInTheDocument();
    expect(screen.queryByText(/确定性选择题评测|服务端事务|同一事务|判分方式|AI 服务|工作流|已携带本次作答|已写入学习证据/iu)).not.toBeInTheDocument();
    await waitFor(() => expect(resultHeading).toHaveFocus());
  });

  it("locks a pilot question and completes it with the server-issued attempt id", async () => {
    renderPractice(
      "/student/practice?subject=数据结构&concept_id=ds_c03_02&question_id=2026-01&pilot_task_id=pilot_task_baseline",
    );
    await screen.findByText(questionOne.question);

    expect(screen.queryByLabelText("科目")).not.toBeInTheDocument();
    expect(screen.getByText("课程固定题目")).toBeInTheDocument();
    expect(screen.getByText("独立完成当前固定题，提交后返回课程试点流程。")).toBeInTheDocument();
    expect(screen.queryByText(/服务端记录/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看原始来源" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    await waitFor(() => expect(apiMocks.evaluatePilotChoiceTask).toHaveBeenCalledWith(
      "pilot_task_baseline",
      { selected_option_ids: ["A"] },
      expect.any(String),
    ));
    expect(apiMocks.completePilotTask).not.toHaveBeenCalled();
    expect(screen.queryByText("正确答案")).not.toBeInTheDocument();
    expect(screen.queryByText("正确答案：A")).not.toBeInTheDocument();
    expect(screen.queryByText("题目解析")).not.toBeInTheDocument();
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
    expect(await screen.findByRole("link", { name: "返回课程试点流程" })).toHaveAttribute(
      "href",
      "/student/pilot-study",
    );
  });

  it("requests diagnosis only after a real computer-organization evaluation exists", async () => {
    const organizationQuestion = {
      ...questionOne,
      id: "2026-20",
      subject: "组成原理",
      question: "MAR 用于保存什么？",
      tags: ["存储器"],
    };
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem(organizationQuestion)],
      total: 217,
      limit: 1,
      offset: 0,
    });
    renderPractice("/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86");

    await screen.findByText("MAR 用于保存什么？");
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(await screen.findByRole("heading", { name: "回答正确" })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledWith({
      contract_version: "0.2",
      capability: "diagnose",
      course_id: "course_408_co",
      concept_id: null,
      qa_id: null,
      attempt_id: "attempt_001",
      user_message: null,
    }));
    expect(screen.queryByText("AI 服务待连接")).not.toBeInTheDocument();
  });

  it("requests diagnosis for a data-structure evaluation with its curriculum context", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [practiceItem()],
      total: 57,
      limit: 1,
      offset: 0,
      context: {
        concept_id: "ds_c02_02",
        concept_title: "顺序表的存储表示",
        course_id: "course_408_ds",
        course_title: "数据结构",
        subject: "数据结构",
        match_method: "exact_question_tag",
      },
    });
    renderPractice("/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02");

    await screen.findByText(questionOne.question);
    expect(apiMocks.invokeAiWorkflow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(await screen.findByRole("heading", { name: "回答正确" })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.invokeAiWorkflow).toHaveBeenCalledWith({
      contract_version: "0.2",
      capability: "diagnose",
      course_id: "course_408_ds",
      concept_id: "ds_c02_02",
      qa_id: null,
      attempt_id: "attempt_001",
      user_message: null,
    }));
  });

  it("renders an explicit incorrect state from the deterministic result", async () => {
    apiMocks.submitQuestionAnswer.mockResolvedValue(evaluation("incorrect"));
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(await screen.findByRole("heading", { name: "这题未答对" })).toBeInTheDocument();
    expect(screen.getByText("正确答案：B")).toBeInTheDocument();
    expect(screen.queryByText(/标准答案逐项比对|AI 猜测/)).not.toBeInTheDocument();
  });

  it("offers an optional contrast check after a reliable incorrect answer", async () => {
    apiMocks.submitQuestionAnswer.mockResolvedValue(evaluation("incorrect"));
    apiMocks.getLearningProbeOffer.mockResolvedValue(learningProbeOffer);
    apiMocks.invokeAiWorkflow.mockRejectedValueOnce(new Error("ai offline"));
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    const followUp = await screen.findByRole("region", { name: "待确认的知识点" });
    expect(followUp).toHaveTextContent("这次先记为一个待确认信号");
    expect(followUp).toHaveTextContent("用另一道题确认是不是同一处卡点");
    expect(within(followUp).getByRole("button", { name: "现在验证" })).toBeEnabled();
    expect(within(followUp).getByRole("button", { name: "稍后复习" })).toBeEnabled();
    expect(within(followUp).getByRole("button", { name: "跳过" })).toBeEnabled();
    expect(apiMocks.getLearningProbeOffer).toHaveBeenCalledWith("attempt_001");
  });

  it("uses the server-assigned contrast question and separates concept evidence from item review", async () => {
    apiMocks.submitQuestionAnswer.mockResolvedValue(evaluation("incorrect"));
    apiMocks.getLearningProbeOffer.mockResolvedValue(learningProbeOffer);
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    fireEvent.click(await screen.findByRole("button", { name: "现在验证" }));

    expect(apiMocks.startLearningProbe).toHaveBeenCalledWith("probe_session_001");
    const contrast = await screen.findByRole("region", { name: "对照验证题" });
    expect(within(contrast).getByRole("heading", { name: "换一道题确认" })).toBeInTheDocument();
    expect(within(contrast).getByText(learningProbeOffer.question.question.question)).toBeInTheDocument();
    fireEvent.click(within(contrast).getByRole("radio", { name: "B. 8 位" }));
    fireEvent.click(within(contrast).getByRole("button", { name: "提交验证" }));

    await waitFor(() => expect(apiMocks.submitLearningProbe).toHaveBeenCalledWith(
      "probe_session_001",
      {
        question_id: "probe-co-storage-contrast-v1",
        answer_type: "choice",
        selected_option_ids: ["B"],
      },
      expect.any(String),
    ));
    const result = await screen.findByRole("region", { name: "验证结果" });
    expect(result).toHaveTextContent("知识点表现");
    expect(result).toHaveTextContent("已有一次新的正确证据，继续观察");
    expect(result).toHaveTextContent("还需要跨日且来自不同题面的证据");
    expect(result).not.toHaveTextContent("已掌握");
  });

  it("keeps an offered check for later without changing concept evidence", async () => {
    apiMocks.submitQuestionAnswer.mockResolvedValue(evaluation("incorrect"));
    apiMocks.getLearningProbeOffer.mockResolvedValue(learningProbeOffer);
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    fireEvent.click(await screen.findByRole("button", { name: "稍后复习" }));

    expect(await screen.findByText("已保留在错题复习中，之后仍可回来验证。")).toBeInTheDocument();
    expect(apiMocks.startLearningProbe).not.toHaveBeenCalled();
    expect(apiMocks.skipLearningProbe).not.toHaveBeenCalled();
    expect(apiMocks.submitLearningProbe).not.toHaveBeenCalled();
  });

  it("skips an offered check without treating the skip as learning evidence", async () => {
    apiMocks.submitQuestionAnswer.mockResolvedValue(evaluation("incorrect"));
    apiMocks.getLearningProbeOffer.mockResolvedValue(learningProbeOffer);
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    fireEvent.click(await screen.findByRole("button", { name: "跳过" }));

    expect(apiMocks.skipLearningProbe).toHaveBeenCalledWith("probe_session_001");
    expect(await screen.findByText("本次已跳过，不影响错题复习和后续学习。")).toBeInTheDocument();
    expect(apiMocks.submitLearningProbe).not.toHaveBeenCalled();
  });

  it("recovers an unfinished contrast check from the URL and server session", async () => {
    apiMocks.getLearningProbeSession.mockResolvedValue({ ...learningProbeSession, status: "offered" });
    apiMocks.getLearningProbeOfferForSession.mockResolvedValue(learningProbeOffer);
    renderPractice("/student/practice?subject=组成原理&probe_session_id=probe_session_001");

    const offeredRegion = await screen.findByRole("region", { name: "待确认的知识点" });
    expect(offeredRegion).toHaveTextContent(learningProbeOffer.concept_title);
    expect(offeredRegion).not.toHaveTextContent(learningProbeOffer.question.question.question);
    expect(apiMocks.getLearningProbeSession).toHaveBeenCalledWith("probe_session_001");
    expect(apiMocks.getLearningProbeOfferForSession).toHaveBeenCalledWith("probe_session_001");
    expect(apiMocks.startLearningProbe).not.toHaveBeenCalled();
    expect(apiMocks.getLearningProbeOffer).not.toHaveBeenCalled();
  });

  it("ignores a stale orchestration task id when recovering a probe session", async () => {
    apiMocks.getLearningProbeSession.mockResolvedValue({ ...learningProbeSession, status: "offered" });
    apiMocks.getLearningProbeOfferForSession.mockResolvedValue(learningProbeOffer);
    renderPractice(
      "/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86&probe_session_id=probe_session_001&orchestration_task_id=stale_task_001",
    );

    const offeredRegion = await screen.findByRole("region", { name: "待确认的知识点" });
    expect(offeredRegion).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.activateStudentLearningTask).not.toHaveBeenCalled());

    fireEvent.click(within(offeredRegion).getByRole("button", { name: "现在验证" }));
    const contrast = await screen.findByRole("region", { name: "对照验证题" });
    fireEvent.click(within(contrast).getByRole("radio", { name: "B. 8 位" }));
    fireEvent.click(within(contrast).getByRole("button", { name: "提交验证" }));

    expect(await screen.findByRole("region", { name: "验证结果" })).toBeInTheDocument();
    expect(apiMocks.completeStudentLearningTask).not.toHaveBeenCalled();
  });

  it("falls back to ordinary mistake review when no governed contrast question exists", async () => {
    apiMocks.submitQuestionAnswer.mockResolvedValue(evaluation("incorrect"));
    apiMocks.getLearningProbeOffer.mockResolvedValue(null);
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(await screen.findByText("当前没有合格的对照题，这次错题已保留在普通错题复习中。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入错题复习" })).toHaveAttribute("href", "/student/mistakes");
    expect(screen.queryByRole("button", { name: "现在验证" })).not.toBeInTheDocument();
  });

  it("continues to the next question and moves focus back to its heading", async () => {
    apiMocks.getQuestionBankQuestions
      .mockResolvedValueOnce({ items: [practiceItem()], total: 197, limit: 1, offset: 0 })
      .mockResolvedValueOnce({ items: [practiceItem(questionTwo)], total: 197, limit: 1, offset: 1 });
    renderPractice();
    await screen.findByText(questionOne.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    fireEvent.click(await screen.findByRole("button", { name: "继续下一题" }));

    expect(await screen.findByText(questionTwo.question)).toBeInTheDocument();
    expect(apiMocks.getQuestionBankQuestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 1, limit: 1 }),
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: /第 2 题/ })).toHaveFocus());
  });

  it("does not settle the first orchestration task again after continuing to another question", async () => {
    apiMocks.getQuestionBankQuestions
      .mockResolvedValueOnce({ items: [practiceItem()], total: 197, limit: 1, offset: 0 })
      .mockResolvedValueOnce({ items: [practiceItem(questionTwo)], total: 197, limit: 1, offset: 1 });
    renderPractice("/student/practice?subject=数据结构&orchestration_task_id=live_task_001");
    await screen.findByText(questionOne.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    await waitFor(() => expect(apiMocks.completeStudentLearningTask).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "继续下一题" }));
    await screen.findByText(questionTwo.question);
    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    await waitFor(() => expect(apiMocks.submitQuestionAnswer).toHaveBeenCalledTimes(2));

    expect(apiMocks.completeStudentLearningTask).toHaveBeenCalledTimes(1);
    expect(apiMocks.completeStudentLearningTask).toHaveBeenCalledWith("live_task_001");
  });

  it("recovers from a question loading error", async () => {
    apiMocks.getQuestionBankQuestions
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [practiceItem()], total: 197, limit: 1, offset: 0 });
    renderPractice();

    expect(await screen.findByRole("alert")).toHaveTextContent("题目加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText(questionOne.question)).toBeInTheDocument();
  });

  it("keeps the selected answer when evaluation fails", async () => {
    apiMocks.submitQuestionAnswer.mockRejectedValue(new Error("network"));
    renderPractice();
    await screen.findByText(questionOne.question);
    const option = screen.getByRole("radio", { name: "A. O(1)" });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("评测提交失败");
    expect(option).toBeChecked();
    expect(screen.getByRole("button", { name: "重新提交" })).toBeEnabled();
  });

  it("reuses one idempotency key when a network retry resubmits the same answer", async () => {
    apiMocks.submitQuestionAnswer
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(evaluation());
    renderPractice();
    await screen.findByText(questionOne.question);

    fireEvent.click(screen.getByRole("radio", { name: "A. O(1)" }));
    fireEvent.click(screen.getByRole("button", { name: "提交并查看结果" }));
    await screen.findByRole("alert");
    const firstKey = apiMocks.submitQuestionAnswer.mock.calls[0]?.[1];
    expect(typeof firstKey).toBe("string");

    fireEvent.click(screen.getByRole("button", { name: "重新提交" }));
    await waitFor(() => expect(apiMocks.submitQuestionAnswer).toHaveBeenCalledTimes(2));
    expect(apiMocks.submitQuestionAnswer.mock.calls[1]?.[1]).toBe(firstKey);
  });

  it("explains an empty filter result and lets the student clear it", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [], total: 0, limit: 1, offset: 0,
    });
    renderPractice();

    expect(await screen.findByRole("heading", { name: "当前筛选没有可用题目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除年份与标签" })).toBeInTheDocument();
  });

  it("offers honest course-wide training when a legacy concept URL has no reliable questions", async () => {
    apiMocks.getQuestionBankQuestions.mockResolvedValue({
      items: [],
      total: 0,
      limit: 1,
      offset: 0,
      context: {
        concept_id: "co_c01_03",
        concept_title: "体系结构与计算机组成",
        course_id: "course_408_co",
        course_title: "计算机组成原理",
        subject: "组成原理",
        match_method: "exact_question_tag",
      },
    });
    renderPractice("/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86&concept_id=co_c01_03");

    expect(await screen.findByRole("heading", { name: "该知识点暂无关联题目" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入组成原理综合训练" })).toHaveAttribute(
      "href",
      "/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86",
    );
    expect(screen.getByRole("link", { name: "返回课程学习" })).toHaveAttribute(
      "href",
      "/student/courses/computer-organization",
    );
  });

  it("keeps photo tutoring outside the five formal practice modes", async () => {
    renderPractice();
    await screen.findByText(questionOne.question);

    const modeNavigation = screen.getByRole("navigation", { name: "训练模式" });
    expect(within(modeNavigation).getAllByRole("listitem")).toHaveLength(5);
    expect(within(modeNavigation).queryByText("拍照讲题")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "上传题目图片" })).toHaveAttribute(
      "href",
      "/student/practice/photo-tutor",
    );
  });
});
