import {
  ONBOARDING_COURSE_IDS,
  studentLearningTaskSettlementSchema,
  type OnboardingCourseId,
  type StudentLearningOrchestration,
  type StudentLearningOrchestrationTask,
  type StudentLearningTaskSettlement,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";
import { withTransaction, type SqlClient } from "../../database/client.js";
import type { StudentOnboardingService } from "../onboarding/student-onboarding.js";
import type { ReliableLearningLoopService } from "../question-bank/reliable-learning-loop.js";
import type { MistakeRecommendationService } from "../question-bank/postgres-mistake-recommendation.js";
import type { StudentLearningOrchestrationService } from "./learning-orchestration-service.js";
import {
  LearningTaskCompletionError,
  type StudentLearningTaskActivation,
  type StudentLearningTaskCompletion,
} from "./learning-orchestration-service.js";
import {
  buildStudentLearningOrchestration,
  type LearningOrchestrationCourseResource,
  type LearningOrchestrationPendingProbe,
  type LearningOrchestrationPracticeAttempt,
  type LearningOrchestrationReadingProgress,
} from "./student-learning-orchestration.js";

interface ReadingProgressRow {
  course_id: string;
  concept_id: string;
  chunk_id: string;
  paragraph_index: number | string;
  source_expanded: boolean;
  updated_at: Date | string;
}

interface PracticeAttemptRow {
  attempt_id: string;
  course_id: string;
  concept_id: string | null;
  outcome: "correct" | "incorrect" | "pending_review";
  submitted_at: Date | string;
}

interface CourseResourceRow {
  course_id: string;
  course_title: string;
  course_slug: string;
  question_subject: string;
}

interface CompletedAssignmentRow {
  task_id: string;
  task_type: StudentLearningOrchestrationTask["task_type"];
  course_id: string;
  concept_id: string | null;
  completed_at: Date | string;
  completion_evidence_refs: unknown;
}

interface AssignmentRow {
  assignment_id: string;
  task_id: string;
  task_type: StudentLearningOrchestrationTask["task_type"];
  status: "pending" | "completed" | "superseded";
  activated_at: Date | string;
  completed_at?: Date | string | null;
  course_id: string;
  concept_id: string | null;
  mistake_id: string | null;
  completion_evidence_refs?: unknown;
  completion_settlement?: unknown;
}

interface AssignmentSnapshotRow extends AssignmentRow {
  status: "pending" | "completed" | "superseded";
}

interface PendingProbeRow {
  probe_session_id: string;
  status: "offered" | "started";
  course_id: string;
  concept_id: string;
  concept_title: string;
  source_attempt_id: string;
  created_at: Date | string;
}

interface ServiceOptions {
  now?: () => Date;
  mistakeRecommendation?: MistakeRecommendationService | null;
}

interface ChoiceCompletionEvidence {
  evidenceId: string;
  attemptId: string;
  evaluationId: string;
  questionId: string;
  outcome: "correct" | "incorrect";
  createdAt: string;
  courseWide: boolean;
}

interface CompletionEvidence {
  refs: string[];
  choice: ChoiceCompletionEvidence | null;
}

interface ChoiceEvidenceRow {
  evidence_id: string;
  attempt_id: string;
  evaluation_id: string;
  question_id: string;
  outcome: "correct" | "incorrect";
  created_at: Date | string;
  attributed_concept_id?: string | null;
  has_concept_links?: boolean;
}

interface TaskContextRow {
  course_title: string;
  concept_title: string | null;
}

interface ReviewStateRow {
  mistake_id: string;
  status: "needs_review" | "mastered";
  wrong_count: number | string;
  next_review_at: Date | string | null;
  consecutive_success_count: number | string | null;
}

interface CompletionTransactionResult {
  assignment: AssignmentRow;
  taskId: string;
  completedAt: string;
  evidenceRefs: string[];
  idempotent: boolean;
  choiceEvidence: ChoiceCompletionEvidence | null;
  storedSettlement: StudentLearningTaskSettlement | null;
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isOnboardingCourseId(courseId: string): courseId is OnboardingCourseId {
  return ONBOARDING_COURSE_IDS.includes(courseId as OnboardingCourseId);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function storedSettlement(value: unknown): StudentLearningTaskSettlement | null {
  const parsed = studentLearningTaskSettlementSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function mapChoiceEvidence(row: ChoiceEvidenceRow | undefined): ChoiceCompletionEvidence | null {
  if (!row) return null;
  return {
    evidenceId: row.evidence_id,
    attemptId: row.attempt_id,
    evaluationId: row.evaluation_id,
    questionId: row.question_id,
    outcome: row.outcome,
    createdAt: iso(row.created_at),
    courseWide: row.has_concept_links === false,
  };
}

function settlementNextTask(snapshot: StudentLearningOrchestration, completedTaskId: string) {
  const task = snapshot.current_task.task_id === completedTaskId ? null : snapshot.current_task;
  return task
    ? {
        task_id: task.task_id,
        task_type: task.task_type,
        course_id: task.course_id,
        course_title: task.course_title,
        concept_id: task.concept_id,
        concept_title: task.concept_title,
        title: task.title,
        reason: task.reason,
        estimated_minutes: task.estimated_minutes,
        href: task.href,
      }
    : null;
}

export class PostgresStudentLearningOrchestration
implements StudentLearningOrchestrationService {
  readonly #now: () => Date;
  readonly #mistakeRecommendation: MistakeRecommendationService | null;

  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly onboarding: StudentOnboardingService,
    private readonly learningLoop: ReliableLearningLoopService,
    options: ServiceOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#mistakeRecommendation = options.mistakeRecommendation ?? null;
  }

  async getSnapshot(userId: string) {
    const recommendationResult = this.#mistakeRecommendation
      ? this.#mistakeRecommendation.listRecommendations(userId, { limit: 5 }).catch(() => null)
      : Promise.resolve(null);
    const [onboarding, learningRecord, mistakes, readingResult, attemptsResult, resourcesResult, assignmentsResult, pendingAssignmentResult, pendingProbeResult, recommendations] = await Promise.all([
      this.onboarding.getState(userId),
      this.learningLoop.getLearningRecord(userId),
      this.learningLoop.listMistakes(userId, {}),
      this.pool.query<ReadingProgressRow>(
        `SELECT DISTINCT ON (progress.course_id)
                progress.course_id, source.concept_id, progress.chunk_id,
                progress.paragraph_index, progress.source_expanded, progress.updated_at
         FROM course_reading_progress progress
         JOIN course_concept_sources source ON source.chunk_id = progress.chunk_id
         JOIN course_core_concepts concept
           ON concept.concept_id = source.concept_id
          AND concept.course_id = progress.course_id
         WHERE progress.user_id = $1
         ORDER BY progress.course_id, progress.updated_at DESC,
                  source.ordinal, concept.ordinal`,
        [userId],
      ),
      this.pool.query<PracticeAttemptRow>(
        `SELECT attempt.attempt_id, catalog.course_id, attempt.concept_id,
                evaluation.status AS outcome, attempt.submitted_at
         FROM practice_attempts attempt
         JOIN evaluations evaluation ON evaluation.attempt_id = attempt.attempt_id
         JOIN questions question ON question.question_id = attempt.question_id
         JOIN course_catalog_entries catalog ON catalog.question_subject = question.subject
         WHERE attempt.user_id = $1
         ORDER BY attempt.submitted_at DESC`,
        [userId],
      ),
      this.pool.query<CourseResourceRow>(
        `SELECT catalog.course_id, course.title AS course_title,
                catalog.slug AS course_slug, catalog.question_subject
         FROM course_catalog_entries catalog
         JOIN courses course ON course.course_id = catalog.course_id
         WHERE catalog.course_id = ANY($1::text[])
         ORDER BY catalog.display_order`,
        [ONBOARDING_COURSE_IDS],
      ),
      this.pool.query<CompletedAssignmentRow>(
        `SELECT task_id, task_type, course_id, concept_id, completed_at,
                completion_evidence_refs
         FROM student_learning_task_assignments
         WHERE user_id = $1
           AND status = 'completed'
           AND completed_at IS NOT NULL
           AND task_id NOT LIKE 'probe_%'`,
        [userId],
      ),
       this.pool.query<AssignmentSnapshotRow>(
         `SELECT assignment_id, task_id, task_type, status, activated_at,
                completed_at, course_id, concept_id, mistake_id,
                completion_evidence_refs, completion_settlement
         FROM student_learning_task_assignments
         WHERE user_id = $1
           AND status = 'pending'
           AND task_id NOT LIKE 'probe_%'
         ORDER BY activated_at DESC LIMIT 1`,
         [userId],
       ),
       this.pool.query<PendingProbeRow>(
         `SELECT session.probe_session_id, session.status,
                 session.course_id, session.concept_id,
                 concept.title AS concept_title,
                 session.source_attempt_id, session.created_at
            FROM student_learning_probe_sessions session
            JOIN course_core_concepts concept
              ON concept.concept_id = session.concept_id
             AND concept.course_id = session.course_id
           WHERE session.user_id = $1
             AND session.status IN ('offered', 'started')
           ORDER BY CASE WHEN session.status = 'started' THEN 0 ELSE 1 END,
                    session.updated_at DESC, session.created_at DESC
           LIMIT 1`,
         [userId],
       ),
       recommendationResult,
     ]);

    const readingProgress: LearningOrchestrationReadingProgress[] = readingResult.rows
      .flatMap((row) => isOnboardingCourseId(row.course_id)
        ? [{
            courseId: row.course_id,
            conceptId: row.concept_id,
            chunkId: row.chunk_id,
            paragraphIndex: Number(row.paragraph_index),
            sourceExpanded: row.source_expanded,
            updatedAt: iso(row.updated_at),
          }]
        : []);
    const practiceAttempts: LearningOrchestrationPracticeAttempt[] = attemptsResult.rows
      .flatMap((row) => isOnboardingCourseId(row.course_id)
        ? [{
            attemptId: row.attempt_id,
            courseId: row.course_id,
            conceptId: row.concept_id,
            outcome: row.outcome,
            submittedAt: iso(row.submitted_at),
          }]
        : []);
    const courseResources: LearningOrchestrationCourseResource[] = resourcesResult.rows
      .flatMap((row) => isOnboardingCourseId(row.course_id)
        ? [{
            courseId: row.course_id,
            courseTitle: row.course_title,
            courseSlug: row.course_slug,
            subject: row.question_subject,
          }]
        : []);
    const completedAssignments = assignmentsResult.rows.flatMap((row) => (
      isOnboardingCourseId(row.course_id)
        ? [{
            taskId: row.task_id,
            taskType: row.task_type,
            courseId: row.course_id,
            conceptId: row.concept_id,
            completedAt: iso(row.completed_at),
            completionEvidenceRefs: stringArray(row.completion_evidence_refs),
          }]
        : []
    ));

    const activeAssignment = pendingAssignmentResult.rows[0];
    const pendingProbeRow = pendingProbeResult.rows[0];
    const pendingProbe: LearningOrchestrationPendingProbe | null = pendingProbeRow
      && isOnboardingCourseId(pendingProbeRow.course_id)
      ? {
          probeSessionId: pendingProbeRow.probe_session_id,
          status: pendingProbeRow.status,
          courseId: pendingProbeRow.course_id,
          conceptId: pendingProbeRow.concept_id,
          conceptTitle: pendingProbeRow.concept_title,
          sourceAttemptId: pendingProbeRow.source_attempt_id,
          offeredAt: iso(pendingProbeRow.created_at),
        }
      : null;
    return buildStudentLearningOrchestration({
      onboarding,
      learningRecord,
      mistakes: mistakes.items,
      recommendations: recommendations?.items ?? [],
      readingProgress,
      practiceAttempts,
      courseResources,
      completedTaskIds: completedAssignments.map((assignment) => assignment.taskId),
      completedAssignments,
      activeAssignment: activeAssignment
        ? {
            taskId: activeAssignment.task_id,
            taskType: activeAssignment.task_type,
            courseId: activeAssignment.course_id as OnboardingCourseId,
            conceptId: activeAssignment.concept_id,
            mistakeId: activeAssignment.mistake_id,
            activatedAt: iso(activeAssignment.activated_at),
          }
        : null,
      pendingProbe,
      now: this.#now(),
    });
  }

  async activateTask(userId: string, taskId: string): Promise<StudentLearningTaskActivation> {
    // Resolve the task from the same server-generated snapshot the student saw.
    // The transaction below still owns the assignment row and its idempotency.
    const snapshot = await this.getSnapshot(userId);
    const task = snapshot.current_task.task_id === taskId ? snapshot.current_task : null;
    if (!task) {
      throw new LearningTaskCompletionError("LEARNING_TASK_NOT_FOUND", "当前学习任务不存在或已更新。", 404);
    }
    if (task.source === "probe") {
      throw new LearningTaskCompletionError("LEARNING_TASK_NOT_FOUND", "验证任务请使用专用验证流程。", 404);
    }
    return withTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`xuetu:learning-task:${userId}`],
      );
      const existing = await client.query<AssignmentRow>(
        `SELECT assignment_id, task_id, task_type, status, activated_at,
                completed_at, course_id, concept_id, mistake_id,
                completion_evidence_refs, completion_settlement
         FROM student_learning_task_assignments
         WHERE user_id = $1 AND task_id = $2
         FOR UPDATE`,
        [userId, taskId],
      );
      const row = existing.rows[0];
      if (row) {
        return {
          task_id: row.task_id,
          activated_at: iso(row.activated_at),
          idempotent: true,
        };
      }

      await client.query(
        `UPDATE student_learning_task_assignments
         SET status = 'superseded', updated_at = $2
         WHERE user_id = $1 AND status = 'pending'`,
        [userId, this.#now()],
      );
      const activatedAt = this.#now();
      await client.query(
        `INSERT INTO student_learning_task_assignments(
           assignment_id, user_id, task_id, course_id, concept_id, mistake_id,
           task_type, status, activated_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$8,$8)`,
        [
          `assignment_${crypto.randomUUID()}`,
          userId,
          task.task_id,
          task.course_id,
          task.concept_id,
          task.mistake_id,
          task.task_type,
          activatedAt,
        ],
      );
      return { task_id: task.task_id, activated_at: activatedAt.toISOString(), idempotent: false };
    });
  }

  async completeTask(userId: string, taskId: string): Promise<StudentLearningTaskCompletion> {
    if (taskId.startsWith("probe_")) {
      throw new LearningTaskCompletionError("LEARNING_TASK_NOT_FOUND", "验证任务请使用专用验证流程。", 404);
    }
    const completed = await withTransaction(this.pool, async (client): Promise<CompletionTransactionResult> => {
      const assignmentResult = await client.query<AssignmentRow>(
        `SELECT assignment_id, task_id, task_type, status, activated_at,
                completed_at, course_id, concept_id, mistake_id,
                completion_evidence_refs, completion_settlement
         FROM student_learning_task_assignments
         WHERE user_id = $1 AND task_id = $2
         FOR UPDATE`,
        [userId, taskId],
      );
      const assignment = assignmentResult.rows[0];
      if (!assignment) {
        throw new LearningTaskCompletionError("LEARNING_TASK_NOT_FOUND", "请先从今日任务进入本次学习。", 404);
      }
      if (assignment.status === "completed") {
        return {
          assignment,
          taskId,
          completedAt: iso(assignment.completed_at ?? this.#now()),
          evidenceRefs: stringArray(assignment.completion_evidence_refs),
          idempotent: true,
          choiceEvidence: null,
          storedSettlement: storedSettlement(assignment.completion_settlement),
        };
      }
      if (assignment.status !== "pending") {
        throw new LearningTaskCompletionError("LEARNING_TASK_NOT_FOUND", "当前学习任务已失效，请刷新今日任务。", 404);
      }

      const evidence = await this.#findCompletionEvidence(client, userId, assignment);
      if (evidence.refs.length === 0) {
        throw new LearningTaskCompletionError("LEARNING_TASK_EVIDENCE_MISSING", "还没有找到完成该任务所需的真实学习记录。", 409);
      }
      const completedAt = this.#now();
      const updated = await client.query<{ completed_at: Date | string }>(
        `UPDATE student_learning_task_assignments
         SET status = 'completed', completed_at = $3,
             completion_evidence_refs = $4::jsonb, updated_at = $3
         WHERE assignment_id = $1 AND user_id = $2 AND status = 'pending'
         RETURNING completed_at`,
        [assignment.assignment_id, userId, completedAt, JSON.stringify(evidence.refs)],
      );
      if ((updated.rowCount ?? 0) === 0) {
        const retry = await client.query<AssignmentRow>(
          `SELECT completed_at, completion_evidence_refs, completion_settlement
           FROM student_learning_task_assignments
           WHERE assignment_id = $1 AND user_id = $2 FOR UPDATE`,
          [assignment.assignment_id, userId],
        );
        const done = retry.rows[0];
        if (!done || !done.completed_at) throw new LearningTaskCompletionError("LEARNING_TASK_EVIDENCE_MISSING", "任务状态发生变化，请刷新后重试。", 409);
        return {
          assignment: { ...assignment, ...done, status: "completed" },
          taskId,
          completedAt: iso(done.completed_at),
          evidenceRefs: stringArray(done.completion_evidence_refs),
          idempotent: true,
          choiceEvidence: evidence.choice,
          storedSettlement: storedSettlement(done.completion_settlement),
        };
      }
      await client.query(
        `UPDATE student_learning_plan_tasks task
         SET status = 'completed', completed_at = $2,
             evidence_refs = $3::jsonb, updated_at = $2
         WHERE task.task_id = $1
           AND task.status = 'pending'
           AND EXISTS (
             SELECT 1 FROM student_learning_plan_versions plan
             WHERE plan.plan_id = task.plan_id AND plan.user_id = $4
            )`,
        [taskId, completedAt, JSON.stringify(evidence.refs), userId],
      );
      return {
        assignment: { ...assignment, status: "completed", completed_at: updated.rows[0]!.completed_at },
        taskId,
        completedAt: iso(updated.rows[0]!.completed_at),
        evidenceRefs: evidence.refs,
        idempotent: false,
        choiceEvidence: evidence.choice,
        storedSettlement: null,
      };
    });

    if (completed.storedSettlement) {
      return {
        task_id: completed.taskId,
        completed_at: completed.completedAt,
        evidence_refs: completed.evidenceRefs,
        idempotent: true,
        next_task_id: completed.storedSettlement.next_task?.task_id ?? null,
        settlement: completed.storedSettlement,
      };
    }

    const snapshot = await this.getSnapshot(userId);
    const choiceEvidence = completed.choiceEvidence
      ?? await this.#loadChoiceEvidence(userId, completed.evidenceRefs);
    const generatedSettlement = await this.#buildSettlement(
      userId,
      completed.assignment,
      completed.evidenceRefs,
      choiceEvidence,
      snapshot,
    );
    const stableSettlement = await withTransaction(this.pool, async (client) => {
      const result = await client.query<{ completion_settlement: unknown }>(
        `UPDATE student_learning_task_assignments
         SET completion_settlement = COALESCE(completion_settlement, $3::jsonb),
             updated_at = CASE WHEN completion_settlement IS NULL THEN $4 ELSE updated_at END
         WHERE assignment_id = $1 AND user_id = $2 AND status = 'completed'
         RETURNING completion_settlement`,
        [
          completed.assignment.assignment_id,
          userId,
          JSON.stringify(generatedSettlement),
          this.#now(),
        ],
      );
      const persisted = storedSettlement(result.rows[0]?.completion_settlement);
      if (!persisted) {
        throw new LearningTaskCompletionError(
          "LEARNING_TASK_EVIDENCE_MISSING",
          "本关已完成，但结算快照尚未保存，请重试。",
          409,
        );
      }
      return persisted;
    });

    return {
      task_id: completed.taskId,
      completed_at: completed.completedAt,
      evidence_refs: completed.evidenceRefs,
      idempotent: completed.idempotent,
      next_task_id: stableSettlement.next_task?.task_id ?? null,
      settlement: stableSettlement,
    };
  }

  async #findCompletionEvidence(
    client: SqlClient,
    userId: string,
    assignment: AssignmentRow,
  ): Promise<CompletionEvidence> {
    if (assignment.task_type === "choice_practice") {
      const result = await client.query<ChoiceEvidenceRow>(
        `SELECT evidence.evidence_id, evidence.attempt_id, evidence.evaluation_id,
                evidence.question_id, evidence.outcome, evidence.created_at,
                evidence.concept_id AS attributed_concept_id,
                EXISTS (
                  SELECT 1 FROM course_concept_question_links active_link
                  WHERE active_link.concept_id = $3 AND active_link.status = 'active'
                ) AS has_concept_links
         FROM learning_evidence evidence
         JOIN practice_attempts attempt ON attempt.attempt_id = evidence.attempt_id
         JOIN questions question ON question.question_id = attempt.question_id
         JOIN course_catalog_entries catalog
           ON catalog.question_subject = question.subject
          AND catalog.course_id = $2
         WHERE evidence.user_id = $1
           AND (
             $3::text IS NULL
             OR (
               EXISTS (
                 SELECT 1
                 FROM course_concept_question_links linked_question
                 WHERE linked_question.concept_id = $3
                   AND linked_question.status = 'active'
               )
               AND evidence.concept_id = $3
             )
             OR NOT EXISTS (
               SELECT 1
               FROM course_concept_question_links linked_question
               WHERE linked_question.concept_id = $3
                 AND linked_question.status = 'active'
             )
           )
           AND evidence.course_id = attempt.course_id
           AND evidence.grading_mode = 'deterministic_choice'
           AND evidence.outcome IN ('correct', 'incorrect')
           AND evidence.created_at >= $4
         ORDER BY evidence.created_at DESC LIMIT 10`,
        [userId, assignment.course_id, assignment.concept_id, assignment.activated_at],
      );
      return {
        refs: result.rows.flatMap((row) => [
          `evidence:${row.evidence_id}`,
          `attempt:${row.attempt_id}`,
          `evaluation:${row.evaluation_id}`,
        ]).slice(0, 12),
        choice: mapChoiceEvidence(result.rows[0]),
      };
    }
    if (assignment.task_type === "mistake_review" && assignment.mistake_id) {
      const result = await client.query<ChoiceEvidenceRow>(
        `SELECT evidence.evidence_id, evidence.attempt_id, evidence.evaluation_id,
                evidence.question_id, evidence.outcome, evidence.created_at,
                evidence.concept_id AS attributed_concept_id,
                true AS has_concept_links
         FROM learning_evidence evidence
         JOIN practice_mistakes mistake
           ON mistake.user_id = evidence.user_id
          AND mistake.question_id = evidence.question_id
         JOIN practice_mistake_review_states review
           ON review.mistake_id = mistake.mistake_id
          AND review.user_id = mistake.user_id
         WHERE evidence.user_id = $1
           AND mistake.mistake_id = $2
           AND evidence.grading_mode = 'deterministic_choice'
           AND evidence.outcome = 'correct'
           AND evidence.eligible_for_learning_state_update = true
           AND evidence.created_at >= $3
           AND review.last_processed_attempt_id = evidence.attempt_id
           AND review.last_reviewed_at >= $3
         ORDER BY evidence.created_at DESC
         LIMIT 1`,
        [userId, assignment.mistake_id, assignment.activated_at],
      );
      return {
        refs: result.rows.flatMap((row) => [
          `evidence:${row.evidence_id}`,
          `attempt:${row.attempt_id}`,
          `evaluation:${row.evaluation_id}`,
          `mistake:${assignment.mistake_id}:review_cycle`,
        ]),
        choice: mapChoiceEvidence(result.rows[0]),
      };
    }
    if (assignment.task_type === "course_reading") {
      const result = await client.query<{ chunk_id: string; paragraph_index: number; source_expanded: boolean }>(
        `SELECT progress.chunk_id, progress.paragraph_index, progress.source_expanded
         FROM course_reading_progress progress
         JOIN course_concept_sources source ON source.chunk_id = progress.chunk_id
         WHERE progress.user_id = $1 AND progress.course_id = $2
           AND ($3::text IS NULL OR source.concept_id = $3)
           AND progress.updated_at >= $4
           AND progress.paragraph_index > 0
           AND progress.source_expanded = true
         ORDER BY progress.updated_at DESC LIMIT 1`,
        [userId, assignment.course_id, assignment.concept_id, assignment.activated_at],
      );
      return {
        refs: result.rows.map((row) => `reading:${assignment.course_id}:${row.chunk_id}:${row.paragraph_index}`),
        choice: null,
      };
    }
    return { refs: [], choice: null };
  }

  async #loadChoiceEvidence(userId: string, evidenceRefs: readonly string[]) {
    const evidenceId = evidenceRefs
      .find((reference) => reference.startsWith("evidence:"))
      ?.slice("evidence:".length);
    if (!evidenceId) return null;
    const result = await this.pool.query<ChoiceEvidenceRow>(
      `SELECT evidence_id, attempt_id, evaluation_id, question_id, outcome, created_at,
              concept_id AS attributed_concept_id,
              (concept_id IS NOT NULL) AS has_concept_links
       FROM learning_evidence
       WHERE user_id = $1 AND evidence_id = $2
         AND grading_mode = 'deterministic_choice'
         AND outcome IN ('correct', 'incorrect')
       LIMIT 1`,
      [userId, evidenceId],
    );
    return mapChoiceEvidence(result.rows[0]);
  }

  async #buildSettlement(
    userId: string,
    assignment: AssignmentRow,
    evidenceRefs: readonly string[],
    choiceEvidence: ChoiceCompletionEvidence | null,
    snapshot: StudentLearningOrchestration,
  ): Promise<StudentLearningTaskSettlement> {
    const settlementConceptId = assignment.task_type === "choice_practice" && choiceEvidence?.courseWide
      ? null
      : assignment.concept_id;
    const contextResult = await this.pool.query<TaskContextRow>(
      `SELECT course.title AS course_title, concept.title AS concept_title
       FROM courses course
       LEFT JOIN course_core_concepts concept
         ON concept.course_id = course.course_id AND concept.concept_id = $2
       WHERE course.course_id = $1
       LIMIT 1`,
      [assignment.course_id, settlementConceptId],
    );
    const taskContext = contextResult.rows[0];
    const courseTitle = taskContext?.course_title
      ?? snapshot.course_priorities.find((course) => course.course_id === assignment.course_id)?.course_title
      ?? "408 课程";
    const conceptTitle = settlementConceptId ? (taskContext?.concept_title ?? null) : null;
    const conceptLabel = conceptTitle ?? courseTitle;
    const nextTask = settlementNextTask(snapshot, assignment.task_id);
    const evidenceCount = Math.max(
      1,
      evidenceRefs.filter((reference) => reference.startsWith("evidence:")).length,
    );
    const tracked = snapshot.plan_progress.tasks.some((task) => task.task_id === assignment.task_id);

    let outcome: StudentLearningTaskSettlement["outcome"] = "completed";
    let resultDetail = "本关完成条件已核验。";
    let evidenceSummary = "新增 1 条可核验学习记录。";
    let profileUpdate: StudentLearningTaskSettlement["profile_update"] = {
      kind: "learning_progress",
      title: `${conceptLabel}学习进度已更新`,
      detail: "本关已有服务端核验的完成证据，后续任务会据此继续编排。",
    };
    let reviewUpdate: StudentLearningTaskSettlement["review_update"] = {
      status: "not_applicable",
      mistake_id: null,
      next_review_at: null,
      summary: "本关不产生选择题错题状态。",
    };

    if (assignment.task_type === "choice_practice") {
      if (!choiceEvidence) {
        throw new LearningTaskCompletionError(
          "LEARNING_TASK_EVIDENCE_MISSING",
          "未找到本关对应的确定性选择题证据。",
          409,
        );
      }
      outcome = choiceEvidence.outcome;
      resultDetail = "本次选择题已完成判分。";
      evidenceSummary = `新增 ${evidenceCount} 次选择题作答。`;
      const reviewResult = await this.pool.query<ReviewStateRow>(
        `SELECT mistake.mistake_id, mistake.status, mistake.wrong_count,
                review.next_review_at, review.consecutive_success_count
         FROM practice_mistakes mistake
         LEFT JOIN practice_mistake_review_states review
           ON review.mistake_id = mistake.mistake_id AND review.user_id = mistake.user_id
         WHERE mistake.user_id = $1 AND mistake.question_id = $2
         LIMIT 1`,
        [userId, choiceEvidence.questionId],
      );
      const review = reviewResult.rows[0];
      if (choiceEvidence.outcome === "incorrect") {
        if (!review) {
          throw new LearningTaskCompletionError(
            "LEARNING_TASK_EVIDENCE_MISSING",
            "作答结果已记录，但错题复习状态尚未就绪。",
            409,
          );
        }
        reviewUpdate = {
          status: "needs_review",
          mistake_id: review.mistake_id,
          next_review_at: review.next_review_at ? iso(review.next_review_at) : null,
          summary: `已加入错题复习，累计答错 ${Number(review.wrong_count)} 次。`,
        };
        profileUpdate = {
          kind: "practice_review",
          title: `${conceptLabel}进入待复习队列`,
          detail: "本次错误作答已形成复习信号，后续任务会优先安排相关复习。",
        };
      } else if (review?.status === "mastered") {
        reviewUpdate = {
          status: "mastered",
          mistake_id: review.mistake_id,
          next_review_at: null,
          summary: "已满足连续正确复习规则，本题已标记掌握。",
        };
        profileUpdate = {
          kind: "mastered",
          title: `${conceptLabel}完成错题修复`,
          detail: "连续正确复习后，待复习状态已关闭。",
        };
      } else if (review) {
        const successCount = Number(review.consecutive_success_count ?? 0);
        reviewUpdate = {
          status: "in_progress",
          mistake_id: review.mistake_id,
          next_review_at: review.next_review_at ? iso(review.next_review_at) : null,
          summary: `已完成 ${Math.min(successCount, 3)}/3 次连续正确复习，继续观察稳定掌握。`,
        };
        profileUpdate = {
          kind: "review_progress",
          title: `${conceptLabel}复习正在推进`,
          detail: "本次正确作答已进入错题修复证据，但尚未达到稳定掌握规则。",
        };
      } else {
        reviewUpdate = {
          status: "not_required",
          mistake_id: null,
          next_review_at: null,
          summary: "本次正确作答未新增待复习记录。",
        };
        profileUpdate = {
          kind: "practice_correct",
          title: `${conceptLabel}新增一次正确作答`,
          detail: "本次结果已计入画像，仍需后续证据观察是否稳定掌握。",
        };
      }
    } else if (assignment.task_type === "mistake_review" && assignment.mistake_id) {
      if (!choiceEvidence || choiceEvidence.outcome !== "correct") {
        throw new LearningTaskCompletionError(
          "LEARNING_TASK_EVIDENCE_MISSING",
          "未找到本轮到期复习对应的正确作答证据。",
          409,
        );
      }
      const reviewResult = await this.pool.query<ReviewStateRow>(
        `SELECT mistake.mistake_id, mistake.status, mistake.wrong_count,
                review.next_review_at, review.consecutive_success_count
         FROM practice_mistakes mistake
         JOIN practice_mistake_review_states review
           ON review.mistake_id = mistake.mistake_id AND review.user_id = mistake.user_id
         WHERE mistake.user_id = $1 AND mistake.mistake_id = $2
         LIMIT 1`,
        [userId, assignment.mistake_id],
      );
      const review = reviewResult.rows[0];
      if (!review) {
        throw new LearningTaskCompletionError(
          "LEARNING_TASK_EVIDENCE_MISSING",
          "本轮作答已记录，但错题复习状态尚未就绪。",
          409,
        );
      }
      resultDetail = "本轮到期复习已完成判分。";
      evidenceSummary = "新增 1 次到期错题复习证据。";
      if (review.status === "mastered") {
        profileUpdate = {
          kind: "mastered",
          title: `${conceptLabel}完成错题修复`,
          detail: "三轮到期复习均有正确作答证据，本题据此关闭复习队列。",
        };
        reviewUpdate = {
          status: "mastered",
          mistake_id: assignment.mistake_id,
          next_review_at: null,
          summary: "已完成 3/3 次到期正确复习，本题标记为已掌握。",
        };
      } else {
        const successCount = Number(review.consecutive_success_count ?? 0);
        profileUpdate = {
          kind: "review_progress",
          title: `${conceptLabel}完成本轮复习`,
          detail: "本轮到期正确作答已记录；下次到期后再验证是否稳定掌握。",
        };
        reviewUpdate = {
          status: "in_progress",
          mistake_id: assignment.mistake_id,
          next_review_at: review.next_review_at ? iso(review.next_review_at) : null,
          summary: `已完成 ${Math.min(successCount, 3)}/3 次到期正确复习。`,
        };
      }
    } else if (assignment.task_type === "course_reading") {
      evidenceSummary = "新增 1 条课程阅读进度。";
    }

    return studentLearningTaskSettlementSchema.parse({
      version: "challenge_settlement_v1",
      task_type: assignment.task_type,
      course_id: assignment.course_id,
      course_title: courseTitle,
      concept_id: settlementConceptId,
      concept_title: conceptTitle,
      outcome,
      result_title: "本关已完成",
      result_detail: resultDetail,
      evidence_update: {
        added_count: evidenceCount,
        objective_total: snapshot.evidence_summary.objective_evidence_count,
        summary: evidenceSummary,
      },
      profile_update: profileUpdate,
      review_update: reviewUpdate,
      plan_progress: {
        tracked,
        completed_task_count: snapshot.plan_progress.completed_task_count,
        total_task_count: snapshot.plan_progress.total_task_count,
        completion_percent: snapshot.plan_progress.completion_percent,
      },
      next_task: nextTask,
    });
  }

}
