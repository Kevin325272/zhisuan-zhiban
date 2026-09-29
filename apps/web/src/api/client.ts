import type {
  StudentAiPreferences,
  StudentAiPreferencesPatch,
  AbilityAssessment,
  AbilityAssessmentKey,
  AdmissionsCurrentTarget,
  AdmissionsTargetSearchQuery,
  AdmissionsTargetSearchResponse,
  AccountCreateRequest,
  AccountCourseScope as AccountCourseScopeContract,
  AccountStatus,
  AcademicClassOptionList,
  AuthAccount,
  AuthRegisterRequest,
  AuthRegistrationResponse,
  AgentEvent,
  AiWorkflowCapability,
  AiWorkflowInvocation,
  AiWorkflowResponse,
  AiWorkflowRuntimeStatus,
  AlgorithmTrace,
  AnswerSubmission,
  Citation,
  ClassEnrollmentCancellation,
  ClassEnrollmentDecisionRequest,
  ClassInvitationRevocation,
  ClassMemberRemoval,
  CommunityCircleOverview,
  CommunityDeleteResult,
  CommunityLikeState,
  CommunityPostCreateRequest,
  CommunityPostDetailResponse,
  CommunityPostList,
  CommunityPostListQuery,
  CommunityPostSummary,
  CommunityPostUpdateRequest,
  CommunityReply,
  CommunityReplyCreateRequest,
  CommunityReplyUpdateRequest,
  CodeRunResult,
  CourseLearningSummary,
  CourseCatalogResponse,
  CourseChapterList,
  CourseContentPageQuery,
  CourseCurriculumMap,
  CourseKnowledgePage,
  CourseMap,
  CourseQaPage,
  CourseReadingProgress,
  CourseReadingProgressResponse,
  CourseReadingProgressUpdate,
  CourseConceptVideoList,
  CourseVideoEpisodePage,
  CourseVideoKind,
  CourseVideoSeriesPage,
  CourseSummary,
  SourceCourseOutline,
  Diagnosis,
  ExternalQuestionConfirmation,
  ExternalQuestionDepth,
  ExternalQuestionDetail,
  ExternalQuestionList,
  LearningProfile,
  LearningProbeEventRequest,
  LearningProbeOffer,
  LearningProbeResult,
  LearningProbeSession,
  LearningNode,
  ManagedQuestionSummary,
  MaterialRecord,
  MockExamSession,
  MockExamStartRequest,
  MockExamSubmissionResult,
  MockExamSubmitRequest,
  LearningRecord,
  ManagedCourseEvidence,
  ManagedCourseEvidenceQuery,
  ManagedCourseStudentList,
  ManagedCourseStudentListQuery,
  MistakeRecommendationResponse,
  PersonalLearningDashboard,
  PlanItem,
  PracticeAttemptRecord,
  PracticeMode,
  PracticeLearningEvidence,
  PracticeTaskSummary,
  ProgrammingLanguage,
  QuestionDto,
  QuestionEvaluationResult,
  QuestionPracticeItem,
  PracticeMistakeRecord,
  PracticeMistakeStatus,
  ProgrammingExperimentAttemptRecord,
  ProgrammingExperimentAttemptSubmit,
  ProgrammingExperimentCatalog,
  ProgrammingExperimentHistory,
  ProgrammingExperimentOverview,
  OnboardingGoalInput,
  OnboardingDiagnosticAnswer,
  OnboardingDiagnosticQuestionSetResponse,
  OnboardingSelfAssessmentsUpdate,
  OnboardingState,
  PastExamCatalogResponse,
  PilotConsentRequest,
  PilotFeedbackRequest,
  PilotManagementReport,
  PilotParticipant,
  PilotParticipantEnrollment,
  PilotStudentStudy,
  PilotTaskCompletionRequest,
  PilotTaskEvaluationRequest,
  PilotTaskEvaluationResponse,
  QuestionType,
  StudentProfile,
  StudentLearningOrchestration,
  StudentLearningTaskCompletion,
  StudentCarePreference,
  StudentCarePreferenceRead,
  StudentCareResponseAction,
  StudentCareResponseResult,
  StudentCareStatus,
  StudentClassEnrollmentRequest,
  StudentClassEnrollmentRequestCreate,
  StudentClassEnrollmentStatus,
  StudentRegistrationPolicy,
  StudentProfileWorkflowResponse,
  SubmissionHistory,
  Task,
  TeacherIntervention,
  TeacherInterventionCreateRequest,
  TeacherInterventionStatusUpdateRequest,
  TeacherClassCreateRequest,
  TeacherClassInvitationCreated,
  TeacherClassManagement,
  TeacherManagedClass,
  TeacherApprovalRequest,
  TraceVariant,
} from "@xuetu/contracts";

interface ApiEnvelope<T> {
  contract_version: string;
  request_id: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface AuthSessionData {
  account: AuthAccount;
}

export interface OptionalAuthSessionData {
  account: AuthAccount | null;
}

export type AccountCourseScope = AccountCourseScopeContract;

// Course saves can come from scrolling, navigation and a visibility flush.
// Keep their network order, including across a course page's unmount/remount.
const readingProgressWrites = new Map<string, Promise<CourseReadingProgress>>();
let readingSessionVersion = 0;
function resetReadingProgressWrites() {
  readingSessionVersion += 1;
  readingProgressWrites.clear();
}
function requireReadingSession(version: number) {
  if (version !== readingSessionVersion) {
    throw new ApiError("登录状态已变化，请重新打开课程。", "READING_SESSION_CHANGED", false, {});
  }
}

export function getAuthSession(options: { optional: true }): Promise<OptionalAuthSessionData>;
export function getAuthSession(options?: { optional?: false }): Promise<AuthSessionData>;
export function getAuthSession(options?: { optional?: boolean }) {
  const path = options?.optional ? "/api/v1/auth/session?optional=1" : "/api/v1/auth/session";
  return request<AuthSessionData | OptionalAuthSessionData>(path);
}

export function getStudentRegistrationPolicy() {
  return request<StudentRegistrationPolicy>("/api/v1/auth/registration-policy");
}

export function getAccountCourseScope() {
  return request<AccountCourseScopeContract>("/api/v1/account/course-scope");
}

export function loginAccount(input: { username: string; password: string }) {
  resetReadingProgressWrites();
  return request<AuthSessionData>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function registerAccount(input: AuthRegisterRequest) {
  resetReadingProgressWrites();
  return request<AuthRegistrationResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logoutAccount() {
  resetReadingProgressWrites();
  return request<{ logged_out: boolean }>("/api/v1/auth/logout", { method: "POST", body: "{}" });
}

export function changeAccountPassword(input: {
  current_password: string;
  new_password: string;
  new_password_confirmation: string;
}) {
  return request<AuthSessionData>("/api/v1/auth/password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getStudentOnboardingState() {
  return request<OnboardingState>("/api/v1/student/onboarding");
}

export function getStudentOnboardingDiagnosticQuestions() {
  return request<OnboardingDiagnosticQuestionSetResponse>(
    "/api/v1/student/onboarding/diagnostic/questions",
  );
}

export function saveStudentOnboardingDiagnosticAnswer(input: OnboardingDiagnosticAnswer) {
  return request<OnboardingState>("/api/v1/student/onboarding/diagnostic/answers", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function completeStudentOnboardingDiagnostic() {
  return request<OnboardingState>("/api/v1/student/onboarding/diagnostic/complete", {
    method: "POST",
    body: "{}",
  });
}

export function saveStudentOnboardingGoals(input: OnboardingGoalInput) {
  return request<OnboardingState>("/api/v1/student/onboarding/goals", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function saveStudentOnboardingSelfAssessments(input: OnboardingSelfAssessmentsUpdate) {
  return request<OnboardingState>("/api/v1/student/onboarding/self-assessments", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function completeStudentOnboarding() {
  return request<OnboardingState>("/api/v1/student/onboarding/complete", {
    method: "POST",
    body: "{}",
  });
}

export function getStudentClassEnrollmentStatus() {
  return request<StudentClassEnrollmentStatus>("/api/v1/student/class-enrollment");
}

export function submitStudentClassEnrollmentRequest(
  input: StudentClassEnrollmentRequestCreate,
) {
  return request<StudentClassEnrollmentStatus>(
    "/api/v1/student/class-enrollment/requests",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function cancelStudentClassEnrollmentRequest() {
  return request<ClassEnrollmentCancellation>(
    "/api/v1/student/class-enrollment/requests/current",
    { method: "DELETE" },
  );
}

export function getPilotStudy() {
  return request<PilotStudentStudy>("/api/v1/student/pilot-study");
}

export function recordPilotConsent(input: PilotConsentRequest) {
  return request<PilotStudentStudy>("/api/v1/student/pilot-study/consent", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function startPilotTask(taskId: string) {
  return request<PilotStudentStudy>(
    `/api/v1/student/pilot-study/tasks/${encodeURIComponent(taskId)}/start`,
    { method: "POST" },
  );
}

export function completePilotTask(
  taskId: string,
  input: PilotTaskCompletionRequest,
) {
  return request<PilotStudentStudy>(
    `/api/v1/student/pilot-study/tasks/${encodeURIComponent(taskId)}/complete`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function evaluatePilotChoiceTask(
  taskId: string,
  input: PilotTaskEvaluationRequest,
  idempotencyKey: string,
) {
  return request<PilotTaskEvaluationResponse>(
    `/api/v1/student/pilot-study/tasks/${encodeURIComponent(taskId)}/evaluate`,
    {
      method: "POST",
      headers: { ...studentHeaders(), "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    },
  );
}

export function submitPilotFeedback(input: PilotFeedbackRequest) {
  return request<PilotStudentStudy>("/api/v1/student/pilot-study/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getPilotManagementReport(includeSynthetic = false) {
  const query = includeSynthetic ? "?include_synthetic=true" : "";
  return request<PilotManagementReport>(`/api/v1/manage/pilot-study${query}`);
}

export function enrollPilotParticipant(input: PilotParticipantEnrollment) {
  return request<PilotParticipant>("/api/v1/manage/pilot-study/participants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function downloadPilotReport(
  format: "json" | "csv",
  includeSynthetic = false,
) {
  const query = includeSynthetic ? "?include_synthetic=true" : "";
  const response = await fetch(`/api/v1/manage/pilot-study/export.${format}${query}`, {
    credentials: "same-origin",
    headers: { Accept: format === "csv" ? "text/csv" : "application/json" },
  });
  if (!response.ok) {
    let apiError: ApiEnvelope<never>["error"];
    try {
      apiError = ((await response.json()) as ApiEnvelope<never>).error;
    } catch {
      apiError = undefined;
    }
    throw new ApiError(
      apiError?.message ?? `导出失败（HTTP ${response.status}）。`,
      apiError?.code ?? "PILOT_EXPORT_FAILED",
      apiError?.retryable ?? response.status >= 500,
      apiError?.details ?? { status: response.status },
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="?([^";]+)"?/iu)?.[1]
    ?? `xuetu-pilot.${format}`;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function getProgrammingExperimentCatalog() {
  return request<ProgrammingExperimentCatalog>("/api/v1/student/programming-experiments");
}

export function getProgrammingExperiment(experimentId: string) {
  return request<ProgrammingExperimentOverview>(
    `/api/v1/student/programming-experiments/${encodeURIComponent(experimentId)}`,
  );
}

export function getProgrammingExperimentAttempts(experimentId: string, limit = 12) {
  return request<ProgrammingExperimentHistory>(
    `/api/v1/student/programming-experiments/${encodeURIComponent(experimentId)}/attempts?limit=${limit}`,
  );
}

export function runProgrammingExperiment(
  experimentId: string,
  input: ProgrammingExperimentAttemptSubmit,
) {
  return request<CodeRunResult>(
    `/api/v1/student/programming-experiments/${encodeURIComponent(experimentId)}/runs`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function submitProgrammingExperimentAttempt(
  experimentId: string,
  input: ProgrammingExperimentAttemptSubmit,
  idempotencyKey: string,
) {
  return request<ProgrammingExperimentAttemptRecord>(
    `/api/v1/student/programming-experiments/${encodeURIComponent(experimentId)}/attempts`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    },
  );
}

export function getManagedAccounts() {
  return request<{ items: AuthAccount[] }>("/api/v1/manage/accounts");
}

export function getManagedAcademicClasses() {
  return request<AcademicClassOptionList>("/api/v1/manage/academic-classes");
}

export function approveManagedTeacher(userId: string, input: TeacherApprovalRequest) {
  return request<{ account: AuthAccount }>(
    `/api/v1/manage/accounts/${encodeURIComponent(userId)}/teacher-approval`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function createManagedAccount(input: AccountCreateRequest) {
  return request<{ account: AuthAccount }>("/api/v1/manage/accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateManagedAccountStatus(userId: string, status: AccountStatus) {
  return request<{ account: AuthAccount }>(`/api/v1/manage/accounts/${encodeURIComponent(userId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function resetManagedAccountPassword(userId: string, password: string) {
  return request<{ account: AuthAccount }>(`/api/v1/manage/accounts/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const formDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(!formDataBody && init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(
      response.ok
        ? "服务返回了无法解析的数据。"
        : `服务暂时不可用（HTTP ${response.status}），请稍后重试。`,
      "UNEXPECTED_RESPONSE",
      response.status >= 500 || response.status === 429,
      { status: response.status },
    );
  }
  if (!response.ok || envelope.error || envelope.data === undefined) {
    const apiError = envelope.error ?? {
      code: "UNEXPECTED_RESPONSE",
      message: "服务返回了无法识别的结果。",
      retryable: false,
      details: {},
    };
    throw new ApiError(apiError.message, apiError.code, apiError.retryable, apiError.details);
  }
  return envelope.data;
}

function signalInit(signal?: AbortSignal): Pick<RequestInit, "signal"> | Record<string, never> {
  return signal ? { signal } : {};
}

export function getNotebookEntries(query: Partial<NotebookQuery>, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  return request<NotebookList>(`/api/v1/student/notebook?${params}`, signalInit(signal));
}
export function getNotebookEntry(id: string, signal?: AbortSignal) {
  return request<{ entry: NotebookEntry | null }>(`/api/v1/student/notebook/${encodeURIComponent(id)}`, signalInit(signal));
}
export function saveNotebookEntry(id: string, input: NotebookWrite) {
  return request<{ entry: NotebookEntry }>(`/api/v1/student/notebook/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}
export function removeNotebookEntry(id: string, version: number) {
  return request<{ removed: boolean }>(`/api/v1/student/notebook/${encodeURIComponent(id)}?version=${version}`, { method: "DELETE" });
}

export function uploadExternalQuestion(
  image: File,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  const body = new FormData();
  body.append("image", image);
  return request<ExternalQuestionDetail>("/api/v1/student/external-questions", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body,
    ...signalInit(signal),
  });
}

export function retryExternalQuestionRecognition(
  externalQuestionId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request<ExternalQuestionDetail>(
    `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}/recognition`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: "{}",
      ...signalInit(signal),
    },
  );
}

export function confirmExternalQuestion(
  externalQuestionId: string,
  input: ExternalQuestionConfirmation,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request<ExternalQuestionDetail>(
    `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}/confirmation`,
    {
      method: "PUT",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
      ...signalInit(signal),
    },
  );
}

export function explainExternalQuestion(
  externalQuestionId: string,
  depth: ExternalQuestionDepth,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request<ExternalQuestionDetail>(
    `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}/explanations`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ depth }),
      ...signalInit(signal),
    },
  );
}

export function saveExternalQuestion(
  externalQuestionId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request<ExternalQuestionDetail>(
    `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}/save`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: "{}",
      ...signalInit(signal),
    },
  );
}

export function getExternalQuestions(signal?: AbortSignal) {
  return request<ExternalQuestionList>(
    "/api/v1/student/external-questions",
    signal ? { signal } : undefined,
  );
}

export function getExternalQuestion(externalQuestionId: string, signal?: AbortSignal) {
  return request<ExternalQuestionDetail>(
    `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}`,
    signal ? { signal } : undefined,
  );
}

export function externalQuestionImageUrl(externalQuestionId: string) {
  return `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}/image`;
}

export function deleteExternalQuestion(
  externalQuestionId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request<{ deleted: boolean }>(
    `/api/v1/student/external-questions/${encodeURIComponent(externalQuestionId)}`,
    {
      method: "DELETE",
      headers: { "Idempotency-Key": idempotencyKey },
      ...signalInit(signal),
    },
  );
}

function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 33) ^ value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export interface OverviewData {
  student: StudentProfile;
  current_course: CourseSummary;
  recommended_node: LearningNode;
  today_plan: Array<{ label: string; status: string }>;
  review_items: Array<{
    concept_id: string;
    label: string;
    evidence_label: string;
    learning_node_id: string;
  }>;
  recent_activity: Array<{ label: string; occurred_at: string }>;
}

export type CourseMapData = CourseMap;
export type CourseCatalogData = CourseCatalogResponse;
export type CourseChaptersData = CourseChapterList;
export type CourseCurriculumMapData = CourseCurriculumMap;
export type CourseKnowledgeData = CourseKnowledgePage;
export type CourseQaData = CourseQaPage;
export type CourseReadingProgressData = CourseReadingProgressResponse;
export type CourseConceptVideosData = CourseConceptVideoList;
export type CourseVideoSeriesData = CourseVideoSeriesPage;
export type CourseVideoEpisodesData = CourseVideoEpisodePage;
export type SourceCourseOutlineData = SourceCourseOutline;

export interface CourseVideoSeriesQuery {
  q: string;
  kind: "all" | CourseVideoKind;
  page: number;
  pageSize: number;
}

export interface CourseVideoEpisodeQuery {
  page: number;
  pageSize: number;
}

export interface QuestionBankSelection {
  mode?: PracticeMode;
  subject?: string;
  concept_id?: string;
  question_id?: string;
  year?: number;
  type?: QuestionType;
  tags?: string[];
  tag_match?: "all" | "any";
  limit?: number;
  offset?: number;
}

export interface QuestionSelectionData {
  items: QuestionPracticeItem[];
  total: number;
  limit: number;
  offset: number;
  context?: {
    concept_id: string;
    concept_title: string;
    course_id: string;
    course_title: string;
    subject: string;
    match_method: "exact_question_tag";
  } | null;
}

export interface QuestionEvaluationBundle {
  attempt: PracticeAttemptRecord;
  evaluation: QuestionEvaluationResult;
  evidence: PracticeLearningEvidence;
}

export interface SubmissionData {
  submission_id: string;
  evaluation: {
    evaluation_id: string;
    passed_count: number;
    total_count: number;
    test_cases: Array<{
      test_case_id: string;
      label: string;
      status: "passed" | "failed" | "error";
      summary: string;
      duration_ms: number | null;
    }>;
  };
  evidence: Array<{
    evidence_id: string;
    type: string;
    label: string;
    summary: string;
    source_ref: string;
  }>;
  diagnosis_id: string | null;
  learning_node_status: LearningNode["status"];
  learning_state_version: number;
  validation_id: string | null;
  learning_update: {
    trigger: "failed_submission" | "passed_submission";
    title: string;
    ability_changes: Array<{
      key: AbilityAssessmentKey;
      label: string;
      before: number;
      after: number;
      delta: number;
      reason: string;
    }>;
    plan_changes: Array<{
      label: string;
      detail: string;
    }>;
    review_changes: Array<{
      id: string;
      title: string;
      scheduled_for: string;
      minutes: number;
      reason: string;
    }>;
  };
}

export interface ValidationCaseSummary {
  test_case_id: string;
  label: string;
  status: "passed" | "failed" | "error";
  duration_ms: number | null;
  memory_kb: number | null;
}

export interface ValidationData {
  passed: boolean;
  previous_node_status: LearningNode["status"];
  current_node_status: LearningNode["status"];
  next_recommended_node_id: string;
  learning_state_version: number;
  evaluation: {
    passed_count: number;
    total_count: number;
    execution_mode: "sandbox" | "mock" | "mock_fallback";
    evaluator_label: string;
    test_cases: ValidationCaseSummary[];
  };
  created_at: string;
}

export interface MistakeData {
  mistake_id: string;
  submission_id: string;
  diagnosis_id: string;
  learning_node_id: string;
  title: string;
  summary: string;
  status: "needs_review" | "resolved";
  created_at: string;
}

export interface SystemStatus {
  status: "ready";
}

export type AgentScenario =
  | "auto"
  | "normal"
  | "rag_empty"
  | "rag_low_confidence"
  | "agent_timeout";

export type TutorHintLevel = "direction" | "clue" | "steps" | "complete";

export interface TutorWorkspaceContext {
  active_view: "code" | "trace" | "tests" | "evidence" | "history" | "ask";
  language: string | null;
  task_title: string | null;
  task_id: string | null;
  learning_node_id: string | null;
  submission_id: string | null;
  code_excerpt: string | null;
  test_summary: string | null;
  trace_summary: string | null;
  error_line: number | null;
  selected_test_case_id: string | null;
  failed_test_cases: string[];
  execution_mode?: "sandbox" | "mock" | "mock_fallback" | null;
  evaluator_label?: string | null;
  runtime_summary?: string[];
  evaluator_error?: string | null;
  trace_variant: string | null;
  learner_weak_points: string[];
}

interface CourseQuestionOptions {
  hintLevel?: TutorHintLevel;
  workspaceContext?: TutorWorkspaceContext;
  sessionScope?: string;
  /** 每个事件到达即回调（真流式增量渲染）。 */
  onEvent?: AgentEventListener;
}

const DEFAULT_LEARNING_SESSION_SCOPE = "course_ds_001:node_bfs_001:task_bfs_bug_001";

function learningSessionStorageKey(scope: string) {
  return `xuetu.learning-session.${scope}`;
}

function readLearningSession(scope: string) {
  try {
    return globalThis.sessionStorage?.getItem(learningSessionStorageKey(scope)) ?? null;
  } catch {
    return null;
  }
}

function writeLearningSession(scope: string, sessionId: string | null) {
  try {
    const key = learningSessionStorageKey(scope);
    if (sessionId) globalThis.sessionStorage?.setItem(key, sessionId);
    else globalThis.sessionStorage?.removeItem(key);
  } catch {
    // Session persistence is a convenience; private browsing must not block tutoring.
  }
}

export function getOverview() {
  return request<OverviewData>("/api/v1/student/overview");
}

function studentHeaders() {
  // Identity is carried by the server-issued httpOnly session cookie.
  return {};
}

export function get408Courses() {
  return request<CourseCatalogData>("/api/v1/408/courses", {
    headers: studentHeaders(),
  });
}

export function getStudentLearningOrchestration() {
  return request<StudentLearningOrchestration>(
    "/api/v1/student/learning-orchestration",
    { headers: studentHeaders() },
  );
}

export function getStudentCareStatus() {
  return request<StudentCareStatus>(
    "/api/v1/student/care",
    { headers: studentHeaders() },
  );
}

export function getStudentCarePreference() {
  return request<StudentCarePreferenceRead>(
    "/api/v1/student/care/preferences",
    { headers: studentHeaders() },
  );
}

export function respondToStudentCare(
  interactionId: string,
  action: StudentCareResponseAction,
) {
  return request<StudentCareResponseResult>(
    `/api/v1/student/care/${encodeURIComponent(interactionId)}/respond`,
    {
      method: "POST",
      headers: studentHeaders(),
      body: JSON.stringify({ action }),
    },
  );
}

export function updateStudentCarePreference(enabled: boolean) {
  return request<StudentCarePreference>(
    "/api/v1/student/care/preferences",
    {
      method: "PUT",
      headers: studentHeaders(),
      body: JSON.stringify({ enabled }),
    },
  );
}

export function activateStudentLearningTask(taskId: string) {
  return request<{
    task_id: string;
    activated_at: string;
    idempotent: boolean;
  }>(
    "/api/v1/student/learning-orchestration/activate",
    {
      method: "POST",
      headers: studentHeaders(),
      body: JSON.stringify({ task_id: taskId }),
    },
  );
}

export function completeStudentLearningTask(taskId: string) {
  return request<StudentLearningTaskCompletion>(
    "/api/v1/student/learning-orchestration/complete",
    {
      method: "POST",
      headers: studentHeaders(),
      body: JSON.stringify({ task_id: taskId }),
    },
  );
}

export function getStudentAdmissionsTarget() {
  return request<AdmissionsCurrentTarget>(
    "/api/v1/student/admissions/target",
    { headers: studentHeaders() },
  );
}

export function searchStudentAdmissionsTargets(query: AdmissionsTargetSearchQuery) {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.year !== undefined) params.set("year", String(query.year));
  params.set("page", String(query.page));
  params.set("page_size", String(query.page_size));
  return request<AdmissionsTargetSearchResponse>(
    `/api/v1/student/admissions/targets?${params.toString()}`,
    { headers: studentHeaders() },
  );
}

export function selectStudentAdmissionsTarget(targetId: string) {
  return request<AdmissionsCurrentTarget>(
    "/api/v1/student/admissions/target",
    {
      method: "PUT",
      headers: studentHeaders(),
      body: JSON.stringify({ target_id: targetId }),
    },
  );
}

export function clearStudentAdmissionsTarget() {
  return request<AdmissionsCurrentTarget>(
    "/api/v1/student/admissions/target",
    { method: "DELETE", headers: studentHeaders() },
  );
}

export function getCourseChapters(courseSlug: string) {
  return request<CourseChaptersData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/chapters`,
    { headers: studentHeaders() },
  );
}

export function getCourseCurriculumMap(courseSlug: string) {
  return request<CourseCurriculumMapData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/curriculum-map`,
    { headers: studentHeaders() },
  );
}

export function getSourceCourseOutline(courseSlug: string) {
  return request<SourceCourseOutlineData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/source-outline`,
    { headers: studentHeaders() },
  );
}

function courseContentParams(query: CourseContentPageQuery) {
  const params = new URLSearchParams();
  if (query.chapter) params.set("chapter", query.chapter);
  params.set("limit", String(query.limit));
  params.set("offset", String(query.offset));
  return params.toString();
}

export function getCourseKnowledge(courseSlug: string, query: CourseContentPageQuery) {
  return request<CourseKnowledgeData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/knowledge?${courseContentParams(query)}`,
    { headers: studentHeaders() },
  );
}

export function getCourseQaExamples(courseSlug: string, query: CourseContentPageQuery) {
  return request<CourseQaData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/qa-examples?${courseContentParams(query)}`,
    { headers: studentHeaders() },
  );
}

export function getCourseConceptVideos(courseSlug: string, conceptId: string) {
  return request<CourseConceptVideosData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/concepts/${encodeURIComponent(conceptId)}/videos`,
    { headers: studentHeaders() },
  );
}

export function getCourseVideoSeries(courseSlug: string, query: CourseVideoSeriesQuery) {
  const params = new URLSearchParams();
  params.set("q", query.q.trim());
  params.set("kind", query.kind);
  params.set("page", String(query.page));
  params.set("page_size", String(query.pageSize));
  return request<CourseVideoSeriesData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/videos?${params.toString()}`,
    { headers: studentHeaders() },
  );
}

export function getCourseVideoSeriesEpisodes(
  courseSlug: string,
  seriesId: string,
  query: CourseVideoEpisodeQuery,
) {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("page_size", String(query.pageSize));
  return request<CourseVideoEpisodesData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/videos/${encodeURIComponent(seriesId)}/episodes?${params.toString()}`,
    { headers: studentHeaders() },
  );
}

export async function getCourseReadingProgress(courseSlug: string) {
  const version = readingSessionVersion;
  let pending = readingProgressWrites.get(courseSlug);
  while (pending) {
    await pending.catch(() => undefined);
    requireReadingSession(version);
    pending = readingProgressWrites.get(courseSlug);
  }
  return request<CourseReadingProgressData>(
    `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/reading-progress`,
    { headers: studentHeaders() },
  );
}

export function saveCourseReadingProgress(
  courseSlug: string,
  update: CourseReadingProgressUpdate,
  options: { keepalive?: boolean } = {},
) {
  const version = readingSessionVersion;
  const body = JSON.stringify(update);
  const keepalive = options.keepalive ?? false;
  const send = () => {
    requireReadingSession(version);
    return request<CourseReadingProgress>(
      `/api/v1/408/courses/${encodeURIComponent(courseSlug)}/reading-progress`,
      { method: "PUT", headers: studentHeaders(), body, keepalive, signal: AbortSignal.timeout(12_000) },
    );
  };
  const previous = readingProgressWrites.get(courseSlug);
  const result = previous ? previous.catch(() => undefined).then(send) : send();
  readingProgressWrites.set(courseSlug, result);
  const release = () => {
    if (readingProgressWrites.get(courseSlug) === result) readingProgressWrites.delete(courseSlug);
  };
  void result.then(release, release);
  return result;
}

export function getCourseMap() {
  return request<CourseMapData>("/api/v1/courses/course_ds_001/map");
}

export function getPracticeTasks() {
  return request<{ course: CourseSummary; items: PracticeTaskSummary[] }>(
    "/api/v1/practice/tasks?course_id=course_ds_001",
  );
}

export function getQuestionBankQuestions(selection: QuestionBankSelection) {
  const params = new URLSearchParams();
  if (selection.mode) params.set("mode", selection.mode);
  if (selection.subject) params.set("subject", selection.subject);
  if (selection.concept_id) params.set("concept_id", selection.concept_id);
  if (selection.question_id) params.set("question_id", selection.question_id);
  if (selection.year !== undefined) params.set("year", String(selection.year));
  if (selection.type) params.set("type", selection.type);
  if (selection.tags?.length) params.set("tags", selection.tags.join(","));
  params.set("tag_match", selection.tag_match ?? "all");
  params.set("limit", String(selection.limit ?? 1));
  params.set("offset", String(selection.offset ?? 0));
  return request<QuestionSelectionData>(
    `/api/v1/question-bank/questions?${params.toString()}`,
  );
}

export function getPastExamCatalog() {
  return request<PastExamCatalogResponse>("/api/v1/question-bank/past-exams");
}

export function getQuestionAssetUrl(
  questionId: string,
  assetId: string,
  attemptId?: string,
) {
  const path = `/api/v1/question-bank/questions/${encodeURIComponent(questionId)}/assets/${encodeURIComponent(assetId)}`;
  if (!attemptId) return path;
  const params = new URLSearchParams({ attempt_id: attemptId });
  return `${path}?${params.toString()}`;
}

export function submitQuestionAnswer(submission: AnswerSubmission, idempotencyKey: string) {
  return request<QuestionEvaluationBundle>("/api/v1/question-bank/evaluations", {
    method: "POST",
    headers: { ...studentHeaders(), "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(submission),
  });
}

export function getLearningProbeOffer(attemptId: string) {
  const params = new URLSearchParams({ attempt_id: attemptId });
  return request<LearningProbeOffer | null>(
    `/api/v1/student/learning-probes/offer?${params.toString()}`,
  );
}

export function getLearningProbeSession(probeSessionId: string) {
  return request<LearningProbeSession>(
    `/api/v1/student/learning-probes/${encodeURIComponent(probeSessionId)}`,
  );
}

export function getLearningProbeOfferForSession(probeSessionId: string) {
  return request<LearningProbeOffer>(
    `/api/v1/student/learning-probes/${encodeURIComponent(probeSessionId)}/offer`,
  );
}

export function startLearningProbe(probeSessionId: string) {
  return request<LearningProbeOffer | null>(
    `/api/v1/student/learning-probes/${encodeURIComponent(probeSessionId)}/start`,
    {
      method: "POST",
      headers: studentHeaders(),
    },
  );
}

export function skipLearningProbe(probeSessionId: string) {
  return request<LearningProbeSession>(
    `/api/v1/student/learning-probes/${encodeURIComponent(probeSessionId)}/skip`,
    {
      method: "POST",
      headers: studentHeaders(),
    },
  );
}

export function submitLearningProbe(
  probeSessionId: string,
  input: LearningProbeEventRequest,
  idempotencyKey: string,
) {
  return request<LearningProbeResult>(
    `/api/v1/student/learning-probes/${encodeURIComponent(probeSessionId)}/submit`,
    {
      method: "POST",
      headers: { ...studentHeaders(), "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    },
  );
}

export function startMockExam(requestBody: MockExamStartRequest) {
  return request<MockExamSession>("/api/v1/question-bank/mock-exams", {
    method: "POST",
    headers: studentHeaders(),
    body: JSON.stringify(requestBody),
  });
}

export function submitMockExam(
  sessionId: string,
  requestBody: MockExamSubmitRequest,
  idempotencyKey: string,
) {
  return request<MockExamSubmissionResult>(
    `/api/v1/question-bank/mock-exams/${encodeURIComponent(sessionId)}/submit`,
    {
      method: "POST",
      headers: { ...studentHeaders(), "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(requestBody),
    },
  );
}

export function getPracticeMistakes(filters: {
  course_id?: string;
  concept_id?: string;
  status?: PracticeMistakeStatus;
} = {}) {
  const params = new URLSearchParams();
  if (filters.course_id) params.set("course_id", filters.course_id);
  if (filters.concept_id) params.set("concept_id", filters.concept_id);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return request<{ items: PracticeMistakeRecord[] }>(
    `/api/v1/student/practice-mistakes${query ? `?${query}` : ""}`,
    { headers: studentHeaders() },
  );
}

export function getStudentMistakeRecommendations(filters: {
  course_id?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams();
  if (filters.course_id) params.set("course_id", filters.course_id);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const query = params.toString();
  return request<MistakeRecommendationResponse>(
    `/api/v1/student/mistake-recommendations${query ? `?${query}` : ""}`,
    { headers: studentHeaders() },
  );
}

export interface PracticeMistakeReopenState {
  mistake_id: string;
  status: "needs_review";
  next_review_at: string | null;
  consecutive_success_count: number;
  next_review_interval_days: number | null;
  last_processed_attempt_id: string | null;
}

export function reopenPracticeMistake(mistakeId: string) {
  return request<PracticeMistakeReopenState>(
    `/api/v1/student/practice-mistakes/${encodeURIComponent(mistakeId)}`,
    {
      method: "PATCH",
      headers: studentHeaders(),
      body: JSON.stringify({ status: "needs_review" }),
    },
  );
}

export function getLearningRecord(courseId?: string) {
  const params = new URLSearchParams();
  if (courseId) params.set("course_id", courseId);
  const query = params.toString();
  return request<LearningRecord>(
    `/api/v1/student/learning-record${query ? `?${query}` : ""}`,
    { headers: studentHeaders() },
  );
}

export function getPersonalLearningDashboard() {
  return request<PersonalLearningDashboard>(
    "/api/v1/student/personal-learning-dashboard",
    { headers: studentHeaders() },
  );
}

const inFlightAiWorkflows = new Map<string, Promise<AiWorkflowResponse>>();
export function clearAiWorkflowRequests() { inFlightAiWorkflows.clear(); }

export function invokeAiWorkflow(invocation: AiWorkflowInvocation) {
  const requestKey = JSON.stringify(invocation);
  const existing = inFlightAiWorkflows.get(requestKey);
  if (existing) return existing;

  const pending = request<AiWorkflowResponse>(
    `/api/v1/student/ai-workflows/${encodeURIComponent(invocation.capability)}`,
    {
      method: "POST",
      headers: studentHeaders(),
      body: JSON.stringify(invocation),
    },
  );
  inFlightAiWorkflows.set(requestKey, pending);
  const clearPending = () => {
    if (inFlightAiWorkflows.get(requestKey) === pending) {
      inFlightAiWorkflows.delete(requestKey);
    }
  };
  void pending.then(clearPending, clearPending);
  return pending;
}

export function getStudentAiPreferences() {
  return request<StudentAiPreferences>("/api/v1/student/ai-preferences", { headers: studentHeaders() });
}

export function updateStudentAiPreferences(patch: StudentAiPreferencesPatch) {
  return request<StudentAiPreferences>("/api/v1/student/ai-preferences", {
    method: "PATCH", headers: studentHeaders(), body: JSON.stringify(patch),
  });
}

export function getAiWorkflowStatus(capability: AiWorkflowCapability) {
  return request<AiWorkflowRuntimeStatus>(
    `/api/v1/student/ai-workflows/status?capability=${encodeURIComponent(capability)}`,
    { headers: studentHeaders() },
  );
}

export function runStudentProfileWorkflow(courseId: string) {
  return request<StudentProfileWorkflowResponse>(
    "/api/v1/student/profile/ai",
    {
      method: "POST",
      body: JSON.stringify({ course_id: courseId }),
      headers: studentHeaders(),
    },
  );
}

function adminHeaders() {
  return {};
}

export function getManagedQuestions(courseId: string) {
  return request<{ items: ManagedQuestionSummary[] }>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/questions`,
    { headers: adminHeaders() },
  );
}

export function getManagedMaterials(courseId: string) {
  return request<{ items: MaterialRecord[] }>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/materials`,
    { headers: adminHeaders() },
  );
}

export function getManagedLearningSummary(courseId: string) {
  return request<CourseLearningSummary>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/learning-summary`,
    { headers: adminHeaders() },
  );
}

export function getManagedCourseStudents(
  courseId: string,
  query: ManagedCourseStudentListQuery,
) {
  const params = new URLSearchParams({
    page: String(query.page),
    page_size: String(query.page_size),
    class_name: query.class_name,
    learning_status: query.learning_status,
  });
  return request<ManagedCourseStudentList>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/students?${params.toString()}`,
    { headers: adminHeaders() },
  );
}

export function getManagedCourseEvidence(
  courseId: string,
  query?: Partial<ManagedCourseEvidenceQuery>,
) {
  const params = new URLSearchParams();
  if (query?.days !== undefined) params.set("days", String(query.days));
  if (query?.start_at) params.set("start_at", query.start_at);
  if (query?.end_at) params.set("end_at", query.end_at);
  if (query?.source_scope) params.set("source_scope", query.source_scope);
  const queryString = params.toString();
  return request<ManagedCourseEvidence>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/evidence${queryString ? `?${queryString}` : ""}`,
    { headers: adminHeaders() },
  );
}

export function recordManagedTeacherIntervention(
  courseId: string,
  input: TeacherInterventionCreateRequest,
) {
  return request<TeacherIntervention>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/interventions`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
}

export function updateManagedTeacherInterventionStatus(
  courseId: string,
  interventionId: string,
  status: TeacherInterventionStatusUpdateRequest["status"],
) {
  return request<TeacherIntervention>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/interventions/${encodeURIComponent(interventionId)}/status`,
    {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ status }),
    },
  );
}

export function getTeacherClassManagement(courseId: string) {
  return request<TeacherClassManagement>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/classes`,
    { headers: adminHeaders() },
  );
}

export function getCommunityCircles() {
  return request<CommunityCircleOverview>("/api/v1/student/community/circles");
}

export function getCommunityPosts(query: Partial<CommunityPostListQuery> = {}) {
  const params = new URLSearchParams();
  if (query.circle_id) params.set("circle_id", query.circle_id);
  if (query.topic) params.set("topic", query.topic);
  if (query.search) params.set("search", query.search);
  if (query.sort) params.set("sort", query.sort);
  params.set("page", String(query.page ?? 1));
  params.set("page_size", String(query.page_size ?? 12));
  return request<CommunityPostList>(`/api/v1/student/community/posts?${params.toString()}`);
}

export function getCommunityPost(
  postId: string,
  query: { reply_page?: number; reply_page_size?: number } = {},
) {
  const params = new URLSearchParams({
    reply_page: String(query.reply_page ?? 1),
    reply_page_size: String(query.reply_page_size ?? 30),
  });
  return request<CommunityPostDetailResponse>(
    `/api/v1/student/community/posts/${encodeURIComponent(postId)}?${params.toString()}`,
  );
}

export function createCommunityPost(
  input: CommunityPostCreateRequest,
  idempotencyKey: string,
) {
  return request<CommunityPostSummary>("/api/v1/student/community/posts", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export function updateCommunityPost(postId: string, input: CommunityPostUpdateRequest) {
  return request<CommunityPostSummary>(
    `/api/v1/student/community/posts/${encodeURIComponent(postId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteCommunityPost(postId: string) {
  return request<CommunityDeleteResult>(
    `/api/v1/student/community/posts/${encodeURIComponent(postId)}`,
    { method: "DELETE" },
  );
}

export function createCommunityReply(
  postId: string,
  input: CommunityReplyCreateRequest,
  idempotencyKey: string,
) {
  return request<CommunityReply>(
    `/api/v1/student/community/posts/${encodeURIComponent(postId)}/replies`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    },
  );
}

export function updateCommunityReply(replyId: string, input: CommunityReplyUpdateRequest) {
  return request<CommunityReply>(
    `/api/v1/student/community/replies/${encodeURIComponent(replyId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteCommunityReply(replyId: string) {
  return request<CommunityDeleteResult>(
    `/api/v1/student/community/replies/${encodeURIComponent(replyId)}`,
    { method: "DELETE" },
  );
}

export function setCommunityPostLike(postId: string, liked: boolean) {
  return request<CommunityLikeState>(
    `/api/v1/student/community/posts/${encodeURIComponent(postId)}/like`,
    { method: "PUT", body: JSON.stringify({ liked }) },
  );
}

export function createTeacherClass(courseId: string, input: TeacherClassCreateRequest) {
  return request<TeacherManagedClass>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/classes`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
}

export function createTeacherClassInvitation(courseId: string, classId: string) {
  return request<TeacherClassInvitationCreated>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/classes/${encodeURIComponent(classId)}/invitation`,
    { method: "POST", headers: adminHeaders() },
  );
}

export function revokeTeacherClassInvitation(courseId: string, classId: string) {
  return request<ClassInvitationRevocation>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/classes/${encodeURIComponent(classId)}/invitation`,
    { method: "DELETE", headers: adminHeaders() },
  );
}

export function decideTeacherClassEnrollmentRequest(
  courseId: string,
  classId: string,
  requestId: string,
  input: ClassEnrollmentDecisionRequest,
) {
  return request<StudentClassEnrollmentRequest>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/classes/${encodeURIComponent(classId)}/requests/${encodeURIComponent(requestId)}/decision`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(input),
    },
  );
}

export function removeTeacherClassMember(
  courseId: string,
  classId: string,
  studentCode: string,
) {
  return request<ClassMemberRemoval>(
    `/api/v1/manage/courses/${encodeURIComponent(courseId)}/classes/${encodeURIComponent(classId)}/members/${encodeURIComponent(studentCode)}`,
    { method: "DELETE", headers: adminHeaders() },
  );
}

export function getLearningProfile() {
  return request<LearningProfile>(
    "/api/v1/student/learning-profile?course_id=course_ds_001",
  );
}

export function getAbilityAssessment() {
  return request<AbilityAssessment>(
    "/api/v1/student/ability-assessment?course_id=course_ds_001",
  );
}

export function getSystemStatus() {
  return request<SystemStatus>("/api/v1/system-status");
}

export function getTask(taskId = "task_bfs_bug_001") {
  return request<Task>(`/api/v1/tasks/${taskId}`);
}

export function getAlgorithmTrace(
  taskId: string,
  language: ProgrammingLanguage,
  variant: TraceVariant,
  customInput?: string,
) {
  const params = new URLSearchParams({ language, variant });
  if (customInput?.trim()) params.set("custom_input", customInput.trim());
  return request<AlgorithmTrace>(
    `/api/v1/tasks/${taskId}/trace?${params.toString()}`,
  );
}

export function getTaskSubmissions(taskId = "task_bfs_bug_001") {
  return request<SubmissionHistory>(`/api/v1/tasks/${taskId}/submissions`);
}

export function runTask(
  taskId: string,
  language: ProgrammingLanguage,
  source: string,
  customInput: string | null,
) {
  return request<CodeRunResult>(`/api/v1/tasks/${taskId}/runs`, {
    method: "POST",
    body: JSON.stringify({
      language,
      source,
      custom_input: customInput,
    }),
  });
}

export function submitTask(
  taskId: string,
  taskVersion: number,
  language: ProgrammingLanguage,
  source: string,
  customInput: string | null = null,
) {
  // 同一份代码复用同一个幂等键：双击或网络重试不会产生重复提交。
  const key = `submission-${taskId}-${taskVersion}-${language}-${stableHash(
    `${source}\u0000${customInput ?? ""}`,
  )}`;
  return request<SubmissionData>(`/api/v1/tasks/${taskId}/submissions`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({
      task_version: taskVersion,
      answer: null,
      code: { language, source },
      custom_input: customInput,
      client_draft_version: 7,
      hint_usage_ids: [],
    }),
  });
}

export function getDiagnosis(diagnosisId: string) {
  return request<Diagnosis>(`/api/v1/diagnoses/${diagnosisId}`);
}

export function getSource(sourceId: string) {
  return request<Citation>(`/api/v1/sources/${sourceId}`);
}

export async function runDiagnosis(
  submissionId: string,
  _mockScenario: "normal" | "rag_empty" | "rag_low_confidence" | "agent_timeout" = "normal",
  workspaceContext?: TutorWorkspaceContext,
  onEvent?: AgentEventListener,
) {
  const session = await request<{ session_id: string }>("/api/v1/learning-sessions", {
    method: "POST",
    body: JSON.stringify({
      course_id: "course_ds_001",
      learning_node_id: "node_bfs_001",
      task_id: "task_bfs_bug_001",
      mode: "guided_learning",
    }),
  });
  const run = await request<{ event_url: string }>(
    `/api/v1/learning-sessions/${session.session_id}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: "请根据本次评测证据定位问题，并给出下一步提示。",
        submission_id: submissionId,
        requested_action: "diagnosis",
        hint_level: "clue",
        workspace_context: workspaceContext ?? null,
      }),
    },
  );
  const response = await fetch(run.event_url, { credentials: "same-origin", headers: { Accept: "text/event-stream" } });
  if (!response.ok) throw new ApiError("诊断事件流不可用。", "AGENT_STREAM_ERROR", true, {});
  return readSseStream(response, onEvent);
}

export async function askCourseQuestion(
  content: string,
  _mockScenario: AgentScenario = "auto",
  options: CourseQuestionOptions = {},
) {
  const scope = options.sessionScope ?? DEFAULT_LEARNING_SESSION_SCOPE;

  async function createSession() {
    const session = await request<{ session_id: string }>("/api/v1/learning-sessions", {
      method: "POST",
      body: JSON.stringify({
        course_id: "course_408_001",
        learning_node_id: "node_408_ai_companion",
        task_id: "task_408_open_question",
        mode: "guided_learning",
      }),
    });
    writeLearningSession(scope, session.session_id);
    return session.session_id;
  }

  async function sendMessage(sessionId: string) {
    const run = await request<{ event_url: string }>(
      `/api/v1/learning-sessions/${sessionId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          submission_id: null,
          requested_action: "question_answer",
          hint_level: options.hintLevel ?? "clue",
          workspace_context: options.workspaceContext ?? null,
        }),
      },
    );
    const response = await fetch(run.event_url, { credentials: "same-origin", headers: { Accept: "text/event-stream" } });
    if (!response.ok) {
      throw new ApiError("问答事件流不可用。", "AGENT_STREAM_ERROR", true, {});
    }
    return readSseStream(response, options.onEvent);
  }

  const sessionId = readLearningSession(scope) ?? (await createSession());
  try {
    return await sendMessage(sessionId);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "RESOURCE_NOT_FOUND") throw error;
    writeLearningSession(scope, null);
    return sendMessage(await createSession());
  }
}

export type AgentChatContext = "study" | "lab" | "teacher";

export interface AgentChatStreamEvent {
  type: "agent.delta" | "agent.done" | "agent.failed";
  delta?: string;
  text?: string;
  error?: { code: string; message: string; retryable: boolean };
}

/**
 * 全局浮窗 Agent 的真实问答流：POST 后增量消费 SSE。
 * 服务未接入时以 ApiError 拒绝，由调用方退回本地演示回复。
 */
export async function streamAgentChat(
  message: string,
  context: AgentChatContext,
  options: {
    onEvent?: (event: AgentChatStreamEvent) => void;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const response = await fetch("/api/v1/agent/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ message, context }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    let code = "AGENT_CHAT_UNAVAILABLE";
    let messageText = "全局智能体暂不可用，请稍后重试。";
    try {
      const envelope = await response.json() as {
        error?: { code?: string; message?: string };
      };
      code = envelope.error?.code ?? code;
      messageText = envelope.error?.message ?? messageText;
    } catch {
      // 非 JSON 错误体保持默认文案。
    }
    throw new ApiError(
      messageText,
      code,
      response.status === 429 || response.status >= 500,
      {},
    );
  }
  await readSseStream(response, (event) =>
    options.onEvent?.(event as unknown as AgentChatStreamEvent));
}

export function parseSse(body: string): AgentEvent[] {
  return body
    .replaceAll("\r\n", "\n")
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const type = lines.find((line) => line.startsWith("event: "))?.slice(7);
      const rawData = lines.find((line) => line.startsWith("data: "))?.slice(6);
      if (!type || !rawData) throw new Error("Invalid SSE event.");
      return { ...JSON.parse(rawData), type } as AgentEvent;
    });
}

function parseSseFrame(block: string): AgentEvent | null {
  const lines = block.replaceAll("\r\n", "\n").split("\n");
  const type = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const rawData = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!type || !rawData) return null;
  try {
    return { ...JSON.parse(rawData), type } as AgentEvent;
  } catch {
    return null;
  }
}

export type AgentEventListener = (event: AgentEvent) => void;

/**
 * 增量消费 SSE 事件流：每个事件到达即回调 onEvent，最终返回完整事件数组。
 * 环境不支持流式 body 时回退为整体读取。
 */
async function readSseStream(
  response: Response,
  onEvent?: AgentEventListener,
): Promise<AgentEvent[]> {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const events = parseSse(await response.text());
    if (onEvent) for (const event of events) onEvent(event);
    return events;
  }

  const decoder = new TextDecoder();
  const events: AgentEvent[] = [];
  let buffer = "";
  const drainFrames = () => {
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const event = parseSseFrame(frame);
      if (event) {
        events.push(event);
        onEvent?.(event);
      }
      separator = buffer.indexOf("\n\n");
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drainFrames();
  }
  buffer += decoder.decode();
  drainFrames();
  if (buffer.trim()) {
    const event = parseSseFrame(buffer);
    if (event) {
      events.push(event);
      onEvent?.(event);
    }
  }
  return events;
}

export function submitValidation(
  validationId: string,
  taskVersion: number,
  learningStateVersion: number,
  language: ProgrammingLanguage,
  source: string,
) {
  const key = `validation-${validationId}-${taskVersion}-${learningStateVersion}-${language}-${stableHash(source)}`;
  return request<ValidationData>(`/api/v1/validations/${validationId}/attempts`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({
      task_version: taskVersion,
      expected_learning_state_version: learningStateVersion,
      answer: null,
      code: { language, source },
    }),
  });
}

export async function getMistakes() {
  const data = await request<{ items: MistakeData[] }>("/api/v1/mistakes");
  return data.items;
}

export async function getLearningPlan() {
  return request<{
    course_id: string;
    learning_state_version: number;
    items: PlanItem[];
  }>("/api/v1/learning-plan?course_id=course_ds_001");
}
import type { NotebookEntry, NotebookList, NotebookQuery, NotebookWrite } from "@xuetu/contracts";
