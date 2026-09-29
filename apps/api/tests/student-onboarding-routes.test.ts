import { afterEach, describe, expect, it } from "vitest";

import type {
  OnboardingGoalInput,
  OnboardingSelfAssessmentsUpdate,
  OnboardingState,
} from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import type {
  LocalAuthenticationService,
  PublicAccount,
} from "../src/services/auth/authentication.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

const studentId = "user_onboarding_student";
const sessionStudentId = "user_session_student";
const adminId = "user_onboarding_admin";
const now = "2026-08-12T08:00:00.000Z";

const studentAccount: PublicAccount = {
  user_id: sessionStudentId,
  username: "session_student",
  display_name: "会话学生",
  account_status: "active",
  roles: ["student"],
  auth_source: "local_development",
  account_origin: "registered",
  data_boundary: "local_account",
  must_change_password: false,
  created_at: now,
  updated_at: now,
  last_login_at: null,
};

const initialState: OnboardingState = {
  status: "not_started",
  current_step: "goals",
  goals: null,
  self_assessments: [],
  profile: null,
  plan: null,
  updated_at: now,
};

function createPlatformAccess(): PlatformAccessService {
  return {
    async getActor(userId) {
      if (userId !== studentId && userId !== sessionStudentId && userId !== adminId) return null;
      return {
        user: {
          user_id: userId,
          display_name: userId === adminId ? "管理员" : "学生",
          account_status: "active",
          auth_source: "local_development",
          created_at: now,
          updated_at: now,
        },
        roles: userId === adminId ? ["admin"] : ["student"],
      };
    },
    async isCourseAssigned() { return true; },
  };
}

function createOnboardingService(calls: Array<{ method: string; userId: string; value?: unknown }>) {
  const diagnosticCourses = [
    "course_408_ds",
    "course_408_co",
    "course_408_os",
    "course_408_cn",
  ] as const;
  return {
    async getState(userId: string) {
      calls.push({ method: "getState", userId });
      return initialState;
    },
    async saveGoals(userId: string, value: OnboardingGoalInput) {
      calls.push({ method: "saveGoals", userId, value });
      return { ...initialState, status: "in_progress", current_step: "self_assessment" };
    },
    async saveSelfAssessments(userId: string, value: OnboardingSelfAssessmentsUpdate) {
      calls.push({ method: "saveSelfAssessments", userId, value });
      return {
        ...initialState,
        status: "in_progress",
        current_step: "profile",
        self_assessments: value.items,
      };
    },
    async completeSetup(userId: string) {
      calls.push({ method: "completeSetup", userId });
      return { ...initialState, status: "completed", current_step: "plan" };
    },
    async getDiagnosticQuestions(userId: string) {
      calls.push({ method: "getDiagnosticQuestions", userId });
      return {
        set_version: "408-v2",
        summary: { total_count: 8, saved_count: 0, completed_at: null },
        items: Array.from({ length: 8 }, (_, index) => ({
          ordinal: index + 1,
          course_id: diagnosticCourses[Math.floor(index / 2)]!,
          course_title: `课程 ${index + 1}`,
          response_status: null,
          selected_option_ids: [],
          question: { id: `question_${index + 1}` },
        })),
      };
    },
    async saveDiagnosticAnswer(userId: string, value: unknown) {
      calls.push({ method: "saveDiagnosticAnswer", userId, value });
      return { ...initialState, status: "in_progress", current_step: "diagnostic" };
    },
    async completeDiagnostic(userId: string) {
      calls.push({ method: "completeDiagnostic", userId });
      return { ...initialState, status: "in_progress", current_step: "profile" };
    },
  };
}

describe("student onboarding routes", () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("restores the current student's onboarding state without diagnostic fields", async () => {
    const calls: Array<{ method: string; userId: string; value?: unknown }> = [];
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: createPlatformAccess(),
      studentOnboarding: createOnboardingService(calls),
    } as never);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/student/onboarding",
      headers: { "x-dev-user-id": studentId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(initialState);
    expect(response.body).not.toMatch(/diagnostic|诊断/iu);
    expect(calls).toEqual([{ method: "getState", userId: studentId }]);
  });

  it("validates and saves goals and all four self assessments", async () => {
    const calls: Array<{ method: string; userId: string; value?: unknown }> = [];
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: createPlatformAccess(),
      studentOnboarding: createOnboardingService(calls),
    } as never);
    const headers = { "x-dev-user-id": studentId };
    const goals = {
      target_exam_year: 2027,
      preparation_stage: "foundation",
      daily_minutes: 90,
      target_school: "中国科学技术大学",
      target_score: 125,
    };
    const assessments = {
      items: [
        { course_id: "course_408_ds", level: "average" },
        { course_id: "course_408_co", level: "weak" },
        { course_id: "course_408_os", level: "good" },
        { course_id: "course_408_cn", level: "not_started" },
      ],
    };

    const goalResponse = await app.inject({ method: "PUT", url: "/api/v1/student/onboarding/goals", headers, payload: goals });
    const assessmentResponse = await app.inject({ method: "PUT", url: "/api/v1/student/onboarding/self-assessments", headers, payload: assessments });
    const invalid = await app.inject({ method: "PUT", url: "/api/v1/student/onboarding/goals", headers, payload: { ...goals, daily_minutes: 17 } });

    expect(goalResponse.statusCode).toBe(200);
    expect(assessmentResponse.statusCode).toBe(200);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("ONBOARDING_GOALS_INVALID");
    expect(calls.map((call) => call.method)).toEqual(["saveGoals", "saveSelfAssessments"]);
  });

  it("exposes the bounded diagnostic flow only to the authenticated student", async () => {
    const calls: Array<{ method: string; userId: string; value?: unknown }> = [];
    const authentication = {
      async resolveSession(token: string) {
        return token === "valid-session" ? { account: studentAccount } : null;
      },
    } as unknown as LocalAuthenticationService;
    app = buildApp({
      answerModel: null,
      authentication,
      allowLocalDevAuth: true,
      platformAccess: createPlatformAccess(),
      studentOnboarding: createOnboardingService(calls),
    } as never);
    const headers = {
      cookie: "xuetu_session=valid-session",
      "x-dev-user-id": adminId,
    };

    const questions = await app.inject({
      method: "GET",
      url: "/api/v1/student/onboarding/diagnostic/questions",
      headers,
    });
    const answer = await app.inject({
      method: "PUT",
      url: "/api/v1/student/onboarding/diagnostic/answers",
      headers,
      payload: {
        question_id: "question_1",
        response_status: "unsure",
        selected_option_ids: [],
      },
    });
    const complete = await app.inject({
      method: "POST",
      url: "/api/v1/student/onboarding/diagnostic/complete",
      headers,
    });

    expect(questions.statusCode).toBe(200);
    expect(answer.statusCode).toBe(200);
    expect(complete.statusCode).toBe(200);
    expect(calls).toEqual([
      { method: "getDiagnosticQuestions", userId: sessionStudentId },
      {
        method: "saveDiagnosticAnswer",
        userId: sessionStudentId,
        value: {
          question_id: "question_1",
          response_status: "unsure",
          selected_option_ids: [],
        },
      },
      { method: "completeDiagnostic", userId: sessionStudentId },
    ]);
  });

  it("requires a student identity", async () => {
    const calls: Array<{ method: string; userId: string; value?: unknown }> = [];
    app = buildApp({
      answerModel: null,
      allowLocalDevAuth: true,
      platformAccess: createPlatformAccess(),
      studentOnboarding: createOnboardingService(calls),
    } as never);

    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/student/onboarding" });
    const admin = await app.inject({
      method: "GET",
      url: "/api/v1/student/onboarding",
      headers: { "x-dev-user-id": adminId },
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(admin.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });
});
