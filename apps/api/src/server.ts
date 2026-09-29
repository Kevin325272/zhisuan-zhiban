import { fileURLToPath } from "node:url";
import { LocalCourseSourcePages } from "./services/course-content/course-source-pages.js";

import { buildApp } from "./app.js";
import { PostgresStudentAiPreferences } from "./services/student-ai-preferences.js";
import { readDatabaseConfig } from "./config/database.js";
import { readAiWorkflowConfig } from "./config/ai-workflow.js";
import { readAgentChatConfig } from "./config/agent-chat.js";
import { readAiRequestLimitConfig } from "./config/ai-request-limit.js";
import { readProfileWorkflowConfig } from "./config/profile-workflow.js";
import { readStudentCareConfig } from "./config/student-care.js";
import { readStudentRegistrationConfig } from "./config/student-registration.js";
import { resolveListenHost } from "./config/listen-host.js";
import { readLlmConfig } from "./config/llm.js";
import { readExternalQuestionConfig } from "./config/external-questions.js";
import { readPastExamConfig } from "./config/past-exams.js";
import { loadLocalEnvironment } from "./config/local-env.js";
import { createPostgresPool, type SqlQueryablePool } from "./database/client.js";
import { PostgresPlatformAccess } from "./services/platform-access.js";
import { PostgresAuthRepository } from "./services/auth/postgres-auth-repository.js";
import { LocalAuthenticationService } from "./services/auth/authentication.js";
import { ScryptPasswordHasher } from "./services/auth/password-hasher.js";
import {
  resolveAuthCookieSecure,
  resolveLocalDevIdentityHeader,
  resolveTrustedProxy,
} from "./services/auth/auth-security.js";
import { PostgresManagementService } from "./services/platform-management.js";
import { PostgresQuestionBank } from "./services/question-bank/postgres-question-bank.js";
import { PostgresQuestionBankDirectory } from "./services/question-bank/question-bank-directory.js";
import { PostgresMockExam } from "./services/question-bank/postgres-mock-exam.js";
import { PostgresReliableLearningLoop } from "./services/question-bank/postgres-reliable-learning-loop.js";
import { PostgresMistakeRecommendation } from "./services/question-bank/postgres-mistake-recommendation.js";
import { PostgresLearningProbe } from "./services/question-bank/postgres-learning-probe.js";
import { PostgresStudentOnboarding } from "./services/onboarding/postgres-student-onboarding.js";
import { PostgresClassEnrollment } from "./services/class-enrollment/postgres-class-enrollment.js";
import { PostgresCommunity } from "./services/community/postgres-community.js";
import { PostgresStudentLearningOrchestration } from "./services/orchestration/postgres-student-learning-orchestration.js";
import { PostgresStudentCareRepository } from "./services/student-care/postgres-student-care.js";
import { DeterministicStudentCareService } from "./services/student-care/student-care-service.js";
import { PostgresStudentAdmissions } from "./services/admissions/postgres-student-admissions.js";
import { PostgresCourseContent } from "./services/course-content/postgres-course-content.js";
import { PostgresCourseVideoLibrary } from "./services/course-videos/postgres-course-video-library.js";
import { PostgresProgrammingExperimentRepository } from "./services/programming-experiments/postgres-programming-experiment.js";
import { PostgresStudentNotebook } from "./services/student-notebook.js";
import { PostgresStudentStudyLibrary } from "./services/study-library/student-study-library.js";
import { Postgres408SourceLayer } from "./services/course-source-layer/postgres-408-source-layer.js";
import { PostgresStudentSourceCourses } from "./services/course-source-layer/postgres-student-source-courses.js";
import { Zip408FigureArchive } from "./services/course-source-layer/zip-408-figure-archive.js";
import {
  CapabilityRoutedAiWorkflowGateway,
  UnavailableAiWorkflowGateway,
  type AiWorkflowGateway,
} from "./services/ai-workflow/ai-workflow-gateway.js";
import { DifyAiWorkflowGateway } from "./services/ai-workflow/dify-ai-workflow-gateway.js";
import { DifyAgentChatGateway } from "./services/agent-chat/dify-agent-chat-gateway.js";
import { HttpAiWorkflowGateway } from "./services/ai-workflow/http-ai-workflow-gateway.js";
import { OpenAiCompatibleAiWorkflowGateway } from "./services/ai-workflow/openai-compatible-ai-workflow-gateway.js";
import { PostgresWorkflowContextRepository } from "./services/ai-workflow/postgres-workflow-context.js";
import {
  DifyProfileWorkflowGateway,
  UnavailableProfileWorkflowGateway,
} from "./services/profile-workflow/dify-profile-workflow-gateway.js";
import { OpenAiCompatibleProfileWorkflowGateway } from "./services/profile-workflow/openai-compatible-profile-workflow-gateway.js";
import { StudentProfileWorkflowContextRepository } from "./services/profile-workflow/profile-workflow-context.js";
import { StudentProfileWorkflowService } from "./services/profile-workflow/student-profile-workflow-service.js";
import { AiUpstreamCircuitBreaker } from "./services/ai-upstream-circuit-breaker.js";
import {
  PostgresExamPaperLibrary,
  ZipExamPaperArchive,
} from "./services/exam-papers/postgres-exam-paper-library.js";
import { PostgresPilotStudy } from "./services/pilot-study/postgres-pilot-study.js";
import { PostgresExternalQuestionRepository } from "./services/external-questions/postgres-external-question.js";
import { ExternalQuestionImageService } from "./services/external-questions/image-service.js";
import { PostgresExternalQuestionConceptMatcher } from "./services/external-questions/concept-matcher.js";
import { OpenAiCompatibleExternalQuestionGateway } from "./services/external-questions/openai-compatible-external-question-gateway.js";
import { UnavailableExternalQuestionAiGateway } from "./services/external-questions/external-question.js";
import { runExternalQuestionCleanupBatch } from "./services/external-questions/cleanup.js";

loadLocalEnvironment();
const registrationConfig = readStudentRegistrationConfig();
const databaseConfig = readDatabaseConfig();
const postgresPool = createPostgresPool(databaseConfig);
const databasePool: SqlQueryablePool = postgresPool;
await databasePool.query("SELECT 1");
const pastExamConfig = readPastExamConfig();
const questionBank = new PostgresQuestionBank(databasePool, "course_408_001", {
  allowLocalDemoPastExams: pastExamConfig.allowLocalDemoPastExams,
});
const learningProbeQuestionBanks = new Map(
  ["course_408_ds", "course_408_co", "course_408_os", "course_408_cn"].map((courseId) => [
    courseId,
    new PostgresQuestionBank(databasePool, courseId, {
      allowLocalDemoPastExams: pastExamConfig.allowLocalDemoPastExams,
    }),
  ] as const),
);
const mockExam = new PostgresMockExam(databasePool, questionBank, {
  allowLocalDemoPastExams: pastExamConfig.allowLocalDemoPastExams,
});
const reliableLearningLoop = new PostgresReliableLearningLoop(databasePool);
const mistakeRecommendation = new PostgresMistakeRecommendation(databasePool);
const learningProbes = new PostgresLearningProbe(databasePool, questionBank, {
  questionBankForCourse: (courseId) => learningProbeQuestionBanks.get(courseId) ?? null,
});
const studentOnboarding = new PostgresStudentOnboarding(databasePool);
const classEnrollment = new PostgresClassEnrollment(databasePool);
const community = new PostgresCommunity(databasePool);
const learningOrchestration = new PostgresStudentLearningOrchestration(
  databasePool,
  studentOnboarding,
  reliableLearningLoop,
  { mistakeRecommendation },
);
const studentCareRepository = new PostgresStudentCareRepository(databasePool);
const studentCare = new DeterministicStudentCareService(
  studentCareRepository,
  learningOrchestration,
  readStudentCareConfig(),
);
const studentAdmissions = new PostgresStudentAdmissions(databasePool);
const platformAccess = new PostgresPlatformAccess(databasePool);
const authRepository = new PostgresAuthRepository(databasePool);
const authSessionCleanupNow = new Date();
await authRepository.cleanupStaleSessions({
  now: authSessionCleanupNow.toISOString(),
  revokedBefore: new Date(
    authSessionCleanupNow.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString(),
});
const authentication = new LocalAuthenticationService(
  authRepository,
  new ScryptPasswordHasher(),
  { registration: registrationConfig },
);
const management = new PostgresManagementService(databasePool);
const courseContent = new PostgresCourseContent(databasePool);
const courseSourcePages = new LocalCourseSourcePages(
  process.env.COURSE_READING_PAGES_PATH?.trim()
  || fileURLToPath(new URL("../../../data/course-materials/reading-pages/", import.meta.url)),
);
const courseVideos = new PostgresCourseVideoLibrary(databasePool);
const programmingExperiments = new PostgresProgrammingExperimentRepository(databasePool);
const studentNotebook = new PostgresStudentNotebook(databasePool, pastExamConfig.allowLocalDemoPastExams);
const studentAiPreferences = new PostgresStudentAiPreferences(databasePool);
const sourceLayer = new Postgres408SourceLayer(databasePool);
const studentSourceCourses = new PostgresStudentSourceCourses(databasePool);
const sourceFigureArchivePath =
  process.env.SOURCE_408_ARCHIVE_PATH?.trim()
  || fileURLToPath(
    new URL(
      "../../../data/course-materials/408-three-courses/raw/output.zip",
      import.meta.url,
    ),
  );
const sourceFigureArchive = new Zip408FigureArchive(sourceFigureArchivePath);
const workflowContext = new PostgresWorkflowContextRepository(
  databasePool,
  learningOrchestration,
  studentCareRepository,
);
const profileWorkflowContext = new StudentProfileWorkflowContextRepository(
  studentOnboarding,
  reliableLearningLoop,
);
const examPaperArchivePath =
  process.env.EXAM_PAPER_ARCHIVE_PATH?.trim()
  || fileURLToPath(new URL("../../../data/self-authored-exams/raw/自命题试卷.zip", import.meta.url));
const examPapers = new PostgresExamPaperLibrary(
  databasePool,
  new ZipExamPaperArchive(examPaperArchivePath),
);
const pilotStudy = new PostgresPilotStudy(databasePool, { choiceEvaluator: questionBank });
const aiWorkflowConfig = readAiWorkflowConfig();
const llmConfig = readLlmConfig();
const aiRequestLimit = readAiRequestLimitConfig();
const openAiCircuitBreaker = new AiUpstreamCircuitBreaker();
const externalQuestionConfig = readExternalQuestionConfig();
const externalQuestionRepository = new PostgresExternalQuestionRepository(databasePool);
const externalQuestionImageService = new ExternalQuestionImageService({
  storageDirectory: externalQuestionConfig.storageDirectory,
  maxUploadBytes: externalQuestionConfig.limits.maxUploadBytes,
  maxInputPixels: externalQuestionConfig.limits.maxInputPixels,
  maxDimension: externalQuestionConfig.limits.maxDimension,
});
const externalQuestionConceptMatcher = new PostgresExternalQuestionConceptMatcher(databasePool);
const externalQuestionGateway = llmConfig
  ? new OpenAiCompatibleExternalQuestionGateway({
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
      timeoutMs: llmConfig.timeoutMs,
      ...(llmConfig.apiFormat ? { apiFormat: llmConfig.apiFormat } : {}),
      ...(llmConfig.reasoningEffort ? { reasoningEffort: llmConfig.reasoningEffort } : {}),
      ...(llmConfig.maxOutputTokens ? { maxOutputTokens: llmConfig.maxOutputTokens } : {}),
      circuitBreaker: openAiCircuitBreaker,
    })
  : new UnavailableExternalQuestionAiGateway();
const cleanupExternalQuestions = async () => {
  await runExternalQuestionCleanupBatch({
    repository: externalQuestionRepository,
    imageService: externalQuestionImageService,
    now: new Date(),
    limit: 20,
    onFailure: (failure) => {
      console.warn(JSON.stringify({
        event: "external_question_file_cleanup_failed",
        code: failure.code,
        externalQuestionId: failure.externalQuestionId,
      }));
    },
  });
};
try {
  await runExternalQuestionCleanupBatch({
    repository: externalQuestionRepository,
    imageService: externalQuestionImageService,
    now: new Date(),
    limit: 20,
  });
} catch (error) {
  console.warn(JSON.stringify({
    event: "external_question_cleanup_startup_failed",
    errorType: error instanceof Error ? error.name : "unknown",
  }));
}
const externalQuestions = {
  repository: externalQuestionRepository,
  imageService: externalQuestionImageService,
  gateway: externalQuestionGateway,
  conceptMatcher: externalQuestionConceptMatcher,
  cleanup: cleanupExternalQuestions,
};
const allowUnverifiedAiSources =
  process.env.XUETU_ALLOW_UNVERIFIED_AI_SOURCE_EXPORT === "true";
const primaryAiWorkflowGateway: AiWorkflowGateway = aiWorkflowConfig
  ? aiWorkflowConfig.provider === "openai_compatible"
    ? llmConfig
      ? new OpenAiCompatibleAiWorkflowGateway({
          baseUrl: llmConfig.baseUrl,
          apiKey: llmConfig.apiKey,
          model: llmConfig.model,
          timeoutMs: llmConfig.timeoutMs,
          ...(llmConfig.apiFormat ? { apiFormat: llmConfig.apiFormat } : {}),
          ...(llmConfig.reasoningEffort ? { reasoningEffort: llmConfig.reasoningEffort } : {}),
          ...(llmConfig.maxOutputTokens ? { maxOutputTokens: llmConfig.maxOutputTokens } : {}),
          allowUnverifiedSources: allowUnverifiedAiSources,
          circuitBreaker: openAiCircuitBreaker,
        })
      : new UnavailableAiWorkflowGateway()
    : aiWorkflowConfig.provider === "dify"
    ? new DifyAiWorkflowGateway({
        endpoint: aiWorkflowConfig.baseUrl,
        secret: aiWorkflowConfig.secret,
        timeoutMs: aiWorkflowConfig.timeoutMs,
        allowUnverifiedSources: allowUnverifiedAiSources,
      })
    : new HttpAiWorkflowGateway({
        ...aiWorkflowConfig,
        allowUnverifiedSources: allowUnverifiedAiSources,
      })
  : new UnavailableAiWorkflowGateway();
// Dify 工作流仅按「诊断」能力对接；其余能力保持不可用，避免向诊断应用发送无效载荷。
const aiWorkflowGateway = aiWorkflowConfig?.provider === "dify"
  ? new CapabilityRoutedAiWorkflowGateway(
      new UnavailableAiWorkflowGateway(),
      { diagnose: primaryAiWorkflowGateway },
    )
  : primaryAiWorkflowGateway;
const profileWorkflowConfig = readProfileWorkflowConfig();
const profileWorkflowGateway = aiWorkflowConfig?.provider === "openai_compatible"
  ? llmConfig
    ? new OpenAiCompatibleProfileWorkflowGateway({
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        timeoutMs: llmConfig.timeoutMs,
        ...(llmConfig.apiFormat ? { apiFormat: llmConfig.apiFormat } : {}),
        ...(llmConfig.reasoningEffort ? { reasoningEffort: llmConfig.reasoningEffort } : {}),
        ...(llmConfig.maxOutputTokens ? { maxOutputTokens: llmConfig.maxOutputTokens } : {}),
        circuitBreaker: openAiCircuitBreaker,
      })
    : new UnavailableProfileWorkflowGateway()
  : profileWorkflowConfig
    ? new DifyProfileWorkflowGateway({
        endpoint: profileWorkflowConfig.baseUrl,
        secret: profileWorkflowConfig.secret,
        timeoutMs: profileWorkflowConfig.timeoutMs,
      })
    : new UnavailableProfileWorkflowGateway();
const studentProfileWorkflow = new StudentProfileWorkflowService(
  profileWorkflowContext,
  profileWorkflowGateway,
);
const agentChatConfig = readAgentChatConfig();
const agentChatGateway = agentChatConfig
  ? new DifyAgentChatGateway({
      endpoint: agentChatConfig.baseUrl,
      secret: agentChatConfig.secret,
      timeoutMs: agentChatConfig.timeoutMs,
    })
  : null;
const app = buildApp({
  logger: true,
  // 旧 JSON 快照仅保留给遗留单元测试；真实服务运行时不再用 JSON 充当数据库。
  persistPath: null,
  questionBank,
  questionBankDirectory: new PostgresQuestionBankDirectory(databasePool, questionBank, learningProbeQuestionBanks),
  mockExam,
  reliableLearningLoop,
  mistakeRecommendation,
  learningProbes,
  studentOnboarding,
  classEnrollment,
  community,
  learningOrchestration,
  studentCare,
  studentAdmissions,
  platformAccess,
  authentication,
  registration: registrationConfig,
  management,
  courseContent,
  courseSourcePages,
  courseVideos,
  programmingExperiments,
  studentNotebook,
  // Reuse exactly the same local-preview policy as the existing practice bank.
  studentStudyLibrary: new PostgresStudentStudyLibrary(databasePool, pastExamConfig.allowLocalDemoPastExams),
  studentAiPreferences,
  sourceLayer,
  studentSourceCourses,
  sourceFigureArchive,
  workflowContext,
  aiWorkflowGateway,
  agentChatGateway,
  studentProfileWorkflow,
  llmConfig,
  examPapers,
  pilotStudy,
  externalQuestions,
  ...(aiRequestLimit ? { aiRequestLimit } : {}),
  authCookieSecure: resolveAuthCookieSecure(),
  trustProxy: resolveTrustedProxy(),
  allowLocalDevAuth: resolveLocalDevIdentityHeader(),
  allowMockScenarios: process.env.XUETU_ALLOW_MOCK_SCENARIOS === "true",
  enableLegacyAgentRoutes:
    process.env.XUETU_ENABLE_LEGACY_AGENT_ROUTES === "true",
  enableLegacyDemoRoutes:
    process.env.XUETU_ENABLE_LEGACY_DEMO_ROUTES === "true",
});
app.addHook("onClose", async () => {
  await postgresPool.end();
});
const port = Number(process.env.PORT ?? 3001);
const host = resolveListenHost(process.argv.slice(2));

try {
  await app.listen({ host, port });
  console.log(`智算智伴 API: http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
