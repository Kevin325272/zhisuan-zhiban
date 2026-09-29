import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CourseLearningSummary,
  ExamPaperManagementResponse,
  ManagedQuestionSummary,
  MaterialRecord,
  PilotManagementReport,
} from "@xuetu/contracts";

import { ApiError } from "../../api/client";
import { AdminEntryPage } from "./admin-entry-page";

const apiMocks = vi.hoisted(() => ({
  getManagedQuestions: vi.fn(),
  getManagedMaterials: vi.fn(),
  getManagedLearningSummary: vi.fn(),
  getManagedExamPapers: vi.fn(),
  getManagedAccounts: vi.fn(),
  createManagedAccount: vi.fn(),
  getManagedAcademicClasses: vi.fn(),
  approveManagedTeacher: vi.fn(),
  resetManagedAccountPassword: vi.fn(),
  getPilotManagementReport: vi.fn(),
  enrollPilotParticipant: vi.fn(),
  downloadPilotReport: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...apiMocks,
}));

vi.mock("../exam-papers/exam-paper-client", () => ({
  getManagedExamPapers: apiMocks.getManagedExamPapers,
}));

vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    account: {
      user_id: "user_admin_001",
      username: "admin_local",
      display_name: "管理员",
      roles: ["admin"],
    },
    logout: authMocks.logout,
  }),
}));

const examPapers: ExamPaperManagementResponse = {
  items: [
    {
      exam_paper_id: "exam_001",
      university: "上海科技大学",
      year: 2022,
      subject: "991数据结构与算法",
      paper_type: "exam",
      page_count: 6,
      content_mode: "text_layer",
      official_source_url: "https://sist.shanghaitech.edu.cn/paper.pdf",
      has_answer_key: false,
      automatic_grading: false,
      landing_page_url: "https://sist.shanghaitech.edu.cn/paper/index.htm",
      file_size_bytes: 794_412,
      course_id: "course_408_001",
      pdf_sha256: "a".repeat(64),
      archive_sha256: "b".repeat(64),
      license_status: "unverified",
      usage_scope: "local_demo_only",
      training_allowed: false,
      review_status: "unreviewed",
      reviewed_by: null,
      reviewed_at: null,
      updated_at: "2026-07-31T00:00:00.000Z",
    },
  ],
  total: 67,
  scan_count: 35,
  text_layer_count: 32,
  license_unverified_count: 67,
  data_scope: "stored_records_only",
};

const questions: ManagedQuestionSummary[] = [
  {
    question_id: "2026-01",
    course_id: "course_408_001",
    year: 2026,
    number: 1,
    subject: "数据结构",
    type: "choice",
    tags: ["线性表"],
    source_url: "https://www.csgraduates.com/study_methods/408quiz/2026/#1",
    license_status: "unverified",
    usage_scope: "local_demo_only",
    review_status: "pending_review",
    reviewed_by: null,
    reviewed_at: null,
    updated_at: "2026-07-27T00:00:00.000Z",
  },
  {
    question_id: "practice-408-v1-02",
    course_id: "course_408_001",
    year: null,
    number: 2,
    subject: "数据结构",
    type: "choice",
    tags: ["图"],
    source_url: "https://xuetu.local/practice/408-v1",
    license_status: "verified",
    usage_scope: "authorized_product_use",
    review_status: "unreviewed",
    reviewed_by: null,
    reviewed_at: null,
    updated_at: "2026-07-27T00:00:00.000Z",
  },
];

const materials: MaterialRecord[] = [];

const summary: CourseLearningSummary = {
  course_id: "course_408_001",
  active_students: 1,
  attempt_count: 2,
  deterministic_correct_count: 1,
  deterministic_incorrect_count: 1,
  pending_review_count: 0,
  evidence_count: 2,
  generated_at: "2026-07-28T00:00:00.000Z",
  data_scope: "stored_records_only",
};

const accounts = [{
  user_id: "user_admin_001",
  username: "admin_local",
  display_name: "管理员",
  account_status: "active",
  roles: ["admin"],
  auth_source: "local_development",
  account_origin: "seeded_admin",
  data_boundary: "local_account",
  must_change_password: false,
  created_at: "2026-08-02T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
  last_login_at: null,
}] as const;

const pilotReport: PilotManagementReport = {
  study: { study_id: "pilot_408_queue_v1", title: "队列知识点三阶段试用", notice_version: "pilot_notice_v1", notice_text: "知情说明" },
  generated_at: "2026-08-22T10:00:00.000Z",
  data_scope: "real_and_synthetic",
  claim_boundary: "small_sample_observational",
  summary: {
    real_participants: 0,
    synthetic_participants: 0,
    consented_real_participants: 0,
    completed_real_participants: 0,
    baseline_evaluated_count: 0,
    baseline_correct_count: 0,
    transfer_evaluated_count: 0,
    transfer_correct_count: 0,
    baseline_correct_rate: null,
    transfer_correct_rate: null,
    observed_change_percentage_points: null,
    average_completion_minutes: null,
    average_ease_of_use: null,
    average_guidance_helpfulness: null,
    average_confidence_before: null,
    average_confidence_after: null,
    average_confidence_change: null,
    average_continued_use_intent: null,
  },
  participants: [],
};

describe("AdminEntryPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    apiMocks.getManagedQuestions.mockReset().mockResolvedValue({ items: questions });
    apiMocks.getManagedMaterials.mockReset().mockResolvedValue({ items: materials });
    apiMocks.getManagedLearningSummary.mockReset().mockResolvedValue(summary);
    apiMocks.getManagedExamPapers.mockReset().mockResolvedValue(examPapers);
    apiMocks.getManagedAccounts.mockReset().mockResolvedValue({ items: accounts });
    apiMocks.createManagedAccount.mockReset().mockResolvedValue({ account: accounts[0] });
    apiMocks.getManagedAcademicClasses.mockReset().mockResolvedValue({
      items: [{
        class_id: "class_cs_2302",
        cohort_year: 2023,
        major: "计算机科学与技术",
        class_name: "计算机科学与技术2302班",
      }],
    });
    apiMocks.approveManagedTeacher.mockReset().mockResolvedValue({ account: accounts[0] });
    apiMocks.resetManagedAccountPassword.mockReset().mockResolvedValue({ account: accounts[0] });
    apiMocks.getPilotManagementReport.mockReset().mockResolvedValue(pilotReport);
    apiMocks.enrollPilotParticipant.mockReset();
    apiMocks.downloadPilotReport.mockReset();
    authMocks.logout.mockReset().mockResolvedValue(undefined);
  });

  it("announces that governance data is loading without exposing infrastructure", () => {
    apiMocks.getManagedQuestions.mockReturnValue(new Promise(() => undefined));
    apiMocks.getManagedMaterials.mockReturnValue(new Promise(() => undefined));
    apiMocks.getManagedLearningSummary.mockReturnValue(new Promise(() => undefined));
    apiMocks.getManagedExamPapers.mockReturnValue(new Promise(() => undefined));

    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("正在读取管理数据…")).toBeInTheDocument();
    expect(screen.queryByText(/PostgreSQL|API/iu)).not.toBeInTheDocument();
  });

  it("renders a truthful governance ledger from the management APIs", async () => {
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("2 道题")).toBeInTheDocument();
    expect(screen.getByText("1 条授权待核验")).toBeInTheDocument();
    expect(screen.getByText("1 名在课学生")).toBeInTheDocument();
    expect(screen.getByText("0 份课程资料")).toBeInTheDocument();
    expect(screen.getByText("自命题试卷与来源")).toBeInTheDocument();
    expect(screen.getByText("67 份已收录整卷")).toBeInTheDocument();
    expect(screen.getByText("35 份扫描版")).toBeInTheDocument();
    expect(screen.getAllByText("授权待核验 67")).toHaveLength(2);
    expect(screen.getByText("上海科技大学")).toBeInTheDocument();
    expect(screen.getByText("1 个账户")).toBeInTheDocument();
    expect(screen.getAllByText("admin_local")).toHaveLength(2);
    expect(screen.getByText("只显示账户身份、使用状态和可执行操作")).toBeInTheDocument();
    expect(screen.getByText("2026-01")).toBeInTheDocument();
    expect(screen.getByText("自编题 / 2")).toBeInTheDocument();
    expect(screen.getByText("待复核")).toBeInTheDocument();
    expect(screen.getByText("1 次答对，1 次答错")).toBeInTheDocument();
    expect(screen.getByText("仅统计当前已有学习记录。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "账户与权限" })).toBeInTheDocument();
    expect(screen.queryByText(/FIRST RELEASE|确定性|计算机学科 AI 助学平台|course_408_001|用户与 RBAC|数据库区分|本地 ZIP|服务端来源包|来源边界|条证据/iu)).not.toBeInTheDocument();
    expect(screen.getByText("真实试用验证")).toBeInTheDocument();
    expect(apiMocks.getPilotManagementReport).toHaveBeenCalledWith(true);
  });

  it("keeps account management available when an unrelated section fails", async () => {
    apiMocks.getManagedQuestions.mockRejectedValueOnce(
      new ApiError("数据库暂时不可用", "DATABASE_UNAVAILABLE", true, {}),
    );

    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("部分内容暂时无法读取");
    expect(screen.getByRole("heading", { name: "创建账户" })).toBeInTheDocument();
    expect(screen.getByText("题库内容暂时无法读取")).toBeInTheDocument();
    expect(screen.queryByText("数据库暂时不可用")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));

    await waitFor(() => expect(apiMocks.getManagedQuestions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("2 道题")).toBeInTheDocument();
  });

  it("shows a full-load failure when every management request fails", async () => {
    const offline = new Error("offline");
    apiMocks.getManagedQuestions.mockRejectedValueOnce(offline);
    apiMocks.getManagedMaterials.mockRejectedValueOnce(offline);
    apiMocks.getManagedLearningSummary.mockRejectedValueOnce(offline);
    apiMocks.getManagedExamPapers.mockRejectedValueOnce(offline);
    apiMocks.getManagedAccounts.mockRejectedValueOnce(offline);
    apiMocks.getManagedAcademicClasses.mockRejectedValueOnce(offline);
    apiMocks.getPilotManagementReport.mockRejectedValueOnce(offline);

    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取管理内容");
    expect(screen.queryByRole("heading", { name: "账户与权限" })).not.toBeInTheDocument();
  });

  it("keeps account creation available when the class list cannot be read", async () => {
    apiMocks.getManagedAcademicClasses.mockRejectedValueOnce(new Error("offline"));
    apiMocks.getManagedAccounts.mockResolvedValueOnce({
      items: [{
        ...accounts[0],
        user_id: "user_teacher_pending",
        username: "teacher_apply_01",
        display_name: "申请教师",
        account_status: "pending_approval",
        roles: ["teacher"],
        account_origin: "registered",
      }],
    });
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "创建账户" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审核教师" }));
    expect(screen.getByRole("status")).toHaveTextContent("班级信息暂时无法读取，请重新读取后再审核教师");
    expect(screen.getByRole("button", { name: "通过审核" })).toBeDisabled();
  });

  it("revokes the server session on exit", async () => {
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "管理员工作台" });
    fireEvent.click(screen.getByRole("link", { name: "退出登录" }));
    await waitFor(() => expect(authMocks.logout).toHaveBeenCalledOnce());
  });

  it("creates students directly and sends administrator-entered teachers to approval", async () => {
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "管理员工作台" });
    expect(screen.getByText(/学生账户自动加入当前配置的 408 四科/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "学生所属课程" })).not.toBeInTheDocument();

    expect(screen.getByRole("textbox", { name: "新账户用户名" })).toHaveAttribute("name", "username");
    expect(screen.getByRole("textbox", { name: "新账户用户名" })).toHaveAttribute("autocomplete", "off");
    expect(screen.getByRole("textbox", { name: "新账户用户名" })).toHaveAttribute("spellcheck", "false");
    expect(screen.getByRole("textbox", { name: "新账户用户名" })).toHaveAttribute("pattern", "[^\\p{C}\\s]{1,32}");
    expect(screen.getByRole("textbox", { name: "新账户显示名称" })).toHaveAttribute("name", "display_name");
    expect(screen.getByLabelText("新账户初始密码")).toHaveAttribute("name", "password");
    expect(screen.getByLabelText("新账户初始密码")).toHaveAttribute("minlength", "6");
    expect(screen.getByRole("combobox", { name: "新账户角色" })).toHaveAttribute("name", "role");

    fireEvent.change(screen.getByRole("textbox", { name: "新账户用户名" }), { target: { value: "student_408" } });
    fireEvent.change(screen.getByRole("textbox", { name: "新账户显示名称" }), { target: { value: "筛查学生" } });
    fireEvent.change(screen.getByLabelText("新账户初始密码"), { target: { value: "StrongPassword123" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(apiMocks.createManagedAccount).toHaveBeenCalledWith({
      username: "student_408",
      display_name: "筛查学生",
      password: "StrongPassword123",
      role: "student",
    }));

    fireEvent.change(screen.getByRole("combobox", { name: "新账户角色" }), {
      target: { value: "teacher" },
    });
    expect(screen.queryByRole("combobox", { name: "教师授权课程" })).not.toBeInTheDocument();
    expect(screen.getByText("教师账户创建后仍需审核资料、课程和班级，审核通过后才能登录。")).toBeInTheDocument();

    apiMocks.createManagedAccount.mockResolvedValueOnce({
      account: { ...accounts[0], account_status: "pending_approval", roles: ["teacher"] },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "新账户用户名" }), { target: { value: "teacher_408" } });
    fireEvent.change(screen.getByRole("textbox", { name: "新账户显示名称" }), { target: { value: "王老师" } });
    fireEvent.change(screen.getByLabelText("新账户初始密码"), { target: { value: "StrongPassword123" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(apiMocks.createManagedAccount).toHaveBeenLastCalledWith({
      username: "teacher_408",
      display_name: "王老师",
      password: "StrongPassword123",
      role: "teacher",
    }));
    expect(await screen.findByText("教师账户已创建，补充教师资料和负责班级后即可启用。")).toBeInTheDocument();
  });

  it("prevents duplicate account creation while the first request is pending", async () => {
    let resolveCreate: ((value: { account: (typeof accounts)[number] }) => void) | undefined;
    apiMocks.createManagedAccount.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "管理员工作台" });
    fireEvent.change(screen.getByRole("textbox", { name: "新账户用户名" }), { target: { value: "student_408" } });
    fireEvent.change(screen.getByRole("textbox", { name: "新账户显示名称" }), { target: { value: "筛查学生" } });
    fireEvent.change(screen.getByLabelText("新账户初始密码"), { target: { value: "StrongPassword123" } });
    const createButton = screen.getByRole("button", { name: "创建" });
    fireEvent.click(createButton);

    expect(await screen.findByRole("button", { name: "正在创建…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "正在创建…" }));
    expect(apiMocks.createManagedAccount).toHaveBeenCalledTimes(1);

    resolveCreate?.({ account: accounts[0] });
    expect(await screen.findByRole("button", { name: "创建" })).toBeEnabled();
  });

  it("resets a password through a confirmed masked dialog", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "管理员工作台" });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "重置 admin_local 的密码" })).toBeInTheDocument();
    const passwordInput = screen.getByLabelText("新临时密码");
    const confirmationInput = screen.getByLabelText("确认新临时密码");
    expect(passwordInput).toHaveAttribute("autocomplete", "new-password");
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toHaveAttribute("minlength", "6");
    expect(confirmationInput).toHaveAttribute("minlength", "6");
    expect(screen.getByText("6 至 128 位，不能包含空格。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(confirmationInput).toHaveAttribute("type", "text");

    fireEvent.change(passwordInput, { target: { value: "StrongPassword123" } });
    fireEvent.change(confirmationInput, { target: { value: "DifferentPassword456" } });
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(apiMocks.resetManagedAccountPassword).not.toHaveBeenCalled();

    fireEvent.change(confirmationInput, { target: { value: "StrongPassword123" } });
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    await waitFor(() => expect(apiMocks.resetManagedAccountPassword).toHaveBeenCalledWith(
      "user_admin_001",
      "StrongPassword123",
    ));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    promptSpy.mockRestore();
  });

  it("reviews a pending teacher with verified profile, course, and class scope", async () => {
    apiMocks.getManagedAccounts.mockResolvedValueOnce({
      items: [{
        ...accounts[0],
        user_id: "user_teacher_pending",
        username: "teacher_apply_01",
        display_name: "申请教师",
        account_status: "pending_approval",
        roles: ["teacher"],
        account_origin: "registered",
      }],
    });
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("待审核")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审核教师" }));
    expect(screen.getByLabelText("教师编号")).toHaveFocus();
    expect(screen.getByLabelText("教师编号")).toHaveAttribute("name", "teacher_number");
    expect(screen.getByLabelText("教师编号")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("院系")).toHaveAttribute("name", "department");
    expect(screen.getByLabelText("职称")).toHaveAttribute("name", "professional_title");
    expect(screen.getByLabelText("授权课程")).toHaveAttribute("name", "course_id");
    fireEvent.change(screen.getByLabelText("教师编号"), { target: { value: "T2026001" } });
    fireEvent.change(screen.getByLabelText("院系"), { target: { value: "计算机科学与技术学院" } });
    fireEvent.change(screen.getByLabelText("职称"), { target: { value: "讲师" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "计算机科学与技术2302班" }));
    fireEvent.click(screen.getByRole("button", { name: "通过审核" }));

    await waitFor(() => expect(apiMocks.approveManagedTeacher).toHaveBeenCalledWith(
      "user_teacher_pending",
      {
        teacher_number: "T2026001",
        department: "计算机科学与技术学院",
        professional_title: "讲师",
        course_id: "course_408_ds",
        class_ids: ["class_cs_2302"],
      },
    ));
  });

  it("submits teacher approval only once while the request is pending", async () => {
    apiMocks.getManagedAccounts.mockResolvedValueOnce({
      items: [{
        ...accounts[0],
        user_id: "user_teacher_pending",
        username: "teacher_apply_01",
        display_name: "申请教师",
        account_status: "pending_approval",
        roles: ["teacher"],
        account_origin: "registered",
      }],
    });
    let resolveApproval: ((value: { account: (typeof accounts)[number] }) => void) | undefined;
    apiMocks.approveManagedTeacher.mockReturnValue(new Promise((resolve) => {
      resolveApproval = resolve;
    }));
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "审核教师" }));
    fireEvent.change(screen.getByLabelText("教师编号"), { target: { value: "T2026001" } });
    fireEvent.change(screen.getByLabelText("院系"), { target: { value: "计算机科学与技术学院" } });
    fireEvent.change(screen.getByLabelText("职称"), { target: { value: "讲师" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "计算机科学与技术2302班" }));
    const form = screen.getByRole("button", { name: "通过审核" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "正在审核…" })).toBeDisabled();
    fireEvent.submit(form!);

    expect(apiMocks.approveManagedTeacher).toHaveBeenCalledTimes(1);
    resolveApproval?.({ account: accounts[0] });
    expect(await screen.findByText("教师账户已通过审核，可以登录教师端。")).toBeInTheDocument();
  });

  it("explains why a teacher cannot be approved before classes are available", async () => {
    apiMocks.getManagedAccounts.mockResolvedValueOnce({
      items: [{
        ...accounts[0],
        user_id: "user_teacher_pending",
        username: "teacher_apply_01",
        display_name: "申请教师",
        account_status: "pending_approval",
        roles: ["teacher"],
        account_origin: "registered",
      }],
    });
    apiMocks.getManagedAcademicClasses.mockResolvedValueOnce({ items: [] });
    render(
      <MemoryRouter>
        <AdminEntryPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "审核教师" }));
    expect(screen.getByRole("status")).toHaveTextContent("暂未录入班级，需先补充班级后再审核教师");
    expect(screen.getByRole("button", { name: "通过审核" })).toBeDisabled();
  });
});
