import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  aiWorkflowRequestSchema,
  studentCareCurrentTaskSchema,
  type AiWorkflowAttemptContext,
  type AiWorkflowConceptContext,
  type AiWorkflowEvaluationContext,
  type AiWorkflowInvocation,
  type AiWorkflowLearningEvidence,
  type AiWorkflowQaCaseContext,
  type AiWorkflowReadingProgressContext,
  type AiWorkflowSourceChunk,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";
import type { StudentLearningOrchestrationService } from "../orchestration/learning-orchestration-service.js";
import type { StudentCareRepository } from "../student-care/student-care-service.js";
import {
  WorkflowContextIncompleteError,
  type BuildWorkflowContextInput,
  type WorkflowContextRepository,
} from "./workflow-context.js";

interface CourseRow {
  course_id: string;
  title: string;
  discipline: string;
  question_subject: string;
}

interface ConceptRow {
  concept_id: string;
  title: string;
  learning_objective: string;
  key_terms: unknown;
}

interface SourceChunkRow {
  chunk_id: string;
  chapter: string;
  print_page: number | string;
  content_text: string;
}

interface ReadingRow {
  chunk_id: string;
  paragraph_index: number | string;
  source_expanded: boolean;
  updated_at: Date | string;
}

interface QaRow {
  qa_id: string;
  question_text: string;
  answer_text: string;
}

interface AttemptRow {
  attempt_id: string;
  question_id: string;
  subject: string;
  question_text: string;
  options: unknown;
  selected_option_ids: unknown;
  submitted_at: Date | string;
  evaluation_id: string;
  grading_mode: "deterministic_choice";
  status: "correct" | "incorrect";
  is_correct: boolean;
  score: number | string;
  correct_option_ids: unknown;
  explanation_text: string | null;
  evaluation_created_at: Date | string;
}

interface EvidenceRow {
  evidence_id: string;
  outcome: "correct" | "incorrect" | "pending_review";
  created_at: Date | string;
  subject: string;
  tags: unknown;
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const optionId = Reflect.get(item, "option_id");
    const text = Reflect.get(item, "text");
    return typeof optionId === "string" && typeof text === "string"
      ? [{ option_id: optionId, text }]
      : [];
  });
}

const evidenceConfidenceCopy = {
  grounded: "证据充分",
  developing: "证据正在形成",
  low: "当前依据较少",
} as const;

const TALK_CONSENT_TTL_MS = 24 * 60 * 60 * 1_000;

function withoutTerminalSeparator(value: string) {
  return value.trim().replace(/[。；;]+$/u, "");
}

export class PostgresWorkflowContextRepository implements WorkflowContextRepository {
  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly learningOrchestration: Pick<StudentLearningOrchestrationService, "getSnapshot"> | null = null,
    private readonly studentCare: Pick<StudentCareRepository, "findInteraction"> | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async build(input: BuildWorkflowContextInput) {
    const { requestId, userId, invocation } = input;
    const course = await this.#course(userId, invocation.course_id);
    if (!course) throw new WorkflowContextIncompleteError("course");

    if (invocation.capability === "care") {
      return this.#buildCareRequest(input, course);
    }

    const needsConcept = invocation.concept_id !== null;
    let concept = needsConcept
      ? await this.#concept(userId, course.course_id, invocation.concept_id!)
      : null;
    if (needsConcept && !concept) {
      throw new WorkflowContextIncompleteError("concept");
    }
    const readingProgress = await this.#readingProgress(userId, course.course_id);
    const qaCase = invocation.capability === "coach"
      ? await this.#qaCase(userId, course.course_id, invocation.qa_id!)
      : null;
    if (invocation.capability === "coach" && !qaCase) {
      throw new WorkflowContextIncompleteError("qa_case");
    }

    const attemptRow =
      invocation.capability === "plan" || invocation.capability === "diagnose"
        ? await this.#attempt(
            userId,
            course.question_subject,
            invocation.capability === "diagnose" ? invocation.attempt_id : null,
            invocation.concept_id,
          )
        : null;
    if (invocation.capability === "diagnose" && !attemptRow) {
      throw new WorkflowContextIncompleteError("attempt");
    }
    if (invocation.capability === "diagnose" && !concept) {
      const resolvedConceptId = await this.#uniqueAttemptConcept(
        userId,
        course.course_id,
        course.question_subject,
        attemptRow!.attempt_id,
        attemptRow!.question_id,
      );
      if (!resolvedConceptId) {
        throw new WorkflowContextIncompleteError("source_chunks");
      }
      concept = await this.#concept(userId, course.course_id, resolvedConceptId);
      if (!concept) {
        throw new WorkflowContextIncompleteError("source_chunks");
      }
    }
    const sourceChunks = concept
      ? await this.#sourceChunks(userId, course.course_id, concept.concept_id)
      : invocation.capability === "plan" && readingProgress
        ? await this.#sourceChunkById(
            userId,
            course.course_id,
            readingProgress.chunk_id,
          )
        : [];
    if ((needsConcept || invocation.capability === "diagnose") && sourceChunks.length === 0) {
      throw new WorkflowContextIncompleteError("source_chunks");
    }
    const attempt = attemptRow ? this.#attemptContext(attemptRow) : null;
    const evaluation = attemptRow ? this.#evaluationContext(attemptRow) : null;
    const [storedEvidence, planEvidence] = await Promise.all([
      this.#learningEvidence(
        userId,
        course.question_subject,
        invocation.capability === "diagnose" ? invocation.attempt_id : null,
      ),
      invocation.capability === "plan"
        ? this.#planEvidence(userId, course.course_id)
        : Promise.resolve([]),
    ]);
    const learningEvidence = [
      ...planEvidence,
      ...(readingProgress
        ? [{
            evidence_id: `reading_${course.course_id}_${readingProgress.chunk_id}`,
            kind: "reading_progress" as const,
            summary: `已阅读至段落 ${readingProgress.paragraph_index + 1}。`,
            observed_at: readingProgress.updated_at,
          }]
        : []),
      ...storedEvidence,
    ].slice(0, 20);

    return aiWorkflowRequestSchema.parse({
      contract_version: "0.2",
      request_id: requestId,
      capability: invocation.capability,
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY[invocation.capability],
      user_id: userId,
      course_id: course.course_id,
      concept_id: concept?.concept_id ?? null,
      source_chunk_ids: sourceChunks.map((chunk) => chunk.source_chunk_id),
      attempt_id: attempt?.attempt_id ?? null,
      learning_evidence: learningEvidence,
      user_message: invocation.user_message,
      context: {
        student: { user_id: userId },
        course: {
          course_id: course.course_id,
          title: course.title,
          discipline: course.discipline,
        },
        concept,
        source_chunks: sourceChunks,
        reading_progress: readingProgress,
        qa_case: qaCase,
        attempt,
        evaluation,
        care_check_in: null,
      },
    });
  }

  async #buildCareRequest(
    input: BuildWorkflowContextInput,
    course: CourseRow,
  ) {
    const { requestId, userId, invocation } = input;
    if (!this.studentCare) {
      throw new WorkflowContextIncompleteError("care_consent");
    }
    const conversationId = invocation.conversation_id;
    if (!conversationId) {
      throw new WorkflowContextIncompleteError("care_consent");
    }
    const consent = await this.studentCare.findInteraction(userId, conversationId);
    const nowMs = this.now().getTime();
    const consentedAtMs = consent?.respondedAt ? Date.parse(consent.respondedAt) : Number.NaN;
    if (
      !consent
      || consent.interactionId !== conversationId
      || consent.status !== "responded"
      || consent.response !== "talk"
      || consent.talkCourseId !== course.course_id
      || !Number.isFinite(consentedAtMs)
      || consentedAtMs > nowMs
      || consentedAtMs <= nowMs - TALK_CONSENT_TTL_MS
    ) {
      throw new WorkflowContextIncompleteError("care_consent");
    }
    if (!this.learningOrchestration) {
      throw new WorkflowContextIncompleteError("care_task");
    }
    const snapshot = await this.learningOrchestration.getSnapshot(userId);
    const task = snapshot.current_task;
    if (task.course_id !== course.course_id) {
      throw new WorkflowContextIncompleteError("care_task");
    }
    const currentTask = studentCareCurrentTaskSchema.parse({
      task_id: task.task_id,
      task_type: task.task_type,
      course_id: task.course_id,
      course_title: task.course_title,
      concept_title: task.concept_title,
      title: task.title,
      estimated_minutes: task.estimated_minutes,
      href: task.href,
    });

    return aiWorkflowRequestSchema.parse({
      contract_version: "0.2",
      request_id: requestId,
      capability: "care",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.care,
      user_id: userId,
      course_id: course.course_id,
      concept_id: null,
      source_chunk_ids: [],
      attempt_id: null,
      learning_evidence: [],
      user_message: invocation.user_message,
      context: {
        student: { user_id: userId },
        course: {
          course_id: course.course_id,
          title: course.title,
          discipline: course.discipline,
        },
        concept: null,
        source_chunks: [],
        reading_progress: null,
        qa_case: null,
        attempt: null,
        evaluation: null,
        care_check_in: {
          conversation_id: conversationId,
          recent_turns: [],
          signal_code: consent.signalCode,
          reason_summary: consent.reasonSummary,
          consented_at: consent.respondedAt,
          current_task: currentTask,
        },
      },
    });
  }

  async #course(userId: string, courseId: string) {
    const result = await this.pool.query<CourseRow>(
      `SELECT c.course_id, c.title, c.discipline, e.question_subject
       FROM courses c
       JOIN course_memberships m
         ON m.course_id = c.course_id
        AND m.user_id = $1
        AND m.membership_role = 'student'
        AND m.status = 'active'
       JOIN course_catalog_entries e ON e.course_id = c.course_id
       WHERE c.course_id = $2 AND c.status = 'active'
       LIMIT 1`,
      [userId, courseId],
    );
    return result.rows[0] ?? null;
  }

  async #concept(userId: string, courseId: string, conceptId: string) {
    const result = await this.pool.query<ConceptRow>(
      `SELECT cc.concept_id, cc.title, cc.learning_objective,
              COALESCE(ARRAY(
                SELECT term_text
                FROM course_concept_terms
                WHERE concept_id = cc.concept_id
                ORDER BY ordinal
              ), '{}') AS key_terms
       FROM course_core_concepts cc
       JOIN course_memberships m
         ON m.course_id = cc.course_id
        AND m.user_id = $1
        AND m.membership_role = 'student'
        AND m.status = 'active'
       WHERE cc.course_id = $2 AND cc.concept_id = $3
       LIMIT 1`,
      [userId, courseId, conceptId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      concept_id: row.concept_id,
      title: row.title,
      learning_objective: row.learning_objective,
      key_terms: stringArray(row.key_terms),
    } satisfies AiWorkflowConceptContext;
  }

  async #sourceChunks(userId: string, courseId: string, conceptId: string) {
    const result = await this.pool.query<SourceChunkRow>(
      `SELECT k.chunk_id, k.chapter, s.print_page, k.content_text
       FROM course_concept_sources s
       JOIN course_core_concepts cc ON cc.concept_id = s.concept_id
       JOIN course_memberships m
         ON m.course_id = cc.course_id
        AND m.user_id = $1
        AND m.membership_role = 'student'
        AND m.status = 'active'
       JOIN course_content_chunks k
         ON k.chunk_id = s.chunk_id AND k.course_id = cc.course_id
       WHERE cc.course_id = $2 AND cc.concept_id = $3
       ORDER BY s.ordinal
       LIMIT 6`,
      [userId, courseId, conceptId],
    );
    return result.rows.map((row) => ({
      source_chunk_id: row.chunk_id,
      chapter: row.chapter,
      locator: `教材印刷页 ${Number(row.print_page)}`,
      content: row.content_text,
    } satisfies AiWorkflowSourceChunk));
  }

  async #sourceChunkById(userId: string, courseId: string, chunkId: string) {
    const result = await this.pool.query<SourceChunkRow>(
      `SELECT k.chunk_id, k.chapter, k.page AS print_page, k.content_text
       FROM course_content_chunks k
       JOIN course_memberships m
         ON m.course_id = k.course_id
        AND m.user_id = $1
        AND m.membership_role = 'student'
        AND m.status = 'active'
       WHERE k.course_id = $2 AND k.chunk_id = $3
       LIMIT 1`,
      [userId, courseId, chunkId],
    );
    return result.rows.map((row) => ({
      source_chunk_id: row.chunk_id,
      chapter: row.chapter,
      locator: `教材印刷页 ${Number(row.print_page)}`,
      content: row.content_text,
    } satisfies AiWorkflowSourceChunk));
  }

  async #readingProgress(userId: string, courseId: string) {
    const result = await this.pool.query<ReadingRow>(
      `SELECT p.chunk_id, p.paragraph_index, p.source_expanded, p.updated_at
       FROM course_reading_progress p
       WHERE p.user_id = $1 AND p.course_id = $2
       LIMIT 1`,
      [userId, courseId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      chunk_id: row.chunk_id,
      paragraph_index: Number(row.paragraph_index),
      source_expanded: row.source_expanded,
      updated_at: iso(row.updated_at),
    } satisfies AiWorkflowReadingProgressContext;
  }

  async #qaCase(userId: string, courseId: string, qaId: string) {
    const result = await this.pool.query<QaRow>(
      `SELECT q.qa_id, q.question_text, q.answer_text
       FROM course_qa_examples q
       JOIN course_memberships m
         ON m.course_id = q.course_id
        AND m.user_id = $1
        AND m.membership_role = 'student'
        AND m.status = 'active'
       WHERE q.course_id = $2 AND q.qa_id = $3
       LIMIT 1`,
      [userId, courseId, qaId],
    );
    const row = result.rows[0];
    return row
      ? {
          qa_id: row.qa_id,
          question: row.question_text,
          answer: row.answer_text,
        } satisfies AiWorkflowQaCaseContext
      : null;
  }

  async #attempt(
    userId: string,
    subject: string,
    attemptId: string | null,
    conceptId: string | null,
  ) {
    const parameters: unknown[] = [userId, subject];
    const attemptFilter = attemptId
      ? (parameters.push(attemptId), ` AND pa.attempt_id = $${parameters.length}`)
      : "";
    const conceptFilter = conceptId
      ? (parameters.push(conceptId), ` AND pa.concept_id = $${parameters.length}`)
      : "";
    const result = await this.pool.query<AttemptRow>(
      `SELECT pa.attempt_id, pa.question_id, q.subject, q.question_text,
              q.options, pa.selected_option_ids, pa.submitted_at,
              e.evaluation_id, e.grading_mode, e.status, e.is_correct, e.score,
              e.correct_option_ids, e.explanation_text,
              e.created_at AS evaluation_created_at
       FROM practice_attempts pa
       JOIN questions q ON q.question_id = pa.question_id
       JOIN evaluations e ON e.attempt_id = pa.attempt_id
       WHERE pa.user_id = $1
         AND q.subject = $2
         AND pa.answer_type = 'choice'
         AND e.grading_mode = 'deterministic_choice'
         AND e.status IN ('correct', 'incorrect')${attemptFilter}${conceptFilter}
       ORDER BY pa.submitted_at DESC
       LIMIT 1`,
      parameters,
    );
    return result.rows[0] ?? null;
  }

  async #uniqueAttemptConcept(
    userId: string,
    courseId: string,
    subject: string,
    attemptId: string,
    questionId: string,
  ) {
    const result = await this.pool.query<{ concept_id: string }>(
      `SELECT DISTINCT link.concept_id
       FROM course_concept_question_links link
       JOIN course_core_concepts concept
         ON concept.concept_id = link.concept_id
       JOIN course_catalog_entries catalog
         ON catalog.course_id = concept.course_id
       JOIN practice_attempts pa
         ON pa.attempt_id = $1
        AND pa.user_id = $2
        AND pa.question_id = link.question_id
       JOIN questions q ON q.question_id = pa.question_id
       JOIN question_learning_metadata meta
         ON meta.question_id = q.question_id
       WHERE link.question_id = $3
         AND link.status = 'active'
         AND concept.course_id = $4
         AND concept.review_status = 'verified'
         AND catalog.question_subject = $5
         AND q.subject = $5
         AND q.question_type = 'choice'
         AND q.review_status = 'approved'
         AND meta.content_review_status IN ('teacher_verified', 'demo_validated')
       ORDER BY link.concept_id
       LIMIT 2`,
      [attemptId, userId, questionId, courseId, subject],
    );
    return result.rows.length === 1 ? result.rows[0]!.concept_id : null;
  }

  #attemptContext(row: AttemptRow): AiWorkflowAttemptContext {
    return {
      attempt_id: row.attempt_id,
      question_id: row.question_id,
      subject: row.subject,
      question_text: row.question_text,
      options: optionArray(row.options),
      selected_option_ids: stringArray(row.selected_option_ids),
      submitted_at: iso(row.submitted_at),
    };
  }

  #evaluationContext(row: AttemptRow): AiWorkflowEvaluationContext {
    return {
      evaluation_id: row.evaluation_id,
      grading_mode: "deterministic_choice",
      status: row.status,
      is_correct: row.is_correct,
      score: Number(row.score),
      correct_option_ids: stringArray(row.correct_option_ids),
      explanation: row.explanation_text,
      created_at: iso(row.evaluation_created_at),
    };
  }

  async #learningEvidence(
    userId: string,
    subject: string,
    attemptId: string | null,
  ) {
    const parameters: unknown[] = [userId, subject];
    const attemptFilter = attemptId
      ? (parameters.push(attemptId), ` AND le.attempt_id = $${parameters.length}`)
      : "";
    const result = await this.pool.query<EvidenceRow>(
      `SELECT le.evidence_id, le.outcome, le.created_at, q.subject, q.tags
       FROM learning_evidence le
       JOIN questions q ON q.question_id = le.question_id
       WHERE le.user_id = $1 AND q.subject = $2${attemptFilter}
       ORDER BY le.created_at DESC
       LIMIT 20`,
      parameters,
    );
    return result.rows.map((row) => {
      const tags = stringArray(row.tags);
      const label = tags.length > 0 ? tags.join("、") : row.subject;
      return {
        evidence_id: row.evidence_id,
        kind: "answer_result",
        summary: `${label}：${row.outcome === "correct" ? "回答正确" : row.outcome === "incorrect" ? "回答错误" : "待复核"}`,
        observed_at: iso(row.created_at),
      } satisfies AiWorkflowLearningEvidence;
    });
  }

  async #planEvidence(userId: string, courseId: string) {
    if (!this.learningOrchestration) return [];
    const snapshot = await this.learningOrchestration.getSnapshot(userId);
    const evidence: AiWorkflowLearningEvidence[] = [];
    if (snapshot.current_task.course_id === courseId) {
      const task = snapshot.current_task;
      evidence.push({
        evidence_id: `workflow_current_task_${courseId}`,
        kind: "weakness_signal",
        summary: [
          `当前确定性任务：${task.title}`,
          `安排原因：${withoutTerminalSeparator(task.reason)}`,
          `完成标准：${withoutTerminalSeparator(task.completion_criteria)}`,
          `预计用时：${task.estimated_minutes} 分钟`,
        ].join("；").slice(0, 1_000),
        observed_at: snapshot.generated_at,
      });
    }
    const summary = snapshot.evidence_summary;
    evidence.push({
      evidence_id: `workflow_evidence_summary_${courseId}`,
      kind: "weakness_signal",
      summary: `证据摘要：${summary.reading_progress_count} 条课程阅读位置，${summary.practice_attempt_count} 次真实作答，${summary.needs_review_count} 个待复习项；${evidenceConfidenceCopy[summary.confidence]}。`,
      observed_at: snapshot.generated_at,
    });
    return evidence;
  }
}
