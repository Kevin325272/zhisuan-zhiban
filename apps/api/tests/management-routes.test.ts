import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import type {
  CourseLearningSummary,
  ManagedQuestionSummary,
  MaterialCreateRequest,
  MaterialRecord,
  PlatformRole,
  PlatformUser,
  QuestionReviewUpdate,
  ManagedCourseEvidence,
  ManagedCourseEvidenceQuery,
  TeacherIntervention,
  TeacherInterventionCreateRequest,
  TeacherInterventionStatusUpdateRequest,
} from "@xuetu/contracts";

import { buildApp } from "../src/app.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";
import {
  ManagementAccessDeniedError,
  ManagementInterventionTargetNotFoundError,
  type ManagementService,
} from "../src/services/platform-management.js";

const teacher: PlatformUser = {
  user_id: "user_teacher_001",
  display_name: "演示教师",
  account_status: "active",
  auth_source: "local_development",
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T00:00:00.000Z",
};

const managedQuestion: ManagedQuestionSummary = {
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
};

const material: MaterialRecord = {
  material_id: "material_001",
  course_id: "course_408_001",
  title: "数据结构实验指导",
  material_type: "course_handout",
  source_url: null,
  storage_ref: "local://materials/lab-guide.pdf",
  review_status: "pending_review",
  license_status: "unverified",
  created_by: "user_teacher_001",
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T00:00:00.000Z",
};

const summary: CourseLearningSummary = {
  course_id: "course_408_001",
  active_students: 1,
  attempt_count: 2,
  deterministic_correct_count: 1,
  deterministic_incorrect_count: 0,
  pending_review_count: 1,
  evidence_count: 2,
  generated_at: "2026-07-27T00:00:00.000Z",
  data_scope: "stored_records_only",
};

const evidence: ManagedCourseEvidence = {
  course_id: "course_408_001",
  generated_at: "2026-07-27T00:00:00.000Z",
  data_scope: "stored_records_only",
  active_student_count: 1,
  top_weak_concepts: [
    {
      concept_id: "co_c01_01",
      concept_title: "指令执行流程",
      attempt_count: 3,
      incorrect_count: 2,
      pending_review_count: 1,
      student_count: 1,
      last_activity_at: "2026-07-27T00:00:00.000Z",
    },
  ],
  recent_interventions: [],
};

const intervention: TeacherIntervention = {
  intervention_id: "intervention_001",
  course_id: "course_408_001",
  concept_id: "co_c01_01",
  concept_title: "指令执行流程",
  action: "assign_review",
  note: "下次课先补充指令执行流程。",
  created_at: "2026-07-27T00:00:00.000Z",
};

describe("teacher/admin management routes", () => {
  let app: FastifyInstance;
  let roles: PlatformRole[];
  let assigned: boolean;
  let requestedMembershipRole: "student" | "teacher" | undefined;
  let receivedMaterial: MaterialCreateRequest | undefined;
  let receivedReview: QuestionReviewUpdate | undefined;
  let receivedEvidenceCourseId: string | undefined;
  let receivedSummaryViewer: { viewerUserId: string; viewerRole: "teacher" | "admin" } | undefined;
  let receivedEvidenceViewer: { viewerUserId: string; viewerRole: "teacher" | "admin" } | undefined;
  let receivedEvidenceQuery: ManagedCourseEvidenceQuery | undefined;
  let receivedIntervention: {
    courseId: string;
    viewer: { viewerUserId: string; viewerRole: "teacher" | "admin" };
    input: TeacherInterventionCreateRequest;
  } | undefined;
  let evidenceCalls = 0;
  let interventionCalls = 0;
  let rejectInterventionForMissingClass = false;
  let rejectInterventionForMissingTarget = false;
  let receivedInterventionStatus: {
    interventionId: string;
    courseId: string;
    viewer: { viewerUserId: string; viewerRole: "teacher" | "admin" };
    input: TeacherInterventionStatusUpdateRequest;
  } | undefined;

  beforeEach(() => {
    roles = ["teacher"];
    assigned = true;
    requestedMembershipRole = undefined;
    receivedMaterial = undefined;
    receivedReview = undefined;
    receivedEvidenceCourseId = undefined;
    receivedSummaryViewer = undefined;
    receivedEvidenceViewer = undefined;
    receivedEvidenceQuery = undefined;
    receivedIntervention = undefined;
    receivedInterventionStatus = undefined;
    evidenceCalls = 0;
    interventionCalls = 0;
    rejectInterventionForMissingClass = false;
    rejectInterventionForMissingTarget = false;
    const access: PlatformAccessService = {
      async getActor(userId) {
        return userId === teacher.user_id ? { user: teacher, roles } : null;
      },
      async isCourseAssigned(_userId, _courseId, membershipRole) {
        requestedMembershipRole = membershipRole;
        return assigned;
      },
    };
    const management: ManagementService = {
      async listQuestions() {
        return [managedQuestion];
      },
      async getQuestionCourseId(questionId) {
        return questionId === managedQuestion.question_id ? managedQuestion.course_id : null;
      },
      async reviewQuestion(_questionId, _actorId, update) {
        receivedReview = update;
        return { ...managedQuestion, review_status: update.review_status };
      },
      async listMaterials() {
        return [material];
      },
      async createMaterial(_courseId, _actorId, input) {
        receivedMaterial = input;
        return material;
      },
      async listCourseStudents() {
        return {
          items: [],
          totalItems: 0,
          availableClasses: [],
          summary: {
            student_count: 0,
            attention_count: 0,
            average_progress_percent: 0,
            average_accuracy_percent: 0,
            weekly_study_minutes: 0,
            evidence_count: 0,
          },
          includesSyntheticDemo: false,
        };
      },
      async getLearningSummary(_courseId, viewer) {
        receivedSummaryViewer = viewer;
        return summary;
      },
      async getCourseEvidence(courseId, viewer, query) {
        evidenceCalls += 1;
        receivedEvidenceCourseId = courseId;
        receivedEvidenceViewer = viewer;
        receivedEvidenceQuery = query;
        return evidence;
      },
      async recordTeacherIntervention(courseId, viewer, input) {
        interventionCalls += 1;
        if (rejectInterventionForMissingClass) {
          throw new ManagementAccessDeniedError("Teacher has no assigned class for this course.");
        }
        if (rejectInterventionForMissingTarget) {
          throw new ManagementInterventionTargetNotFoundError();
        }
        receivedIntervention = { courseId, viewer, input };
        return intervention;
      },
      async updateTeacherInterventionStatus(courseId, interventionId, viewer, input) {
        receivedInterventionStatus = { interventionId, courseId, viewer, input };
        return { ...intervention, status: input.status };
      },
    };
    app = buildApp({
      answerModel: null,
      platformAccess: access,
      management,
      allowLocalDevAuth: true,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const actorHeaders = { "x-dev-user-id": "user_teacher_001" };

  it("allows an assigned teacher to view source and review status, but not answers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_001/questions?review_status=pending_review",
      headers: actorHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(requestedMembershipRole).toBe("teacher");
    expect(response.json().data.items[0]).toMatchObject({
      source_url: managedQuestion.source_url,
      license_status: "unverified",
      usage_scope: "local_demo_only",
      review_status: "pending_review",
    });
    expect(response.body).not.toContain("answer_key");
  });

  it("forbids a teacher from managing a course they are not assigned", async () => {
    assigned = false;
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_other/questions",
      headers: actorHeaders,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("COURSE_ACCESS_DENIED");
  });

  it("does not disclose whether a review target exists outside the teacher's course assignment", async () => {
    assigned = false;
    const payload = { review_status: "approved", review_note: "已核对原题与答案。" };

    const inaccessible = await app.inject({
      method: "PATCH",
      url: "/api/v1/manage/questions/2026-01/review",
      headers: actorHeaders,
      payload,
    });
    const missing = await app.inject({
      method: "PATCH",
      url: "/api/v1/manage/questions/question_missing/review",
      headers: actorHeaders,
      payload,
    });

    expect(inaccessible.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(inaccessible.json().error).toMatchObject({
      code: "QUESTION_NOT_FOUND",
      message: "题目不存在。",
    });
    expect(missing.json().error).toMatchObject({
      code: "QUESTION_NOT_FOUND",
      message: "题目不存在。",
    });
    expect(receivedReview).toBeUndefined();
  });

  it("allows an administrator to manage a course without membership", async () => {
    roles = ["admin"];
    assigned = false;
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_other/questions",
      headers: actorHeaders,
    });
    expect(response.statusCode).toBe(200);
  });

  it("supports material creation and question review with validated contracts", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/manage/courses/course_408_001/materials",
      headers: actorHeaders,
      payload: {
        title: "数据结构实验指导",
        material_type: "course_handout",
        source_url: null,
        storage_ref: "local://materials/lab-guide.pdf",
        license_status: "unverified",
      },
    });
    expect(create.statusCode).toBe(201);
    expect(receivedMaterial?.title).toBe("数据结构实验指导");

    const review = await app.inject({
      method: "PATCH",
      url: "/api/v1/manage/questions/2026-01/review",
      headers: actorHeaders,
      payload: { review_status: "approved", review_note: "已核对原题与答案。" },
    });
    expect(review.statusCode).toBe(200);
    expect(receivedReview?.review_status).toBe("approved");
  });

  it("exposes only stored-record learning aggregates", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_001/learning-summary",
      headers: actorHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(summary);
    expect(response.json().data.data_scope).toBe("stored_records_only");
    expect(receivedSummaryViewer).toEqual({
      viewerUserId: teacher.user_id,
      viewerRole: "teacher",
    });
  });

  it("allows an assigned teacher to read weak-concept evidence", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_001/evidence",
      headers: actorHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(receivedEvidenceCourseId).toBe("course_408_001");
    expect(receivedEvidenceViewer).toEqual({
      viewerUserId: teacher.user_id,
      viewerRole: "teacher",
    });
    expect(response.json().data).toEqual(evidence);
    expect(response.body).not.toContain("answer_key");
    expect(response.body).not.toContain("actor_user_id");
  });

  it("passes the evidence window query through the authorized route", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_001/evidence?days=7&start_at=2026-08-18T00:00:00.000Z&end_at=2026-08-25T00:00:00.000Z",
      headers: actorHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(receivedEvidenceQuery).toMatchObject({
      days: 7,
      start_at: "2026-08-18T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
    });
  });

  it("records a bounded teacher intervention with the authorized actor", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manage/courses/course_408_001/interventions",
      headers: actorHeaders,
      payload: {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "下次课先补充指令执行流程。",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(receivedIntervention).toEqual({
      courseId: "course_408_001",
      viewer: {
        viewerUserId: teacher.user_id,
        viewerRole: "teacher",
      },
      input: {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "下次课先补充指令执行流程。",
      },
    });
    expect(response.json().data).toEqual(intervention);
  });

  it("accepts a public student code without allowing an internal user id", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manage/courses/course_408_001/interventions",
      headers: actorHeaders,
      payload: {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "给这名同学安排一次复测。",
        target_type: "student",
        target_student_code: "P7F3A1C20",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(receivedIntervention?.input).toEqual({
      concept_id: "co_c01_01",
      action: "assign_review",
      note: "给这名同学安排一次复测。",
      target_type: "student",
      target_student_code: "P7F3A1C20",
    });
    expect(receivedIntervention?.input).not.toHaveProperty("target_user_id");
  });

  it("rejects invalid intervention input before calling the service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manage/courses/course_408_001/interventions",
      headers: actorHeaders,
      payload: {
        concept_id: "co_c01_01",
        action: "invented_action",
        note: "",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("TEACHER_INTERVENTION_INVALID");
    expect(interventionCalls).toBe(0);
  });

  it("rejects contradictory intervention targets before they reach PostgreSQL", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manage/courses/course_408_001/interventions",
      headers: actorHeaders,
      payload: {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "安排班级复习。",
        target_type: "class",
        target_class_id: "class_001",
        target_user_id: "student_001",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("TEACHER_INTERVENTION_INVALID");
    expect(interventionCalls).toBe(0);
  });

  it("returns 403 when a course teacher has no assigned class", async () => {
    rejectInterventionForMissingClass = true;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manage/courses/course_408_001/interventions",
      headers: actorHeaders,
      payload: {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "补充复习。",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TEACHER_CLASS_ASSIGNMENT_REQUIRED");
  });

  it("returns a bounded 404 when the public student code is outside the teacher scope", async () => {
    rejectInterventionForMissingTarget = true;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/manage/courses/course_408_001/interventions",
      headers: actorHeaders,
      payload: {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "给这名同学安排一次复测。",
        target_type: "student",
        target_student_code: "P00000000",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({
      code: "TEACHER_INTERVENTION_TARGET_NOT_FOUND",
      message: "目标学生不在当前教师可管理的课程范围内。",
    });
  });

  it("authorizes a forward intervention status update", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/manage/courses/course_408_001/interventions/intervention_001/status",
      headers: actorHeaders,
      payload: { status: "sent" },
    });

    expect(response.statusCode).toBe(200);
    expect(receivedInterventionStatus).toEqual({
      interventionId: "intervention_001",
      courseId: "course_408_001",
      viewer: { viewerUserId: teacher.user_id, viewerRole: "teacher" },
      input: { status: "sent" },
    });
    expect(response.json().data.status).toBe("sent");
  });

  it("forbids an unassigned teacher from reading or writing evidence", async () => {
    assigned = false;

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_001/evidence",
      headers: actorHeaders,
    });
    const write = await app.inject({
      method: "POST",
      url: "/api/v1/manage/courses/course_408_001/interventions",
      headers: actorHeaders,
      payload: {
        concept_id: "co_c01_01",
        action: "assign_review",
        note: "不应写入。",
      },
    });

    expect(read.statusCode).toBe(403);
    expect(write.statusCode).toBe(403);
    expect(evidenceCalls).toBe(0);
    expect(interventionCalls).toBe(0);
  });

  it("passes an administrator viewer to course evidence without teacher scoping", async () => {
    roles = ["admin"];
    assigned = false;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/manage/courses/course_408_001/evidence",
      headers: actorHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(receivedEvidenceViewer).toEqual({
      viewerUserId: teacher.user_id,
      viewerRole: "admin",
    });
  });
});
