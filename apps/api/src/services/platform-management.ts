import { createHash, randomUUID } from "node:crypto";

import {
  courseLearningSummarySchema,
  managedCourseEvidenceSchema,
  managedCourseEvidenceQuerySchema,
  managedCourseStudentSchema,
  managedCourseStudentSummarySchema,
  managedCourseTeacherSchema,
  managedQuestionSummarySchema,
  materialRecordSchema,
  teacherInterventionSchema,
  teacherInterventionCreateRequestSchema,
  teacherInterventionStatusUpdateRequestSchema,
  type CourseLearningSummary,
  type ManagedCourseEvidence,
  type ManagedCourseEvidenceQuery,
  type ManagedCourseStudent,
  type ManagedCourseStudentListQuery,
  type ManagedCourseStudentSummary,
  type ManagedCourseTeacher,
  type ManagedCourseWeakConcept,
  type ManagedQuestionSummary,
  type MaterialCreateRequest,
  type MaterialRecord,
  type QuestionReviewUpdate,
  type ReviewStatus,
  type TeacherIntervention,
  type TeacherInterventionCreateRequest,
  type TeacherInterventionStatus,
  type TeacherInterventionStatusUpdateRequest,
} from "@xuetu/contracts";

import { withTransaction, type SqlQueryablePool } from "../database/client.js";

const SHARED_408_QUESTION_BANK_ID = "course_408_001";
const MINIMUM_EVIDENCE_SAMPLE = 5;
const DEFAULT_EVIDENCE_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ManagementViewer {
  viewerUserId: string;
  viewerRole: "teacher" | "admin";
}

export interface ManagementService {
  listQuestions(courseId: string, reviewStatus?: ReviewStatus): Promise<ManagedQuestionSummary[]>;
  getQuestionCourseId(questionId: string): Promise<string | null>;
  reviewQuestion(
    questionId: string,
    actorId: string,
    update: QuestionReviewUpdate,
  ): Promise<ManagedQuestionSummary | null>;
  listMaterials(courseId: string): Promise<MaterialRecord[]>;
  createMaterial(
    courseId: string,
    actorId: string,
    input: MaterialCreateRequest,
  ): Promise<MaterialRecord>;
  listCourseStudents(
    courseId: string,
    viewer: ManagementViewer,
    query: ManagedCourseStudentListQuery,
  ): Promise<ManagedCourseStudentPage>;
  listCourseTeachers?(
    courseId: string,
    viewer: ManagementViewer,
  ): Promise<ManagedCourseTeacher[]>;
  getLearningSummary(
    courseId: string,
    viewer: ManagementViewer,
  ): Promise<CourseLearningSummary>;
  getCourseEvidence(
    courseId: string,
    viewer: ManagementViewer,
    query?: ManagedCourseEvidenceQuery,
  ): Promise<ManagedCourseEvidence>;
  recordTeacherIntervention(
    courseId: string,
    viewer: ManagementViewer,
    input: TeacherInterventionCreateRequest,
  ): Promise<TeacherIntervention>;
  updateTeacherInterventionStatus(
    courseId: string,
    interventionId: string,
    viewer: ManagementViewer,
    input: TeacherInterventionStatusUpdateRequest,
  ): Promise<TeacherIntervention>;
}

export class ManagementResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagementResourceNotFoundError";
  }
}

export class ManagementInterventionTargetNotFoundError extends ManagementResourceNotFoundError {
  constructor(message = "目标学生不在当前教师可管理的课程范围内。") {
    super(message);
    this.name = "ManagementInterventionTargetNotFoundError";
  }
}

export class ManagementAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagementAccessDeniedError";
  }
}

export class ManagementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagementConflictError";
  }
}

export class ManagementInterventionEvidenceRequiredError extends ManagementConflictError {
  constructor(message = "学生尚未产生可核验的复测证据。") {
    super(message);
    this.name = "ManagementInterventionEvidenceRequiredError";
  }
}

interface EvidenceWindow {
  startAt: string;
  endAt: string;
  days: number;
}

function resolveEvidenceWindow(
  input: ManagedCourseEvidenceQuery | undefined,
  now: Date,
): EvidenceWindow {
  const parsed = input === undefined ? undefined : managedCourseEvidenceQuerySchema.parse(input);
  const end = parsed?.end_at ? new Date(parsed.end_at) : now;
  const requestedDays = parsed?.days ?? DEFAULT_EVIDENCE_WINDOW_DAYS;
  const start = parsed?.start_at
    ? new Date(parsed.start_at)
    : new Date(end.getTime() - requestedDays * DAY_MS);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new ManagementConflictError("学情统计时间范围无效。结束时间必须晚于开始时间。");
  }
  const derivedDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
  if (derivedDays > 90) {
    throw new ManagementConflictError("学情统计时间范围不能超过 90 天。");
  }
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    days: derivedDays,
  };
}

interface ManagedQuestionRow {
  question_id: string;
  course_id: string;
  year: number | null;
  number: number;
  subject: string;
  question_type: "choice" | "subjective";
  tags: string[];
  source_url: string;
  license_status: "unverified" | "verified" | "restricted";
  usage_scope: "local_demo_only" | "authorized_product_use";
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  updated_at: Date | string;
}

interface MaterialRow {
  material_id: string;
  course_id: string;
  title: string;
  material_type: MaterialRecord["material_type"];
  source_url: string | null;
  storage_ref: string | null;
  review_status: ReviewStatus;
  license_status: MaterialRecord["license_status"];
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ManagedCourseStudentRow {
  student_code: string;
  display_name: string;
  student_number: string;
  cohort_year: number | string | null;
  major: string | null;
  class_name: string | null;
  onboarding_status: string;
  last_active_at: Date | string | null;
  plan_completion_percent: number | string;
  accuracy_percent: number | string;
  correct_count: number | string;
  incorrect_count: number | string;
  evidence_count: number | string;
  pending_review_mistake_count: number | string;
  weekly_study_minutes: number | string;
  current_focus: string | null;
  focus_source?: ManagedCourseStudent["focus_source"];
  recent_attempt_count?: number | string;
  learning_status: ManagedCourseStudent["learning_status"];
  data_provenance: ManagedCourseStudent["data_provenance"];
}

interface ManagedCourseStudentPageRow {
  items: ManagedCourseStudentRow[];
  total_items: number | string;
  available_classes: unknown;
  summary_student_count: number | string;
  summary_attention_count: number | string;
  summary_average_progress_percent: number | string;
  summary_average_accuracy_percent: number | string;
  summary_weekly_study_minutes: number | string;
  summary_evidence_count: number | string;
  includes_synthetic_demo: boolean;
}

export interface ManagedCourseStudentPage {
  items: ManagedCourseStudent[];
  totalItems: number;
  availableClasses: string[];
  summary: ManagedCourseStudentSummary;
  includesSyntheticDemo: boolean;
}

interface ManagedCourseTeacherRow {
  display_name: string;
  teacher_number: string;
  department: string;
  professional_title: string;
  assigned_classes: unknown;
  data_provenance: ManagedCourseTeacher["data_provenance"];
}

interface ManagedCourseWeakConceptRow {
  concept_id: string;
  concept_title: string;
  attempt_count: number | string;
  valid_attempt_count?: number | string | null;
  incorrect_count: number | string;
  incorrect_student_count?: number | string | null;
  error_rate?: number | string | null;
  pending_review_count: number | string;
  student_count: number | string;
  probe_participant_count?: number | string | null;
  probe_correct_count?: number | string | null;
  probe_incorrect_count?: number | string | null;
  last_activity_at: Date | string | null;
  source_kind?: "live" | "snapshot";
}

interface TeacherInterventionRow {
  intervention_id: string;
  course_id: string;
  concept_id: string;
  actor_user_id?: string;
  concept_title: string;
  action: TeacherIntervention["action"];
  note: string;
  target_type?: TeacherIntervention["target_type"];
  target_class_id?: string | null;
  target_class_name?: string | null;
  target_student_code?: string | null;
  target_user_id?: string | null;
  material_ref?: string | null;
  due_at?: Date | string | null;
  status?: TeacherIntervention["status"];
  delivered_at?: Date | string | null;
  completed_at?: Date | string | null;
  evidence_snapshot?: Record<string, unknown> | null;
  created_at: Date | string;
}

interface ManagedCourseEvidenceAggregateRow {
  active_student_count: number | string;
  active_window_student_count?: number | string | null;
  valid_attempt_student_count?: number | string | null;
  real_trial_valid_attempt_student_count?: number | string | null;
  includes_synthetic_demo?: boolean;
  real_trial_student_count?: number | string | null;
  real_trial_attempt_count?: number | string | null;
  real_trial_incorrect_count?: number | string | null;
  real_trial_valid_attempt_count?: number | string | null;
  synthetic_verification_student_count?: number | string | null;
  synthetic_verification_attempt_count?: number | string | null;
  synthetic_verification_incorrect_count?: number | string | null;
  synthetic_verification_valid_attempt_count?: number | string | null;
  local_demo_student_count?: number | string | null;
  local_demo_attempt_count?: number | string | null;
  local_demo_incorrect_count?: number | string | null;
  local_demo_valid_attempt_count?: number | string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoNullable(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function mapQuestion(row: ManagedQuestionRow): ManagedQuestionSummary {
  return managedQuestionSummarySchema.parse({
    question_id: row.question_id,
    course_id: row.course_id,
    year: row.year === null ? null : Number(row.year),
    number: Number(row.number),
    subject: row.subject,
    type: row.question_type,
    tags: row.tags,
    source_url: row.source_url,
    license_status: row.license_status,
    usage_scope: row.usage_scope,
    review_status: row.review_status,
    reviewed_by: row.reviewed_by,
    reviewed_at: isoNullable(row.reviewed_at),
    updated_at: iso(row.updated_at),
  });
}

function mapMaterial(row: MaterialRow): MaterialRecord {
  return materialRecordSchema.parse({
    ...row,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  });
}

function mapCourseStudent(row: ManagedCourseStudentRow): ManagedCourseStudent {
  return managedCourseStudentSchema.parse({
    student_code: row.student_code,
    display_name: row.display_name,
    student_number: row.student_number,
    cohort_year: row.cohort_year === null ? null : Number(row.cohort_year),
    major: row.major,
    class_name: row.class_name,
    onboarding_status: row.onboarding_status,
    last_active_at: isoNullable(row.last_active_at),
    plan_completion_percent: Number(row.plan_completion_percent),
    accuracy_percent: Number(row.accuracy_percent),
    correct_count: Number(row.correct_count),
    incorrect_count: Number(row.incorrect_count),
    evidence_count: Number(row.evidence_count),
    pending_review_mistake_count: Number(row.pending_review_mistake_count),
    weekly_study_minutes: Number(row.weekly_study_minutes),
    current_focus: row.current_focus,
    focus_source: row.focus_source ?? "none",
    recent_attempt_count: Number(row.recent_attempt_count ?? 0),
    learning_status: row.learning_status,
    data_provenance: row.data_provenance,
  });
}

function mapCourseTeacher(row: ManagedCourseTeacherRow): ManagedCourseTeacher {
  return managedCourseTeacherSchema.parse({
    display_name: row.display_name,
    teacher_number: row.teacher_number,
    department: row.department,
    professional_title: row.professional_title,
    assigned_classes: Array.isArray(row.assigned_classes) ? row.assigned_classes : [],
    data_provenance: row.data_provenance,
  });
}

function mapWeakConcept(row: ManagedCourseWeakConceptRow): ManagedCourseWeakConcept {
  const mapped: ManagedCourseWeakConcept = {
    concept_id: row.concept_id,
    concept_title: row.concept_title,
    attempt_count: Number(row.attempt_count),
    incorrect_count: Number(row.incorrect_count),
    pending_review_count: Number(row.pending_review_count),
    student_count: Number(row.student_count),
    last_activity_at: isoNullable(row.last_activity_at),
  };
  if (row.valid_attempt_count !== undefined && row.valid_attempt_count !== null) {
    mapped.valid_attempt_count = Number(row.valid_attempt_count);
  }
  if (row.incorrect_student_count !== undefined && row.incorrect_student_count !== null) {
    mapped.incorrect_student_count = Number(row.incorrect_student_count);
  }
  if (row.error_rate !== undefined && row.error_rate !== null) {
    mapped.error_rate = Number(row.error_rate);
  }
  if (row.probe_participant_count !== undefined && row.probe_participant_count !== null) {
    mapped.probe_participant_count = Number(row.probe_participant_count);
  }
  if (row.probe_correct_count !== undefined && row.probe_correct_count !== null) {
    mapped.probe_correct_count = Number(row.probe_correct_count);
  }
  if (row.probe_incorrect_count !== undefined && row.probe_incorrect_count !== null) {
    mapped.probe_incorrect_count = Number(row.probe_incorrect_count);
  }
  return mapped;
}

function mapTeacherIntervention(row: TeacherInterventionRow): TeacherIntervention {
  const payload: Record<string, unknown> = {
    intervention_id: row.intervention_id,
    course_id: row.course_id,
    concept_id: row.concept_id,
    concept_title: row.concept_title,
    action: row.action,
    note: row.note,
    created_at: iso(row.created_at),
  };
  if (row.target_type !== undefined) payload.target_type = row.target_type;
  if (row.target_class_id !== undefined) payload.target_class_id = row.target_class_id;
  if (row.target_class_name !== undefined) payload.target_class_name = row.target_class_name;
  if (row.target_type === "student") {
    const studentCode = row.target_student_code ?? (row.target_user_id
      ? `P${createHash("md5").update(row.target_user_id).digest("hex").slice(0, 8).toUpperCase()}`
      : null);
    if (studentCode) payload.target_student_code = studentCode;
  }
  if (row.material_ref !== undefined) payload.material_ref = row.material_ref;
  if (row.due_at !== undefined) payload.due_at = isoNullable(row.due_at);
  if (row.status !== undefined) payload.status = row.status;
  if (row.delivered_at !== undefined) payload.delivered_at = isoNullable(row.delivered_at);
  if (row.completed_at !== undefined) payload.completed_at = isoNullable(row.completed_at);
  if (row.evidence_snapshot !== undefined) payload.evidence_snapshot = row.evidence_snapshot;
  return teacherInterventionSchema.parse(payload);
}

function numeric(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentage(incorrect: number, attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((incorrect / attempts) * 10000) / 100));
}

function sourceMetric(
  row: ManagedCourseEvidenceAggregateRow,
  source: "real_trial" | "synthetic_verification" | "local_demo",
) {
  const validAttempts = numeric(row[`${source}_valid_attempt_count` as keyof ManagedCourseEvidenceAggregateRow] as number | string | null | undefined);
  const attempts = numeric(row[`${source}_attempt_count` as keyof ManagedCourseEvidenceAggregateRow] as number | string | null | undefined);
  const incorrect = numeric(row[`${source}_incorrect_count` as keyof ManagedCourseEvidenceAggregateRow] as number | string | null | undefined);
  return {
    student_count: numeric(row[`${source}_student_count` as keyof ManagedCourseEvidenceAggregateRow] as number | string | null | undefined),
    valid_attempt_count: validAttempts || attempts,
    incorrect_count: incorrect,
    error_rate: percentage(incorrect, validAttempts || attempts),
  };
}

const INTERVENTION_TRANSITIONS: Record<
  TeacherInterventionStatus,
  readonly TeacherInterventionStatus[]
> = {
  planned: ["sent", "cancelled"],
  sent: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function canTransitionIntervention(
  current: TeacherInterventionStatus,
  next: TeacherInterventionStatus,
): boolean {
  return INTERVENTION_TRANSITIONS[current].includes(next);
}

function dataOriginSql(userAlias: string): string {
  return `CASE
    WHEN EXISTS (
      SELECT 1 FROM pilot_participants participant
       WHERE participant.user_id = ${userAlias}.user_id
         AND participant.participant_kind = 'synthetic_verification'
    ) THEN 'synthetic_verification'
    WHEN EXISTS (
      SELECT 1 FROM pilot_participants participant
       WHERE participant.user_id = ${userAlias}.user_id
         AND participant.participant_kind = 'real_trial'
    ) THEN 'real_trial'
    WHEN EXISTS (
      SELECT 1 FROM users account
       WHERE account.user_id = ${userAlias}.user_id
         AND account.account_origin = 'legacy_demo'
    ) THEN 'local_demo'
    ELSE 'local_demo'
  END`;
}

function buildQuestionScopeSql(
  attemptAlias: string,
  questionAlias: string,
  courseParam: string,
  sharedBankParam: string,
): string {
  return "(" + attemptAlias + ".course_id = " + courseParam
    + " OR (" + attemptAlias + ".course_id = " + sharedBankParam
    + " AND EXISTS (SELECT 1 FROM course_catalog_entries target_catalog"
    + " WHERE target_catalog.course_id = " + courseParam
    + " AND target_catalog.question_subject = " + questionAlias + ".subject)))";
}

function buildScopedStudentsSql(
  courseParam: string,
  roleParam: string,
  viewerParam: string,
): string {
  return [
    "SELECT DISTINCT cm.user_id",
    "  FROM course_memberships cm",
    "  JOIN users u ON u.user_id = cm.user_id AND u.account_status = 'active'",
    " WHERE cm.course_id = " + courseParam,
    "   AND cm.membership_role = 'student'",
    "   AND cm.status = 'active'",
    "   AND (" + roleParam + " = 'admin' OR EXISTS (",
    "         SELECT 1",
    "           FROM student_academic_profiles viewer_profile",
    "           JOIN teacher_course_class_assignments viewer_assignment",
    "             ON viewer_assignment.class_id = viewer_profile.class_id",
    "            AND viewer_assignment.course_id = cm.course_id",
    "          WHERE viewer_profile.user_id = cm.user_id",
    "            AND viewer_assignment.teacher_user_id = " + viewerParam,
    "       ))",
  ].join("\n");
}

function buildSnapshotPolicySql(courseParam: string, sharedBankParam: string): string {
  const attemptScope = buildQuestionScopeSql("newer_attempt", "newer_question", courseParam, sharedBankParam);
  const evidenceScope = buildQuestionScopeSql("newer_evidence", "newer_question", courseParam, sharedBankParam);
  return [
    "SELECT snapshot.user_id,",
    "       NOT (",
    "         EXISTS (",
    "           SELECT 1",
    "             FROM practice_attempts newer_attempt",
    "             JOIN questions newer_question",
    "               ON newer_question.question_id = newer_attempt.question_id",
    "            WHERE newer_attempt.user_id = snapshot.user_id",
    "              AND newer_attempt.submitted_at > snapshot.generated_at",
    "              AND " + attemptScope,
    "         )",
    "         OR EXISTS (",
    "           SELECT 1",
    "             FROM learning_evidence newer_evidence",
    "             JOIN questions newer_question",
    "               ON newer_question.question_id = newer_evidence.question_id",
    "            WHERE newer_evidence.user_id = snapshot.user_id",
    "              AND newer_evidence.created_at > snapshot.generated_at",
    "              AND " + evidenceScope,
    "         )",
    "       ) AS use_snapshot,",
    "       snapshot.generated_at,",
    "       COALESCE(snapshot.last_active_at, snapshot.generated_at) AS activity_at,",
    "       snapshot.correct_count, snapshot.incorrect_count, snapshot.pending_review_count",
    "  FROM student_course_progress_snapshots snapshot",
    "  JOIN scoped_students scoped ON scoped.user_id = snapshot.user_id",
    " WHERE snapshot.course_id = " + courseParam,
    "   AND snapshot.data_provenance = 'synthetic_demo'",
  ].join("\n");
}

const managedQuestionColumns = `
  question_id, course_id, year, number, subject, question_type, tags,
  source_url, license_status, usage_scope, review_status,
  reviewed_by, reviewed_at, updated_at
`;

export class PostgresManagementService implements ManagementService {
  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: (prefix: string) => string = (prefix) =>
      `${prefix}_${randomUUID()}`,
  ) {}

  async listQuestions(
    courseId: string,
    reviewStatus?: ReviewStatus,
  ): Promise<ManagedQuestionSummary[]> {
    const parameters: unknown[] = [courseId];
    const statusClause = reviewStatus ? " AND review_status = $2" : "";
    if (reviewStatus) parameters.push(reviewStatus);
    const result = await this.pool.query<ManagedQuestionRow>(
      `SELECT ${managedQuestionColumns}
       FROM questions
       WHERE course_id = $1${statusClause}
       ORDER BY year DESC, number ASC`,
      parameters,
    );
    return result.rows.map(mapQuestion);
  }

  async getQuestionCourseId(questionId: string): Promise<string | null> {
    const result = await this.pool.query<{ course_id: string }>(
      "SELECT course_id FROM questions WHERE question_id = $1",
      [questionId],
    );
    return result.rows[0]?.course_id ?? null;
  }

  async reviewQuestion(
    questionId: string,
    actorId: string,
    update: QuestionReviewUpdate,
  ): Promise<ManagedQuestionSummary | null> {
    return withTransaction(this.pool, async (client) => {
      const reviewedAt = this.now().toISOString();
      const result = await client.query<ManagedQuestionRow>(
        `UPDATE questions
         SET review_status = $2, review_note = $3, reviewed_by = $4,
             reviewed_at = $5, updated_at = $5
         WHERE question_id = $1
         RETURNING ${managedQuestionColumns}`,
        [questionId, update.review_status, update.review_note, actorId, reviewedAt],
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE question_learning_metadata
         SET content_review_status = $2, updated_at = $3
         WHERE question_id = $1`,
        [
          questionId,
          update.review_status === "approved" ? "teacher_verified" : "pending_teacher_review",
          reviewedAt,
        ],
      );
      return mapQuestion(row);
    });
  }

  async listMaterials(courseId: string): Promise<MaterialRecord[]> {
    const result = await this.pool.query<MaterialRow>(
      `SELECT material_id, course_id, title, material_type, source_url,
              storage_ref, review_status, license_status, created_by,
              created_at, updated_at
       FROM materials
       WHERE course_id = $1
       ORDER BY updated_at DESC`,
      [courseId],
    );
    return result.rows.map(mapMaterial);
  }

  async createMaterial(
    courseId: string,
    actorId: string,
    input: MaterialCreateRequest,
  ): Promise<MaterialRecord> {
    const now = this.now().toISOString();
    const result = await this.pool.query<MaterialRow>(
      `INSERT INTO materials(
         material_id, course_id, title, material_type, source_url, storage_ref,
         review_status, license_status, created_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'pending_review',$7,$8,$9,$9)
       RETURNING material_id, course_id, title, material_type, source_url,
                 storage_ref, review_status, license_status, created_by,
                 created_at, updated_at`,
      [
        this.createId("material"),
        courseId,
        input.title,
        input.material_type,
        input.source_url,
        input.storage_ref,
        input.license_status,
        actorId,
        now,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Material insert returned no row.");
    return mapMaterial(row);
  }

  async listCourseStudents(
    courseId: string,
    viewer: ManagementViewer,
    query: ManagedCourseStudentListQuery,
  ): Promise<ManagedCourseStudentPage> {
    const result = await this.pool.query<ManagedCourseStudentPageRow>(
      `WITH students AS (
             SELECT u.user_id,
                    u.display_name,
                    'P' || upper(substr(md5(u.user_id), 1, 8)) AS student_code
               FROM course_memberships cm
               JOIN users u ON u.user_id = cm.user_id
              WHERE cm.course_id = $1
                 AND cm.membership_role = 'student'
                 AND cm.status = 'active'
                 AND u.account_status = 'active'
                 AND (
                   $3 = 'admin'
                   OR EXISTS (
                     SELECT 1
                       FROM student_academic_profiles viewer_profile
                       JOIN teacher_course_class_assignments viewer_assignment
                         ON viewer_assignment.class_id = viewer_profile.class_id
                        AND viewer_assignment.course_id = cm.course_id
                      WHERE viewer_profile.user_id = u.user_id
                        AND viewer_assignment.teacher_user_id = $4
                   )
                 )
           ),
           onboarding AS (
             SELECT user_id, status, updated_at
               FROM student_onboarding_states
           ),
           active_plans AS (
             SELECT user_id, plan_id, generated_at
               FROM student_learning_plan_versions
              WHERE status = 'active'
           ),
           plan_progress AS (
             SELECT p.user_id,
                    COUNT(t.task_id)::int AS total_tasks,
                    COUNT(t.task_id) FILTER (WHERE t.status = 'completed')::int AS completed_tasks
               FROM active_plans p
               LEFT JOIN student_learning_plan_tasks t ON t.plan_id = p.plan_id
                                                    AND t.course_id = $1
              GROUP BY p.user_id
           ),
           practice AS (
             SELECT pa.user_id,
                     COUNT(*) FILTER (WHERE e.status = 'correct')::int AS correct_count,
                     COUNT(*) FILTER (WHERE e.status = 'incorrect')::int AS incorrect_count,
                     MAX(pa.submitted_at) AS last_attempt_at
               FROM practice_attempts pa
               JOIN evaluations e ON e.attempt_id = pa.attempt_id
               JOIN questions q ON q.question_id = pa.question_id
              WHERE pa.course_id = $1
                 OR (
                   pa.course_id = $2
                   AND EXISTS (
                     SELECT 1
                       FROM course_catalog_entries target_catalog
                      WHERE target_catalog.course_id = $1
                        AND target_catalog.question_subject = q.subject
                   )
                 )
              GROUP BY pa.user_id
           ),
           evidence AS (
             SELECT evidence.user_id,
                    COUNT(*)::int AS evidence_count,
                    MAX(evidence.created_at) AS last_evidence_at
               FROM learning_evidence evidence
               JOIN questions q ON q.question_id = evidence.question_id
              WHERE evidence.course_id = $1
                 OR (
                   evidence.course_id = $2
                   AND EXISTS (
                     SELECT 1
                       FROM course_catalog_entries target_catalog
                      WHERE target_catalog.course_id = $1
                        AND target_catalog.question_subject = q.subject
                   )
                 )
               GROUP BY evidence.user_id
           ),
           course_activity_rows AS (
             SELECT attempt.user_id, attempt.submitted_at AS activity_at,
                    COALESCE(concept.title, (SELECT MIN(linked.title) FROM course_concept_question_links link
                      JOIN course_core_concepts linked ON linked.concept_id = link.concept_id AND linked.course_id = $1
                     WHERE link.question_id = attempt.question_id AND link.status = 'active'
                     HAVING COUNT(DISTINCT linked.concept_id) = 1), '课程练习') AS focus_title, 'practice' AS focus_source,
                    attempt.attempt_id AS event_key, true AS is_answer
               FROM practice_attempts attempt
               JOIN questions question ON question.question_id = attempt.question_id
               LEFT JOIN course_core_concepts concept ON concept.concept_id = attempt.concept_id AND concept.course_id = $1
              WHERE attempt.course_id = $1 OR (attempt.course_id = $2 AND EXISTS (
                SELECT 1 FROM course_catalog_entries catalog WHERE catalog.course_id = $1 AND catalog.question_subject = question.subject
              ))
             UNION ALL
             SELECT reading.user_id, reading.updated_at,
                    COALESCE((SELECT MIN(concept.title) FROM course_concept_sources source
                       JOIN course_core_concepts concept ON concept.concept_id = source.concept_id AND concept.course_id = $1
                      WHERE source.chunk_id = reading.chunk_id HAVING COUNT(DISTINCT concept.concept_id) = 1),
                      LEFT(reading.chapter, 200)), 'reading', reading.chunk_id, false
               FROM course_reading_progress reading WHERE reading.course_id = $1
             UNION ALL
             SELECT experiment.user_id, experiment.created_at, COALESCE(concept.title, '课程实验'),
                    'experiment', experiment.attempt_id, false
               FROM programming_experiment_attempts experiment
               LEFT JOIN course_core_concepts concept ON concept.concept_id = experiment.concept_id AND concept.course_id = $1
              WHERE experiment.course_id = $1
             UNION ALL
             SELECT event.user_id, event.created_at, concept.title, 'probe', event.evidence_event_id, true
               FROM student_concept_evidence_events event
               JOIN course_core_concepts concept ON concept.concept_id = event.concept_id AND concept.course_id = $1
              WHERE event.course_id = $1 AND event.attempt_id IS NULL
                AND event.outcome IN ('correct', 'incorrect', 'pending_review')
                AND event.data_origin <> 'synthetic_verification'
           ),
           activity AS (
             SELECT DISTINCT ON (user_id) user_id, activity_at AS last_active_at, focus_title, focus_source
               FROM course_activity_rows
              WHERE activity_at <= $9::timestamptz
              ORDER BY user_id, activity_at DESC, focus_source, event_key
           ),
           recent_answers AS (
             SELECT user_id, COUNT(*)::int AS recent_attempt_count FROM course_activity_rows
              WHERE is_answer AND activity_at <= $9::timestamptz
                AND activity_at >= ((($9::timestamptz AT TIME ZONE 'Asia/Shanghai')::date - 6)::timestamp AT TIME ZONE 'Asia/Shanghai')
              GROUP BY user_id
           ),
           current_snapshots AS (
             SELECT snapshot.*
               FROM student_course_progress_snapshots snapshot
               LEFT JOIN practice pr ON pr.user_id = snapshot.user_id
               LEFT JOIN evidence evi ON evi.user_id = snapshot.user_id
               LEFT JOIN activity live_activity ON live_activity.user_id = snapshot.user_id
              WHERE snapshot.course_id = $1
                AND live_activity.user_id IS NULL
                AND (snapshot.last_active_at IS NULL OR snapshot.last_active_at <= $9::timestamptz)
                AND (pr.last_attempt_at IS NULL OR pr.last_attempt_at <= snapshot.generated_at)
                AND (evi.last_evidence_at IS NULL OR evi.last_evidence_at <= snapshot.generated_at)
           ),
           mistakes AS (
             SELECT user_id,
                    COUNT(*) FILTER (WHERE status = 'needs_review')::int AS pending_review_mistake_count
               FROM practice_mistakes
              WHERE course_id = $1
              GROUP BY user_id
           ),
            roster AS (
       SELECT s.student_code,
              s.display_name,
             COALESCE(profile.student_number, s.student_code) AS student_number,
             academic_class.cohort_year,
             academic_class.major,
             academic_class.class_name,
             COALESCE(o.status, 'not_started') AS onboarding_status,
             COALESCE(snapshot.last_active_at, a.last_active_at) AS last_active_at,
             COALESCE(snapshot.progress_percent, CASE
               WHEN COALESCE(pp.total_tasks, 0) = 0 THEN 0
               ELSE ROUND(100.0 * pp.completed_tasks / pp.total_tasks)::int
             END) AS plan_completion_percent,
             CASE
               WHEN COALESCE(snapshot.correct_count, pr.correct_count, 0)
                    + COALESCE(snapshot.incorrect_count, pr.incorrect_count, 0) = 0 THEN 0
               ELSE ROUND(
                 100.0 * COALESCE(snapshot.correct_count, pr.correct_count, 0)
                 / (COALESCE(snapshot.correct_count, pr.correct_count, 0)
                    + COALESCE(snapshot.incorrect_count, pr.incorrect_count, 0))
               )::int
             END AS accuracy_percent,
             COALESCE(snapshot.correct_count, pr.correct_count, 0) AS correct_count,
             COALESCE(snapshot.incorrect_count, pr.incorrect_count, 0) AS incorrect_count,
             COALESCE(snapshot.evidence_count, evi.evidence_count, 0) AS evidence_count,
             COALESCE(snapshot.pending_review_count, m.pending_review_mistake_count, 0) AS pending_review_mistake_count,
             0::int AS weekly_study_minutes,
             COALESCE(a.focus_title, snapshot.current_focus) AS current_focus,
             COALESCE(a.focus_source, CASE WHEN snapshot.user_id IS NOT NULL THEN 'demo_snapshot' ELSE 'none' END) AS focus_source,
             COALESCE(recent.recent_attempt_count, 0) AS recent_attempt_count,
             CASE
               WHEN COALESCE(a.last_active_at, snapshot.last_active_at) IS NULL
                 OR COALESCE(a.last_active_at, snapshot.last_active_at) < $9::timestamptz - interval '7 days' THEN 'inactive'
               WHEN COALESCE(snapshot.pending_review_count, m.pending_review_mistake_count, 0) >= 3 THEN 'needs_attention'
               ELSE 'on_track'
             END AS learning_status,
             COALESCE(profile.data_provenance, 'registered_account') AS data_provenance
        FROM students s
        LEFT JOIN onboarding o ON o.user_id = s.user_id
        LEFT JOIN plan_progress pp ON pp.user_id = s.user_id
        LEFT JOIN practice pr ON pr.user_id = s.user_id
        LEFT JOIN evidence evi ON evi.user_id = s.user_id
        LEFT JOIN mistakes m ON m.user_id = s.user_id
        LEFT JOIN activity a ON a.user_id = s.user_id
        LEFT JOIN recent_answers recent ON recent.user_id = s.user_id
        LEFT JOIN student_academic_profiles profile ON profile.user_id = s.user_id
        LEFT JOIN academic_classes academic_class ON academic_class.class_id = profile.class_id
         LEFT JOIN current_snapshots snapshot
           ON snapshot.user_id = s.user_id AND snapshot.course_id = $1
            ),
            class_scoped AS (
              SELECT *
                FROM roster
               WHERE $5::text = 'all'
                  OR ($5::text = 'assigned' AND class_name IS NOT NULL)
                  OR class_name = $5::text
            ),
            filtered_roster AS (
              SELECT *
                FROM class_scoped
               WHERE $6::text = 'all' OR learning_status = $6::text
            ),
            paged_roster AS (
              SELECT *
                FROM filtered_roster
               ORDER BY CASE WHEN data_provenance = 'synthetic_demo' THEN 0 ELSE 1 END,
                        CASE learning_status
                          WHEN 'needs_attention' THEN 0
                          WHEN 'inactive' THEN 1
                          ELSE 2
                        END,
                        student_number
               LIMIT $7 OFFSET $8
            ),
            metadata AS (
              SELECT (SELECT COUNT(*)::int FROM filtered_roster) AS total_items,
                     COALESCE(
                       (SELECT array_agg(DISTINCT class_name ORDER BY class_name)
                          FROM roster
                         WHERE class_name IS NOT NULL),
                       '{}'
                     ) AS available_classes,
                     (SELECT COUNT(*)::int FROM class_scoped) AS summary_student_count,
                     (SELECT COUNT(*)::int
                        FROM class_scoped
                       WHERE learning_status <> 'on_track') AS summary_attention_count,
                     COALESCE(
                       (SELECT ROUND(AVG(plan_completion_percent))::int FROM class_scoped),
                       0
                     ) AS summary_average_progress_percent,
                     COALESCE(
                       (SELECT ROUND(AVG(accuracy_percent))::int FROM class_scoped),
                       0
                     ) AS summary_average_accuracy_percent,
                     COALESCE(
                       (SELECT SUM(weekly_study_minutes)::int FROM class_scoped),
                       0
                     ) AS summary_weekly_study_minutes,
                     COALESCE(
                       (SELECT SUM(evidence_count)::int FROM class_scoped),
                       0
                     ) AS summary_evidence_count,
                     COALESCE(
                       (SELECT BOOL_OR(data_provenance = 'synthetic_demo') FROM roster),
                       false
                     ) AS includes_synthetic_demo
            )
       SELECT COALESCE(
                jsonb_agg(
                  to_jsonb(paged_roster)
                  ORDER BY CASE WHEN paged_roster.data_provenance = 'synthetic_demo' THEN 0 ELSE 1 END,
                           CASE paged_roster.learning_status
                             WHEN 'needs_attention' THEN 0
                             WHEN 'inactive' THEN 1
                             ELSE 2
                           END,
                           paged_roster.student_number
                ) FILTER (WHERE paged_roster.student_code IS NOT NULL),
                '[]'::jsonb
              ) AS items,
              metadata.total_items,
              metadata.available_classes,
              metadata.summary_student_count,
              metadata.summary_attention_count,
              metadata.summary_average_progress_percent,
              metadata.summary_average_accuracy_percent,
              metadata.summary_weekly_study_minutes,
              metadata.summary_evidence_count,
              metadata.includes_synthetic_demo
         FROM metadata
         LEFT JOIN paged_roster ON true
        GROUP BY metadata.total_items,
                 metadata.available_classes,
                 metadata.summary_student_count,
                 metadata.summary_attention_count,
                 metadata.summary_average_progress_percent,
                 metadata.summary_average_accuracy_percent,
                 metadata.summary_weekly_study_minutes,
                 metadata.summary_evidence_count,
                 metadata.includes_synthetic_demo`,
      [
        courseId,
        SHARED_408_QUESTION_BANK_ID,
        viewer.viewerRole,
        viewer.viewerUserId,
        query.class_name,
        query.learning_status,
        query.page_size,
        (query.page - 1) * query.page_size,
        this.now().toISOString(),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Course student pagination query returned no metadata row.");
    return {
      items: Array.isArray(row.items) ? row.items.map(mapCourseStudent) : [],
      totalItems: Number(row.total_items),
      availableClasses: Array.isArray(row.available_classes)
        ? row.available_classes.filter((value): value is string => typeof value === "string")
        : [],
      summary: managedCourseStudentSummarySchema.parse({
        student_count: Number(row.summary_student_count),
        attention_count: Number(row.summary_attention_count),
        average_progress_percent: Number(row.summary_average_progress_percent),
        average_accuracy_percent: Number(row.summary_average_accuracy_percent),
        weekly_study_minutes: Number(row.summary_weekly_study_minutes),
        evidence_count: Number(row.summary_evidence_count),
      }),
      includesSyntheticDemo: row.includes_synthetic_demo === true,
    };
  }

  async listCourseTeachers(
    courseId: string,
    viewer: ManagementViewer,
  ): Promise<ManagedCourseTeacher[]> {
    const result = await this.pool.query<ManagedCourseTeacherRow>(
      `SELECT teacher.display_name,
              profile.teacher_number,
              profile.department,
              profile.professional_title,
              COALESCE(
                array_agg(DISTINCT academic_class.class_name ORDER BY academic_class.class_name)
                  FILTER (WHERE academic_class.class_name IS NOT NULL),
                '{}'
              ) AS assigned_classes,
              profile.data_provenance
         FROM course_memberships membership
         JOIN users teacher ON teacher.user_id = membership.user_id
         JOIN teacher_academic_profiles profile ON profile.user_id = teacher.user_id
         LEFT JOIN teacher_course_class_assignments assignment
           ON assignment.teacher_user_id = teacher.user_id
          AND assignment.course_id = membership.course_id
         LEFT JOIN academic_classes academic_class ON academic_class.class_id = assignment.class_id
         WHERE membership.course_id = $1
           AND membership.membership_role = 'teacher'
           AND membership.status = 'active'
           AND teacher.account_status = 'active'
           AND ($2 = 'admin' OR teacher.user_id = $3)
        GROUP BY teacher.user_id, profile.teacher_number, profile.department,
                 profile.professional_title, profile.data_provenance
        ORDER BY teacher.display_name`,
      [courseId, viewer.viewerRole, viewer.viewerUserId],
    );
    return result.rows.map(mapCourseTeacher);
  }

  async getLearningSummary(
    courseId: string,
    viewer: ManagementViewer,
  ): Promise<CourseLearningSummary> {
    const result = await this.pool.query<Record<string, string | number>>(
      `SELECT c.course_id,
              COUNT(DISTINCT attempt_member.user_id) FILTER (
                WHERE attempt_user.user_id IS NOT NULL
              ) AS active_students,
              COUNT(DISTINCT pa.attempt_id) AS attempt_count,
              COUNT(DISTINCT e.evaluation_id) FILTER (WHERE e.status = 'correct')
                AS deterministic_correct_count,
              COUNT(DISTINCT e.evaluation_id) FILTER (WHERE e.status = 'incorrect')
                AS deterministic_incorrect_count,
              COUNT(DISTINCT e.evaluation_id) FILTER (WHERE e.status = 'pending_review')
                AS pending_review_count,
              COUNT(DISTINCT le.evidence_id) AS evidence_count
       FROM courses c
       LEFT JOIN course_catalog_entries target_catalog ON target_catalog.course_id = c.course_id
       LEFT JOIN course_memberships attempt_member
         ON attempt_member.course_id = c.course_id
         AND attempt_member.membership_role = 'student'
         AND attempt_member.status = 'active'
         AND (
           $3 = 'admin'
           OR EXISTS (
             SELECT 1
               FROM student_academic_profiles viewer_profile
               JOIN teacher_course_class_assignments viewer_assignment
                 ON viewer_assignment.class_id = viewer_profile.class_id
                AND viewer_assignment.course_id = attempt_member.course_id
              WHERE viewer_profile.user_id = attempt_member.user_id
                AND viewer_assignment.teacher_user_id = $4
           )
         )
       LEFT JOIN users attempt_user
         ON attempt_user.user_id = attempt_member.user_id
        AND attempt_user.account_status = 'active'
       LEFT JOIN practice_attempts pa
         ON attempt_member.user_id = pa.user_id
        AND attempt_user.user_id IS NOT NULL
        AND (
          pa.course_id = c.course_id
          OR (
            pa.course_id = $2
            AND EXISTS (
              SELECT 1
                FROM questions q
               WHERE q.question_id = pa.question_id
                 AND q.subject = target_catalog.question_subject
            )
          )
        )
       LEFT JOIN evaluations e ON e.attempt_id = pa.attempt_id
       LEFT JOIN learning_evidence le ON le.evaluation_id = e.evaluation_id
       WHERE c.course_id = $1
       GROUP BY c.course_id`,
      [
        courseId,
        SHARED_408_QUESTION_BANK_ID,
        viewer.viewerRole,
        viewer.viewerUserId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new ManagementResourceNotFoundError("Course not found.");
    return courseLearningSummarySchema.parse({
      course_id: row.course_id,
      active_students: Number(row.active_students),
      attempt_count: Number(row.attempt_count),
      deterministic_correct_count: Number(row.deterministic_correct_count),
      deterministic_incorrect_count: Number(row.deterministic_incorrect_count),
      pending_review_count: Number(row.pending_review_count),
      evidence_count: Number(row.evidence_count),
      generated_at: this.now().toISOString(),
      data_scope: "stored_records_only",
    });
  }

  async getCourseEvidence(
    courseId: string,
    viewer: ManagementViewer,
    query?: ManagedCourseEvidenceQuery,
  ): Promise<ManagedCourseEvidence> {
    const parsedQuery = query === undefined ? undefined : managedCourseEvidenceQuerySchema.parse(query);
    const evidenceWindow = resolveEvidenceWindow(parsedQuery, this.now());
    const startExpression = "$5";
    const endExpression = "$6";
    const sourceScope = parsedQuery?.source_scope ?? "real_and_synthetic";
    const sourceFilter = sourceScope === "real_trial_only"
      ? " AND data_origin = 'real_trial'"
      : "";
    const snapshotSourceFilter = sourceScope === "real_trial_only" ? " AND false" : "";
    const windowParameters = [evidenceWindow.startAt, evidenceWindow.endAt];

    const aggregateParameters = [
      courseId,
      viewer.viewerRole,
      viewer.viewerUserId,
      SHARED_408_QUESTION_BANK_ID,
      ...windowParameters,
    ];
    const aggregateScope = buildScopedStudentsSql("$1", "$2", "$3");
    const aggregateSnapshotPolicy = buildSnapshotPolicySql("$1", "$4");
    const aggregateQuestionScope = buildQuestionScopeSql("pa", "question", "$1", "$4");
    const aggregateSql = [
      "WITH scoped_students AS (",
      aggregateScope,
      "), snapshot_policy AS (",
      aggregateSnapshotPolicy,
      "), live_rows AS (",
      "  SELECT DISTINCT le.evidence_id, pa.user_id, pa.attempt_id,",
      "         le.outcome, pa.submitted_at AS activity_at,",
      "         " + dataOriginSql("pa") + " AS data_origin",
      "    FROM practice_attempts pa",
      "    JOIN scoped_students scoped ON scoped.user_id = pa.user_id",
      "    JOIN questions question ON question.question_id = pa.question_id",
      "    JOIN evaluations evaluation ON evaluation.attempt_id = pa.attempt_id",
      "    JOIN learning_evidence le ON le.attempt_id = pa.attempt_id",
      "    LEFT JOIN snapshot_policy snapshot_policy ON snapshot_policy.user_id = pa.user_id",
      "   WHERE " + aggregateQuestionScope,
      "     AND pa.submitted_at >= " + startExpression,
      "     AND pa.submitted_at < " + endExpression,
      "     AND evaluation.grading_mode = 'deterministic_choice'",
      "     AND le.grading_mode = 'deterministic_choice'",
      "     AND le.eligible_for_learning_state_update = true",
      "     AND le.outcome IN ('correct', 'incorrect')",
      "     AND COALESCE(snapshot_policy.use_snapshot, false) = false",
      "), snapshot_rows AS (",
      "  SELECT user_id, 'local_demo'::text AS data_origin,",
      "         (correct_count + incorrect_count)::int AS valid_attempt_count,",
      "         incorrect_count::int AS incorrect_count, activity_at",
      "    FROM snapshot_policy",
      "   WHERE use_snapshot = true",
      "     AND activity_at >= " + startExpression,
      "     AND activity_at < " + endExpression,
      "     " + snapshotSourceFilter,
      "), valid_rows AS (",
      "  SELECT user_id, data_origin, 1::int AS valid_attempt_count,",
      "         CASE WHEN outcome = 'incorrect' THEN 1 ELSE 0 END::int AS incorrect_count,",
      "         activity_at",
      "    FROM live_rows",
      "  UNION ALL",
      "  SELECT user_id, data_origin, valid_attempt_count, incorrect_count, activity_at",
      "    FROM snapshot_rows",
      "), activity_rows AS (",
      "  SELECT user_id, activity_at, data_origin FROM live_rows",
      "  UNION ALL",
      "  SELECT user_id, activity_at, data_origin FROM snapshot_rows",
      "  UNION ALL",
      "  SELECT scoped.user_id, account.last_login_at,",
      "         " + dataOriginSql("scoped") + " AS data_origin",
      "    FROM scoped_students scoped",
      "    JOIN users account ON account.user_id = scoped.user_id",
      "   WHERE account.last_login_at IS NOT NULL",
      "), source_aggregate AS (",
      "  SELECT",
      "    COUNT(DISTINCT user_id) FILTER (WHERE data_origin = 'real_trial' AND valid_attempt_count > 0)::int AS real_trial_student_count,",
      "    COALESCE(SUM(valid_attempt_count) FILTER (WHERE data_origin = 'real_trial'), 0)::int AS real_trial_attempt_count,",
      "    COALESCE(SUM(valid_attempt_count) FILTER (WHERE data_origin = 'real_trial' AND valid_attempt_count > 0), 0)::int AS real_trial_valid_attempt_count,",
      "    COALESCE(SUM(incorrect_count) FILTER (WHERE data_origin = 'real_trial'), 0)::int AS real_trial_incorrect_count,",
      "    COUNT(DISTINCT user_id) FILTER (WHERE data_origin = 'synthetic_verification' AND valid_attempt_count > 0)::int AS synthetic_verification_student_count,",
      "    COALESCE(SUM(valid_attempt_count) FILTER (WHERE data_origin = 'synthetic_verification'), 0)::int AS synthetic_verification_attempt_count,",
      "    COALESCE(SUM(valid_attempt_count) FILTER (WHERE data_origin = 'synthetic_verification' AND valid_attempt_count > 0), 0)::int AS synthetic_verification_valid_attempt_count,",
      "    COALESCE(SUM(incorrect_count) FILTER (WHERE data_origin = 'synthetic_verification'), 0)::int AS synthetic_verification_incorrect_count,",
      "    COUNT(DISTINCT user_id) FILTER (WHERE data_origin = 'local_demo' AND valid_attempt_count > 0)::int AS local_demo_student_count,",
      "    COALESCE(SUM(valid_attempt_count) FILTER (WHERE data_origin = 'local_demo'), 0)::int AS local_demo_attempt_count,",
      "    COALESCE(SUM(valid_attempt_count) FILTER (WHERE data_origin = 'local_demo' AND valid_attempt_count > 0), 0)::int AS local_demo_valid_attempt_count,",
      "    COALESCE(SUM(incorrect_count) FILTER (WHERE data_origin = 'local_demo'), 0)::int AS local_demo_incorrect_count",
      "  FROM valid_rows",
      ")",
      "SELECT (SELECT COUNT(DISTINCT cm.user_id)::int",
      "          FROM course_memberships cm",
      "          JOIN users u ON u.user_id = cm.user_id AND u.account_status = 'active'",
      "         WHERE cm.course_id = $1",
      "           AND cm.membership_role = 'student'",
      "           AND cm.status = 'active'",
      "           AND ($2 = 'admin' OR EXISTS (",
      "                 SELECT 1 FROM student_academic_profiles viewer_profile",
      "                 JOIN teacher_course_class_assignments viewer_assignment",
      "                   ON viewer_assignment.class_id = viewer_profile.class_id",
      "                  AND viewer_assignment.course_id = cm.course_id",
      "                WHERE viewer_profile.user_id = cm.user_id",
      "                  AND viewer_assignment.teacher_user_id = $3",
      "               ))) AS active_student_count,",
      "(SELECT COUNT(DISTINCT user_id)::int FROM activity_rows",
      "  WHERE activity_at >= " + startExpression + " AND activity_at < " + endExpression + sourceFilter,
      ") AS active_window_student_count,",
      "(SELECT COUNT(DISTINCT user_id)::int FROM valid_rows",
      "  WHERE valid_attempt_count > 0" + sourceFilter,
      ") AS valid_attempt_student_count,",
      "(SELECT COUNT(DISTINCT user_id)::int FROM valid_rows",
      "  WHERE valid_attempt_count > 0 AND data_origin = 'real_trial'",
      ") AS real_trial_valid_attempt_student_count,",
      "(SELECT COALESCE(BOOL_OR(data_origin <> 'real_trial'), false) FROM valid_rows",
      "  ) OR EXISTS (SELECT 1 FROM scoped_students scoped",
      "               JOIN student_academic_profiles profile ON profile.user_id = scoped.user_id",
      "              WHERE profile.data_provenance = 'synthetic_demo') AS includes_synthetic_demo,",
      "source_aggregate.*",
      "FROM source_aggregate",
      "WHERE EXISTS (SELECT 1 FROM courses WHERE course_id = $1)",
    ].join("\n");
    const courseResult = await this.pool.query<ManagedCourseEvidenceAggregateRow>(
      aggregateSql,
      aggregateParameters,
    );
    const aggregate = courseResult.rows[0];
    if (!aggregate) throw new ManagementResourceNotFoundError("Course not found.");

    const weakParameters = [
      courseId,
      SHARED_408_QUESTION_BANK_ID,
      viewer.viewerRole,
      viewer.viewerUserId,
      ...windowParameters,
    ];
    const weakScope = buildScopedStudentsSql("$1", "$3", "$4");
    const weakSnapshotPolicy = buildSnapshotPolicySql("$1", "$2");
    const weakQuestionScope = buildQuestionScopeSql("pa", "question", "$1", "$2");
    const weakSql = [
      "/* WITH snapshot_policy: per-student snapshot/live selection */",
      "WITH scoped_students AS (",
      weakScope,
      "), snapshot_policy AS (",
      weakSnapshotPolicy,
      "), live_evidence AS (",
      "  SELECT DISTINCT le.evidence_id,",
      "         COALESCE(le.concept_id, pa.concept_id, mistake.concept_id) AS concept_id,",
      "         pa.attempt_id, pa.user_id, pa.submitted_at, le.outcome,",
      "         " + dataOriginSql("pa") + " AS data_origin",
      "    FROM practice_attempts pa",
      "    JOIN course_memberships attempt_member",
      "      ON attempt_member.user_id = pa.user_id",
      "     AND attempt_member.course_id = $1",
      "     AND attempt_member.membership_role = 'student'",
      "     AND attempt_member.status = 'active'",
      "     AND ($3 = 'admin' OR EXISTS (",
      "           SELECT 1 FROM student_academic_profiles viewer_profile",
      "           JOIN teacher_course_class_assignments viewer_assignment",
      "             ON viewer_assignment.class_id = viewer_profile.class_id",
      "            AND viewer_assignment.course_id = attempt_member.course_id",
      "            AND viewer_assignment.teacher_user_id = $4",
      "          WHERE viewer_profile.user_id = attempt_member.user_id",
      "         ))",
      "    JOIN users attempt_user ON attempt_user.user_id = attempt_member.user_id",
      "                            AND attempt_user.account_status = 'active'",
      "    JOIN questions question ON question.question_id = pa.question_id",
      "    JOIN evaluations evaluation ON evaluation.attempt_id = pa.attempt_id",
      "    JOIN learning_evidence le ON le.attempt_id = pa.attempt_id",
      "    LEFT JOIN snapshot_policy snapshot_policy ON snapshot_policy.user_id = pa.user_id",
      "    LEFT JOIN practice_mistakes mistake",
      "      ON mistake.user_id = pa.user_id AND mistake.question_id = pa.question_id",
      "   WHERE " + weakQuestionScope,
      "     AND pa.submitted_at >= " + startExpression,
      "     AND pa.submitted_at < " + endExpression,
      "     AND evaluation.grading_mode = 'deterministic_choice'",
      "     AND le.grading_mode = 'deterministic_choice'",
      "     AND le.eligible_for_learning_state_update = true",
      "     AND le.outcome IN ('correct', 'incorrect')",
      "     AND COALESCE(snapshot_policy.use_snapshot, false) = false",
      "     " + (sourceScope === "real_trial_only" ? "AND (" + dataOriginSql("pa") + ") = 'real_trial'" : ""),
      "), pending_evidence AS (",
      "  SELECT DISTINCT COALESCE(le.concept_id, pa.concept_id, mistake.concept_id) AS concept_id,",
      "         pa.attempt_id, pa.user_id,",
      "         " + dataOriginSql("pa") + " AS data_origin",
      "    FROM practice_attempts pa",
      "    JOIN scoped_students scoped ON scoped.user_id = pa.user_id",
      "    JOIN questions question ON question.question_id = pa.question_id",
      "    JOIN evaluations evaluation ON evaluation.attempt_id = pa.attempt_id",
      "    LEFT JOIN learning_evidence le ON le.attempt_id = pa.attempt_id",
      "    LEFT JOIN practice_mistakes mistake",
      "      ON mistake.user_id = pa.user_id AND mistake.question_id = pa.question_id",
      "   WHERE " + weakQuestionScope,
      "     AND pa.submitted_at >= " + startExpression,
      "     AND pa.submitted_at < " + endExpression,
      "     AND (evaluation.status = 'pending_review'",
      "          OR le.outcome = 'pending_review'",
      "          OR (le.evidence_id IS NOT NULL",
      "              AND COALESCE(le.eligible_for_learning_state_update, false) = false))",
      "     " + (sourceScope === "real_trial_only" ? "AND (" + dataOriginSql("pa") + ") = 'real_trial'" : ""),
      "), pending_by_concept AS (",
      "  SELECT concept_id, COUNT(DISTINCT attempt_id)::int AS pending_count",
      "    FROM pending_evidence",
      "   WHERE concept_id IS NOT NULL",
      "   GROUP BY concept_id",
      "), probe_by_concept AS (",
      "  SELECT event.concept_id,",
      "         COUNT(DISTINCT event.user_id) FILTER (WHERE event.eligible_for_learning_state_update = true)::int AS probe_participant_count,",
      "         COUNT(DISTINCT event.evidence_event_id) FILTER (WHERE event.outcome = 'correct' AND event.eligible_for_learning_state_update = true)::int AS probe_correct_count,",
      "         COUNT(DISTINCT event.evidence_event_id) FILTER (WHERE event.outcome = 'incorrect' AND event.eligible_for_learning_state_update = true)::int AS probe_incorrect_count",
      "    FROM student_concept_evidence_events event",
      "    JOIN scoped_students scoped ON scoped.user_id = event.user_id",
      "   WHERE event.course_id = $1",
      "     AND event.created_at >= " + startExpression,
      "     AND event.created_at < " + endExpression,
      "     AND event.outcome IN ('correct', 'incorrect')",
      "     AND event.eligible_for_learning_state_update = true",
      "     " + (sourceScope === "real_trial_only" ? "AND event.data_origin = 'real_trial'" : ""),
      "   GROUP BY event.concept_id",
      "), live_weak AS (",
      "  SELECT concept.concept_id, concept.title AS concept_title,",
      "         COUNT(DISTINCT live.evidence_id)::int AS attempt_count,",
      "         COUNT(DISTINCT live.evidence_id)::int AS valid_attempt_count,",
      "         COUNT(DISTINCT live.evidence_id) FILTER (WHERE live.outcome = 'incorrect')::int AS incorrect_count,",
      "         COUNT(DISTINCT live.user_id) FILTER (WHERE live.outcome = 'incorrect')::int AS incorrect_student_count,",
      "         COALESCE(pending.pending_count, 0)::int AS pending_review_count,",
      "         COUNT(DISTINCT live.user_id)::int AS student_count,",
      "         COALESCE(probe.probe_participant_count, 0)::int AS probe_participant_count,",
      "         COALESCE(probe.probe_correct_count, 0)::int AS probe_correct_count,",
      "         COALESCE(probe.probe_incorrect_count, 0)::int AS probe_incorrect_count,",
      "         MAX(live.submitted_at) AS last_activity_at",
      "    FROM live_evidence live",
      "    JOIN course_core_concepts concept",
      "      ON concept.concept_id = live.concept_id AND concept.course_id = $1",
      "    LEFT JOIN pending_by_concept pending ON pending.concept_id = concept.concept_id",
      "    LEFT JOIN probe_by_concept probe ON probe.concept_id = concept.concept_id",
      "   WHERE live.concept_id IS NOT NULL",
      "   GROUP BY concept.concept_id, concept.title, pending.pending_count,",
      "            probe.probe_participant_count, probe.probe_correct_count, probe.probe_incorrect_count",
      "), snapshot_weak AS (",
      "  SELECT concept.concept_id, concept.title AS concept_title,",
       "         SUM(snapshot_policy.correct_count + snapshot_policy.incorrect_count)::int AS attempt_count,",
       "         SUM(snapshot_policy.correct_count + snapshot_policy.incorrect_count)::int AS valid_attempt_count,",
       "         SUM(snapshot_policy.incorrect_count)::int AS incorrect_count,",
       "         COUNT(DISTINCT snapshot_policy.user_id) FILTER (WHERE snapshot_policy.incorrect_count > 0)::int AS incorrect_student_count,",
       "         SUM(snapshot_policy.pending_review_count)::int AS pending_review_count,",
       "         COUNT(DISTINCT snapshot_policy.user_id)::int AS student_count,",
      "         0::int AS probe_participant_count, 0::int AS probe_correct_count,",
       "         0::int AS probe_incorrect_count, MAX(snapshot_policy.activity_at) AS last_activity_at",
       "    FROM snapshot_policy snapshot_policy",
      "    JOIN course_core_concepts concept",
      "      ON concept.concept_id = (SELECT weak_concept_id FROM student_course_progress_snapshots",
       "                                WHERE user_id = snapshot_policy.user_id AND course_id = $1)",
      "     AND concept.course_id = $1",
       "   WHERE snapshot_policy.use_snapshot = true",
       "     AND snapshot_policy.activity_at >= " + startExpression,
       "     AND snapshot_policy.activity_at < " + endExpression,
      "     " + snapshotSourceFilter,
      "   GROUP BY concept.concept_id, concept.title",
      "), combined_weak AS (",
      "  SELECT * FROM live_weak",
      "  UNION ALL",
      "  SELECT * FROM snapshot_weak",
      ")",
      "SELECT concept_id, concept_title,",
      "       SUM(attempt_count)::int AS attempt_count,",
      "       SUM(valid_attempt_count)::int AS valid_attempt_count,",
      "       SUM(incorrect_count)::int AS incorrect_count,",
      "       SUM(incorrect_student_count)::int AS incorrect_student_count,",
      "       ROUND(100.0 * SUM(incorrect_count) / NULLIF(SUM(valid_attempt_count), 0), 2)::numeric AS error_rate,",
      "       SUM(pending_review_count)::int AS pending_review_count,",
      "       SUM(student_count)::int AS student_count,",
      "       SUM(probe_participant_count)::int AS probe_participant_count,",
      "       SUM(probe_correct_count)::int AS probe_correct_count,",
      "       SUM(probe_incorrect_count)::int AS probe_incorrect_count,",
      "       MAX(last_activity_at) AS last_activity_at",
      "  FROM combined_weak",
      " GROUP BY concept_id, concept_title",
      ` HAVING SUM(student_count) >= ${MINIMUM_EVIDENCE_SAMPLE}`,
      " ORDER BY incorrect_count DESC, pending_review_count DESC, attempt_count DESC, concept_title ASC",
      " LIMIT 3",
    ].join("\n");
    const weakConceptResult = await this.pool.query<ManagedCourseWeakConceptRow>(
      weakSql,
      weakParameters,
    );

    const interventionResult = await this.pool.query<TeacherInterventionRow>(
      `SELECT intervention.intervention_id, intervention.course_id, intervention.concept_id,
              concept.title AS concept_title, intervention.action, intervention.note,
              intervention.target_type, intervention.target_class_id, target_class.class_name AS target_class_name,
              intervention.target_user_id,
              intervention.material_ref, intervention.due_at, intervention.status,
              intervention.delivered_at, intervention.completed_at, intervention.evidence_snapshot,
              intervention.created_at
         FROM teacher_interventions intervention
         JOIN course_core_concepts concept ON concept.concept_id = intervention.concept_id
         LEFT JOIN academic_classes target_class ON target_class.class_id = intervention.target_class_id
        WHERE intervention.course_id = $1
          AND (
            $2 = 'admin'
            OR intervention.actor_user_id = $3
            OR (
              COALESCE(intervention.target_type, 'concept') <> 'concept'
              AND EXISTS (
              SELECT 1
                FROM teacher_course_class_assignments assignment
               WHERE assignment.teacher_user_id = $3
                 AND assignment.course_id = intervention.course_id
                 AND (
                   (
                     COALESCE(intervention.target_type, 'concept') = 'class'
                     AND assignment.class_id = intervention.target_class_id
                   )
                   OR (
                     COALESCE(intervention.target_type, 'concept') = 'student'
                     AND EXISTS (
                       SELECT 1
                         FROM student_academic_profiles target_profile
                        WHERE target_profile.user_id = intervention.target_user_id
                          AND target_profile.class_id = assignment.class_id
                     )
                   )
                 )
              )
            )
          )
        ORDER BY intervention.created_at DESC
        LIMIT 20`,
      [courseId, viewer.viewerRole, viewer.viewerUserId],
    );

    const weakConcepts = weakConceptResult.rows
      .map(mapWeakConcept)
      .filter((concept) => concept.student_count >= MINIMUM_EVIDENCE_SAMPLE);
    const recentInterventions = interventionResult.rows.map(mapTeacherIntervention);
    const activeStudentCount = numeric(aggregate.active_student_count);
    const validAttemptStudentCount = numeric(aggregate.valid_attempt_student_count);
    const realTrialValidAttemptStudentCount = numeric(aggregate.real_trial_valid_attempt_student_count);
    const sufficient = validAttemptStudentCount >= MINIMUM_EVIDENCE_SAMPLE;
    const evidenceStatus = validAttemptStudentCount === 0
      ? "no_valid_evidence" as const
      : sufficient
        ? "sufficient" as const
        : "insufficient_sample" as const;
    const includesSyntheticDemo = Boolean(aggregate.includes_synthetic_demo);
    const payload = {
      course_id: courseId,
      generated_at: this.now().toISOString(),
      data_scope: includesSyntheticDemo ? "includes_synthetic_demo" as const : "stored_records_only" as const,
      active_student_count: activeStudentCount,
      top_weak_concepts: sufficient ? weakConcepts : [],
      recent_interventions: recentInterventions,
      window: {
        start_at: evidenceWindow.startAt,
        end_at: evidenceWindow.endAt,
        days: evidenceWindow.days,
      },
      sample: {
        minimum_students: MINIMUM_EVIDENCE_SAMPLE,
        active_student_count: activeStudentCount,
        active_window_student_count: numeric(aggregate.active_window_student_count),
        valid_attempt_student_count: validAttemptStudentCount,
        real_trial_valid_attempt_student_count: realTrialValidAttemptStudentCount,
        sufficient,
      },
      evidence_status: evidenceStatus,
      source_scope: sourceScope,
      source_breakdown: {
        real_trial: sourceMetric(aggregate, "real_trial"),
        synthetic_verification: sourceMetric(aggregate, "synthetic_verification"),
        local_demo: sourceMetric(aggregate, "local_demo"),
      },
    };
    return managedCourseEvidenceSchema.parse(payload);
  }

  async recordTeacherIntervention(
    courseId: string,
    viewer: ManagementViewer,
    input: TeacherInterventionCreateRequest,
  ): Promise<TeacherIntervention> {
    const parsedInput = teacherInterventionCreateRequestSchema.parse(input);
    const conceptResult = await this.pool.query<{ concept_id: string; title: string }>(
      `SELECT concept_id, title
         FROM course_core_concepts
        WHERE concept_id = $1 AND course_id = $2`,
      [parsedInput.concept_id, courseId],
    );
    const concept = conceptResult.rows[0];
    if (!concept) {
      throw new ManagementResourceNotFoundError("Concept does not belong to the requested course.");
    }

    const createdAt = this.now().toISOString();
    const targetType = parsedInput.target_type ?? "concept";
    const targetClassId = parsedInput.target_class_id ?? null;
    const targetStudentCode = parsedInput.target_student_code ?? null;
    let targetUserId: string | null = null;
    if (targetType === "student" && targetStudentCode) {
      const targetResult = await this.pool.query<{ target_user_id: string }>(
        `SELECT profile.user_id AS target_user_id
           FROM student_academic_profiles profile
           JOIN users target_user
             ON target_user.user_id = profile.user_id
            AND target_user.account_status = 'active'
           JOIN course_memberships membership
             ON membership.user_id = profile.user_id
            AND membership.course_id = $1
            AND membership.membership_role = 'student'
            AND membership.status = 'active'
          WHERE 'P' || upper(substr(md5(profile.user_id), 1, 8)) = $2
            AND (
              $3 = 'admin'
              OR EXISTS (
                SELECT 1
                  FROM teacher_course_class_assignments assignment
                 WHERE assignment.teacher_user_id = $4
                   AND assignment.course_id = $1
                   AND assignment.class_id = profile.class_id
              )
            )
          LIMIT 1`,
        [courseId, targetStudentCode, viewer.viewerRole, viewer.viewerUserId],
      );
      targetUserId = targetResult.rows[0]?.target_user_id ?? null;
      if (!targetUserId) throw new ManagementInterventionTargetNotFoundError();
    }
    const materialRef = parsedInput.material_ref ?? null;
    const dueAt = parsedInput.due_at ?? null;
    const result = await this.pool.query<TeacherInterventionRow>(
      `INSERT INTO teacher_interventions(
         intervention_id, course_id, concept_id, actor_user_id, action, note,
         target_type, target_class_id, target_user_id, material_ref, due_at,
         status, delivered_at, completed_at, evidence_snapshot, created_at, updated_at
       )
       SELECT $1,$2,$3,$4,$5,$6,$7,$9,$10,$11,$12,
              'planned',NULL,NULL,NULL,$13,$13
        WHERE (
          $8 = 'admin'
          OR EXISTS (
            SELECT 1
              FROM teacher_course_class_assignments viewer_assignment
             WHERE viewer_assignment.teacher_user_id = $4
               AND viewer_assignment.course_id = $2
               AND (
                 $7 = 'concept'
                 OR ($7 = 'class' AND viewer_assignment.class_id = $9)
                 OR ($7 = 'student' AND EXISTS (
                   SELECT 1
                     FROM student_academic_profiles target_profile
                     JOIN course_memberships target_membership
                       ON target_membership.user_id = target_profile.user_id
                      AND target_membership.course_id = $2
                      AND target_membership.membership_role = 'student'
                      AND target_membership.status = 'active'
                    WHERE target_profile.user_id = $10
                      AND target_profile.class_id = viewer_assignment.class_id
                 ))
               )
          )
        )
        AND (
          $7 = 'concept'
          OR ($7 = 'class' AND EXISTS (
            SELECT 1 FROM teacher_course_class_assignments target_assignment
             WHERE target_assignment.class_id = $9
               AND target_assignment.course_id = $2
          ))
          OR ($7 = 'student' AND EXISTS (
            SELECT 1
              FROM course_memberships target_membership
              JOIN users target_user
                ON target_user.user_id = target_membership.user_id
               AND target_user.account_status = 'active'
             WHERE target_membership.user_id = $10
               AND target_membership.course_id = $2
               AND target_membership.membership_role = 'student'
               AND target_membership.status = 'active'
          ))
        )
       RETURNING intervention_id, course_id, concept_id, target_type, target_class_id,
                 target_user_id, material_ref, due_at, status, delivered_at,
                 completed_at, evidence_snapshot, action, note, created_at`,
      [
        this.createId("intervention"),
        courseId,
        parsedInput.concept_id,
        viewer.viewerUserId,
        parsedInput.action,
        parsedInput.note,
        targetType,
        viewer.viewerRole,
        targetClassId,
        targetUserId,
        materialRef,
        dueAt,
        createdAt,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ManagementAccessDeniedError("Teacher has no assigned class for this course.");
    }
    return mapTeacherIntervention({
      ...row,
      concept_title: concept.title,
      target_student_code: targetStudentCode,
    });
  }

  async updateTeacherInterventionStatus(
    courseId: string,
    interventionId: string,
    viewer: ManagementViewer,
    input: TeacherInterventionStatusUpdateRequest,
  ): Promise<TeacherIntervention> {
    const parsedInput = teacherInterventionStatusUpdateRequestSchema.parse(input);
    return withTransaction(this.pool, async (client) => {
      const existingResult = await client.query<TeacherInterventionRow>(
        `SELECT intervention.intervention_id, intervention.course_id, intervention.concept_id,
                intervention.actor_user_id,
                intervention.target_type, intervention.target_class_id, intervention.target_user_id,
                intervention.material_ref, intervention.due_at, intervention.status,
                intervention.delivered_at, intervention.completed_at, intervention.evidence_snapshot,
                intervention.action, intervention.note, intervention.created_at,
                concept.title AS concept_title
           FROM teacher_interventions intervention
           JOIN course_core_concepts concept ON concept.concept_id = intervention.concept_id
          WHERE intervention.intervention_id = $1
            AND intervention.course_id = $2
            AND (
              $3 = 'admin'
              OR intervention.actor_user_id = $4
              OR (
                COALESCE(intervention.target_type, 'concept') <> 'concept'
                AND EXISTS (
                SELECT 1
                  FROM teacher_course_class_assignments assignment
                 WHERE assignment.teacher_user_id = $4
                   AND assignment.course_id = intervention.course_id
                   AND (
                     (COALESCE(intervention.target_type, 'concept') = 'class'
                          AND assignment.class_id = intervention.target_class_id)
                     OR (COALESCE(intervention.target_type, 'concept') = 'student'
                         AND EXISTS (
                           SELECT 1 FROM student_academic_profiles profile
                            WHERE profile.user_id = intervention.target_user_id
                              AND profile.class_id = assignment.class_id
                         ))
                   )
                )
              )
            )
          FOR UPDATE`,
        [interventionId, courseId, viewer.viewerRole, viewer.viewerUserId],
      );
      const existing = existingResult.rows[0];
      if (!existing) {
        throw new ManagementResourceNotFoundError("Teacher intervention not found.");
      }
      const currentStatus = (existing.status ?? "planned") as TeacherInterventionStatus;
      const nextStatus = parsedInput.status;
      if (!canTransitionIntervention(currentStatus, nextStatus)) {
        throw new ManagementConflictError(
          `教师干预不能从 ${currentStatus} 变更为 ${nextStatus}。`,
        );
      }

      const changedAt = this.now().toISOString();
      let deliveredAt = existing.delivered_at ?? null;
      let completedAt: Date | string | null = null;
      let evidenceSnapshot: Record<string, unknown> | null = null;

      if (nextStatus === "sent") {
        deliveredAt = deliveredAt ?? changedAt;
      } else if (nextStatus === "cancelled") {
        deliveredAt = deliveredAt;
      } else if (nextStatus === "completed") {
        if (!deliveredAt) {
          throw new ManagementConflictError("干预必须先送达，才能标记完成。");
        }
        const evidenceResult = await client.query<{
          valid_evidence_count: number | string | null;
          correct_count?: number | string | null;
          incorrect_count?: number | string | null;
          real_trial_count?: number | string | null;
          synthetic_verification_count?: number | string | null;
          local_demo_count?: number | string | null;
          last_evidence_at: Date | string | null;
        }>(
          `WITH scoped_evidence AS (
             SELECT evaluation.evaluation_id,
                    evidence.created_at AS evidence_at,
                    evaluation.status AS outcome,
                    ${dataOriginSql("evidence")} AS data_origin
               FROM learning_evidence evidence
               JOIN evaluations evaluation ON evaluation.evaluation_id = evidence.evaluation_id
               JOIN practice_attempts attempt ON attempt.attempt_id = evaluation.attempt_id
               JOIN questions question ON question.question_id = evidence.question_id
               JOIN users account
                 ON account.user_id = evidence.user_id
                AND account.account_status = 'active'
               JOIN course_memberships membership
                 ON membership.user_id = evidence.user_id
                AND membership.course_id = $1
                AND membership.membership_role = 'student'
                AND membership.status = 'active'
               JOIN course_core_concepts concept
                 ON concept.concept_id = evidence.concept_id
                AND concept.course_id = $1
               JOIN course_concept_question_links concept_link
                 ON concept_link.concept_id = evidence.concept_id
                AND concept_link.question_id = evidence.question_id
                AND concept_link.status = 'active'
              WHERE evidence.concept_id = $2
                AND evidence.created_at > $3
                AND evidence.attempt_id = attempt.attempt_id
                AND evidence.user_id = attempt.user_id
                AND evidence.question_id = attempt.question_id
                AND attempt.concept_id = evidence.concept_id
                AND ${buildQuestionScopeSql("attempt", "question", "$1", "$8")}
                AND evaluation.grading_mode = 'deterministic_choice'
                AND evidence.grading_mode = 'deterministic_choice'
                AND evidence.eligible_for_learning_state_update = true
                AND evaluation.status IN ('correct', 'incorrect')
                AND evidence.outcome = evaluation.status
                AND (
                  ($4 = 'student' AND evidence.user_id = $6)
                  OR ($4 = 'class' AND EXISTS (
                    SELECT 1
                      FROM student_academic_profiles profile
                     WHERE profile.user_id = evidence.user_id
                       AND profile.class_id = $5
                  ))
                  OR ($4 = 'concept' AND (
                    EXISTS (
                      SELECT 1
                        FROM user_roles actor_role
                       WHERE actor_role.user_id = $7
                         AND actor_role.role_key = 'admin'
                    )
                    OR EXISTS (
                      SELECT 1
                        FROM student_academic_profiles profile
                        JOIN teacher_course_class_assignments assignment
                          ON assignment.class_id = profile.class_id
                         AND assignment.course_id = $1
                       WHERE profile.user_id = evidence.user_id
                         AND assignment.teacher_user_id = $7
                    )
                  ))
                )
           )
           SELECT COUNT(DISTINCT evaluation_id)::int AS valid_evidence_count,
                  COUNT(DISTINCT evaluation_id) FILTER (WHERE outcome = 'correct')::int AS correct_count,
                  COUNT(DISTINCT evaluation_id) FILTER (WHERE outcome = 'incorrect')::int AS incorrect_count,
                  COUNT(DISTINCT evaluation_id) FILTER (WHERE data_origin = 'real_trial')::int AS real_trial_count,
                  COUNT(DISTINCT evaluation_id) FILTER (WHERE data_origin = 'synthetic_verification')::int AS synthetic_verification_count,
                  COUNT(DISTINCT evaluation_id) FILTER (WHERE data_origin = 'local_demo')::int AS local_demo_count,
                  MAX(evidence_at) AS last_evidence_at
             FROM scoped_evidence`,
          [
            courseId,
            existing.concept_id,
            deliveredAt,
            existing.target_type ?? "concept",
            existing.target_class_id ?? null,
            existing.target_user_id ?? null,
            existing.actor_user_id,
            SHARED_408_QUESTION_BANK_ID,
          ],
        );
        const evidence = evidenceResult.rows[0];
        const validEvidenceCount = numeric(evidence?.valid_evidence_count);
        if (!evidence || validEvidenceCount <= 0) {
          throw new ManagementInterventionEvidenceRequiredError();
        }
        completedAt = changedAt;
        evidenceSnapshot = {
          valid_evidence_count: validEvidenceCount,
          correct_count: numeric(evidence.correct_count),
          incorrect_count: numeric(evidence.incorrect_count),
          source_breakdown: {
            real_trial: numeric(evidence.real_trial_count),
            synthetic_verification: numeric(evidence.synthetic_verification_count),
            local_demo: numeric(evidence.local_demo_count),
          },
          last_evidence_at: evidence.last_evidence_at === null || evidence.last_evidence_at === undefined
            ? null
            : iso(evidence.last_evidence_at),
          captured_at: changedAt,
        };
      }

      const updatedResult = await client.query<TeacherInterventionRow>(
        `UPDATE teacher_interventions
            SET status = $3,
                delivered_at = $4,
                completed_at = $5,
                evidence_snapshot = $6::jsonb,
                updated_at = $7
          WHERE intervention_id = $1
            AND course_id = $2
          RETURNING intervention_id, course_id, concept_id, target_type, target_class_id,
                    target_user_id, material_ref, due_at, status, delivered_at,
                    completed_at, evidence_snapshot, action, note, created_at`,
        [
          interventionId,
          courseId,
          nextStatus,
          deliveredAt,
          completedAt,
          evidenceSnapshot === null ? null : JSON.stringify(evidenceSnapshot),
          changedAt,
        ],
      );
      const updated = updatedResult.rows[0];
      if (!updated) {
        throw new ManagementResourceNotFoundError("Teacher intervention not found.");
      }
      return mapTeacherIntervention({
        ...updated,
        concept_title: updated.concept_title ?? existing.concept_title ?? existing.concept_id,
      });
    });
  }
}
