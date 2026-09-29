import Fastify, {
  type FastifyError,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import multipart from "@fastify/multipart";

import type { LlmConfig } from "./config/llm.js";
import { readLlmConfig } from "./config/llm.js";
import type { StudentRegistrationConfig } from "./config/student-registration.js";
import type { EvaluatorConfig } from "./config/evaluator.js";
import { readEvaluatorConfig } from "./config/evaluator.js";
import { createDemoState } from "./domain/demo-state.js";
import { registerAgentRunRoutes } from "./routes/agent-runs.js";
import { registerAgentChatRoutes } from "./routes/agent-chat.js";
import { registerAiWorkflowRoutes } from "./routes/ai-workflows.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerManagementRoutes } from "./routes/management.js";
import { registerCourseContentRoutes } from "./routes/course-content.js";
import { registerQuestionBankRoutes } from "./routes/question-bank.js";
import type { QuestionBankDirectory } from "./services/question-bank/question-bank-directory.js";
import { registerStudentLearningLoopRoutes } from "./routes/student-learning-loop.js";
import { registerStudentMistakeRecommendationRoutes } from "./routes/student-mistake-recommendations.js";
import { registerStudentLearningProbeRoutes } from "./routes/student-learning-probes.js";
import { registerExamPaperRoutes } from "./routes/exam-papers.js";
import { registerStudentRoutes } from "./routes/student.js";
import { registerStudentSourceCourseRoutes } from "./routes/student-source-courses.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountManagementRoutes } from "./routes/account-management.js";
import { registerStudentOnboardingRoutes } from "./routes/student-onboarding.js";
import { registerClassEnrollmentRoutes } from "./routes/class-enrollment.js";
import { registerCommunityRoutes } from "./routes/community.js";
import { registerStudentLearningOrchestrationRoutes } from "./routes/student-learning-orchestration.js";
import { registerStudentCareRoutes } from "./routes/student-care.js";
import { registerStudentAdmissionsRoutes } from "./routes/student-admissions.js";
import { registerStudentProfileWorkflowRoutes } from "./routes/student-profile-workflow.js";
import { registerCourseVideoRoutes } from "./routes/course-videos.js";
import { registerProgrammingExperimentRoutes } from "./routes/programming-experiments.js";
import { registerStudentNotebookRoutes } from "./routes/student-notebook.js";
import { registerStudentStudyLibraryRoutes } from "./routes/student-study-library.js";
import type { StudentStudyLibrary } from "./services/study-library/student-study-library.js";
import { registerStudentAiPreferencesRoutes } from "./routes/student-ai-preferences.js";
import type { StudentAiPreferencesStore } from "./services/student-ai-preferences.js";
import type { StudentNotebook } from "./services/student-notebook.js";
import { registerPilotStudyRoutes } from "./routes/pilot-study.js";
import {
  registerExternalQuestionRoutes,
  type ExternalQuestionRouteServices,
} from "./routes/external-questions.js";
import { createDemoFlow } from "./services/demo-flow.js";
import {
  createOpenAiCompatibleChat,
  type CourseAnswerModel,
} from "./services/openai-compatible-chat.js";
import {
  createTestKnowledgeBase,
  type TestKnowledgeBase,
} from "./services/test-knowledge-base.js";
import type { CodeEvaluator } from "./services/evaluator/code-evaluator.js";
import {
  applyPersistedState,
  createStatePersister,
  loadPersistedState,
} from "./services/state-persistence.js";
import { CachedCodeEvaluator } from "./services/evaluator/cached-code-evaluator.js";
import { LimitedCodeEvaluator } from "./services/evaluator/limited-code-evaluator.js";
import { Judge0Client } from "./services/evaluator/judge0-client.js";
import { Judge0CodeEvaluator } from "./services/evaluator/judge0-evaluator.js";
import { Judge0LanguageResolver } from "./services/evaluator/language-resolver.js";
import { MockBfsCodeEvaluator } from "./services/evaluator/mock-bfs-evaluator.js";
import type { QuestionBankService } from "./services/question-bank/question-bank.js";
import type { MockExamService } from "./services/question-bank/mock-exam.js";
import type { ReliableLearningLoopService } from "./services/question-bank/reliable-learning-loop.js";
import type { MistakeRecommendationService } from "./services/question-bank/postgres-mistake-recommendation.js";
import type { LearningProbeService } from "./services/question-bank/learning-probe-service.js";
import type { PlatformAccessService } from "./services/platform-access.js";
import type { ManagementService } from "./services/platform-management.js";
import type { CourseContentService } from "./services/course-content/course-content.js";
import type { CourseSourcePages } from "./services/course-content/course-source-pages.js";
import type { AiWorkflowGateway } from "./services/ai-workflow/ai-workflow-gateway.js";
import type { AgentChatGateway } from "./services/agent-chat/agent-chat-gateway.js";
import type { WorkflowContextRepository } from "./services/ai-workflow/workflow-context.js";
import {
  EphemeralCareConversationStore,
  type CareConversationStore,
} from "./services/ai-workflow/care-conversation-store.js";
import type { ExamPaperLibrary } from "./services/exam-papers/exam-paper-library.js";
import type { SourceLayerSummaryService } from "./services/course-source-layer/source-layer.js";
import type {
  SourceFigureArchive,
  StudentSourceCourseService,
} from "./services/course-source-layer/student-source-courses.js";
import type { LocalAuthenticationService } from "./services/auth/authentication.js";
import type { AuthRateLimitOptions } from "./services/auth/auth-rate-limiter.js";
import {
  resolveRequestIdentity,
  type RequestIdentity,
} from "./services/auth/request-identity.js";
import type { StudentOnboardingService } from "./services/onboarding/student-onboarding.js";
import type { ClassEnrollmentService } from "./services/class-enrollment/class-enrollment.js";
import type { CommunityService } from "./services/community/community.js";
import type { StudentLearningOrchestrationService } from "./services/orchestration/learning-orchestration-service.js";
import type { StudentCareService } from "./services/student-care/student-care-service.js";
import type { StudentAdmissionsService } from "./services/admissions/postgres-student-admissions.js";
import type { CourseVideoLibrary } from "./services/course-videos/course-video-library.js";
import type { ProgrammingExperimentRepository } from "./services/programming-experiments/postgres-programming-experiment.js";
import type { StudentProfileWorkflowService } from "./services/profile-workflow/student-profile-workflow-service.js";
import type { PilotStudyService } from "./services/pilot-study/pilot-study.js";
import {
  PerUserAiRequestLimiter,
  type AiRequestLimitOptions,
} from "./services/ai-request-limiter.js";

export interface BuildAppOptions {
  knowledgeBase?: TestKnowledgeBase;
  answerModel?: CourseAnswerModel | null;
  llmConfig?: LlmConfig | null;
  codeEvaluator?: CodeEvaluator;
  evaluatorConfig?: EvaluatorConfig;
  /** 学习状态快照文件路径；不传则纯内存运行（测试默认）。 */
  persistPath?: string | null;
  /** 是否允许客户端注入演示场景（mock_scenario）；生产应为 false。 */
  allowMockScenarios?: boolean;
  /** 仅本地兼容旧 BFS 问答会话；默认不注册相关路由。 */
  enableLegacyAgentRoutes?: boolean;
  /** 仅本地演示旧 BFS 课程/任务/作答状态；正式运行默认不注册。 */
  enableLegacyDemoRoutes?: boolean;
  questionBank?: QuestionBankService | null;
  questionBankDirectory?: QuestionBankDirectory | null;
  mockExam?: MockExamService | null;
  reliableLearningLoop?: ReliableLearningLoopService | null;
  mistakeRecommendation?: MistakeRecommendationService | null;
  learningProbes?: LearningProbeService | null;
  platformAccess?: PlatformAccessService | null;
  management?: ManagementService | null;
  courseContent?: CourseContentService | null;
  courseSourcePages?: CourseSourcePages | null;
  workflowContext?: WorkflowContextRepository | null;
  aiWorkflowGateway?: AiWorkflowGateway | null;
  agentChatGateway?: AgentChatGateway | null;
  careConversationStore?: CareConversationStore;
  examPapers?: ExamPaperLibrary | null;
  sourceLayer?: SourceLayerSummaryService | null;
  studentSourceCourses?: StudentSourceCourseService | null;
  sourceFigureArchive?: SourceFigureArchive | null;
  authentication?: LocalAuthenticationService | null;
  registration?: StudentRegistrationConfig;
  studentOnboarding?: StudentOnboardingService | null;
  classEnrollment?: ClassEnrollmentService | null;
  community?: CommunityService | null;
  learningOrchestration?: StudentLearningOrchestrationService | null;
  studentCare?: StudentCareService | null;
  studentAdmissions?: StudentAdmissionsService | null;
  courseVideos?: CourseVideoLibrary | null;
  programmingExperiments?: ProgrammingExperimentRepository | null;
  studentNotebook?: StudentNotebook | null;
  studentStudyLibrary?: StudentStudyLibrary | null;
  studentAiPreferences?: StudentAiPreferencesStore | null;
  studentProfileWorkflow?: StudentProfileWorkflowService | null;
  pilotStudy?: PilotStudyService | null;
  externalQuestions?: ExternalQuestionRouteServices | null;
  authCookieSecure?: boolean;
  authSessionTtlSeconds?: number;
  authRateLimit?: AuthRateLimitOptions;
  aiRequestLimit?: Partial<AiRequestLimitOptions>;
  trustProxy?: FastifyServerOptions["trustProxy"];
  /** 仅本地联调：允许 X-Dev-User-Id。不是生产认证。 */
  allowLocalDevAuth?: boolean;
  logger?: boolean;
}

function createCodeEvaluator(config: EvaluatorConfig): CodeEvaluator {
  const fallback = new MockBfsCodeEvaluator();
  if (config.mode === "mock") return fallback;
  const client = new Judge0Client(config);
  const resolver = new Judge0LanguageResolver(client, config.languageIds);
  return new Judge0CodeEvaluator({
    client,
    resolver,
    allowMockFallback: config.allowMockFallback,
    fallback,
  });
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 512 * 1024,
    trustProxy: options.trustProxy ?? false,
    genReqId: () => `req_${crypto.randomUUID()}`,
  });
  app.register(multipart);
  const requestIdentities = new WeakMap<FastifyRequest, RequestIdentity>();
  const aiRequestLimiter = new PerUserAiRequestLimiter(options.aiRequestLimit);
  const profileAiRequestLimiter = new PerUserAiRequestLimiter(options.aiRequestLimit);
  const careConversationStore = options.careConversationStore
    ?? new EphemeralCareConversationStore();
  if (options.authentication) {
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?", 1)[0] ?? request.url;
      const publicAuthPath = path === "/api/v1/auth/registration-policy"
        || path === "/api/v1/auth/register"
        || path === "/api/v1/auth/login"
        || path === "/api/v1/auth/session"
        || path === "/api/v1/auth/logout";
      if (path === "/api/v1/system-status" || publicAuthPath) return;
      if (!path.startsWith("/api/v1/")) return;
      const managementSurface = path.startsWith("/api/v1/manage/");
      const accountSurface = path.startsWith("/api/v1/account/");
      const authSurface = path.startsWith("/api/v1/auth/");
      const identity = await resolveRequestIdentity(request, {
        authentication: options.authentication ?? null,
        platformAccess: options.platformAccess ?? null,
        allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      });
      if (!identity) {
        return reply.code(401).send({
          contract_version: "0.1",
          request_id: request.id,
          error: { code: "AUTHENTICATION_REQUIRED", message: "请先登录后再访问受保护内容。", retryable: false, details: {} },
        });
      }
      requestIdentities.set(request, identity);
      const allowed = managementSurface
        ? identity.roles.includes("admin") || identity.roles.includes("teacher")
        : accountSurface || authSurface
          ? identity.roles.length > 0
          : identity.roles.includes("student");
      if (!allowed) {
        return reply.code(403).send({
          contract_version: "0.1",
          request_id: request.id,
          error: { code: "ROLE_ACCESS_DENIED", message: "当前账户角色无权访问该入口。", retryable: false, details: {} },
        });
      }
    });
  }
  const evaluatorConfig = options.evaluatorConfig ?? readEvaluatorConfig();
  const codeEvaluator = new CachedCodeEvaluator(
    new LimitedCodeEvaluator(
      options.codeEvaluator ?? createCodeEvaluator(evaluatorConfig),
      evaluatorConfig.maxConcurrentRuns,
    ),
  );
  const knowledgeBase = options.knowledgeBase ?? createTestKnowledgeBase();
  const createLegacyContext = () => {
    const state = createDemoState();
    for (const citation of knowledgeBase.listCitations()) {
      state.citations.set(citation.source_id, citation);
    }
    return { state, flow: createDemoFlow(state, codeEvaluator) };
  };
  const defaultLegacyContext = createLegacyContext();
  const legacyContextsByUser = new Map<string, ReturnType<typeof createLegacyContext>>();
  const legacyContextForRequest = (request: FastifyRequest) => {
    const userId = requestIdentities.get(request)?.userId;
    if (!userId) return defaultLegacyContext;
    const existing = legacyContextsByUser.get(userId);
    if (existing) return existing;
    const created = createLegacyContext();
    created.state.student.user_id = userId;
    legacyContextsByUser.set(userId, created);
    return created;
  };
  const { state, flow } = defaultLegacyContext;
  if (options.persistPath) {
    const persisted = loadPersistedState(options.persistPath);
    if (persisted) applyPersistedState(state, flow, persisted);
    const persister = createStatePersister(options.persistPath, state, flow);
    flow.setOnChange(persister.schedule);
    app.addHook("onClose", async () => {
      persister.flush();
    });
  }
  const llmConfig = options.llmConfig === undefined ? readLlmConfig() : options.llmConfig;
  const answerModel =
    options.answerModel === undefined
      ? llmConfig
        ? createOpenAiCompatibleChat(llmConfig)
        : null
      : options.answerModel;

  registerAuthRoutes(app, options.authentication ?? null, {
    ...(options.authCookieSecure === undefined ? {} : { secureCookies: options.authCookieSecure }),
    ...(options.authSessionTtlSeconds === undefined
      ? {}
      : { sessionTtlSeconds: options.authSessionTtlSeconds }),
    ...(options.authRateLimit === undefined ? {} : { rateLimit: options.authRateLimit }),
    ...(options.registration === undefined ? {} : { registration: options.registration }),
  });
  registerAccountManagementRoutes(app, options.authentication ?? null, {
    platformAccess: options.platformAccess ?? null,
    allowLocalDevAuth: options.allowLocalDevAuth ?? false,
  });
  if (options.studentOnboarding) {
    registerStudentOnboardingRoutes(app, options.studentOnboarding, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.classEnrollment && options.platformAccess) {
    registerClassEnrollmentRoutes(app, options.classEnrollment, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess,
      authentication: options.authentication ?? null,
    });
  }
  if (options.community && options.platformAccess) {
    registerCommunityRoutes(app, options.community, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess,
      authentication: options.authentication ?? null,
    });
  }
  if (options.learningOrchestration) {
    registerStudentLearningOrchestrationRoutes(app, options.learningOrchestration, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.studentCare) {
    registerStudentCareRoutes(app, options.studentCare, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.studentAdmissions) {
    registerStudentAdmissionsRoutes(app, options.studentAdmissions, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.studentAiPreferences) {
    registerStudentAiPreferencesRoutes(app, options.studentAiPreferences, {
      authentication: options.authentication ?? null,
      platformAccess: options.platformAccess ?? null,
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
    });
  }
  if (options.studentProfileWorkflow) {
    registerStudentProfileWorkflowRoutes(app, options.studentProfileWorkflow, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
      aiRequestLimiter: profileAiRequestLimiter,
      studentAiPreferences: options.studentAiPreferences ?? null,
    });
  }
  if (options.pilotStudy) {
    registerPilotStudyRoutes(app, options.pilotStudy, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  const externalQuestions = options.externalQuestions;
  if (
    externalQuestions?.repository
    && externalQuestions.imageService
    && externalQuestions.gateway
    && externalQuestions.conceptMatcher
  ) {
    registerExternalQuestionRoutes(app, externalQuestions, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
      aiRequestLimiter,
    });
  }

  if (options.enableLegacyDemoRoutes === true) {
    registerStudentRoutes(app, (request) => legacyContextForRequest(request).state);
    registerLearningRoutes(app, legacyContextForRequest, codeEvaluator);
  }
  if (options.studentNotebook) {
    registerStudentNotebookRoutes(app, options.studentNotebook, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.studentStudyLibrary) {
    registerStudentStudyLibraryRoutes(app, options.studentStudyLibrary, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.programmingExperiments) {
    registerProgrammingExperimentRoutes(
      app,
      options.programmingExperiments,
      codeEvaluator,
      {
        allowLocalDevAuth: options.allowLocalDevAuth ?? false,
        platformAccess: options.platformAccess ?? null,
        authentication: options.authentication ?? null,
      },
    );
  }
  if (options.questionBank) {
    registerQuestionBankRoutes(app, options.questionBank, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
      mockExam: options.mockExam ?? null,
      directory: options.questionBankDirectory ?? null,
    });
  }
  if (options.reliableLearningLoop) {
    registerStudentLearningLoopRoutes(app, options.reliableLearningLoop, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
      mistakeRecommendation: options.mistakeRecommendation ?? null,
    });
  }
  if (options.mistakeRecommendation) {
    registerStudentMistakeRecommendationRoutes(app, options.mistakeRecommendation, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.learningProbes) {
    registerStudentLearningProbeRoutes(app, options.learningProbes, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.examPapers) {
    registerExamPaperRoutes(app, options.examPapers, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      courseId: "course_408_001",
      authentication: options.authentication ?? null,
    });
  }
  if (options.platformAccess && options.management) {
    registerManagementRoutes(app, options.platformAccess, options.management, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      sourceLayer: options.sourceLayer ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.courseContent) {
    registerCourseContentRoutes(app, options.courseContent, {
      sourcePages: options.courseSourcePages ?? null,
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.courseVideos) {
    registerCourseVideoRoutes(app, options.courseVideos, {
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      platformAccess: options.platformAccess ?? null,
      authentication: options.authentication ?? null,
    });
  }
  if (options.studentSourceCourses && options.sourceFigureArchive) {
    registerStudentSourceCourseRoutes(
      app,
      options.studentSourceCourses,
      options.sourceFigureArchive,
      {
        allowLocalDevAuth: options.allowLocalDevAuth ?? false,
        platformAccess: options.platformAccess ?? null,
        authentication: options.authentication ?? null,
      },
    );
  }
  if (options.workflowContext && options.aiWorkflowGateway) {
    registerAiWorkflowRoutes(app, {
      workflowContext: options.workflowContext,
      aiWorkflowGateway: options.aiWorkflowGateway,
      platformAccess: options.platformAccess ?? null,
      allowLocalDevAuth: options.allowLocalDevAuth ?? false,
      authentication: options.authentication ?? null,
      aiRequestLimiter,
      careConversationStore,
      studentAiPreferences: options.studentAiPreferences ?? null,
    });
  }
  // 全局浮窗 Agent 路由常驻注册：未配置真实网关时以 503 响应，前端退回本地演示回复。
  registerAgentChatRoutes(app, {
    gateway: options.agentChatGateway ?? null,
    platformAccess: options.platformAccess ?? null,
    allowLocalDevAuth: options.allowLocalDevAuth ?? false,
    authentication: options.authentication ?? null,
    aiRequestLimiter,
  });
  if (options.enableLegacyAgentRoutes === true) registerAgentRunRoutes(app, {
    knowledgeBase,
    answerModel,
    allowMockScenarios: options.allowMockScenarios ?? false,
    aiRequestLimiter,
    getRequestUserId: (request) =>
      requestIdentities.get(request)?.userId ?? "anonymous_demo",
    getLearnerContext: (session, request) => {
      const requestState = legacyContextForRequest(request).state;
      if (session.course_id === "course_408_001") {
        return {
          major: requestState.student.major,
          course: "408 课程群",
          currentTopic: "本轮主动提问",
          weakPoints: [],
          nextRecommendation: "根据本轮问题进入对应课程知识点，并用课程训练验证理解。",
        };
      }
      const currentNode = requestState.nodes.find(
        (node) => node.learning_node_id === requestState.course.current_node_id,
      );
      const weakPoints = requestState.nodes
        .filter((node) => node.status === "in_progress" || node.status === "needs_review")
        .flatMap((node) => (node.recommended_reason ? [node.recommended_reason] : []));
      return {
        major: requestState.student.major,
        course: requestState.course.title,
        currentTopic: currentNode?.title ?? "当前课程任务",
        weakPoints,
        nextRecommendation: currentNode?.completion_criteria ?? "继续完成当前学习计划。",
      };
    },
  });

  app.get("/api/v1/system-status", async (request) => {
    return {
      contract_version: "0.1",
      request_id: request.id,
      data: { status: "ready" },
    };
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      contract_version: "0.1",
      request_id: request.id,
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "请求的资源不存在。",
        retryable: false,
        details: {},
      },
    }),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    request.log.error(error);
    return reply.code(statusCode).send({
      contract_version: "0.1",
      request_id: request.id,
      error: {
        code:
          statusCode >= 500
            ? "INTERNAL_ERROR"
            : statusCode === 413
              ? "PAYLOAD_TOO_LARGE"
              : "BAD_REQUEST",
        message:
          statusCode >= 500 ? "服务内部错误，请稍后重试。" : error.message || "请求无效。",
        retryable: statusCode >= 500,
        details: {},
      },
    });
  });

  return app;
}
