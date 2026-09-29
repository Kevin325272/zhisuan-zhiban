import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type {
  LocalAuthenticationService,
  PublicAccount,
} from "../src/services/auth/authentication.js";

type ExplicitMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RouteInventoryItem = Readonly<{
  method: ExplicitMethod;
  path: string;
  source: string;
}>;

const route = (
  source: string,
  method: ExplicitMethod,
  path: string,
): RouteInventoryItem => ({ source, method, path });

const NORMAL_ROUTES = [
  route("account-management.ts", "GET", "/api/v1/account/course-scope"),
  route("account-management.ts", "GET", "/api/v1/manage/accounts"),
  route("account-management.ts", "GET", "/api/v1/manage/academic-classes"),
  route("account-management.ts", "POST", "/api/v1/manage/accounts"),
  route("account-management.ts", "PATCH", "/api/v1/manage/accounts/:userId/status"),
  route("account-management.ts", "POST", "/api/v1/manage/accounts/:userId/teacher-approval"),
  route("account-management.ts", "POST", "/api/v1/manage/accounts/:userId/reset-password"),

  route("ai-workflows.ts", "GET", "/api/v1/student/ai-workflows/status"),
  route("ai-workflows.ts", "POST", "/api/v1/student/ai-workflows/:capability"),

  route("agent-chat.ts", "POST", "/api/v1/agent/chat"),

  route("auth.ts", "GET", "/api/v1/auth/registration-policy"),
  route("auth.ts", "POST", "/api/v1/auth/register"),
  route("auth.ts", "POST", "/api/v1/auth/login"),
  route("auth.ts", "GET", "/api/v1/auth/session"),
  route("auth.ts", "POST", "/api/v1/auth/logout"),
  route("auth.ts", "POST", "/api/v1/auth/password"),

  route("class-enrollment.ts", "GET", "/api/v1/student/class-enrollment"),
  route("class-enrollment.ts", "POST", "/api/v1/student/class-enrollment/requests"),
  route("class-enrollment.ts", "DELETE", "/api/v1/student/class-enrollment/requests/current"),
  route("class-enrollment.ts", "GET", "/api/v1/manage/courses/:courseId/classes"),
  route("class-enrollment.ts", "POST", "/api/v1/manage/courses/:courseId/classes"),
  route("class-enrollment.ts", "POST", "/api/v1/manage/courses/:courseId/classes/:classId/invitation"),
  route("class-enrollment.ts", "DELETE", "/api/v1/manage/courses/:courseId/classes/:classId/invitation"),
  route("class-enrollment.ts", "POST", "/api/v1/manage/courses/:courseId/classes/:classId/requests/:requestId/decision"),
  route("class-enrollment.ts", "DELETE", "/api/v1/manage/courses/:courseId/classes/:classId/members/:studentCode"),

  route("community.ts", "GET", "/api/v1/student/community/circles"),
  route("community.ts", "GET", "/api/v1/student/community/posts"),
  route("community.ts", "POST", "/api/v1/student/community/posts"),
  route("community.ts", "GET", "/api/v1/student/community/posts/:postId"),
  route("community.ts", "PATCH", "/api/v1/student/community/posts/:postId"),
  route("community.ts", "DELETE", "/api/v1/student/community/posts/:postId"),
  route("community.ts", "POST", "/api/v1/student/community/posts/:postId/replies"),
  route("community.ts", "PATCH", "/api/v1/student/community/replies/:replyId"),
  route("community.ts", "DELETE", "/api/v1/student/community/replies/:replyId"),
  route("community.ts", "PUT", "/api/v1/student/community/posts/:postId/like"),

  route("course-content.ts", "GET", "/api/v1/408/courses"),
  route("course-content.ts", "GET", "/api/v1/408/courses/:courseSlug/chapters"),
  route("course-content.ts", "GET", "/api/v1/408/courses/:courseSlug/curriculum-map"),
  route("course-content.ts", "GET", "/api/v1/408/courses/:courseSlug/knowledge"),
  route("course-content.ts", "GET", "/api/v1/408/courses/:courseSlug/qa-examples"),
  route("course-content.ts", "GET", "/api/v1/408/courses/:courseSlug/reading-progress"),
  route("course-content.ts", "PUT", "/api/v1/408/courses/:courseSlug/reading-progress"),
  route("course-content.ts", "GET", "/api/v1/408/courses/:courseSlug/source-pages/:pageId"),

  route("course-videos.ts", "GET", "/api/v1/408/courses/:courseSlug/videos"),
  route("course-videos.ts", "GET", "/api/v1/408/courses/:courseSlug/videos/:seriesId/episodes"),
  route("course-videos.ts", "GET", "/api/v1/408/courses/:courseSlug/concepts/:conceptId/videos"),

  route("exam-papers.ts", "GET", "/api/v1/exam-papers"),
  route("exam-papers.ts", "GET", "/api/v1/exam-papers/:examPaperId"),
  route("exam-papers.ts", "GET", "/api/v1/exam-papers/:examPaperId/file"),
  route("exam-papers.ts", "GET", "/api/v1/manage/exam-papers"),

  route("external-questions.ts", "POST", "/api/v1/student/external-questions"),
  route("external-questions.ts", "POST", "/api/v1/student/external-questions/:externalQuestionId/recognition"),
  route("external-questions.ts", "PUT", "/api/v1/student/external-questions/:externalQuestionId/confirmation"),
  route("external-questions.ts", "POST", "/api/v1/student/external-questions/:externalQuestionId/explanations"),
  route("external-questions.ts", "POST", "/api/v1/student/external-questions/:externalQuestionId/save"),
  route("external-questions.ts", "GET", "/api/v1/student/external-questions"),
  route("external-questions.ts", "GET", "/api/v1/student/external-questions/:externalQuestionId"),
  route("external-questions.ts", "GET", "/api/v1/student/external-questions/:externalQuestionId/image"),
  route("external-questions.ts", "DELETE", "/api/v1/student/external-questions/:externalQuestionId"),

  route("management.ts", "GET", "/api/v1/manage/courses/:courseId/questions"),
  route("management.ts", "PATCH", "/api/v1/manage/questions/:questionId/review"),
  route("management.ts", "GET", "/api/v1/manage/courses/:courseId/materials"),
  route("management.ts", "POST", "/api/v1/manage/courses/:courseId/materials"),
  route("management.ts", "GET", "/api/v1/manage/courses/:courseId/learning-summary"),
  route("management.ts", "GET", "/api/v1/manage/courses/:courseId/students"),
  route("management.ts", "GET", "/api/v1/manage/courses/:courseId/evidence"),
  route("management.ts", "POST", "/api/v1/manage/courses/:courseId/interventions"),
  route("management.ts", "PATCH", "/api/v1/manage/courses/:courseId/interventions/:interventionId/status"),
  route("management.ts", "GET", "/api/v1/manage/courses/:courseId/source-layer"),

  route("pilot-study.ts", "GET", "/api/v1/student/pilot-study"),
  route("pilot-study.ts", "POST", "/api/v1/student/pilot-study/consent"),
  route("pilot-study.ts", "POST", "/api/v1/student/pilot-study/tasks/:taskId/start"),
  route("pilot-study.ts", "POST", "/api/v1/student/pilot-study/tasks/:taskId/complete"),
  route("pilot-study.ts", "POST", "/api/v1/student/pilot-study/tasks/:taskId/evaluate"),
  route("pilot-study.ts", "POST", "/api/v1/student/pilot-study/feedback"),
  route("pilot-study.ts", "GET", "/api/v1/manage/pilot-study"),
  route("pilot-study.ts", "POST", "/api/v1/manage/pilot-study/participants"),
  route("pilot-study.ts", "GET", "/api/v1/manage/pilot-study/export.json"),
  route("pilot-study.ts", "GET", "/api/v1/manage/pilot-study/export.csv"),

  route("programming-experiments.ts", "GET", "/api/v1/student/programming-experiments"),
  route("programming-experiments.ts", "GET", "/api/v1/student/programming-experiments/:experimentId"),
  route("programming-experiments.ts", "GET", "/api/v1/student/programming-experiments/:experimentId/attempts"),
  route("programming-experiments.ts", "POST", "/api/v1/student/programming-experiments/:experimentId/runs"),
  route("programming-experiments.ts", "POST", "/api/v1/student/programming-experiments/:experimentId/attempts"),

  route("question-bank.ts", "GET", "/api/v1/question-bank/past-exams"),
  route("question-bank.ts", "GET", "/api/v1/question-bank/questions/:questionId/assets/:assetId"),
  route("question-bank.ts", "GET", "/api/v1/question-bank/questions"),
  route("question-bank.ts", "GET", "/api/v1/question-bank/questions/:questionId"),
  route("question-bank.ts", "POST", "/api/v1/question-bank/evaluations"),
  route("question-bank.ts", "POST", "/api/v1/question-bank/mock-exams"),
  route("question-bank.ts", "POST", "/api/v1/question-bank/mock-exams/:sessionId/submit"),

  route("student-admissions.ts", "GET", "/api/v1/student/admissions/targets"),
  route("student-admissions.ts", "GET", "/api/v1/student/admissions/target"),
  route("student-admissions.ts", "PUT", "/api/v1/student/admissions/target"),
  route("student-admissions.ts", "DELETE", "/api/v1/student/admissions/target"),

  route("student-care.ts", "GET", "/api/v1/student/care"),
  route("student-care.ts", "GET", "/api/v1/student/care/preferences"),
  route("student-care.ts", "POST", "/api/v1/student/care/:interactionId/respond"),
  route("student-care.ts", "PUT", "/api/v1/student/care/preferences"),

  route("student-learning-loop.ts", "GET", "/api/v1/student/practice-mistakes"),
  route("student-learning-loop.ts", "PATCH", "/api/v1/student/practice-mistakes/:mistakeId"),
  route("student-learning-loop.ts", "GET", "/api/v1/student/learning-record"),
  route("student-learning-loop.ts", "GET", "/api/v1/student/personal-learning-dashboard"),

  route("student-learning-orchestration.ts", "GET", "/api/v1/student/learning-orchestration"),
  route("student-learning-orchestration.ts", "POST", "/api/v1/student/learning-orchestration/activate"),
  route("student-learning-orchestration.ts", "POST", "/api/v1/student/learning-orchestration/complete"),

  route("student-learning-probes.ts", "GET", "/api/v1/student/learning-probes/offer"),
  route("student-learning-probes.ts", "POST", "/api/v1/student/learning-probes/:probeSessionId/start"),
  route("student-learning-probes.ts", "POST", "/api/v1/student/learning-probes/:probeSessionId/skip"),
  route("student-learning-probes.ts", "POST", "/api/v1/student/learning-probes/:probeSessionId/submit"),
  route("student-learning-probes.ts", "GET", "/api/v1/student/learning-probes/:probeSessionId/offer"),
  route("student-learning-probes.ts", "GET", "/api/v1/student/learning-probes/:probeSessionId"),

  route("student-mistake-recommendations.ts", "GET", "/api/v1/student/mistake-recommendations"),

  route("student-onboarding.ts", "GET", "/api/v1/student/onboarding"),
  route("student-onboarding.ts", "GET", "/api/v1/student/onboarding/diagnostic/questions"),
  route("student-onboarding.ts", "PUT", "/api/v1/student/onboarding/diagnostic/answers"),
  route("student-onboarding.ts", "POST", "/api/v1/student/onboarding/diagnostic/complete"),
  route("student-onboarding.ts", "PUT", "/api/v1/student/onboarding/goals"),
  route("student-onboarding.ts", "PUT", "/api/v1/student/onboarding/self-assessments"),
  route("student-onboarding.ts", "POST", "/api/v1/student/onboarding/complete"),

  route("student-profile-workflow.ts", "GET", "/api/v1/student/profile/ai/status"),
  route("student-profile-workflow.ts", "POST", "/api/v1/student/profile/ai"),

  route("student-source-courses.ts", "GET", "/api/v1/408/courses/:courseSlug/source-outline"),
  route("student-source-courses.ts", "GET", "/api/v1/408/courses/:courseSlug/source-figures/:figureAssetId"),

  route("app.ts", "GET", "/api/v1/system-status"),
  route("student-study-library.ts", "GET", "/api/v1/student/study-library/map"),
  route("student-study-library.ts", "GET", "/api/v1/student/study-library/collections"),
  route("student-study-library.ts", "GET", "/api/v1/student/study-library/collections/:id"),
  route("student-study-library.ts", "PUT", "/api/v1/student/study-library/collections/:id"),
  route("student-study-library.ts", "DELETE", "/api/v1/student/study-library/collections/:id"),
  route("student-study-library.ts", "GET", "/api/v1/student/study-library/questions/:id/collections"),
  route("student-study-library.ts", "PUT", "/api/v1/student/study-library/collections/:id/questions/:qid"),
  route("student-study-library.ts", "DELETE", "/api/v1/student/study-library/collections/:id/questions/:qid"),
  route("student-study-library.ts", "GET", "/api/v1/student/study-library/cards"),
  route("student-study-library.ts", "GET", "/api/v1/student/study-library/card-seeds"),
  route("student-study-library.ts", "PUT", "/api/v1/student/study-library/cards/:id"),
  route("student-study-library.ts", "DELETE", "/api/v1/student/study-library/cards/:id"),
  route("student-study-library.ts", "GET", "/api/v1/student/study-library/today"),
  route("student-study-library.ts", "POST", "/api/v1/student/study-library/today"),
  route("student-study-library.ts", "POST", "/api/v1/student/study-library/reviews"),
] as const satisfies ReadonlyArray<RouteInventoryItem>;

const LEGACY_AGENT_ROUTES = [
  route("agent-runs.ts", "POST", "/api/v1/learning-sessions"),
  route("agent-runs.ts", "POST", "/api/v1/learning-sessions/:sessionId/messages"),
  route("agent-runs.ts", "GET", "/api/v1/agent-runs/:runId/events"),
] as const satisfies ReadonlyArray<RouteInventoryItem>;

const LEGACY_DEMO_ROUTES = [
  route("learning.ts", "GET", "/api/v1/tasks/:taskId/submissions"),
  route("learning.ts", "POST", "/api/v1/tasks/:taskId/runs"),
  route("learning.ts", "POST", "/api/v1/tasks/:taskId/submissions"),
  route("learning.ts", "GET", "/api/v1/submissions/:submissionId"),
  route("learning.ts", "GET", "/api/v1/submissions/:submissionId/evidence"),
  route("learning.ts", "GET", "/api/v1/diagnoses/:diagnosisId"),
  route("learning.ts", "GET", "/api/v1/mistakes"),
  route("learning.ts", "GET", "/api/v1/learning-plan"),
  route("learning.ts", "POST", "/api/v1/validations/:validationId/attempts"),
  route("student.ts", "GET", "/api/v1/student/overview"),
  route("student.ts", "GET", "/api/v1/courses/:courseId/map"),
  route("student.ts", "GET", "/api/v1/tasks/:taskId/trace"),
  route("student.ts", "GET", "/api/v1/tasks/:taskId"),
  route("student.ts", "GET", "/api/v1/sources/:sourceId"),
  route("student.ts", "GET", "/api/v1/practice/tasks"),
  route("student.ts", "GET", "/api/v1/student/ability-assessment"),
  route("student.ts", "GET", "/api/v1/student/learning-profile"),
] as const satisfies ReadonlyArray<RouteInventoryItem>;

const LEGACY_ROUTES = [
  ...LEGACY_AGENT_ROUTES,
  ...LEGACY_DEMO_ROUTES,
] as const satisfies ReadonlyArray<RouteInventoryItem>;

const PUBLIC_ROUTES = new Set([
  "GET /api/v1/system-status",
  "GET /api/v1/auth/registration-policy",
  "POST /api/v1/auth/register",
  "POST /api/v1/auth/login",
  "GET /api/v1/auth/session",
  "POST /api/v1/auth/logout",
]);

function registeredExplicitMethodCount(app: FastifyInstance) {
  return [...app.printRoutes({ commonPrefix: false }).matchAll(/\(([^)]+)\)/g)]
    .flatMap((match) => (match[1] ?? "").split(",").map((method) => method.trim()))
    .filter((method) => method !== "HEAD").length;
}

function concretePath(path: string) {
  return path.replace(/:[^/]+/g, "audit-value");
}

function normalApp(
  options: {
    legacyAgent?: boolean;
    legacyDemo?: boolean;
    roles?: PublicAccount["roles"];
    courseAssigned?: boolean;
    onListAccounts?: () => void;
  } = {},
) {
  const service = {} as never;
  const roles = options.roles ?? [];
  const account: PublicAccount = {
    user_id: "user_role_audit",
    username: "role_audit",
    display_name: "角色边界审计账户",
    account_status: "active",
    roles: [...roles],
    auth_source: "local_development",
    account_origin: "registered",
    data_boundary: "local_account",
    must_change_password: false,
    created_at: "2026-09-02T00:00:00.000Z",
    updated_at: "2026-09-02T00:00:00.000Z",
    last_login_at: null,
  };
  const authentication = {
    async resolveSession(token: string) {
      return token === "role-session" && roles.length > 0
        ? { account }
        : null;
    },
    async listAccounts() {
      options.onListAccounts?.();
      return [account];
    },
  } as unknown as LocalAuthenticationService;
  const platformAccess = {
    async getActor(userId: string) {
      if (userId !== account.user_id) return null;
      return {
        user: {
          user_id: account.user_id,
          display_name: account.display_name,
          account_status: account.account_status,
          auth_source: account.auth_source,
          created_at: account.created_at,
          updated_at: account.updated_at,
        },
        roles: [...roles],
      };
    },
    async isCourseAssigned(
      userId: string,
      _courseId: string,
      membershipRole: "student" | "teacher",
    ) {
      return userId === account.user_id
        && membershipRole === "teacher"
        && (options.courseAssigned ?? false);
    },
  };
  const management = {
    async listQuestions() {
      return [];
    },
  };

  return buildApp({
    answerModel: null,
    llmConfig: null,
    authentication,
    platformAccess,
    management: management as never,
    studentOnboarding: service,
    studentStudyLibrary: service,
    classEnrollment: service,
    community: service,
    learningOrchestration: service,
    studentCare: service,
    studentAdmissions: service,
    studentProfileWorkflow: service,
    pilotStudy: service,
    externalQuestions: {
      repository: service,
      imageService: service,
      gateway: service,
      conceptMatcher: service,
    },
    programmingExperiments: service,
    questionBank: service,
    mockExam: service,
    reliableLearningLoop: service,
    mistakeRecommendation: service,
    learningProbes: service,
    examPapers: service,
    sourceLayer: service,
    courseContent: service,
    courseVideos: service,
    studentSourceCourses: service,
    sourceFigureArchive: service,
    workflowContext: service,
    aiWorkflowGateway: service,
    enableLegacyAgentRoutes: options.legacyAgent ?? false,
    enableLegacyDemoRoutes: options.legacyDemo ?? false,
  });
}

describe("complete Fastify authentication boundary", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = normalApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("locks the normal server inventory to 140 explicit method/path endpoints", () => {
    expect(NORMAL_ROUTES).toHaveLength(140);
    expect(new Set(NORMAL_ROUTES.map(({ method, path }) => `${method} ${path}`)).size).toBe(140);
    expect(registeredExplicitMethodCount(app)).toBe(140);

    for (const item of NORMAL_ROUTES) {
      expect(
        app.hasRoute({ method: item.method, url: item.path }),
        `${item.method} ${item.path} from ${item.source}`,
      ).toBe(true);
    }
  });

  it("keeps all 20 legacy endpoints out of the normal server construction", () => {
    expect(LEGACY_ROUTES).toHaveLength(20);
    for (const item of LEGACY_ROUTES) {
      expect(
        app.hasRoute({ method: item.method, url: item.path }),
        `${item.method} ${item.path} from ${item.source}`,
      ).toBe(false);
    }
  });

  it("registers only the three agent routes when the agent legacy gate is enabled", async () => {
    expect(LEGACY_AGENT_ROUTES).toHaveLength(3);
    expect(LEGACY_DEMO_ROUTES).toHaveLength(17);
    const legacyAgentApp = normalApp({ legacyAgent: true });
    await legacyAgentApp.ready();
    try {
      expect(registeredExplicitMethodCount(legacyAgentApp)).toBe(143);
      for (const item of LEGACY_AGENT_ROUTES) {
        expect(
          legacyAgentApp.hasRoute({ method: item.method, url: item.path }),
          `${item.method} ${item.path} from ${item.source}`,
        ).toBe(true);
      }
      for (const item of LEGACY_DEMO_ROUTES) {
        expect(
          legacyAgentApp.hasRoute({ method: item.method, url: item.path }),
          `${item.method} ${item.path} from ${item.source}`,
        ).toBe(false);
      }
    } finally {
      await legacyAgentApp.close();
    }
  });

  it("registers only the 17 demo routes when the demo legacy gate is enabled", async () => {
    const legacyDemoApp = normalApp({ legacyDemo: true });
    await legacyDemoApp.ready();
    try {
      expect(registeredExplicitMethodCount(legacyDemoApp)).toBe(157);
      for (const item of LEGACY_AGENT_ROUTES) {
        expect(
          legacyDemoApp.hasRoute({ method: item.method, url: item.path }),
          `${item.method} ${item.path} from ${item.source}`,
        ).toBe(false);
      }
      for (const item of LEGACY_DEMO_ROUTES) {
        expect(
          legacyDemoApp.hasRoute({ method: item.method, url: item.path }),
          `${item.method} ${item.path} from ${item.source}`,
        ).toBe(true);
      }
    } finally {
      await legacyDemoApp.close();
    }
  });

  it("registers all 20 legacy endpoints when both independent gates are enabled", async () => {
    const legacyApp = normalApp({ legacyAgent: true, legacyDemo: true });
    await legacyApp.ready();
    try {
      expect(registeredExplicitMethodCount(legacyApp)).toBe(160);
      for (const item of LEGACY_ROUTES) {
        expect(
          legacyApp.hasRoute({ method: item.method, url: item.path }),
          `${item.method} ${item.path} from ${item.source}`,
        ).toBe(true);
      }
    } finally {
      await legacyApp.close();
    }
  });

  it("has exactly six intended public method/path endpoints", () => {
    expect(PUBLIC_ROUTES.size).toBe(6);
    expect(
      NORMAL_ROUTES.filter(({ method, path }) => PUBLIC_ROUTES.has(`${method} ${path}`)),
    ).toHaveLength(6);
  });

  it("rejects anonymous access to every other normal endpoint before its handler", async () => {
    const protectedRoutes = NORMAL_ROUTES.filter(
      ({ method, path }) => !PUBLIC_ROUTES.has(`${method} ${path}`),
    );
    expect(protectedRoutes).toHaveLength(134);

    for (const item of protectedRoutes) {
      const response = await app.inject({
        method: item.method,
        url: concretePath(item.path),
      });
      expect(
        {
          statusCode: response.statusCode,
          code: response.json().error?.code,
          message: response.json().error?.message,
        },
        `${item.method} ${item.path} from ${item.source}`,
      ).toEqual({
        statusCode: 401,
        code: "AUTHENTICATION_REQUIRED",
        message: "请先登录后再访问受保护内容。",
      });
    }
  });

  it("allows the six public endpoints through the global authentication hook", async () => {
    const checks = [
      { method: "GET", url: "/api/v1/system-status", statusCode: 200 },
      { method: "GET", url: "/api/v1/auth/registration-policy", statusCode: 200 },
      { method: "POST", url: "/api/v1/auth/register", statusCode: 400 },
      { method: "POST", url: "/api/v1/auth/login", statusCode: 400 },
      { method: "GET", url: "/api/v1/auth/session?optional=1", statusCode: 200 },
      { method: "POST", url: "/api/v1/auth/logout", statusCode: 200 },
    ] as const;

    for (const check of checks) {
      const response = await app.inject(check);
      expect(response.statusCode, `${check.method} ${check.url}`).toBe(check.statusCode);
      expect(response.json().error?.message, `${check.method} ${check.url}`).not.toBe(
        "请先登录后再访问受保护内容。",
      );
    }
  });

  it("fails closed for a future unclassified API path before not-found handling", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/future-sensitive-route" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      message: "请先登录后再访问受保护内容。",
    });
  });

  it("admits a teacher to management before handler and course-scope narrowing", async () => {
    let listAccountsCalls = 0;
    const teacherApp = normalApp({
      roles: ["teacher"],
      courseAssigned: true,
      onListAccounts: () => {
        listAccountsCalls += 1;
      },
    });
    await teacherApp.ready();
    try {
      const accountGovernance = await teacherApp.inject({
        method: "GET",
        url: "/api/v1/manage/accounts",
        headers: { cookie: "xuetu_session=role-session" },
      });
      expect(accountGovernance.statusCode).toBe(403);
      expect(accountGovernance.json().error).toMatchObject({
        code: "ADMIN_ACCESS_REQUIRED",
        message: "只有管理员可以治理账户。",
      });
      expect(listAccountsCalls).toBe(0);

      const assignedCourse = await teacherApp.inject({
        method: "GET",
        url: "/api/v1/manage/courses/course_audit/questions",
        headers: { cookie: "xuetu_session=role-session" },
      });
      expect(assignedCourse.statusCode).toBe(200);
      expect(assignedCourse.json().data).toEqual({ items: [] });

      const studentSurface = await teacherApp.inject({
        method: "PUT",
        url: "/api/v1/student/admissions/target",
        headers: { cookie: "xuetu_session=role-session" },
        payload: {},
      });
      expect(studentSurface.statusCode).toBe(403);
      expect(studentSurface.json().error).toMatchObject({
        code: "ROLE_ACCESS_DENIED",
      });
    } finally {
      await teacherApp.close();
    }
  });

  it("admits an admin to admin and course handlers but not student handlers", async () => {
    let listAccountsCalls = 0;
    const adminApp = normalApp({
      roles: ["admin"],
      onListAccounts: () => {
        listAccountsCalls += 1;
      },
    });
    await adminApp.ready();
    try {
      const accountGovernance = await adminApp.inject({
        method: "GET",
        url: "/api/v1/manage/accounts",
        headers: { cookie: "xuetu_session=role-session" },
      });
      expect(accountGovernance.statusCode).toBe(200);
      expect(listAccountsCalls).toBe(1);

      const globalCourseManagement = await adminApp.inject({
        method: "GET",
        url: "/api/v1/manage/courses/course_audit/questions",
        headers: { cookie: "xuetu_session=role-session" },
      });
      expect(globalCourseManagement.statusCode).toBe(200);

      const studentSurface = await adminApp.inject({
        method: "PUT",
        url: "/api/v1/student/admissions/target",
        headers: { cookie: "xuetu_session=role-session" },
        payload: {},
      });
      expect(studentSurface.statusCode).toBe(403);
      expect(studentSurface.json().error).toMatchObject({
        code: "ROLE_ACCESS_DENIED",
      });
    } finally {
      await adminApp.close();
    }
  });

  it("admits a student only to student and account surfaces", async () => {
    const studentApp = normalApp({ roles: ["student"] });
    await studentApp.ready();
    try {
      const studentSurface = await studentApp.inject({
        method: "PUT",
        url: "/api/v1/student/admissions/target",
        headers: { cookie: "xuetu_session=role-session" },
        payload: {},
      });
      expect(studentSurface.statusCode).toBe(400);
      expect(studentSurface.json().error).toMatchObject({
        code: "ADMISSIONS_TARGET_INVALID",
      });

      const managementSurface = await studentApp.inject({
        method: "GET",
        url: "/api/v1/manage/accounts",
        headers: { cookie: "xuetu_session=role-session" },
      });
      expect(managementSurface.statusCode).toBe(403);
      expect(managementSurface.json().error).toMatchObject({
        code: "ROLE_ACCESS_DENIED",
      });
    } finally {
      await studentApp.close();
    }
  });

  it("combines only the scopes present on a multi-role identity", async () => {
    const assignedApp = normalApp({
      roles: ["student", "teacher"],
      courseAssigned: true,
    });
    await assignedApp.ready();
    try {
      const studentSurface = await assignedApp.inject({
        method: "PUT",
        url: "/api/v1/student/admissions/target",
        headers: { cookie: "xuetu_session=role-session" },
        payload: {},
      });
      expect(studentSurface.statusCode).toBe(400);
      expect(studentSurface.json().error?.code).toBe("ADMISSIONS_TARGET_INVALID");

      const assignedCourse = await assignedApp.inject({
        method: "GET",
        url: "/api/v1/manage/courses/course_audit/questions",
        headers: { cookie: "xuetu_session=role-session" },
      });
      expect(assignedCourse.statusCode).toBe(200);

      const adminOnly = await assignedApp.inject({
        method: "GET",
        url: "/api/v1/manage/accounts",
        headers: { cookie: "xuetu_session=role-session" },
      });
      expect(adminOnly.statusCode).toBe(403);
      expect(adminOnly.json().error?.code).toBe("ADMIN_ACCESS_REQUIRED");
    } finally {
      await assignedApp.close();
    }

    const unassignedApp = normalApp({
      roles: ["student", "teacher"],
      courseAssigned: false,
    });
    await unassignedApp.ready();
    try {
      const unassignedCourse = await unassignedApp.inject({
        method: "GET",
        url: "/api/v1/manage/courses/course_audit/questions",
        headers: { cookie: "xuetu_session=role-session" },
      });
      expect(unassignedCourse.statusCode).toBe(403);
      expect(unassignedCourse.json().error).toMatchObject({
        code: "COURSE_ACCESS_DENIED",
      });
    } finally {
      await unassignedApp.close();
    }
  });
});
