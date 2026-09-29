import type {
  StudentLearningOrchestration,
} from "@xuetu/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type {
  LocalAuthenticationService,
  PublicAccount,
} from "../src/services/auth/authentication.js";

const student: PublicAccount = {
  user_id: "user_student_session",
  username: "student_session",
  display_name: "会话学生",
  account_status: "active",
  roles: ["student"],
  auth_source: "local_development",
  account_origin: "registered",
  data_boundary: "local_account",
  must_change_password: false,
  created_at: "2026-08-02T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
  last_login_at: null,
};

const admin: PublicAccount = {
  ...student,
  user_id: "user_admin_session",
  username: "admin_session",
  display_name: "会话管理员",
  roles: ["admin"],
};

function snapshot(): StudentLearningOrchestration {
  const courseIds = [
    ["course_408_ds", "数据结构", "data-structures"],
    ["course_408_co", "计算机组成原理", "computer-organization"],
    ["course_408_os", "操作系统", "operating-systems"],
    ["course_408_cn", "计算机网络", "computer-networks"],
  ] as const;
  return {
    generated_at: "2026-08-12T00:00:00.000Z",
    source: "deterministic_evidence_rules",
    ai_status: "unavailable",
    ai_status_message: "AI 学习编排尚未接入，当前任务由可验证学习证据确定。",
    goal_context: null,
    evidence_summary: {
      basis: "course_structure",
      confidence: "low",
      objective_evidence_count: 0,
      subjective_evidence_count: 0,
      reading_progress_count: 0,
      practice_attempt_count: 0,
      needs_review_count: 0,
      explanation: "尚无学习证据。",
      evidence_refs: [],
    },
    plan_progress: {
      plan_id: null,
      completed_task_count: 0,
      total_task_count: 0,
      completion_percent: 0,
      tasks: [],
    },
    challenge_journey: {
      current_stage_label: "数据结构 · 课程起点",
      current_node_id: "journey_live_course_course_408_ds",
      nodes: [{
        node_id: "journey_live_course_course_408_ds",
        task_id: "live_course_course_408_ds",
        kind: "course_reading",
        status: "recommended",
        course_id: "course_408_ds",
        course_title: "数据结构",
        concept_id: null,
        title: "进入数据结构继续学习",
        href: "/student/courses/data-structures",
      }],
      recent_activity: {
        completed_day_count: 0,
        days: [
          { date: "2026-08-06", completed: false },
          { date: "2026-08-07", completed: false },
          { date: "2026-08-08", completed: false },
          { date: "2026-08-09", completed: false },
          { date: "2026-08-10", completed: false },
          { date: "2026-08-11", completed: false },
          { date: "2026-08-12", completed: false },
        ],
      },
      profile_updates: [{
        update_id: "profile_starting_point_ds",
        course_id: "course_408_ds",
        course_title: "数据结构",
        kind: "starting_point",
        occurred_at: null,
        title: "学习证据正在形成",
        detail: "先从课程结构开始学习，后续再根据真实阅读和作答调整顺序。",
      }],
    },
    current_task: {
      task_id: "live_course_course_408_ds",
      source: "course_fallback",
      task_type: "course_reading",
      course_id: "course_408_ds",
      course_title: "数据结构",
      concept_id: null,
      concept_title: null,
      mistake_id: null,
      probe_session_id: null,
      title: "进入数据结构继续学习",
      reason: "按课程结构开始学习。",
      completion_criteria: "进入课程知识地图并开始一个核心知识点。",
      estimated_minutes: 25,
      href: "/student/courses/data-structures",
      practice_question_count: 0,
      evidence_refs: ["course_structure:course_408_ds"],
    },
    course_priorities: courseIds.map(([course_id, course_title, slug], index) => ({
      rank: index + 1,
      course_id,
      course_title,
      priority: index === 0 ? "focus" : index === 1 ? "strengthen" : "maintain",
      evidence_level: "self_report_only",
      rationale: "尚无客观证据。",
      started_concept_count: 0,
      concept_count: 10,
      practice_attempt_count: 0,
      needs_review_count: 0,
      href: `/student/courses/${slug}`,
    })),
    boundary_note: "当前结果只描述已存储学习证据。",
  };
}

function completionSettlement() {
  return {
    version: "challenge_settlement_v1" as const,
    task_type: "choice_practice" as const,
    course_id: "course_408_ds" as const,
    course_title: "数据结构",
    concept_id: "ds_c01",
    concept_title: "算法复杂度",
    outcome: "correct" as const,
    result_title: "本关已完成",
    result_detail: "本次选择题已完成判分。",
    evidence_update: {
      added_count: 1,
      objective_total: 1,
      summary: "新增 1 次选择题作答。",
    },
    profile_update: {
      kind: "practice_correct" as const,
      title: "算法复杂度新增一次正确作答",
      detail: "本次结果已计入画像，仍需后续证据观察是否稳定掌握。",
    },
    review_update: {
      status: "not_required" as const,
      mistake_id: null,
      next_review_at: null,
      summary: "本次正确作答未新增待复习记录。",
    },
    plan_progress: {
      tracked: false,
      completed_task_count: 0,
      total_task_count: 0,
      completion_percent: 0,
    },
    next_task: {
      task_id: "task_co_read",
      task_type: "course_reading" as const,
      course_id: "course_408_co" as const,
      course_title: "计算机组成原理",
      concept_id: "co_c01",
      concept_title: "计算机系统层次",
      title: "继续学习计算机系统层次",
      reason: "当前关卡已完成，继续补齐下一项课程学习。",
      estimated_minutes: 20,
      href: "/student/courses/computer-organization?concept_id=co_c01",
    },
  };
}

function platformAccess() {
  return {
    async getActor(userId: string) {
      return {
        user: {
          user_id: userId,
          display_name: "本地账户",
          account_status: "active" as const,
          auth_source: "local_development" as const,
          created_at: "2026-08-02T00:00:00.000Z",
          updated_at: "2026-08-02T00:00:00.000Z",
        },
        roles: ["student" as const],
      };
    },
    async isCourseAssigned() { return true; },
  };
}

describe("student learning-orchestration routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns the current student's deterministic orchestration snapshot", async () => {
    const calls: string[] = [];
    app = buildApp({
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      learningOrchestration: {
        async getSnapshot(userId: string) {
          calls.push(userId);
          return snapshot();
        },
      },
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/learning-orchestration",
      headers: { "x-dev-user-id": "user_student_001" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.current_task).toMatchObject({ task_id: "live_course_course_408_ds" });
    expect(calls).toEqual(["user_student_001"]);
  });

  it("uses the server session even when a different development identity is supplied", async () => {
    const calls: string[] = [];
    const authentication = {
      async resolveSession(token: string) {
        return token === "student-session" ? { account: student } : null;
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      authentication,
      allowLocalDevAuth: true,
      platformAccess: platformAccess(),
      learningOrchestration: {
        async getSnapshot(userId: string) {
          calls.push(userId);
          return snapshot();
        },
      },
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/learning-orchestration",
      headers: {
        cookie: "xuetu_session=student-session",
        "x-dev-user-id": "user_admin_001",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([student.user_id]);
  });

  it("rejects unauthenticated and administrator sessions", async () => {
    const authentication = {
      async resolveSession(token: string) {
        return token === "admin-session" ? { account: admin } : null;
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      authentication,
      allowLocalDevAuth: false,
      platformAccess: platformAccess(),
      learningOrchestration: { async getSnapshot() { return snapshot(); } },
    } as never);

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/student/learning-orchestration",
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/student/learning-orchestration",
      headers: { cookie: "xuetu_session=admin-session" },
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
  });

  it("settles only the current task and never accepts browser-supplied evidence", async () => {
    const calls: Array<[string, string]> = [];
    const authentication = {
      async resolveSession(token: string) {
        return token === "student-session" ? { account: student } : null;
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      authentication,
      allowLocalDevAuth: false,
      platformAccess: platformAccess(),
      learningOrchestration: {
        async getSnapshot() { return snapshot(); },
        async completeTask(userId: string, taskId: string) {
          calls.push([userId, taskId]);
          return {
            task_id: taskId,
            completed_at: "2026-08-13T08:00:00.000Z",
            evidence_refs: ["attempt:attempt_001"],
            idempotent: false,
            next_task_id: "task_co_read",
            settlement: completionSettlement(),
          };
        },
      },
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-orchestration/complete",
      headers: { cookie: "xuetu_session=student-session" },
      payload: { task_id: "live_practice_ds_c01" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.next_task_id).toBe("task_co_read");
    expect(response.json().data.settlement).toMatchObject({
      version: "challenge_settlement_v1",
      next_task: { task_id: "task_co_read" },
    });
    expect(calls).toEqual([[student.user_id, "live_practice_ds_c01"]]);

    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-orchestration/complete",
      headers: { cookie: "xuetu_session=student-session" },
      payload: { task_id: "live_practice_ds_c01", evidence_refs: ["attempt:forged"] },
    });
    expect(forged.statusCode).toBe(400);
  });

  it("activates a task using the session student and accepts only the task id", async () => {
    const calls: Array<[string, string]> = [];
    const authentication = {
      async resolveSession(token: string) {
        return token === "student-session" ? { account: student } : null;
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      authentication,
      allowLocalDevAuth: false,
      platformAccess: platformAccess(),
      learningOrchestration: {
        async getSnapshot() { return snapshot(); },
        async activateTask(userId: string, taskId: string) {
          calls.push([userId, taskId]);
          return { task_id: taskId, activated_at: "2026-08-13T08:00:00.000Z", idempotent: false };
        },
        async completeTask() { throw new Error("not used"); },
      },
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-orchestration/activate",
      headers: { cookie: "xuetu_session=student-session" },
      payload: { task_id: "live_course_course_408_ds" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ task_id: "live_course_course_408_ds", idempotent: false });
    expect(calls).toEqual([[student.user_id, "live_course_course_408_ds"]]);

    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/student/learning-orchestration/activate",
      headers: { cookie: "xuetu_session=student-session" },
      payload: { task_id: "live_course_course_408_ds", activated_at: "forged" },
    });
    expect(forged.statusCode).toBe(400);
  });
});
