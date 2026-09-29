import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeacherEntryPage } from "./teacher-entry-page";

function response(data: unknown) {
  return {
    ok: true,
    json: async () => ({ contract_version: "0.1", request_id: "req_teacher_test", data }),
  } as Response;
}

function errorResponse(status: number, message = "请求失败") {
  return {
    ok: false,
    status,
    json: async () => ({
      contract_version: "0.1",
      request_id: "req_teacher_error",
      error: { code: "TEST_ERROR", message, retryable: false, details: {} },
    }),
  } as Response;
}

const students = {
  course_id: "course_408_ds",
  items: [{
    student_code: "P7F3A1C20",
    display_name: "许泽宇",
    student_number: "2315929354",
    cohort_year: 2023,
    major: "计算机科学与技术",
    class_name: "计算机科学与技术2302班",
    onboarding_status: "in_progress",
    last_active_at: "2026-08-23T08:00:00.000Z",
    plan_completion_percent: 40,
    accuracy_percent: 60,
    correct_count: 3,
    incorrect_count: 2,
    evidence_count: 5,
    pending_review_mistake_count: 1,
    weekly_study_minutes: 235,
    current_focus: "队列与循环队列",
    focus_source: "demo_snapshot",
    recent_attempt_count: 0,
    learning_status: "needs_attention",
    data_provenance: "synthetic_demo",
  }, {
    student_code: "P8D4B2E31",
    display_name: "韩若曦",
    student_number: "2315929381",
    cohort_year: 2023,
    major: "软件工程",
    class_name: "软件工程2301班",
    onboarding_status: "completed",
    last_active_at: "2026-08-23T10:00:00.000Z",
    plan_completion_percent: 72,
    accuracy_percent: 82,
    correct_count: 9,
    incorrect_count: 2,
    evidence_count: 13,
    pending_review_mistake_count: 0,
    weekly_study_minutes: 318,
    current_focus: "树与二叉树",
    focus_source: "reading",
    recent_attempt_count: 4,
    learning_status: "on_track",
    data_provenance: "synthetic_demo",
  }],
  teachers: [{
    display_name: "陈明远",
    teacher_number: "T2008016",
    department: "计算机科学与技术系",
    professional_title: "副教授",
    assigned_classes: ["计算机科学与技术2302班", "软件工程2301班"],
    data_provenance: "synthetic_demo",
  }],
  generated_at: "2026-08-23T08:00:00.000Z",
  data_scope: "includes_synthetic_demo",
  pagination: {
    page: 1,
    page_size: 15,
    total_items: 2,
    total_pages: 1,
  },
  filters: {
    class_name: "assigned",
    learning_status: "all",
    available_classes: ["计算机科学与技术2302班", "软件工程2301班"],
  },
  summary: {
    student_count: 2,
    attention_count: 1,
    average_progress_percent: 56,
    average_accuracy_percent: 71,
    weekly_study_minutes: 553,
    evidence_count: 18,
  },
};

const evidence = {
  course_id: "course_408_ds",
  generated_at: "2026-08-23T08:00:00.000Z",
  data_scope: "stored_records_only",
  active_student_count: 1,
  top_weak_concepts: [{
    concept_id: "ds_c03_02",
    concept_title: "队列与循环队列",
    attempt_count: 6,
    incorrect_count: 4,
    pending_review_count: 3,
    student_count: 1,
    last_activity_at: "2026-08-23T08:00:00.000Z",
  }],
  recent_interventions: [],
};

const evidenceWithQuality = {
  ...evidence,
  top_weak_concepts: [],
  window: {
    start_at: "2026-08-09T00:00:00.000Z",
    end_at: "2026-08-23T08:00:00.000Z",
    days: 14,
  },
  sample: {
    minimum_students: 5,
    active_student_count: 6,
    active_window_student_count: 5,
    valid_attempt_student_count: 4,
    real_trial_valid_attempt_student_count: 3,
    sufficient: false,
  },
  evidence_status: "insufficient_sample" as const,
  source_scope: "real_and_synthetic" as const,
  source_breakdown: {
    real_trial: { student_count: 3, valid_attempt_count: 8, incorrect_count: 2, error_rate: 25 },
    synthetic_verification: { student_count: 1, valid_attempt_count: 4, incorrect_count: 2, error_rate: 50 },
    local_demo: { student_count: 0, valid_attempt_count: 0, incorrect_count: 0, error_rate: 0 },
  },
};

const plannedIntervention = {
  intervention_id: "intervention_001",
  course_id: "course_408_ds",
  concept_id: "ds_c03_02",
  concept_title: "队列与循环队列",
  action: "assign_review" as const,
  note: "请完成一道循环队列边界条件练习。",
  target_type: "class" as const,
  target_class_id: "class_cs_2301",
  target_class_name: "计算机科学与技术2301班",
  material_ref: null,
  due_at: null,
  status: "planned" as const,
  delivered_at: null,
  completed_at: null,
  evidence_snapshot: null,
  created_at: "2026-08-22T08:00:00.000Z",
};

const classManagement = {
  course_id: "course_408_ds",
  classes: [{
    class_id: "class_se_2301",
    class_name: "软件工程2301班",
    cohort_year: 2023,
    major: "软件工程",
    member_count: 1,
    pending_request_count: 2,
    invitation: { status: "none", code_hint: null, expires_at: null },
  }],
  pending_requests: [{
    request_id: "enrollment_request_1",
    class_id: "class_se_2301",
    class_name: "软件工程2301班",
    student_code: "P7F3A1C20",
    display_name: "许泽宇",
    student_number: "2315929354",
    status: "pending",
    submitted_at: "2026-08-26T08:00:00.000Z",
  }, {
    request_id: "enrollment_request_2",
    class_id: "class_se_2301",
    class_name: "软件工程2301班",
    student_code: "P1A2B3C4D",
    display_name: "周启航",
    student_number: "2315929366",
    status: "pending",
    submitted_at: "2026-08-26T08:05:00.000Z",
  }],
  members: [{
    class_id: "class_se_2301",
    class_name: "软件工程2301班",
    student_code: "P8D4B2E31",
    display_name: "韩若曦",
    student_number: "2315929381",
    joined_at: "2026-08-25T08:00:00.000Z",
  }],
};

function courseScope(
  courseId = "course_408_ds",
  courseCode = "CS408-DS",
  title = "数据结构",
) {
  return {
    items: [{ course_id: courseId, course_code: courseCode, title }],
    visibility: "active_memberships_only",
  };
}

describe("TeacherEntryPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a user-facing retry message when the course list cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network offline")));

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("学情暂时无法读取，请检查课程授权后重试。");
    expect(alert).not.toHaveTextContent(/API|PostgreSQL/iu);
  });

  it("renders the authorized class roster and keeps credential fields out of the view", async () => {
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      return path.includes("/evidence")
        ? Promise.resolve(response(evidence))
        : Promise.resolve(response(students));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "班级学情" })).toBeInTheDocument());
    expect(await screen.findByText("许泽宇")).toBeInTheDocument();
    expect(screen.getByText("2315929354")).toBeInTheDocument();
    expect(screen.getAllByText("计算机科学与技术2302班").length).toBeGreaterThan(0);
    const teacherProfile = screen.getByRole("region", { name: "任课教师" });
    expect(within(teacherProfile).getByText("陈明远")).toBeInTheDocument();
    expect(teacherProfile).toHaveTextContent("T2008016");
    expect(teacherProfile).toHaveTextContent("副教授");
    expect(teacherProfile).toHaveTextContent("计算机科学与技术系");
    expect(screen.queryByText("演示班级")).not.toBeInTheDocument();
    expect(screen.queryByText("模拟试点数据")).not.toBeInTheDocument();
    expect(screen.getByText("体验数据")).toBeInTheDocument();
    expect(screen.queryByText("当前页面含演示记录，仅用于体验班级查看流程，不代表正式试点结论。"))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "证据来源拆分" })).not.toBeInTheDocument();
    const studentRow = screen.getByText("2315929354").closest("tr");
    expect(studentRow).not.toBeNull();
    expect(within(studentRow!).getByRole("progressbar", { name: "许泽宇课程进度 40%" }))
      .toHaveAttribute("aria-valuenow", "40");
    expect(within(studentRow!).getByText("60%")).toBeInTheDocument();
    expect(within(studentRow!).getByText("0 次")).toBeInTheDocument();
    expect(within(studentRow!).getByText("体验场景")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "近7天作答" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "本周学习" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "当前重点" })).not.toBeInTheDocument();
    expect(screen.getByText("最近阅读")).toBeInTheDocument();
    expect(within(studentRow!).getByText("需要关注")).toBeInTheDocument();
    expect(within(studentRow!).getByText("队列与循环队列")).toBeInTheDocument();
    expect(screen.queryByText("password_hash")).not.toBeInTheDocument();
    expect(screen.queryByText("answer_key")).not.toBeInTheDocument();
    expect(screen.queryByText("course_408_ds")).not.toBeInTheDocument();
    expect(screen.queryByText("ds_c03_02")).not.toBeInTheDocument();
    expect(screen.queryByText(/数据范围|证据范围|AI 对话/)).not.toBeInTheDocument();
  });

  it("creates a class and manages its invitation code from the teacher workspace", async () => {
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      if (path.includes("/students")) return Promise.resolve(response(students));
      if (path.endsWith("/classes") && method === "POST") {
        return Promise.resolve(response({
          class_id: "class_cs_2401",
          class_name: "计算机科学与技术2401班",
          cohort_year: 2024,
          major: "计算机科学与技术",
          member_count: 0,
          pending_request_count: 0,
          invitation: { status: "none", code_hint: null, expires_at: null },
        }));
      }
      if (path.endsWith("/invitation") && method === "POST") {
        return Promise.resolve(response({
          class_id: "class_se_2301",
          invite_code: "ABCD-7K9M",
          code_hint: "****-7K9M",
          expires_at: "2026-09-25T08:00:00.000Z",
        }));
      }
      if (path.endsWith("/invitation") && method === "DELETE") {
        return Promise.resolve(response({ revoked: true }));
      }
      if (path.endsWith("/classes")) return Promise.resolve(response(classManagement));
      return Promise.resolve(errorResponse(404));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><TeacherEntryPage /></MemoryRouter>);
    await screen.findByText("许泽宇");
    fireEvent.click(screen.getByRole("button", { name: "打开班级管理" }));
    expect(await screen.findByRole("region", { name: "班级管理" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("班级名称"), { target: { value: "计算机科学与技术2401班" } });
    fireEvent.change(screen.getByLabelText("年级"), { target: { value: "2024" } });
    fireEvent.change(screen.getByLabelText("专业"), { target: { value: "计算机科学与技术" } });
    fireEvent.click(screen.getByRole("button", { name: "创建班级" }));
    expect(await screen.findByText("计算机科学与技术2401班")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/manage/courses/course_408_ds/classes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          class_name: "计算机科学与技术2401班",
          cohort_year: 2024,
          major: "计算机科学与技术",
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "生成邀请码：软件工程2301班" }));
    expect(await screen.findByText("ABCD-7K9M")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停用邀请码：软件工程2301班" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/manage/courses/course_408_ds/classes/class_se_2301/invitation",
      expect.objectContaining({ method: "DELETE" }),
    ));
    expect(screen.queryByText("ABCD-7K9M")).not.toBeInTheDocument();
  });

  it("retries only the class management request when its first load fails", async () => {
    let classManagementRequests = 0;
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      if (path.includes("/students")) return Promise.resolve(response(students));
      if (path.endsWith("/classes")) {
        classManagementRequests += 1;
        return Promise.resolve(classManagementRequests === 1
          ? errorResponse(503, "班级名单暂时不可用。")
          : response(classManagement));
      }
      return Promise.resolve(errorResponse(404));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><TeacherEntryPage /></MemoryRouter>);
    await screen.findByText("许泽宇");
    const learningRequestCount = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "打开班级管理" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("班级名单暂时不可用");
    expect(classManagementRequests).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "重新读取班级" }));

    expect(await screen.findByRole("button", { name: "生成邀请码：软件工程2301班" })).toBeInTheDocument();
    expect(classManagementRequests).toBe(2);
    expect(fetchMock.mock.calls.length).toBe(learningRequestCount + 2);
  });

  it("approves, rejects and removes only members of the selected teacher class", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      if (path.includes("/students")) return Promise.resolve(response(students));
      if (path.endsWith("/classes")) return Promise.resolve(response(classManagement));
      if (path.includes("enrollment_request_1/decision")) {
        return Promise.resolve(response({
          request_id: "enrollment_request_1",
          status: "approved",
          student_number: "2315929354",
          class_id: "class_se_2301",
          class_name: "软件工程2301班",
          course_id: "course_408_ds",
          course_title: "数据结构",
          submitted_at: "2026-08-26T08:00:00.000Z",
          reviewed_at: "2026-08-26T09:00:00.000Z",
        }));
      }
      if (path.includes("enrollment_request_2/decision")) {
        return Promise.resolve(response({
          request_id: "enrollment_request_2",
          status: "rejected",
          student_number: "2315929366",
          class_id: "class_se_2301",
          class_name: "软件工程2301班",
          course_id: "course_408_ds",
          course_title: "数据结构",
          submitted_at: "2026-08-26T08:05:00.000Z",
          reviewed_at: "2026-08-26T09:01:00.000Z",
        }));
      }
      if (path.includes("/members/P8D4B2E31")) return Promise.resolve(response({ removed: true }));
      return Promise.resolve(errorResponse(404));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><TeacherEntryPage /></MemoryRouter>);
    await screen.findByText("许泽宇");
    fireEvent.click(screen.getByRole("button", { name: "打开班级管理" }));
    await screen.findByRole("region", { name: "班级管理" });

    fireEvent.click(screen.getByRole("button", { name: "批准：许泽宇" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("enrollment_request_1/decision"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "approved" }) }),
    ));
    expect(screen.queryByRole("button", { name: "批准：许泽宇" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "拒绝：周启航" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("enrollment_request_2/decision"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "rejected" }) }),
    ));
    expect(screen.queryByRole("button", { name: "拒绝：周启航" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "移出班级：韩若曦" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/members/P8D4B2E31"),
      expect.objectContaining({ method: "DELETE" }),
    ));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("不会删除学习记录"));
    expect(screen.queryByRole("button", { name: "移出班级：韩若曦" })).not.toBeInTheDocument();
  });

  it("selects the first course the teacher is actually authorized to view", async () => {
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) {
        return Promise.resolve(response(courseScope("course_408_cn", "CS408-CN", "计算机网络")));
      }
      if (!path.includes("course_408_cn")) {
        return Promise.resolve(errorResponse(403, "教师只能查看已授权课程。"));
      }
      return Promise.resolve(response(path.includes("/evidence")
        ? { ...evidence, course_id: "course_408_cn" }
        : { ...students, course_id: "course_408_cn", items: [{ ...students.items[0], plan_completion_percent: 20, correct_count: 1, evidence_count: 2 }] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("408 · 计算机网络")).toBeInTheDocument());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("网络试点学生")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/v1/account/course-scope",
      "/api/v1/manage/courses/course_408_cn/students?page=1&page_size=15&class_name=assigned&learning_status=all",
      "/api/v1/manage/courses/course_408_cn/evidence",
    ]);
  });

  it("loads only the selected authorized course and defers the others until selection", async () => {
    const secondCourseStudent = {
      ...students,
      course_id: "course_408_cn",
      items: [{
        ...students.items[0],
        student_code: "P7F3A1C21",
        display_name: "网络课程学生",
        student_number: "2315929355",
      }],
      pagination: { ...students.pagination, total_items: 1 },
      summary: { ...students.summary, student_count: 1 },
    };
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) {
        return Promise.resolve(response({
          items: [
            ...courseScope().items,
            ...courseScope("course_408_cn", "CS408-CN", "计算机网络").items,
          ],
          visibility: "active_memberships_only",
        }));
      }
      if (path.includes("course_408_cn")) {
        return Promise.resolve(response(path.includes("/evidence")
          ? { ...evidence, course_id: "course_408_cn" }
          : secondCourseStudent));
      }
      return Promise.resolve(response(path.includes("/evidence") ? evidence : students));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    await screen.findByText("许泽宇");
    const initialPaths = fetchMock.mock.calls.map(([input]) => String(input));
    expect(initialPaths.some((path) => path.includes("course_408_cn"))).toBe(false);

    fireEvent.change(screen.getByRole("combobox", { name: "教师授权课程" }), {
      target: { value: "course_408_cn" },
    });

    expect(await screen.findByText("网络课程学生")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      expect.stringContaining("/api/v1/manage/courses/course_408_cn/students"),
      "/api/v1/manage/courses/course_408_cn/evidence",
    ]));
  });

  it("refetches only the paged roster when class or learning status changes", async () => {
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      const query = new URL(path, "http://xuetu.local").searchParams;
      const className = query.get("class_name") ?? "assigned";
      const learningStatus = query.get("learning_status") ?? "all";
      const items = learningStatus === "on_track"
        ? [students.items[1]]
        : className === "计算机科学与技术2302班"
          ? [students.items[0]]
          : students.items;
      return Promise.resolve(response({
        ...students,
        items,
        pagination: { ...students.pagination, total_items: items.length },
        filters: {
          ...students.filters,
          class_name: className,
          learning_status: learningStatus,
        },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    await screen.findByText("韩若曦");
    const initialEvidenceRequestCount = fetchMock.mock.calls.filter(([input]) => String(input).includes("/evidence")).length;
    fireEvent.change(screen.getByRole("combobox", { name: "选择班级" }), {
      target: { value: "计算机科学与技术2302班" },
    });
    expect(await screen.findByText("许泽宇")).toBeInTheDocument();
    expect(screen.queryByText("韩若曦")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "选择班级" }), {
      target: { value: "all" },
    });
    fireEvent.click(within(screen.getByRole("group", { name: "按学习状态筛选" }))
      .getByRole("button", { name: "进度正常" }));
    expect(await screen.findByText("韩若曦")).toBeInTheDocument();
    expect(screen.queryByText("许泽宇")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      expect.stringContaining("class_name=%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%A7%91%E5%AD%A6%E4%B8%8E%E6%8A%80%E6%9C%AF2302%E7%8F%AD&learning_status=all"),
      expect.stringContaining("class_name=all&learning_status=on_track"),
    ]));
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/evidence")))
      .toHaveLength(initialEvidenceRequestCount);
  });

  it("prioritizes the demo roster and paginates a large course membership list", async () => {
    const demoRoster = Array.from({ length: 13 }, (_, index) => ({
      ...students.items[index % students.items.length],
      student_code: `DEMO${String(index + 1).padStart(2, "0")}`,
      display_name: index === 12 ? "程嘉树" : `演示学生${index + 1}`,
      student_number: index === 12 ? "2415929524" : `23${String(15929000 + index)}`,
      class_name: index === 12 ? "软件工程2402班" : "计算机科学与技术2302班",
      data_provenance: "synthetic_demo" as const,
    }));
    const storedMembers = Array.from({ length: 5 }, (_, index) => ({
      ...students.items[1],
      student_code: `STORED${String(index + 1).padStart(2, "0")}`,
      display_name: `既有开发账号${index + 1}`,
      student_number: `P${String(index + 1).padStart(8, "0")}`,
      class_name: null,
      data_provenance: "stored_records" as const,
    }));
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      const query = new URL(path, "http://xuetu.local").searchParams;
      const className = query.get("class_name") ?? "assigned";
      const page = Number(query.get("page") ?? "1");
      const ordered = className === "all" ? [...demoRoster, ...storedMembers] : demoRoster;
      const items = ordered.slice((page - 1) * 15, page * 15);
      return Promise.resolve(response({
        ...students,
        items,
        pagination: {
          page,
          page_size: 15,
          total_items: ordered.length,
          total_pages: Math.ceil(ordered.length / 15),
        },
        filters: {
          ...students.filters,
          class_name: className,
          available_classes: ["计算机科学与技术2302班", "软件工程2402班"],
        },
        summary: {
          ...students.summary,
          student_count: ordered.length,
        },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    await screen.findByText("2415929524");
    const table = screen.getByRole("table", { name: "班级学生学习进度" });
    expect(within(table).getAllByRole("row")).toHaveLength(14);
    expect(screen.getByRole("combobox", { name: "选择班级" })).toHaveValue("assigned");
    expect(screen.queryByText("既有开发账号1")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "学生名单分页" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "选择班级" }), {
      target: { value: "all" },
    });
    expect(await screen.findByText("第 1 / 2 页")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(16);
    expect(screen.getByText("程嘉树")).toBeInTheDocument();
    expect(screen.queryByText("既有开发账号5")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("第 2 / 2 页")).toBeInTheDocument();
    expect(await screen.findByText("既有开发账号5")).toBeInTheDocument();
    expect(screen.queryByText("程嘉树")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      "/api/v1/manage/courses/course_408_ds/students?page=2&page_size=15&class_name=all&learning_status=all",
    );
  });

  it("shows top weak concepts and records only the bounded intervention fields", async () => {
    let evidenceRequests = 0;
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) {
        evidenceRequests += 1;
        return Promise.resolve(response(evidence));
      }
      if (path.includes("course_408_ds")) return Promise.resolve(response(students));
      return Promise.resolve(errorResponse(403));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("共性薄弱点")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "队列与循环队列" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "薄弱点统计时间" })).toHaveValue("14");
    expect(screen.getByLabelText("队列与循环队列 学情指标")).toHaveTextContent("4 次错误");
    expect(screen.getByLabelText("队列与循环队列 学情指标")).toHaveTextContent("3 条待审核");
    expect(screen.getByLabelText("队列与循环队列 学情指标")).toHaveTextContent("1 名作答学生");

    fireEvent.change(screen.getByLabelText("干预动作：队列与循环队列"), {
      target: { value: "classroom_focus" },
    });
    fireEvent.change(screen.getByLabelText("干预备注：队列与循环队列"), {
      target: { value: "下次课集中演示循环队列的边界条件。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记录干预：队列与循环队列" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/manage/courses/course_408_ds/interventions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          concept_id: "ds_c03_02",
          action: "classroom_focus",
          note: "下次课集中演示循环队列的边界条件。",
        }),
      }),
    ));
    expect(evidenceRequests).toBeGreaterThan(1);
    expect(await screen.findByRole("status")).toHaveTextContent("干预已记录");
  });

  it("loads the target directory only after selecting a student and submits the public student code", async () => {
    let classRequests = 0;
    let submittedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      if (path.includes("/students")) return Promise.resolve(response(students));
      if (path.endsWith("/classes")) {
        classRequests += 1;
        return Promise.resolve(response(classManagement));
      }
      if (path.includes("/interventions") && method === "POST") {
        submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(response({
          ...plannedIntervention,
          target_type: "student",
          target_class_id: null,
          target_student_code: "P8D4B2E31",
        }));
      }
      return Promise.resolve(errorResponse(404));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><TeacherEntryPage /></MemoryRouter>);
    await screen.findByText("共性薄弱点");
    expect(classRequests).toBe(0);

    fireEvent.change(screen.getByLabelText("干预范围：队列与循环队列"), {
      target: { value: "student" },
    });
    const classSelect = await screen.findByLabelText("目标班级：队列与循环队列");
    expect(classRequests).toBe(1);
    expect(screen.queryByRole("region", { name: "班级管理" })).not.toBeInTheDocument();
    fireEvent.change(classSelect, { target: { value: "class_se_2301" } });
    fireEvent.change(screen.getByLabelText("目标学生：队列与循环队列"), {
      target: { value: "P8D4B2E31" },
    });
    fireEvent.change(screen.getByLabelText("干预备注：队列与循环队列"), {
      target: { value: "请在周五前完成循环队列复测。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记录干预：队列与循环队列" }));

    await waitFor(() => expect(submittedBody).toEqual({
      concept_id: "ds_c03_02",
      action: "assign_review",
      note: "请在周五前完成循环队列复测。",
      target_type: "student",
      target_student_code: "P8D4B2E31",
    }));
    expect(submittedBody).not.toHaveProperty("target_user_id");
    expect(submittedBody).not.toHaveProperty("target_class_id");
  });

  it("submits an assigned class target selected from the lazy directory", async () => {
    let submittedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      if (path.includes("/students")) return Promise.resolve(response(students));
      if (path.endsWith("/classes")) return Promise.resolve(response(classManagement));
      if (path.includes("/interventions") && method === "POST") {
        submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(response(plannedIntervention));
      }
      return Promise.resolve(errorResponse(404));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><TeacherEntryPage /></MemoryRouter>);
    await screen.findByText("共性薄弱点");
    fireEvent.change(screen.getByLabelText("干预范围：队列与循环队列"), {
      target: { value: "class" },
    });
    fireEvent.change(await screen.findByLabelText("目标班级：队列与循环队列"), {
      target: { value: "class_se_2301" },
    });
    fireEvent.change(screen.getByLabelText("干预备注：队列与循环队列"), {
      target: { value: "给软件工程2301班安排统一复习。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记录干预：队列与循环队列" }));

    await waitFor(() => expect(submittedBody).toEqual({
      concept_id: "ds_c03_02",
      action: "assign_review",
      note: "给软件工程2301班安排统一复习。",
      target_type: "class",
      target_class_id: "class_se_2301",
    }));
  });

  it("retries a failed intervention target directory without opening class management", async () => {
    let classRequests = 0;
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      if (path.includes("/students")) return Promise.resolve(response(students));
      if (path.endsWith("/classes")) {
        classRequests += 1;
        return Promise.resolve(classRequests === 1
          ? errorResponse(503, "班级名单暂时不可用。")
          : response(classManagement));
      }
      return Promise.resolve(errorResponse(404));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><TeacherEntryPage /></MemoryRouter>);
    await screen.findByText("共性薄弱点");
    fireEvent.change(screen.getByLabelText("干预范围：队列与循环队列"), {
      target: { value: "student" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("班级名单暂时不可用");
    fireEvent.click(screen.getByRole("button", { name: "重新读取干预目标" }));
    await waitFor(() => expect(classRequests).toBe(2));
    expect(await screen.findByLabelText("目标班级：队列与循环队列")).toBeEnabled();
    expect(screen.queryByRole("region", { name: "班级管理" })).not.toBeInTheDocument();
  });

  it("keeps an intervention note when the write is rejected", async () => {
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidence));
      if (path.includes("/interventions")) return Promise.resolve(errorResponse(500, "干预服务暂时不可用。"));
      if (path.includes("course_408_ds")) return Promise.resolve(response(students));
      return Promise.resolve(errorResponse(403));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    await screen.findByText("共性薄弱点");
    const note = "需要在课堂上补充边界条件。";
    fireEvent.change(screen.getByLabelText("干预备注：队列与循环队列"), { target: { value: note } });
    fireEvent.click(screen.getByRole("button", { name: "记录干预：队列与循环队列" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("干预服务暂时不可用");
    expect(screen.getByLabelText("干预备注：队列与循环队列")).toHaveValue(note);
  });

  it("keeps sample thresholds out of the overview and explains unavailable insights in place", async () => {
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response(evidenceWithQuality));
      if (path.includes("course_408_ds")) return Promise.resolve(response(students));
      return Promise.resolve(errorResponse(403));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "共性薄弱点" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "证据概览" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "薄弱点统计时间" })).toHaveValue("14");
    expect(screen.queryByText(/4\s*\/\s*5/)).not.toBeInTheDocument();
    expect(screen.getByText("还需要更多作答记录")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "证据来源拆分" })).not.toBeInTheDocument();
    expect(screen.queryByText("真实试用")).not.toBeInTheDocument();
    expect(screen.queryByText("验证记录")).not.toBeInTheDocument();
  });

  it("changes the insight period without changing the class roster query", async () => {
    const fetchMock = vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response({
        ...evidenceWithQuality,
        window: { ...evidenceWithQuality.window, days: path.includes("days=30") ? 30 : 14 },
      }));
      return Promise.resolve(response(students));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter><TeacherEntryPage /></MemoryRouter>);
    await screen.findByText("许泽宇");
    const rosterCount = fetchMock.mock.calls.filter(([input]) => String(input).includes("/students?")).length;
    fireEvent.change(screen.getByRole("combobox", { name: "薄弱点统计时间" }), { target: { value: "30" } });
    await waitFor(() => expect(fetchMock.mock.calls.map(([input]) => String(input)))
      .toContain("/api/v1/manage/courses/course_408_ds/evidence?days=30"));
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/students?"))).toHaveLength(rosterCount);
    expect(await screen.findByText("许泽宇")).toBeInTheDocument();
  });

  it("marks a planned intervention as sent and refreshes the evidence view", async () => {
    let evidenceRequests = 0;
    const sentIntervention = { ...plannedIntervention, status: "sent" as const, delivered_at: "2026-08-23T09:00:00.000Z" };
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) {
        evidenceRequests += 1;
        return Promise.resolve(response({
          ...evidenceWithQuality,
          evidence_status: "sufficient" as const,
          sample: { ...evidenceWithQuality.sample, valid_attempt_student_count: 5, sufficient: true },
          top_weak_concepts: evidence.top_weak_concepts,
          recent_interventions: [evidenceRequests > 1 ? sentIntervention : plannedIntervention],
        }));
      }
      if (path.endsWith("/interventions/intervention_001/status") && method === "PATCH") {
        return Promise.resolve(response(sentIntervention));
      }
      if (path.includes("course_408_ds")) return Promise.resolve(response(students));
      return Promise.resolve(errorResponse(403));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "标记为已送达：队列与循环队列" })).toBeInTheDocument();
    expect(screen.getByText("范围：计算机科学与技术2301班")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "标记为已送达：队列与循环队列" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/manage/courses/course_408_ds/interventions/intervention_001/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "sent" }),
      }),
    ));
    expect(evidenceRequests).toBeGreaterThan(1);
    expect(await screen.findByRole("status")).toHaveTextContent("已标记为已送达");
    expect(await screen.findByRole("button", { name: "标记为已完成：队列与循环队列" })).toBeInTheDocument();
  });

  it("lets a teacher cancel an active intervention and refreshes its terminal state", async () => {
    let evidenceRequests = 0;
    const cancelledIntervention = { ...plannedIntervention, status: "cancelled" as const };
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) {
        evidenceRequests += 1;
        return Promise.resolve(response({
          ...evidenceWithQuality,
          evidence_status: "sufficient" as const,
          sample: { ...evidenceWithQuality.sample, valid_attempt_student_count: 5, sufficient: true },
          top_weak_concepts: evidence.top_weak_concepts,
          recent_interventions: [evidenceRequests > 1 ? cancelledIntervention : plannedIntervention],
        }));
      }
      if (path.endsWith("/interventions/intervention_001/status") && method === "PATCH") {
        return Promise.resolve(response(cancelledIntervention));
      }
      if (path.includes("course_408_ds")) return Promise.resolve(response(students));
      return Promise.resolve(errorResponse(403));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    const cancelButton = await screen.findByRole("button", { name: "取消教学安排：队列与循环队列" });
    fireEvent.click(cancelButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/manage/courses/course_408_ds/interventions/intervention_001/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      }),
    ));
    expect(evidenceRequests).toBeGreaterThan(1);
    expect(await screen.findByRole("status")).toHaveTextContent("教学安排已取消");
    expect(await screen.findByText("已取消")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消教学安排：队列与循环队列" })).not.toBeInTheDocument();
  });

  it("keeps a sent intervention actionable when completion evidence is missing", async () => {
    const sentIntervention = { ...plannedIntervention, status: "sent" as const, delivered_at: "2026-08-23T09:00:00.000Z" };
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path.includes("/account/course-scope")) return Promise.resolve(response(courseScope()));
      if (path.includes("/evidence")) return Promise.resolve(response({
        ...evidenceWithQuality,
        evidence_status: "sufficient" as const,
        sample: { ...evidenceWithQuality.sample, valid_attempt_student_count: 5, sufficient: true },
        top_weak_concepts: evidence.top_weak_concepts,
        recent_interventions: [sentIntervention],
      }));
      if (path.endsWith("/interventions/intervention_001/status") && method === "PATCH") {
        return Promise.resolve(errorResponse(409, "完成前还没有新的有效作答记录。"));
      }
      if (path.includes("course_408_ds")) return Promise.resolve(response(students));
      return Promise.resolve(errorResponse(403));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <TeacherEntryPage />
      </MemoryRouter>,
    );

    const completeButton = await screen.findByRole("button", { name: "标记为已完成：队列与循环队列" });
    fireEvent.click(completeButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("完成前还没有新的有效作答记录");
    expect(screen.getByRole("button", { name: "标记为已完成：队列与循环队列" })).toBeInTheDocument();
  });
});
