import { randomUUID } from "node:crypto";

import {
  ONBOARDING_COURSE_IDS,
  onboardingDiagnosticQuestionSetResponseSchema,
  onboardingInitialProfileSchema,
  onboardingLearningPlanSchema,
  onboardingStateSchema,
  questionDtoSchema,
  type OnboardingDiagnosticAnswer,
  type OnboardingDiagnosticQuestionSetResponse,
  type OnboardingCourseId,
  type OnboardingGoalInput,
  type OnboardingGoals,
  type OnboardingInitialProfile,
  type OnboardingLearningPlan,
  type OnboardingLearningTask,
  type OnboardingSelfAssessment,
  type OnboardingSelfAssessmentLevel,
  type OnboardingSelfAssessmentsUpdate,
  type OnboardingState,
} from "@xuetu/contracts";

import {
  ONBOARDING_DIAGNOSTIC_SET_VERSION,
} from "../../database/seed-onboarding-diagnostic.js";
import {
  withTransaction,
  type SqlClient,
  type SqlQueryablePool,
} from "../../database/client.js";
import { studentQuestionExposureSqlForAliases } from "../question-bank/student-question-exposure.js";
import {
  buildDeterministicOnboardingResult,
  type OnboardingCourseResource,
  type OnboardingScreeningEvidence,
} from "./deterministic-onboarding-planner.js";
import {
  StudentOnboardingError,
  type StudentOnboardingService,
} from "./student-onboarding.js";

type Queryable = Pick<SqlQueryablePool, "query"> | Pick<SqlClient, "query">;

interface OnboardingStateRow {
  status: "not_started" | "in_progress" | "completed";
  current_step: "goals" | "self_assessment" | "diagnostic" | "profile" | "plan";
  target_exam_year: number | null;
  preparation_stage: "preparing" | "foundation" | "strengthening" | "sprint" | null;
  daily_minutes: number | null;
  target_school: string | null;
  target_score: number | null;
  completed_at: Date | string | null;
  diagnostic_set_version: string;
  updated_at: Date | string;
}

interface SelfAssessmentRow {
  course_id: OnboardingSelfAssessment["course_id"];
  level: OnboardingSelfAssessment["level"];
}

interface ProfileRow {
  profile_payload: unknown;
}

interface PlanRow {
  plan_id: string;
  version: number;
  source: "deterministic_fallback";
  ai_status: "unavailable";
  ai_status_message: string;
  start_date: Date | string;
  daily_minutes: number;
  today_task_id: string;
  generated_at: Date | string;
}

interface PlanTaskRow {
  task_id: string;
  day_index: number;
  task_date: Date | string;
  task_order: number;
  course_id: OnboardingSelfAssessment["course_id"];
  course_title: string;
  concept_id: string | null;
  concept_title: string | null;
  task_type: OnboardingLearningTask["task_type"];
  estimated_minutes: number;
  title: string;
  reason: string;
  completion_criteria: string;
  href: string;
  evidence_refs: unknown;
  status: "pending" | "completed";
}

interface CourseResourceRow {
  course_id: OnboardingSelfAssessment["course_id"];
  course_title: string;
  question_subject: string;
  course_slug: string;
  concept_id: string;
  concept_title: string;
  practice_question_count: number | string;
}

interface DiagnosticQuestionRow {
  ordinal: number | string;
  course_id: OnboardingSelfAssessment["course_id"];
  course_title: string;
  question_id: string;
  year: number | string | null;
  number: number | string;
  subject: string;
  question_type: "choice" | "subjective";
  multiple: boolean;
  question_text: string;
  options: unknown;
  tags: unknown;
  assets: unknown;
  source_provider: string;
  dataset_id: string;
  source_url: string;
  license_status: "unverified" | "verified" | "restricted";
  usage_scope: "local_demo_only" | "authorized_product_use";
  answer_key?: unknown;
  response_status?: "answered" | "unsure" | "skipped" | null;
  selected_option_ids?: unknown;
}

interface DiagnosticSummaryRow {
  saved_count: number | string;
  completed_at: Date | string | null;
}

interface ScreeningEvidenceRow {
  course_id: OnboardingSelfAssessment["course_id"];
  question_id: string;
  response_status: "answered" | "unsure" | "skipped";
  is_correct: boolean | null;
  concept_id: string;
  concept_title: string;
  practice_question_count: number | string;
}

interface ServiceOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asDateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function stringArray(value: unknown): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function jsonArray(value: unknown): unknown[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed : [];
}

function publicQuestion(row: DiagnosticQuestionRow) {
  return questionDtoSchema.parse({
    id: row.question_id,
    year: row.year === null ? null : Number(row.year),
    number: Number(row.number),
    subject: row.subject,
    type: row.question_type,
    multiple: row.multiple,
    question: row.question_text,
    options: jsonArray(row.options),
    tags: stringArray(row.tags),
    assets: jsonArray(row.assets).filter((asset) => (
      asset && typeof asset === "object" && Reflect.get(asset, "role") === "question"
    )),
    content_format: "plain_text",
    source: {
      provider: row.source_provider,
      dataset_id: row.dataset_id,
      source_url: row.source_url,
      license_status: row.license_status,
      usage_scope: row.usage_scope,
    },
  });
}

const LEGACY_COURSE_TITLES: Record<OnboardingSelfAssessment["course_id"], string> = {
  course_408_ds: "数据结构",
  course_408_co: "计算机组成原理",
  course_408_os: "操作系统",
  course_408_cn: "计算机网络",
};

const LEGACY_SELF_ASSESSMENT_LABELS: Record<OnboardingSelfAssessmentLevel, string> = {
  not_started: "尚未开始",
  weak: "基础较弱",
  average: "有一定基础",
  good: "基础较好",
  reinforcing: "正在强化",
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isSelfAssessmentLevel(value: unknown): value is OnboardingSelfAssessmentLevel {
  return ["not_started", "weak", "average", "good", "reinforcing"].includes(String(value));
}

function normalizeStoredInitialProfile(
  value: unknown,
  selfAssessments: OnboardingSelfAssessment[],
): OnboardingInitialProfile {
  const current = onboardingInitialProfileSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = objectValue(value);
  const legacyPriorities = Array.isArray(legacy?.priority_courses)
    ? legacy.priority_courses.map(objectValue).filter((item): item is Record<string, unknown> => item !== null)
    : [];
  const assessmentByCourse = new Map(selfAssessments.map((item) => [item.course_id, item.level]));
  const priorityByCourse = new Map(
    legacyPriorities
      .filter((item) => ONBOARDING_COURSE_IDS.includes(item.course_id as OnboardingSelfAssessment["course_id"]))
      .map((item) => [item.course_id as OnboardingSelfAssessment["course_id"], item]),
  );

  return onboardingInitialProfileSchema.parse({
    profile_id: typeof legacy?.profile_id === "string" ? legacy.profile_id : "legacy_onboarding_profile",
    version: typeof legacy?.version === "number" && legacy.version > 0 ? legacy.version : 1,
    confidence: "low",
    evidence_status: "accumulating",
    confidence_explanation: "历史首次设置已按当前规则恢复；目前只保留课程自评作为起步依据，客观学习证据正在积累。",
    generated_at: typeof legacy?.generated_at === "string"
      ? legacy.generated_at
      : new Date(0).toISOString(),
    objective_evidence_count: 0,
    subjective_evidence_count: Math.min(selfAssessments.length, ONBOARDING_COURSE_IDS.length),
    priority_courses: ONBOARDING_COURSE_IDS.map((courseId, index) => {
      const stored = priorityByCourse.get(courseId);
      const storedAssessment = stored?.self_assessment;
      const selfAssessment = assessmentByCourse.get(courseId)
        ?? (isSelfAssessmentLevel(storedAssessment) ? storedAssessment : "not_started");
      const storedPriority = stored?.priority;
      const priority = storedPriority === "focus" || storedPriority === "strengthen" || storedPriority === "maintain"
        ? storedPriority
        : index === 0 ? "focus" : index === 1 ? "strengthen" : "maintain";
      return {
        course_id: courseId,
        course_title: typeof stored?.course_title === "string"
          ? stored.course_title
          : LEGACY_COURSE_TITLES[courseId],
        priority,
        self_assessment: selfAssessment,
        evidence_level: "self_report_only" as const,
        evidence_refs: [`self:${courseId}`],
        rationale: `你将本课程标记为“${LEGACY_SELF_ASSESSMENT_LABELS[selfAssessment]}”，当前仅据此安排起步顺序。`,
      };
    }),
    boundary_note: "初始学习方向不是能力测评，不代表分数、排名、录取概率或提分效果。",
  });
}

function containsLegacyDiagnosticText(value: string): boolean {
  return /diagnostic|诊断|答错|正确率|能力分/iu.test(value);
}

export class PostgresStudentOnboarding implements StudentOnboardingService {
  readonly #now: () => Date;
  readonly #createId: (prefix: string) => string;

  constructor(
    private readonly pool: SqlQueryablePool,
    options: ServiceOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  async getState(userId: string): Promise<OnboardingState> {
    await this.#ensureState(this.pool, userId);
    return this.#loadState(this.pool, userId);
  }

  async getDiagnosticQuestions(userId: string): Promise<OnboardingDiagnosticQuestionSetResponse> {
    await this.#ensureState(this.pool, userId);
    const state = await this.#readState(this.pool, userId);
    if (!this.#hasGoals(state)) {
      throw new StudentOnboardingError(
        "ONBOARDING_GOALS_REQUIRED",
        "请先保存考研目标和每日可用时间。",
        409,
      );
    }
    const selfAssessments = await this.#loadSelfAssessments(this.pool, userId);
    if (selfAssessments.length !== ONBOARDING_COURSE_IDS.length) {
      throw new StudentOnboardingError(
        "ONBOARDING_SELF_ASSESSMENTS_REQUIRED",
        "请先完成四门课程的基础自评。",
        409,
      );
    }
    const rows = await this.#loadDiagnosticQuestions(this.pool, userId, state.diagnostic_set_version);
    if (rows.length !== 8) {
      throw new StudentOnboardingError(
        "ONBOARDING_DIAGNOSTIC_UNAVAILABLE",
        "起步筛查题组暂不可用，请稍后重试。",
        503,
        true,
      );
    }
    const summary = await this.#loadDiagnosticSummary(
      this.pool,
      userId,
      state.diagnostic_set_version,
    );
    return onboardingDiagnosticQuestionSetResponseSchema.parse({
      set_version: state.diagnostic_set_version,
      summary,
      items: rows.map((row) => ({
        ordinal: Number(row.ordinal),
        course_id: row.course_id,
        course_title: row.course_title,
        response_status: row.response_status ?? null,
        selected_option_ids: stringArray(row.selected_option_ids),
        question: publicQuestion(row),
      })),
    });
  }

  async saveDiagnosticAnswer(
    userId: string,
    answer: OnboardingDiagnosticAnswer,
  ): Promise<OnboardingState> {
    return withTransaction(this.pool, async (client) => {
      await this.#ensureState(client, userId);
      const state = await this.#lockState(client, userId);
      if (state.status === "completed") return this.#loadState(client, userId);
      if (!this.#hasGoals(state)) {
        throw new StudentOnboardingError(
          "ONBOARDING_GOALS_REQUIRED",
          "请先保存考研目标和每日可用时间。",
          409,
        );
      }
      const selfAssessments = await this.#loadSelfAssessments(client, userId);
      if (
        selfAssessments.length !== ONBOARDING_COURSE_IDS.length
        || ONBOARDING_COURSE_IDS.some((courseId) => !selfAssessments.some((item) => item.course_id === courseId))
      ) {
        throw new StudentOnboardingError(
          "ONBOARDING_SELF_ASSESSMENTS_REQUIRED",
          "请先完成四门课程的基础自评。",
          409,
        );
      }
      const questionResult = await client.query<DiagnosticQuestionRow>(
        `SELECT diagnostic.ordinal, diagnostic.course_id, course.title AS course_title,
                q.question_id, q.year, q.number, q.subject, q.question_type,
                q.multiple, q.question_text, q.options, q.tags, q.assets,
                batch.source_provider, batch.dataset_id, q.source_url,
                q.license_status, q.usage_scope
         FROM onboarding_diagnostic_questions diagnostic
         JOIN questions q ON q.question_id = diagnostic.question_id
         JOIN question_learning_metadata learning ON learning.question_id = q.question_id
         JOIN question_import_batches batch ON batch.import_batch_id = q.import_batch_id
         JOIN courses course ON course.course_id = diagnostic.course_id
         WHERE diagnostic.set_version = $1
           AND diagnostic.question_id = $2
           AND diagnostic.active = true
           AND q.review_status = 'approved'
           AND learning.content_review_status = 'teacher_verified'
           AND ${studentQuestionExposureSqlForAliases("q", "learning")}
         LIMIT 1`,
        [state.diagnostic_set_version, answer.question_id],
      );
      const question = questionResult.rows[0];
      if (!question) {
        throw new StudentOnboardingError(
          "ONBOARDING_DIAGNOSTIC_QUESTION_NOT_FOUND",
          "起步筛查题目不存在或已下线。",
          404,
        );
      }
      const validOptionIds = new Set(
        jsonArray(question.options).flatMap((option) => (
          option && typeof option === "object" && typeof Reflect.get(option, "option_id") === "string"
            ? [Reflect.get(option, "option_id") as string]
            : []
        )),
      );
      if (answer.selected_option_ids.some((optionId) => !validOptionIds.has(optionId))) {
        throw new StudentOnboardingError(
          "ONBOARDING_DIAGNOSTIC_OPTION_INVALID",
          "所选答案不属于当前题目。",
          400,
        );
      }
      const timestamp = this.#now();
      await client.query(
        `INSERT INTO student_onboarding_diagnostic_answers(
           user_id, set_version, question_id, response_status,
           selected_option_ids, is_correct, evaluated_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,NULL,NULL,$6,$6)
         ON CONFLICT (user_id, set_version, question_id) DO UPDATE SET
           response_status = EXCLUDED.response_status,
           selected_option_ids = EXCLUDED.selected_option_ids,
           is_correct = NULL,
           evaluated_at = NULL,
           updated_at = EXCLUDED.updated_at`,
        [
          userId,
          state.diagnostic_set_version,
          answer.question_id,
          answer.response_status,
          JSON.stringify(answer.selected_option_ids),
          timestamp,
        ],
      );
      await client.query(
        `UPDATE student_onboarding_states
         SET status = 'in_progress', current_step = 'diagnostic', updated_at = $2
         WHERE user_id = $1`,
        [userId, timestamp],
      );
      return this.#loadState(client, userId);
    });
  }

  async completeDiagnostic(userId: string): Promise<OnboardingState> {
    return withTransaction(this.pool, async (client) => {
      await this.#ensureState(client, userId);
      const state = await this.#lockState(client, userId);
      if (state.status === "completed") return this.#loadState(client, userId);
      if (!this.#hasGoals(state)) {
        throw new StudentOnboardingError(
          "ONBOARDING_GOALS_REQUIRED",
          "请先完成目标设置。",
          409,
        );
      }
      const selfAssessments = await this.#loadSelfAssessments(client, userId);
      if (
        selfAssessments.length !== ONBOARDING_COURSE_IDS.length
        || ONBOARDING_COURSE_IDS.some((courseId) => !selfAssessments.some((item) => item.course_id === courseId))
      ) {
        throw new StudentOnboardingError(
          "ONBOARDING_SELF_ASSESSMENTS_REQUIRED",
          "请先完成四门课程的基础自评。",
          409,
        );
      }
      const rows = await this.#loadDiagnosticQuestions(
        client,
        userId,
        state.diagnostic_set_version,
        true,
      );
      if (rows.length !== 8 || rows.some((row) => !row.response_status)) {
        throw new StudentOnboardingError(
          "ONBOARDING_DIAGNOSTIC_INCOMPLETE",
          "请先完成 8 道起步筛查题；不确定或跳过也需要明确选择。",
          409,
        );
      }
      const timestamp = this.#now();
      for (const row of rows) {
        const selected = stringArray(row.selected_option_ids).sort((left, right) => left.localeCompare(right));
        const correct = stringArray(row.answer_key).sort((left, right) => left.localeCompare(right));
        const isCorrect = row.response_status === "answered"
          ? selected.length === correct.length && selected.every((value, index) => value === correct[index])
          : null;
        await client.query(
          `UPDATE student_onboarding_diagnostic_answers
           SET is_correct = $4, evaluated_at = $5, updated_at = $5
           WHERE user_id = $1 AND set_version = $2 AND question_id = $3`,
          [userId, state.diagnostic_set_version, row.question_id, isCorrect, timestamp],
        );
      }
      return this.#persistCompletedSetup(client, userId, state, selfAssessments, timestamp);
    });
  }

  async saveGoals(userId: string, goals: OnboardingGoalInput): Promise<OnboardingState> {
    return withTransaction(this.pool, async (client) => {
      await this.#ensureState(client, userId);
      await client.query(
        `UPDATE student_onboarding_states
         SET status = 'in_progress', current_step = 'self_assessment',
             target_exam_year = $2, preparation_stage = $3, daily_minutes = $4,
             target_school = $5, target_score = $6,
             started_at = COALESCE(started_at, $7), updated_at = $7
         WHERE user_id = $1`,
        [
          userId,
          goals.target_exam_year,
          goals.preparation_stage,
          goals.daily_minutes,
          goals.target_school ?? null,
          goals.target_score ?? null,
          this.#now(),
        ],
      );
      return this.#loadState(client, userId);
    });
  }

  async saveSelfAssessments(
    userId: string,
    update: OnboardingSelfAssessmentsUpdate,
  ): Promise<OnboardingState> {
    return withTransaction(this.pool, async (client) => {
      await this.#ensureState(client, userId);
      const locked = await this.#lockState(client, userId);
      if (!this.#hasGoals(locked)) {
        throw new StudentOnboardingError(
          "ONBOARDING_GOALS_REQUIRED",
          "请先保存考研目标和每日可用时间。",
          409,
        );
      }
      if (locked.status === "completed") return this.#loadState(client, userId);

      const timestamp = this.#now();
      for (const item of update.items) {
        await client.query(
          `INSERT INTO student_onboarding_self_assessments(
             user_id, course_id, level, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$4)
           ON CONFLICT (user_id, course_id) DO UPDATE SET
             level = EXCLUDED.level,
             updated_at = EXCLUDED.updated_at`,
          [userId, item.course_id, item.level, timestamp],
        );
      }
      if (locked.completed_at) {
        // Revising preferences reuses existing evidence; a retired screening set
        // must not send a learner who already finished setup back into onboarding.
        return this.#persistCompletedSetup(client, userId, locked, update.items, timestamp);
      }
      await client.query(
        `UPDATE student_onboarding_states
         SET status = 'in_progress', current_step = 'diagnostic', updated_at = $2
         WHERE user_id = $1 AND status <> 'completed'`,
        [userId, timestamp],
      );
      return this.#loadState(client, userId);
    });
  }

  async completeSetup(userId: string): Promise<OnboardingState> {
    return withTransaction(this.pool, async (client) => {
      await this.#ensureState(client, userId);
      const state = await this.#lockState(client, userId);
      if (state.status === "completed") {
        const existing = await this.#loadState(client, userId);
        if (
          existing.goals
          && existing.profile
          && existing.plan
          && existing.plan.tasks.length > 0
        ) {
          return existing;
        }
      }
      if (!this.#hasGoals(state)) {
        throw new StudentOnboardingError(
          "ONBOARDING_GOALS_REQUIRED",
          "请先完成目标设置。",
          409,
        );
      }

      const selfAssessments = await this.#loadSelfAssessments(client, userId);
      if (
        selfAssessments.length !== ONBOARDING_COURSE_IDS.length
        || ONBOARDING_COURSE_IDS.some((courseId) => !selfAssessments.some((item) => item.course_id === courseId))
      ) {
        throw new StudentOnboardingError(
          "ONBOARDING_SELF_ASSESSMENTS_INCOMPLETE",
          "请先完成四门课程的基础自评。",
          409,
        );
      }

      if (state.status !== "completed" && state.current_step !== "profile") {
        // Recheck availability on the server when the student chooses to
        // continue. Connection failures and incomplete available sets are not
        // treated as completed diagnostic evidence.
        const questions = state.current_step === "diagnostic"
          ? await this.#loadDiagnosticQuestions(client, userId, state.diagnostic_set_version)
          : null;
        if (!questions || questions.length === 8) {
          throw new StudentOnboardingError(
            "ONBOARDING_DIAGNOSTIC_REQUIRED",
            "请先完成 8 道起步筛查题。",
            409,
          );
        }
      }

      return this.#persistCompletedSetup(
        client,
        userId,
        state,
        selfAssessments,
        this.#now(),
      );
    });
  }

  async #persistCompletedSetup(
    client: SqlClient,
    userId: string,
    state: OnboardingStateRow & {
      target_exam_year: number;
      preparation_stage: NonNullable<OnboardingStateRow["preparation_stage"]>;
      daily_minutes: number;
    },
    selfAssessments: OnboardingSelfAssessment[],
    timestamp: Date,
  ): Promise<OnboardingState> {
    const resources = await this.#loadCourseResources(client);
    if (
      resources.length !== ONBOARDING_COURSE_IDS.length
      || ONBOARDING_COURSE_IDS.some((courseId) => !resources.some((resource) => resource.courseId === courseId))
    ) {
      throw new StudentOnboardingError(
        "ONBOARDING_COURSE_CONTEXT_UNAVAILABLE",
        "课程入口或知识点上下文暂不可用。",
        503,
        true,
      );
    }
    const screening = state.diagnostic_set_version
      ? await this.#loadScreeningEvidence(client, userId, state.diagnostic_set_version)
      : [];
    const profileVersionResult = await client.query<{ next_version: number | string }>(
      `SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version
       FROM student_initial_profile_versions WHERE user_id = $1`,
      [userId],
    );
    const planVersionResult = await client.query<{ next_version: number | string }>(
      `SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version
       FROM student_learning_plan_versions WHERE user_id = $1`,
      [userId],
    );
    const goals: OnboardingGoals = {
      target_exam_year: state.target_exam_year,
      preparation_stage: state.preparation_stage,
      daily_minutes: state.daily_minutes,
      target_school: state.target_school,
      target_score: state.target_score,
      saved_at: asIso(state.updated_at),
    };
    const generated = buildDeterministicOnboardingResult({
      goals,
      selfAssessments,
      resources,
      profileVersion: Number(profileVersionResult.rows[0]?.next_version ?? 1),
      planVersion: Number(planVersionResult.rows[0]?.next_version ?? 1),
      now: timestamp,
      createId: this.#createId,
      ...(screening.length > 0 ? { screening } : {}),
    });

    await client.query(
      `INSERT INTO student_initial_profile_versions(
         profile_id, user_id, version, confidence, profile_payload, generated_at, created_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$6)`,
      [
        generated.profile.profile_id,
        userId,
        generated.profile.version,
        generated.profile.confidence,
        JSON.stringify(generated.profile),
        timestamp,
      ],
    );
    await client.query(
      `UPDATE student_learning_plan_versions
       SET status = 'superseded', superseded_at = $2
       WHERE user_id = $1 AND status = 'active'`,
      [userId, timestamp],
    );
    await client.query(
      `INSERT INTO student_learning_plan_versions(
         plan_id, user_id, version, source, ai_status, ai_status_message,
         start_date, daily_minutes, today_task_id, status, generated_at, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10)`,
      [
        generated.plan.plan_id,
        userId,
        generated.plan.version,
        generated.plan.source,
        generated.plan.ai_status,
        generated.plan.ai_status_message,
        generated.plan.start_date,
        generated.plan.daily_minutes,
        generated.plan.today_task_id,
        timestamp,
      ],
    );
    for (const task of generated.plan.tasks) {
      await client.query(
        `INSERT INTO student_learning_plan_tasks(
           task_id, plan_id, day_index, task_date, task_order,
           course_id, concept_id, task_type, estimated_minutes,
           title, reason, completion_criteria, href, evidence_refs,
           status, completed_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,NULL,$16,$16)`,
        [
          task.task_id,
          generated.plan.plan_id,
          task.day_index,
          task.task_date,
          task.order,
          task.course_id,
          task.concept_id,
          task.task_type,
          task.estimated_minutes,
          task.title,
          task.reason,
          task.completion_criteria,
          task.href,
          JSON.stringify(task.evidence_refs),
          task.status,
          timestamp,
        ],
      );
    }
    await client.query(
      `UPDATE student_onboarding_states
       SET status = 'completed', current_step = 'plan',
           completed_at = $2, updated_at = $2
       WHERE user_id = $1`,
      [userId, timestamp],
    );

    return onboardingStateSchema.parse({
      status: "completed",
      current_step: "plan",
      goals,
      self_assessments: selfAssessments,
      profile: generated.profile,
      plan: generated.plan,
      updated_at: timestamp.toISOString(),
    });
  }

  async #ensureState(queryable: Queryable, userId: string): Promise<void> {
    await queryable.query(
      `INSERT INTO student_onboarding_states(
         user_id, status, current_step, diagnostic_set_version, created_at, updated_at
       ) VALUES ($1,'not_started','goals',$3,$2,$2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, this.#now(), ONBOARDING_DIAGNOSTIC_SET_VERSION],
    );
  }

  async #readState(queryable: Queryable, userId: string): Promise<OnboardingStateRow> {
    const result = await queryable.query<OnboardingStateRow>(
      `SELECT status, current_step, target_exam_year, preparation_stage,
              daily_minutes, target_school, target_score, completed_at,
              diagnostic_set_version, updated_at
       FROM student_onboarding_states
       WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new StudentOnboardingError("ONBOARDING_STATE_NOT_FOUND", "入门状态不存在。", 404);
    }
    return row;
  }

  async #loadDiagnosticQuestions(
    queryable: Queryable,
    userId: string,
    setVersion: string,
    includeAnswerKey = false,
  ): Promise<DiagnosticQuestionRow[]> {
    const answerColumns = includeAnswerKey
      ? ", q.answer_key"
      : "";
    const result = await queryable.query<DiagnosticQuestionRow>(
      `SELECT diagnostic.ordinal, diagnostic.course_id, course.title AS course_title,
              q.question_id, q.year, q.number, q.subject, q.question_type,
              q.multiple, q.question_text, q.options, q.tags, q.assets,
              batch.source_provider, batch.dataset_id, q.source_url,
              q.license_status, q.usage_scope${answerColumns},
              answer.response_status, answer.selected_option_ids
       FROM onboarding_diagnostic_questions diagnostic
       JOIN questions q ON q.question_id = diagnostic.question_id
       JOIN question_learning_metadata learning ON learning.question_id = q.question_id
       JOIN question_import_batches batch ON batch.import_batch_id = q.import_batch_id
       JOIN courses course ON course.course_id = diagnostic.course_id
       LEFT JOIN student_onboarding_diagnostic_answers answer
         ON answer.user_id = $1
        AND answer.set_version = diagnostic.set_version
        AND answer.question_id = diagnostic.question_id
       WHERE diagnostic.set_version = $2
         AND diagnostic.active = true
         AND q.review_status = 'approved'
         AND learning.content_review_status = 'teacher_verified'
         AND ${studentQuestionExposureSqlForAliases("q", "learning")}
       ORDER BY diagnostic.ordinal`,
      [userId, setVersion],
    );
    return result.rows;
  }

  async #loadDiagnosticSummary(
    queryable: Queryable,
    userId: string,
    setVersion: string,
  ) {
    const result = await queryable.query<DiagnosticSummaryRow>(
      `SELECT COUNT(*)::int AS saved_count,
              CASE WHEN COUNT(*) = 8
                    AND COUNT(*) FILTER (WHERE evaluated_at IS NOT NULL) = 8
                   THEN MAX(evaluated_at)
                   ELSE NULL
              END AS completed_at
       FROM student_onboarding_diagnostic_answers
       WHERE user_id = $1 AND set_version = $2`,
      [userId, setVersion],
    );
    const row = result.rows[0];
    return {
      total_count: 8 as const,
      saved_count: Number(row?.saved_count ?? 0),
      completed_at: row?.completed_at ? asIso(row.completed_at) : null,
    };
  }

  async #loadScreeningEvidence(
    queryable: Queryable,
    userId: string,
    setVersion: string,
  ): Promise<OnboardingScreeningEvidence[]> {
    const result = await queryable.query<ScreeningEvidenceRow>(
      `SELECT diagnostic.course_id,
              answer.question_id, answer.response_status, answer.is_correct,
              diagnostic.concept_id, concept.title AS concept_title,
              COUNT(practice_learning.question_id)::int AS practice_question_count
       FROM student_onboarding_diagnostic_answers answer
       JOIN onboarding_diagnostic_questions diagnostic
         ON diagnostic.set_version = answer.set_version
        AND diagnostic.question_id = answer.question_id
        AND diagnostic.active = true
       JOIN questions q ON q.question_id = answer.question_id
       JOIN question_learning_metadata learning ON learning.question_id = q.question_id
       JOIN course_core_concepts concept ON concept.concept_id = diagnostic.concept_id
       LEFT JOIN course_concept_question_links link
         ON link.concept_id = concept.concept_id
        AND link.status = 'active'
       LEFT JOIN questions practice_question
         ON practice_question.question_id = link.question_id
        AND practice_question.review_status = 'approved'
       LEFT JOIN question_learning_metadata practice_learning
         ON practice_learning.question_id = practice_question.question_id
        AND practice_learning.content_review_status = 'teacher_verified'
        AND 'targeted' = ANY(practice_learning.allowed_modes)
        AND practice_learning.source_type <> 'self_authored_screening'
        AND practice_learning.protect_full_paper = false
        AND ${studentQuestionExposureSqlForAliases("practice_question", "practice_learning")}
       WHERE answer.user_id = $1
         AND answer.set_version = $2
         AND answer.evaluated_at IS NOT NULL
         AND q.review_status = 'approved'
         AND learning.content_review_status = 'teacher_verified'
       GROUP BY diagnostic.ordinal, diagnostic.course_id,
                answer.question_id, answer.response_status, answer.is_correct,
                diagnostic.concept_id, concept.title
       ORDER BY diagnostic.ordinal`,
      [userId, setVersion],
    );
    if (result.rows.length !== 8) return [];

    const byCourse = new Map<OnboardingCourseId, OnboardingScreeningEvidence>();
    for (const courseId of ONBOARDING_COURSE_IDS) {
      byCourse.set(courseId, {
        courseId,
        answeredCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        unsureCount: 0,
        skippedCount: 0,
        riskConcepts: [],
      });
    }
    for (const row of result.rows) {
      const item = byCourse.get(row.course_id);
      if (!item) continue;
      if (row.response_status === "answered") {
        item.answeredCount += 1;
        if (row.is_correct === true) item.correctCount += 1;
        if (row.is_correct === false) {
          item.incorrectCount += 1;
          item.riskConcepts.push({
            conceptId: row.concept_id,
            conceptTitle: row.concept_title,
            questionId: row.question_id,
            practiceQuestionCount: Number(row.practice_question_count),
          });
        }
      } else if (row.response_status === "unsure") {
        item.unsureCount += 1;
      } else {
        item.skippedCount += 1;
      }
    }
    return ONBOARDING_COURSE_IDS.map((courseId) => byCourse.get(courseId)!);
  }

  async #lockState(queryable: Queryable, userId: string): Promise<OnboardingStateRow> {
    const result = await queryable.query<OnboardingStateRow>(
      `SELECT status, current_step, target_exam_year, preparation_stage,
              daily_minutes, target_school, target_score, completed_at,
              diagnostic_set_version, updated_at
       FROM student_onboarding_states
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new StudentOnboardingError("ONBOARDING_STATE_NOT_FOUND", "入门状态不存在。", 404);
    }
    return row;
  }

  #hasGoals(row: OnboardingStateRow): row is OnboardingStateRow & {
    target_exam_year: number;
    preparation_stage: NonNullable<OnboardingStateRow["preparation_stage"]>;
    daily_minutes: number;
  } {
    return row.target_exam_year !== null
      && row.preparation_stage !== null
      && row.daily_minutes !== null;
  }

  async #loadSelfAssessments(queryable: Queryable, userId: string): Promise<OnboardingSelfAssessment[]> {
    const result = await queryable.query<SelfAssessmentRow>(
      `SELECT course_id, level
       FROM student_onboarding_self_assessments
       WHERE user_id = $1
       ORDER BY CASE course_id
         WHEN 'course_408_ds' THEN 1 WHEN 'course_408_co' THEN 2
         WHEN 'course_408_os' THEN 3 WHEN 'course_408_cn' THEN 4 END`,
      [userId],
    );
    return result.rows.map((row) => ({ course_id: row.course_id, level: row.level }));
  }

  async #loadState(queryable: Queryable, userId: string): Promise<OnboardingState> {
    const stateResult = await queryable.query<OnboardingStateRow>(
      `SELECT status, current_step, target_exam_year, preparation_stage,
              daily_minutes, target_school, target_score, completed_at,
              diagnostic_set_version, updated_at
       FROM student_onboarding_states
       WHERE user_id = $1`,
      [userId],
    );
    const row = stateResult.rows[0];
    if (!row) {
      throw new StudentOnboardingError("ONBOARDING_STATE_NOT_FOUND", "入门状态不存在。", 404);
    }
    const selfAssessments = await this.#loadSelfAssessments(queryable, userId);
    const profileResult = await queryable.query<ProfileRow>(
      `SELECT profile_payload
       FROM student_initial_profile_versions
       WHERE user_id = $1
       ORDER BY version DESC LIMIT 1`,
      [userId],
    );
    const planResult = await queryable.query<PlanRow>(
      `SELECT plan_id, version, source, ai_status, ai_status_message,
              start_date, daily_minutes, today_task_id, generated_at
       FROM student_learning_plan_versions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY version DESC LIMIT 1`,
      [userId],
    );
    const profile = profileResult.rows[0]
      ? normalizeStoredInitialProfile(profileResult.rows[0].profile_payload, selfAssessments)
      : null;
    const plan = planResult.rows[0]
      ? await this.#loadPlan(queryable, planResult.rows[0])
      : null;
    return onboardingStateSchema.parse({
      status: row.status,
      current_step: row.current_step,
      goals: this.#hasGoals(row)
        ? {
            target_exam_year: row.target_exam_year,
            preparation_stage: row.preparation_stage,
            daily_minutes: row.daily_minutes,
            target_school: row.target_school,
            target_score: row.target_score,
            saved_at: asIso(row.updated_at),
          }
        : null,
      self_assessments: selfAssessments,
      profile,
      plan,
      updated_at: asIso(row.updated_at),
    });
  }

  async #loadPlan(queryable: Queryable, row: PlanRow): Promise<OnboardingLearningPlan> {
    const tasks = await queryable.query<PlanTaskRow>(
      `SELECT task.task_id, task.day_index, task.task_date, task.task_order,
              task.course_id, course.title AS course_title,
              task.concept_id, concept.title AS concept_title,
              task.task_type, task.estimated_minutes, task.title, task.reason,
              task.completion_criteria, task.href, task.evidence_refs,
              task.status
       FROM student_learning_plan_tasks task
       JOIN courses course ON course.course_id = task.course_id
       LEFT JOIN course_core_concepts concept ON concept.concept_id = task.concept_id
       WHERE task.plan_id = $1
       ORDER BY task.day_index, task.task_order`,
      [row.plan_id],
    );
    const mappedTasks = tasks.rows.map((task) => {
      const evidenceRefs = stringArray(task.evidence_refs)
        .filter((reference) => (
          reference.startsWith("self:") || reference.startsWith("screening:")
        ));
      return {
        task_id: task.task_id,
        day_index: Number(task.day_index),
        task_date: asDateOnly(task.task_date),
        order: Number(task.task_order),
        course_id: task.course_id,
        course_title: task.course_title,
        concept_id: task.concept_id,
        concept_title: task.concept_title,
        task_type: task.task_type,
        estimated_minutes: Number(task.estimated_minutes),
        title: containsLegacyDiagnosticText(task.title)
          ? `学习：${task.concept_title ?? task.course_title}`
          : task.title,
        reason: containsLegacyDiagnosticText(task.reason)
          ? `根据你的学习设置与课程自评，先建立“${task.concept_title ?? task.course_title}”的基础理解。`
          : task.reason,
        completion_criteria: containsLegacyDiagnosticText(task.completion_criteria)
          ? "完成课程讲解中的首段阅读或一次可靠选择题训练。"
          : task.completion_criteria,
        href: task.href,
        evidence_refs: evidenceRefs.length > 0
          ? evidenceRefs
          : [`self:${task.course_id}`],
        status: task.status,
      };
    });
    return onboardingLearningPlanSchema.parse({
      plan_id: row.plan_id,
      version: Number(row.version),
      source: row.source,
      ai_status: row.ai_status,
      ai_status_message: containsLegacyDiagnosticText(row.ai_status_message)
        ? "AI 个性化编排尚未接入，当前路径按学习设置、课程结构和时间约束恢复。"
        : row.ai_status_message,
      start_date: asDateOnly(row.start_date),
      daily_minutes: Number(row.daily_minutes),
      generated_at: asIso(row.generated_at),
      today_task_id: row.today_task_id,
      tasks: mappedTasks,
    });
  }

  async #loadCourseResources(
    queryable: Queryable,
  ): Promise<OnboardingCourseResource[]> {
    const result = await queryable.query<CourseResourceRow>(
      `SELECT catalog.course_id, course.title AS course_title,
              catalog.question_subject, catalog.slug AS course_slug,
              selected.concept_id, selected.concept_title,
              COUNT(practice_learning.question_id)::int AS practice_question_count
       FROM course_catalog_entries catalog
       JOIN courses course ON course.course_id = catalog.course_id
       JOIN LATERAL (
         SELECT concept.concept_id, concept.title AS concept_title
         FROM course_core_concepts concept
         JOIN course_learning_modules module ON module.module_id = concept.module_id
         WHERE concept.course_id = catalog.course_id
           AND concept.review_status = 'verified'
         ORDER BY CASE concept.importance WHEN 'core' THEN 1 ELSE 2 END,
                  module.chapter_ordinal, module.ordinal, concept.ordinal
         LIMIT 1
       ) selected ON true
       LEFT JOIN course_concept_question_links link
         ON link.concept_id = selected.concept_id
        AND link.status = 'active'
       LEFT JOIN questions practice_question
         ON practice_question.question_id = link.question_id
        AND practice_question.review_status = 'approved'
       LEFT JOIN question_learning_metadata practice_learning
         ON practice_learning.question_id = practice_question.question_id
        AND practice_learning.content_review_status = 'teacher_verified'
        AND 'targeted' = ANY(practice_learning.allowed_modes)
        AND practice_learning.source_type <> 'self_authored_screening'
        AND practice_learning.protect_full_paper = false
        AND (
          (
            practice_question.usage_scope = 'authorized_product_use'
            AND practice_question.license_status = 'verified'
          )
          OR practice_learning.source_type = 'self_authored_practice'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(practice_question.assets) AS required_asset
          WHERE required_asset->>'role' IN ('question', 'option')
        )
       WHERE catalog.course_id = ANY($1::text[])
       GROUP BY catalog.course_id, course.title, catalog.question_subject,
                catalog.slug, selected.concept_id, selected.concept_title
       ORDER BY catalog.display_order`,
      [ONBOARDING_COURSE_IDS],
    );
    return result.rows.map((row) => ({
      courseId: row.course_id,
      courseTitle: row.course_title,
      subject: row.question_subject,
      courseHref: `/student/courses/${row.course_slug}`,
      fallbackConcept: {
        conceptId: row.concept_id,
        conceptTitle: row.concept_title,
        practiceQuestionCount: Number(row.practice_question_count),
      },
    }));
  }

}
