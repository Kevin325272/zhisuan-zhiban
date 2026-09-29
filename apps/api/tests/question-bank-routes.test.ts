import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import type {
  AnswerSubmission,
  MockExamSession,
  MockExamStartRequest,
  MockExamSubmissionResult,
  MockExamSubmitRequest,
  PlatformRole,
  PracticeSelection,
  QuestionDto,
  QuestionLearningMetadata,
} from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import type {
  QuestionBankService,
  QuestionEvaluationBundle,
} from "../src/services/question-bank/question-bank.js";
import { QuestionSubmissionError } from "../src/services/question-bank/question-bank.js";
import {
  MockExamError,
  type MockExamService,
} from "../src/services/question-bank/mock-exam.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

const question: QuestionDto = {
  id: "2026-01",
  year: 2026,
  number: 1,
  subject: "数据结构",
  type: "choice",
  multiple: false,
  question: "顺序表的哪项操作必然移动元素？",
  options: [
    { option_id: "A", text: "表头插入", assets: [] },
    { option_id: "B", text: "表尾删除", assets: [] },
  ],
  tags: ["线性表"],
  assets: [],
  content_format: "plain_text",
  source: {
    provider: "csgraduates.com",
    dataset_id: "408_json_data",
    source_url: "https://www.csgraduates.com/study_methods/408quiz/2026/#1",
    license_status: "unverified",
    usage_scope: "local_demo_only",
  },
};

const learningMetadata: QuestionLearningMetadata = {
  source_type: "past_exam",
  allowed_modes: ["targeted", "past_exam", "mock_exam"],
  paper_year: 2026,
  protect_full_paper: false,
  importance: "core",
  content_review_status: "pending_teacher_review",
};

const evaluationBundle: QuestionEvaluationBundle = {
  attempt: {
    attempt_id: "attempt_001",
    user_id: "user_student_001",
    course_id: "course_408_001",
    question_id: "2026-01",
    answer_type: "choice",
    selected_option_ids: ["A"],
    response_text: null,
    status: "evaluated",
    submitted_at: "2026-07-27T00:00:00.000Z",
  },
  evaluation: {
    evaluation_id: "evaluation_001",
    submission_id: "attempt_001",
    question_id: "2026-01",
    grading_mode: "deterministic_choice",
    status: "correct",
    is_correct: true,
    score: 100,
    correct_option_ids: ["A"],
    explanation: "表头插入会移动已有元素。",
    reference_solution: null,
    answer_assets: [],
    review_required: false,
    created_at: "2026-07-27T00:00:00.000Z",
    source: question.source,
  },
  evidence: {
    evidence_id: "evidence_001",
    evaluation_id: "evaluation_001",
    submission_id: "attempt_001",
    question_id: "2026-01",
    subject: "数据结构",
    year: 2026,
    question_type: "choice",
    outcome: "correct",
    grading_mode: "deterministic_choice",
    selected_option_ids: ["A"],
    response_present: false,
    tags: ["线性表"],
    review_required: false,
    eligible_for_learning_state_update: true,
    persistence_status: "persisted",
    created_at: "2026-07-27T00:00:00.000Z",
    source: question.source,
  },
};

const mockExamSession: MockExamSession = {
  session_id: "exam_session_001",
  year: 2023,
  status: "active",
  duration_minutes: 180,
  server_now: "2026-08-24T06:00:00.000Z",
  started_at: "2026-08-24T06:00:00.000Z",
  expires_at: "2026-08-24T09:00:00.000Z",
  submitted_at: null,
  resumed: false,
  questions: [{ question, learning_metadata: learningMetadata, ranking: null }],
};

const mockExamSubmission: MockExamSubmissionResult = {
  session_id: "exam_session_001",
  year: 2023,
  status: "submitted",
  submitted_at: "2026-08-24T07:00:00.000Z",
  question_count: 1,
  answered_count: 1,
  unanswered_count: 0,
  objective: {
    question_count: 1,
    answered_count: 1,
    correct_count: 1,
    score: 2,
    max_score: 2,
  },
  subjective: {
    question_count: 0,
    submitted_count: 0,
    pending_review_count: 0,
  },
  score_status: "partial_pending_subjective_review",
  evaluations: [evaluationBundle.evaluation],
};

describe("question-bank routes", () => {
  let app: FastifyInstance;
  let receivedSelectionUserId: string | undefined;
  let receivedSelection: PracticeSelection | undefined;
  let receivedSubmission:
    | { userId: string; submission: AnswerSubmission }
    | undefined;
  let receivedIdempotencyKey: string | undefined;
  let evaluationError: Error | null;
  let evaluationReplayed: boolean;
  let receivedMockStart: { userId: string; request: MockExamStartRequest } | undefined;
  let receivedMockSubmit: {
    userId: string;
    sessionId: string;
    request: MockExamSubmitRequest;
    idempotencyKey: string;
  } | undefined;
  let mockExamError: Error | null;
  let mockExamReplayed: boolean;
  let actorExists: boolean;
  let actorRoles: PlatformRole[];
  let courseAssigned: boolean;
  let subcourseAssigned: boolean;
  let requestedMembershipRole: "student" | "teacher" | undefined;
  let receivedCatalogUserId: string | undefined;
  let receivedAssetRequest: {
    userId: string;
    questionId: string;
    assetId: string;
    attemptId?: string;
  } | undefined;
  let assetAvailable: boolean;

  beforeEach(() => {
    receivedSelection = undefined;
    receivedSelectionUserId = undefined;
    receivedSubmission = undefined;
    receivedIdempotencyKey = undefined;
    evaluationError = null;
    evaluationReplayed = false;
    receivedMockStart = undefined;
    receivedMockSubmit = undefined;
    mockExamError = null;
    mockExamReplayed = false;
    actorExists = true;
    actorRoles = ["student"];
    courseAssigned = true;
    subcourseAssigned = false;
    requestedMembershipRole = undefined;
    receivedCatalogUserId = undefined;
    receivedAssetRequest = undefined;
    assetAvailable = true;
    const service: QuestionBankService = {
      courseId: "course_408_001",
      async select(userId, selection) {
        receivedSelectionUserId = userId;
        receivedSelection = selection;
        return {
          items: [{ question, learning_metadata: learningMetadata, ranking: null }],
          total: 1,
          limit: selection.limit,
          offset: selection.offset,
        };
      },
      async get(questionId) {
        return questionId === question.id ? question : null;
      },
      async evaluate(userId, submission, idempotencyKey?: string) {
        receivedSubmission = { userId, submission };
        receivedIdempotencyKey = idempotencyKey;
        if (evaluationError) throw evaluationError;
        return evaluationReplayed
          ? ({ ...evaluationBundle, idempotency_replayed: true } as QuestionEvaluationBundle)
          : evaluationBundle;
      },
      async listPastExamPapers(userId) {
        receivedCatalogUserId = userId;
        return {
          items: [{
            year: 2026,
            question_count: 47,
            choice_count: 40,
            subjective_count: 7,
            subjects: [
              { subject: "数据结构", question_count: 11 },
              { subject: "组成原理", question_count: 12 },
              { subject: "操作系统", question_count: 12 },
              { subject: "计算机网络", question_count: 12 },
            ],
            attempted_count: 9,
            next_question_number: 10,
            is_complete: true,
          }],
        };
      },
      async openAsset(userId, questionId, assetId, attemptId) {
        receivedAssetRequest = {
          userId,
          questionId,
          assetId,
          ...(attemptId ? { attemptId } : {}),
        };
        return assetAvailable
          ? {
              role: attemptId ? "explanation" : "question",
              mimeType: "image/png",
              byteLength: 4,
              content: Buffer.from([137, 80, 78, 71]),
            }
          : null;
      },
    };
    const access: PlatformAccessService = {
      async getActor(userId) {
        if (!actorExists) return null;
        return {
          user: {
            user_id: userId,
            display_name: "本地联调学生",
            account_status: "active",
            auth_source: "local_development",
            created_at: "2026-07-27T00:00:00.000Z",
            updated_at: "2026-07-27T00:00:00.000Z",
          },
          roles: actorRoles,
        };
      },
      async isCourseAssigned(_userId, courseId, membershipRole) {
        requestedMembershipRole = membershipRole;
        return courseId === "course_408_001" ? courseAssigned : subcourseAssigned;
      },
    };
    const mockExam: MockExamService = {
      courseId: "course_408_001",
      async start(userId, request) {
        receivedMockStart = { userId, request };
        if (mockExamError) throw mockExamError;
        return mockExamSession;
      },
      async submit(userId, sessionId, request, idempotencyKey) {
        receivedMockSubmit = { userId, sessionId, request, idempotencyKey };
        if (mockExamError) throw mockExamError;
        return mockExamReplayed
          ? { ...mockExamSubmission, idempotency_replayed: true }
          : mockExamSubmission;
      },
    };
    app = buildApp({
      answerModel: null,
      questionBank: service,
      mockExam,
      platformAccess: access,
      allowLocalDevAuth: true,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns filtered public questions without answer-bearing fields", async () => {
    const response = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions?subject=数据结构&concept_id=ds_c02_02&year=2026&type=choice&tags=线性表&limit=10&offset=0",
    });

    expect(response.statusCode).toBe(200);
    expect(receivedSelection).toEqual({
      mode: "targeted",
      subject: "数据结构",
      concept_id: "ds_c02_02",
      year: 2026,
      type: "choice",
      tags: ["线性表"],
      tag_match: "all",
      limit: 10,
      offset: 0,
    });
    expect(receivedSelectionUserId).toBe("user_student_001");
    expect(response.json().data.items[0]).not.toHaveProperty("answer");
    expect(response.json().data.items[0]).not.toHaveProperty("explanation");
  });

  it("returns the current student's past-paper catalog without answer material", async () => {
    const response = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/past-exams",
    });

    expect(response.statusCode).toBe(200);
    expect(receivedCatalogUserId).toBe("user_student_001");
    expect(response.json().data.items[0]).toMatchObject({
      year: 2026,
      question_count: 47,
      attempted_count: 9,
    });
    expect(response.body).not.toMatch(/answer|solution|explanation|correct_option/iu);
  });

  it("never stores answer-bearing images in a shared browser cache", async () => {
    const response = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions/2026-01/assets/asset_001?attempt_id=attempt_001",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^image\/png/iu);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(receivedAssetRequest).toEqual({
      userId: "user_student_001",
      questionId: "2026-01",
      assetId: "asset_001",
      attemptId: "attempt_001",
    });
  });

  it("allows private caching for question images that contain no answer material", async () => {
    const response = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions/2026-01/assets/asset_001",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, max-age=3600");
    expect(receivedAssetRequest).toEqual({
      userId: "user_student_001",
      questionId: "2026-01",
      assetId: "asset_001",
    });
  });

  it("does not reveal whether a denied or mismatched asset exists", async () => {
    assetAvailable = false;
    const response = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions/2026-01/assets/asset_hidden",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("QUESTION_ASSET_NOT_FOUND");
  });

  it("allows the question-bank container when the student is assigned to a 408 subcourse", async () => {
    courseAssigned = false;
    subcourseAssigned = true;

    const questions = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions?subject=数据结构&limit=1",
    });
    expect(questions.statusCode).toBe(200);

    const evaluation = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/evaluations",
      headers: { "x-dev-user-id": "user_student_001", "idempotency-key": "subcourse-submit-001" },
      payload: {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
    });
    expect(evaluation.statusCode).toBe(201);
  });

  it("passes an exact question ID through the public selection contract", async () => {
    const response = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions?subject=数据结构&type=choice&question_id=2026-01&limit=1",
    });

    expect(response.statusCode).toBe(200);
    expect(receivedSelection).toMatchObject({
      subject: "数据结构",
      type: "choice",
      question_id: "2026-01",
      limit: 1,
    });
  });

  it("returns one public question without releasing its answer", async () => {
    const response = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions/2026-01",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: "2026-01", content_format: "plain_text" });
    expect(response.body).not.toContain("correct_option_ids");
  });

  it("requires the explicit local-development actor before accepting an answer", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/evaluations",
      payload: {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("returns answer and evidence only after a validated submission", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/evaluations",
      headers: { "x-dev-user-id": "user_student_001", "idempotency-key": "choice-submit-001" },
      payload: {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(receivedSubmission).toEqual({
      userId: "user_student_001",
      submission: {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
    });
    expect(requestedMembershipRole).toBe("student");
    expect(receivedIdempotencyKey).toBe("choice-submit-001");
    expect(response.json().data).toMatchObject({
      evaluation: { correct_option_ids: ["A"], status: "correct" },
      evidence: { persistence_status: "persisted" },
    });
  });

  it("requires an idempotency key before evaluating a choice answer", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/evaluations",
      headers: { "x-dev-user-id": "user_student_001" },
      payload: {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(receivedSubmission).toBeUndefined();
  });

  it("reports a conflict when a request key is reused with different answer data", async () => {
    evaluationError = new QuestionSubmissionError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "同一个提交键不能用于不同作答。",
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/evaluations",
      headers: { "x-dev-user-id": "user_student_001", "idempotency-key": "choice-conflict-001" },
      payload: {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["B"],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("returns the original evaluation as an idempotent replay without exposing replay state in data", async () => {
    evaluationReplayed = true;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/evaluations",
      headers: { "x-dev-user-id": "user_student_001", "idempotency-key": "choice-replay-001" },
      payload: {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["idempotency-replayed"]).toBe("true");
    expect(response.json().data).not.toHaveProperty("idempotency_replayed");
    expect(response.json().data.evaluation.status).toBe("correct");
  });

  it("refuses unknown, non-student, or unassigned local actors before evaluation", async () => {
    const request = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/question-bank/evaluations",
        headers: { "x-dev-user-id": "user_student_001", "idempotency-key": "choice-submit-access" },
        payload: {
          question_id: "2026-01",
          answer_type: "choice",
          selected_option_ids: ["A"],
        },
      });

    actorExists = false;
    const missing = await request();
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("ACTOR_NOT_FOUND");

    actorExists = true;
    actorRoles = ["teacher"];
    const teacher = await request();
    expect(teacher.statusCode).toBe(403);
    expect(teacher.json().error.code).toBe("COURSE_ACCESS_DENIED");

    actorRoles = ["student"];
    courseAssigned = false;
    const unassigned = await request();
    expect(unassigned.statusCode).toBe(403);
    expect(receivedSubmission).toBeUndefined();
  });

  it("rejects malformed filters and submissions as contract errors", async () => {
    const badFilter = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions?limit=500",
    });
    expect(badFilter.statusCode).toBe(400);
    expect(badFilter.json().error.code).toBe("QUESTION_BANK_FILTER_INVALID");

    const badMode = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions?mode=adaptive_ai",
    });
    expect(badMode.statusCode).toBe(400);
    expect(badMode.json().error.code).toBe("QUESTION_BANK_FILTER_INVALID");

    const badSubmission = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/evaluations",
      headers: { "x-dev-user-id": "user_student_001", "idempotency-key": "choice-submit-invalid" },
      payload: {
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: [],
      },
    });
    expect(badSubmission.statusCode).toBe(400);
    expect(badSubmission.json().error.code).toBe("ANSWER_SUBMISSION_INVALID");
  });

  it("denies public question reads for teachers and unassigned students", async () => {
    actorRoles = ["teacher"];
    const teacher = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions?limit=1",
    });
    expect(teacher.statusCode).toBe(403);
    expect(teacher.json().error.code).toBe("COURSE_ACCESS_DENIED");

    actorRoles = ["student"];
    courseAssigned = false;
    const unassigned = await app.inject({
      method: "GET",
      headers: { "x-dev-user-id": "user_student_001" },
      url: "/api/v1/question-bank/questions/2026-01",
    });
    expect(unassigned.statusCode).toBe(403);
    expect(unassigned.json().error.code).toBe("COURSE_ACCESS_DENIED");
  });

  it("starts a server-owned full-paper session for the current student", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/mock-exams",
      headers: { "x-dev-user-id": "user_student_001" },
      payload: { year: 2023 },
    });

    expect(response.statusCode).toBe(201);
    expect(receivedMockStart).toEqual({
      userId: "user_student_001",
      request: { year: 2023 },
    });
    expect(response.json().data).toMatchObject({
      session_id: "exam_session_001",
      duration_minutes: 180,
      server_now: "2026-08-24T06:00:00.000Z",
      resumed: false,
    });
    expect(response.body).not.toMatch(/answer_key|correct_option_ids|reference_solution/u);
  });

  it("validates and submits a full paper once with an explicit idempotency key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/mock-exams/exam_session_001/submit",
      headers: {
        "x-dev-user-id": "user_student_001",
        "idempotency-key": "mock-submit-001",
      },
      payload: {
        answers: [{
          question_id: "2026-01",
          answer_type: "choice",
          selected_option_ids: ["A"],
        }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(receivedMockSubmit).toMatchObject({
      userId: "user_student_001",
      sessionId: "exam_session_001",
      idempotencyKey: "mock-submit-001",
    });
    expect(response.json().data).toMatchObject({
      status: "submitted",
      objective: { score: 2, max_score: 2 },
      score_status: "partial_pending_subjective_review",
    });
    expect(response.json().data).not.toHaveProperty("idempotency_replayed");
  });

  it("rejects duplicate mock answers before the service and maps bounded domain failures", async () => {
    const answer = {
      question_id: "2026-01",
      answer_type: "choice",
      selected_option_ids: ["A"],
    };
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/mock-exams/exam_session_001/submit",
      headers: {
        "x-dev-user-id": "user_student_001",
        "idempotency-key": "mock-submit-duplicate",
      },
      payload: { answers: [answer, answer] },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe("MOCK_EXAM_SUBMISSION_INVALID");
    expect(receivedMockSubmit).toBeUndefined();

    mockExamError = new MockExamError("MOCK_EXAM_EXPIRED", "该模考会话已超过 180 分钟。", 410);
    const expired = await app.inject({
      method: "POST",
      url: "/api/v1/question-bank/mock-exams/exam_session_001/submit",
      headers: {
        "x-dev-user-id": "user_student_001",
        "idempotency-key": "mock-submit-expired",
      },
      payload: { answers: [] },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe("MOCK_EXAM_EXPIRED");
  });
});
