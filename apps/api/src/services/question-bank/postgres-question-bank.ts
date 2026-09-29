import { createHash, randomUUID } from "node:crypto";

import {
  pastExamCatalogResponseSchema,
  practiceAttemptRecordSchema,
  practiceLearningEvidenceSchema,
  questionDtoSchema,
  questionEvaluationResultSchema,
  questionLearningMetadataSchema,
  questionOptionSchema,
  questionPracticeItemSchema,
  type AnswerSubmission,
  type PastExamCatalogResponse,
  type PracticeSelection,
  type QuestionAssetReference,
  type QuestionDto,
} from "@xuetu/contracts";

import { withTransaction, type SqlClient, type SqlQueryablePool } from "../../database/client.js";
import {
  evaluateStoredQuestion,
  QuestionNotFoundError,
  QuestionSubmissionError,
  type QuestionBankService,
  type QuestionAssetFile,
  type QuestionEvaluationBundle,
  type QuestionSelectionResult,
  type SnapshotQuestionEvaluation,
  type StoredQuestion,
} from "./question-bank.js";
import {
  rankAdaptiveQuestionCandidates,
  type AdaptiveQuestionCandidate,
} from "./adaptive-question-ranking.js";
import {
  FSRS_ALGORITHM_VERSION,
  advanceQuestionMemory,
  questionMemoryRetrievability,
  type StoredQuestionMemoryState,
} from "./fsrs-memory.js";
import {
  studentQuestionExposureSql,
  studentQuestionContentReviewSql,
  studentQuestionExposureWithLocalPastExamsSql,
} from "./student-question-exposure.js";

interface PublicQuestionRow {
  question_id: string;
  year: number | null;
  number: number;
  subject: string;
  question_type: "choice" | "subjective";
  multiple: boolean;
  question_text: string;
  options: unknown;
  tags: string[];
  assets: unknown;
  source_provider: string;
  dataset_id: string;
  source_url: string;
  license_status: "unverified" | "verified" | "restricted";
  usage_scope: "local_demo_only" | "authorized_product_use";
  total_count?: string | number;
}

interface PracticeQuestionRow extends PublicQuestionRow {
  source_type: "past_exam" | "mock_exam" | "self_authored_screening" | "self_authored_practice";
  allowed_modes: Array<"diagnostic" | "targeted" | "past_exam" | "mock_exam" | "mistake_review">;
  paper_year: number | null;
  protect_full_paper: boolean;
  importance: "core" | "extended";
  content_review_status: "pending_teacher_review" | "demo_validated" | "teacher_verified";
  memory_due: Date | string | null;
  memory_stability: number | null;
  memory_difficulty: number | null;
  memory_elapsed_days: number | null;
  memory_scheduled_days: number | null;
  memory_reps: number | null;
  memory_lapses: number | null;
  memory_learning_steps: number | null;
  memory_state: 0 | 1 | 2 | 3 | null;
  memory_last_review: Date | string | null;
  memory_last_attempt_id: string | null;
  memory_algorithm_version: string | null;
  attempt_count: string | number;
  concept_correct_count: string | number;
  concept_incorrect_count: string | number;
  wrong_count: string | number;
}

interface StoredQuestionRow extends PublicQuestionRow {
  course_id: string;
  answer_key: unknown;
  explanation_text: string | null;
  solution_text: string | null;
}

interface RepositoryOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
  allowLocalDemoPastExams?: boolean;
}

interface PracticeConceptRow {
  concept_id: string;
  concept_title: string;
  course_id: string;
  course_title: string;
  subject: string;
}

interface EvaluationIdempotencyRow {
  request_fingerprint: string;
  response_payload: unknown;
}

interface QuestionMemoryRow {
  due: Date | string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  state: 0 | 1 | 2 | 3;
  last_review: Date | string | null;
  last_attempt_id: string;
  algorithm_version: string;
}

interface PastExamCatalogQuestionRow {
  year: number;
  number: number;
  subject: string;
  question_type: "choice" | "subjective";
  attempted: boolean;
}

interface QuestionAssetRow {
  role: QuestionAssetReference["role"];
  mime_type: QuestionAssetFile["mimeType"];
  byte_length: number;
  content: Buffer | Uint8Array;
}

const publicColumns = `
  q.question_id,
  q.year,
  q.number,
  q.subject,
  q.question_type,
  q.multiple,
  q.question_text,
  q.options,
  q.tags,
  q.assets,
  b.source_provider,
  b.dataset_id,
  q.source_url,
  q.license_status,
  q.usage_scope
`;

const practiceColumns = `
  ${publicColumns},
  meta.source_type,
  meta.allowed_modes,
  meta.paper_year,
  meta.protect_full_paper,
  meta.importance,
  meta.content_review_status,
  memory.due AS memory_due,
  memory.stability AS memory_stability,
  memory.difficulty AS memory_difficulty,
  memory.elapsed_days AS memory_elapsed_days,
  memory.scheduled_days AS memory_scheduled_days,
  memory.reps AS memory_reps,
  memory.lapses AS memory_lapses,
  memory.learning_steps AS memory_learning_steps,
  memory.state AS memory_state,
  memory.last_review AS memory_last_review,
  memory.last_attempt_id AS memory_last_attempt_id,
  memory.algorithm_version AS memory_algorithm_version,
  COALESCE(question_stats.attempt_count, 0)::text AS attempt_count,
  COALESCE(concept_stats.correct_count, 0)::text AS concept_correct_count,
  COALESCE(concept_stats.incorrect_count, 0)::text AS concept_incorrect_count,
  COALESCE(mistake.wrong_count, 0)::text AS wrong_count,
  COUNT(*) OVER()::text AS total_count
`;

function publicAssets(assets: unknown): QuestionAssetReference[] {
  if (!Array.isArray(assets)) return [];
  return assets.filter(
    (asset): asset is QuestionAssetReference =>
      Boolean(asset) &&
      typeof asset === "object" &&
      Reflect.get(asset, "role") === "question",
  );
}

function publicOptions(options: unknown) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => {
    const parsed = questionOptionSchema.parse(option);
    return {
      ...parsed,
      assets: parsed.assets.filter(
        (asset) => asset.role === "option" && asset.option_id === parsed.option_id,
      ),
    };
  });
}

function mapPublicQuestion(row: PublicQuestionRow): QuestionDto {
  return questionDtoSchema.parse({
    id: row.question_id,
    year: row.year === null ? null : Number(row.year),
    number: Number(row.number),
    subject: row.subject,
    type: row.question_type,
    multiple: row.multiple,
    question: row.question_text,
    options: publicOptions(row.options),
    tags: row.tags,
    assets: publicAssets(row.assets),
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

function isoTimestamp(value: Date | string | null) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Question memory contains an invalid timestamp.");
  return date.toISOString();
}

function memoryState(row: PracticeQuestionRow): StoredQuestionMemoryState | null {
  if (row.memory_due === null) return null;
  if (
    row.memory_stability === null
    || row.memory_difficulty === null
    || row.memory_elapsed_days === null
    || row.memory_scheduled_days === null
    || row.memory_reps === null
    || row.memory_lapses === null
    || row.memory_learning_steps === null
    || row.memory_state === null
    || row.memory_last_attempt_id === null
    || row.memory_algorithm_version !== FSRS_ALGORITHM_VERSION
  ) {
    throw new Error(`Question memory state is incomplete: ${row.question_id}.`);
  }
  return {
    due: isoTimestamp(row.memory_due)!,
    stability: Number(row.memory_stability),
    difficulty: Number(row.memory_difficulty),
    elapsed_days: Number(row.memory_elapsed_days),
    scheduled_days: Number(row.memory_scheduled_days),
    reps: Number(row.memory_reps),
    lapses: Number(row.memory_lapses),
    learning_steps: Number(row.memory_learning_steps),
    state: Number(row.memory_state) as 0 | 1 | 2 | 3,
    last_review: isoTimestamp(row.memory_last_review),
    last_attempt_id: row.memory_last_attempt_id,
    algorithm_version: FSRS_ALGORITHM_VERSION,
  };
}

function storedMemoryState(row: QuestionMemoryRow): StoredQuestionMemoryState {
  if (row.algorithm_version !== FSRS_ALGORITHM_VERSION) {
    throw new Error(`Unsupported question-memory algorithm: ${row.algorithm_version}.`);
  }
  return {
    due: isoTimestamp(row.due)!,
    stability: Number(row.stability),
    difficulty: Number(row.difficulty),
    elapsed_days: Number(row.elapsed_days),
    scheduled_days: Number(row.scheduled_days),
    reps: Number(row.reps),
    lapses: Number(row.lapses),
    learning_steps: Number(row.learning_steps),
    state: Number(row.state) as 0 | 1 | 2 | 3,
    last_review: isoTimestamp(row.last_review),
    last_attempt_id: row.last_attempt_id,
    algorithm_version: FSRS_ALGORITHM_VERSION,
  };
}

function adaptiveCandidate(row: PracticeQuestionRow, now: Date): AdaptiveQuestionCandidate {
  const memory = memoryState(row);
  return {
    question_id: row.question_id,
    due: memory?.due ?? null,
    retrievability: memory ? questionMemoryRetrievability(memory, now) : null,
    attempt_count: Number(row.attempt_count),
    concept_correct_count: Number(row.concept_correct_count),
    concept_incorrect_count: Number(row.concept_incorrect_count),
    wrong_count: Number(row.wrong_count),
    importance: row.importance,
  };
}

function mapPracticeItem(
  row: PracticeQuestionRow,
  ranking: ReturnType<typeof rankAdaptiveQuestionCandidates>[number]["ranking"] | null,
) {
  return questionPracticeItemSchema.parse({
    question: mapPublicQuestion(row),
    learning_metadata: questionLearningMetadataSchema.parse({
      source_type: row.source_type,
      allowed_modes: row.allowed_modes,
      paper_year: row.paper_year === null ? null : Number(row.paper_year),
      protect_full_paper: row.protect_full_paper,
      importance: row.importance,
      content_review_status: row.content_review_status,
    }),
    ranking,
  });
}

const completePastExamSubjects = new Set(["数据结构", "组成原理", "操作系统", "计算机网络"]);

function hasCompletePastExamStructure(rows: readonly PracticeQuestionRow[], year: number) {
  if (rows.length !== 47 || rows.some((row) => Number(row.year) !== year)) return false;
  const numbers = new Set(rows.map((row) => Number(row.number)));
  const subjects = new Set(rows.map((row) => row.subject));
  const choiceCount = rows.filter((row) => row.question_type === "choice").length;
  const subjectiveCount = rows.filter((row) => row.question_type === "subjective").length;
  return numbers.size === 47
    && Array.from({ length: 47 }, (_, index) => index + 1).every((number) => numbers.has(number))
    && subjects.size === completePastExamSubjects.size
    && [...subjects].every((subject) => completePastExamSubjects.has(subject))
    && choiceCount === 40
    && subjectiveCount === 7;
}

function mapStoredQuestion(row: StoredQuestionRow): StoredQuestion {
  const allAssets = Array.isArray(row.assets)
    ? (row.assets as QuestionAssetReference[])
    : [];
  return {
    courseId: row.course_id,
    question: mapPublicQuestion(row),
    correctOptionIds: Array.isArray(row.answer_key)
      ? row.answer_key.filter((value): value is string => typeof value === "string")
      : [],
    explanation: row.explanation_text,
    referenceSolution: row.solution_text,
    answerAssets: allAssets.filter(
      (asset) => asset.role === "explanation" || asset.role === "solution",
    ),
  };
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as unknown;
}

function submissionFingerprint(submission: AnswerSubmission) {
  const canonical = submission.answer_type === "choice"
    ? {
        answer_type: submission.answer_type,
        concept_id: submission.concept_id ?? null,
        question_id: submission.question_id,
        selected_option_ids: [...submission.selected_option_ids].sort((left, right) =>
          left.localeCompare(right),
        ),
      }
    : {
        answer_type: submission.answer_type,
        concept_id: submission.concept_id ?? null,
        question_id: submission.question_id,
        response_text: submission.response_text,
      };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function validateExplicitConcept(
  client: SqlClient,
  conceptId: string,
  questionId: string,
  courseId: string,
  subject: string,
) {
  const link = await client.query(
    `SELECT 1
     FROM course_concept_question_links link
     JOIN course_core_concepts concept ON concept.concept_id = link.concept_id
     JOIN course_catalog_entries catalog ON catalog.course_id = concept.course_id
     WHERE link.concept_id = $1
       AND link.question_id = $2
       AND link.status = 'active'
       AND (concept.course_id = $3 OR $3 = 'course_408_001')
       AND concept.review_status = 'verified'
       AND catalog.question_subject = $4
     LIMIT 1`,
    [conceptId, questionId, courseId, subject],
  );
  if ((link.rowCount ?? 0) === 0) {
    throw new QuestionSubmissionError(
      "CONCEPT_QUESTION_MISMATCH",
      "该题未被可靠关联到所选知识点，不能以该知识点提交。",
    );
  }
}

function parseIdempotentEvaluation(responsePayload: unknown): QuestionEvaluationBundle {
  const payload = jsonValue(responsePayload);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Stored question evaluation idempotency response is invalid.");
  }
  const record = payload as Record<string, unknown>;
  return {
    attempt: practiceAttemptRecordSchema.parse(record.attempt),
    evaluation: questionEvaluationResultSchema.parse(record.evaluation),
    evidence: practiceLearningEvidenceSchema.parse(record.evidence),
    idempotency_replayed: true,
  };
}

export class PostgresQuestionBank implements QuestionBankService {
  readonly #now: () => Date;
  readonly #createId: (prefix: string) => string;
  readonly #contentReviewSql: string;
  readonly #readExposureSql: string;

  constructor(
    private readonly pool: SqlQueryablePool,
    readonly courseId: string,
    options: RepositoryOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    const allowLocalDemoPastExams = options.allowLocalDemoPastExams === true;
    this.#readExposureSql = allowLocalDemoPastExams
      ? studentQuestionExposureWithLocalPastExamsSql
      : studentQuestionExposureSql;
    this.#contentReviewSql = studentQuestionContentReviewSql(allowLocalDemoPastExams);
  }

  async listPastExamPapers(userId: string): Promise<PastExamCatalogResponse> {
    if (!userId.trim()) throw new Error("Past-exam catalog requires a user id.");
    const result = await this.pool.query<PastExamCatalogQuestionRow>(
      `SELECT q.year, q.number, q.subject, q.question_type,
              EXISTS (
                SELECT 1
                FROM practice_attempts attempt
                WHERE attempt.user_id = $2
                  AND attempt.question_id = q.question_id
              ) AS attempted
       FROM questions q
       JOIN question_learning_metadata meta ON meta.question_id = q.question_id
       WHERE q.course_id = $1
         AND q.year IS NOT NULL
         AND q.review_status = 'approved'
         AND ${this.#contentReviewSql}
         AND meta.source_type = 'past_exam'
         AND 'past_exam' = ANY(meta.allowed_modes)
         AND ${this.#readExposureSql}
       ORDER BY q.year DESC, q.number ASC, q.question_id ASC
       LIMIT 2000`,
      [this.courseId, userId],
    );

    const papers = new Map<number, {
      choiceCount: number;
      subjectiveCount: number;
      attemptedCount: number;
      nextQuestionNumber: number | null;
      numbers: Set<number>;
      subjects: Map<string, number>;
      questionCount: number;
    }>();
    for (const row of result.rows) {
      const year = Number(row.year);
      const paper = papers.get(year) ?? {
        choiceCount: 0,
        subjectiveCount: 0,
        attemptedCount: 0,
        nextQuestionNumber: null,
        numbers: new Set<number>(),
        subjects: new Map<string, number>(),
        questionCount: 0,
      };
      paper.questionCount += 1;
      paper.numbers.add(Number(row.number));
      if (row.question_type === "choice") paper.choiceCount += 1;
      else paper.subjectiveCount += 1;
      paper.subjects.set(row.subject, (paper.subjects.get(row.subject) ?? 0) + 1);
      if (row.attempted) paper.attemptedCount += 1;
      else if (paper.nextQuestionNumber === null) paper.nextQuestionNumber = Number(row.number);
      papers.set(year, paper);
    }

    const subjectOrder = new Map([
      ["数据结构", 0],
      ["组成原理", 1],
      ["操作系统", 2],
      ["计算机网络", 3],
    ]);
    return pastExamCatalogResponseSchema.parse({
      items: [...papers.entries()]
        .sort(([left], [right]) => right - left)
        .map(([year, paper]) => {
          const subjects = [...paper.subjects.entries()]
            .sort(([left], [right]) => (
              (subjectOrder.get(left) ?? 99) - (subjectOrder.get(right) ?? 99)
              || left.localeCompare(right)
            ))
            .map(([subject, questionCount]) => ({
              subject,
              question_count: questionCount,
            }));
          const expectedSubjects = subjects.length === 4
            && subjects.every((item) => subjectOrder.has(item.subject));
          const expectedNumbers = paper.numbers.size === 47
            && Array.from({ length: 47 }, (_, index) => index + 1)
              .every((number) => paper.numbers.has(number));
          return {
            year,
            question_count: paper.questionCount,
            choice_count: paper.choiceCount,
            subjective_count: paper.subjectiveCount,
            subjects,
            attempted_count: paper.attemptedCount,
            next_question_number: paper.nextQuestionNumber,
            is_complete: paper.questionCount === 47
              && paper.choiceCount === 40
              && paper.subjectiveCount === 7
              && expectedSubjects
              && expectedNumbers,
          };
        }),
    });
  }

  async openAsset(
    userId: string,
    questionId: string,
    assetId: string,
    attemptId?: string,
  ): Promise<QuestionAssetFile | null> {
    if (!userId.trim() || !questionId.trim() || !assetId.trim()) return null;
    const result = await this.pool.query<QuestionAssetRow>(
      `SELECT link.role, blob.mime_type, blob.byte_length, blob.content
       FROM question_asset_links link
       JOIN question_asset_blobs blob ON blob.content_sha256 = link.content_sha256
       JOIN questions q ON q.question_id = link.question_id
       JOIN question_learning_metadata meta ON meta.question_id = q.question_id
       WHERE q.course_id = $1
         AND q.question_id = $3
         AND link.asset_id = $4
         AND q.review_status = 'approved'
         AND ${this.#contentReviewSql}
         AND ${this.#readExposureSql}
         AND (
           link.role IN ('question', 'option')
           OR (
             $5::text IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM practice_attempts attempt
               JOIN evaluations evaluation ON evaluation.attempt_id = attempt.attempt_id
               WHERE attempt.attempt_id = $5
                 AND attempt.user_id = $2
                 AND attempt.question_id = q.question_id
             )
           )
         )
       LIMIT 1`,
      [this.courseId, userId, questionId, assetId, attemptId ?? null],
    );
    const row = result.rows[0];
    if (!row) return null;
    const content = Buffer.from(row.content);
    const byteLength = Number(row.byte_length);
    if (content.length !== byteLength) {
      throw new Error("Stored question image byte length is inconsistent.");
    }
    return {
      role: row.role,
      mimeType: row.mime_type,
      byteLength,
      content,
    };
  }

  async select(userId: string, selection: PracticeSelection): Promise<QuestionSelectionResult> {
    if (!userId.trim()) throw new Error("Question selection requires a user id.");
    const conditions = [
      "q.course_id = $1",
      "q.review_status = 'approved'",
      this.#contentReviewSql,
      this.#readExposureSql,
    ];
    const parameters: unknown[] = [this.courseId, userId];
    const addCondition = (sql: string, value: unknown) => {
      parameters.push(value);
      conditions.push(sql.replace("?", `$${parameters.length}`));
    };

    if (selection.mode === "diagnostic") {
      conditions.push("meta.source_type = 'self_authored_screening'");
      conditions.push("'diagnostic' = ANY(meta.allowed_modes)");
    } else if (selection.mode === "targeted") {
      conditions.push("'targeted' = ANY(meta.allowed_modes)");
      conditions.push("meta.source_type <> 'self_authored_screening'");
      conditions.push("meta.protect_full_paper = false");
    } else if (selection.mode === "past_exam") {
      conditions.push("meta.source_type = 'past_exam'");
      conditions.push("'past_exam' = ANY(meta.allowed_modes)");
    } else if (selection.mode === "mock_exam") {
      conditions.push("meta.source_type = 'past_exam'");
      conditions.push("'mock_exam' = ANY(meta.allowed_modes)");
    } else {
      conditions.push("mistake.user_id = $2");
      conditions.push("mistake.status = 'needs_review'");
      conditions.push("q.question_type = 'choice'");
    }

    if (selection.question_id) addCondition("q.question_id = ?", selection.question_id);
    if (selection.subject) addCondition("q.subject = ?", selection.subject);
    if (selection.year) addCondition("q.year = ?", selection.year);
    if (selection.type) addCondition("q.question_type = ?", selection.type);
    if (selection.concept_id) {
      addCondition(
        `EXISTS (
           SELECT 1
           FROM course_concept_question_links cql
           JOIN course_core_concepts concept ON concept.concept_id = cql.concept_id
           JOIN course_catalog_entries catalog ON catalog.course_id = concept.course_id
           WHERE cql.question_id = q.question_id
             AND cql.concept_id = ?
             AND cql.status = 'active'
             AND (concept.course_id = q.course_id OR q.course_id = 'course_408_001')
             AND concept.review_status = 'verified'
             AND catalog.question_subject = q.subject
         )`,
        selection.concept_id,
      );
    }
    if (selection.tags.length > 0) {
      addCondition(
        selection.tag_match === "all" ? "q.tags @> ?::text[]" : "q.tags && ?::text[]",
        selection.tags,
      );
    }
    const contextResult = selection.concept_id
      ? await this.pool.query<PracticeConceptRow>(
          `SELECT concept.concept_id, concept.title AS concept_title,
                  course.course_id, course.title AS course_title,
                  catalog.question_subject AS subject
           FROM course_core_concepts concept
           JOIN courses course ON course.course_id = concept.course_id
           JOIN course_catalog_entries catalog ON catalog.course_id = course.course_id
           WHERE concept.concept_id = $1 AND concept.review_status = 'verified'`,
          [selection.concept_id],
        )
      : null;
    const result = await this.pool.query<PracticeQuestionRow>(
      `SELECT ${practiceColumns}
       FROM questions q
       JOIN question_import_batches b ON b.import_batch_id = q.import_batch_id
       JOIN question_learning_metadata meta ON meta.question_id = q.question_id
       LEFT JOIN student_question_memory_states memory
         ON memory.question_id = q.question_id AND memory.user_id = $2
       LEFT JOIN practice_mistakes mistake
         ON mistake.question_id = q.question_id AND mistake.user_id = $2
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS attempt_count
         FROM practice_attempts attempt
         WHERE attempt.user_id = $2 AND attempt.question_id = q.question_id
       ) question_stats ON true
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE evaluation.status = 'correct')::int AS correct_count,
           COUNT(*) FILTER (WHERE evaluation.status = 'incorrect')::int AS incorrect_count
         FROM practice_attempts concept_attempt
         JOIN evaluations evaluation ON evaluation.attempt_id = concept_attempt.attempt_id
         WHERE concept_attempt.user_id = $2
           AND concept_attempt.concept_id IN (
             SELECT link.concept_id
             FROM course_concept_question_links link
             WHERE link.question_id = q.question_id AND link.status = 'active'
           )
       ) concept_stats ON true
       WHERE ${conditions.join(" AND ")}
       ORDER BY q.year DESC NULLS LAST, q.number ASC, q.question_id ASC`,
      parameters,
    );

    const contextRow = contextResult?.rows[0];
    const adaptive = selection.mode === "targeted" || selection.mode === "mistake_review";
    const rankings = adaptive
      ? rankAdaptiveQuestionCandidates(
          result.rows.map((row) => adaptiveCandidate(row, this.#now())),
          this.#now(),
        )
      : [];
    const rankingByQuestion = new Map(rankings.map((item) => [item.question_id, item.ranking]));
    const orderedRows = adaptive
      ? [...result.rows].sort((left, right) => (
          rankings.findIndex((item) => item.question_id === left.question_id)
          - rankings.findIndex((item) => item.question_id === right.question_id)
        ))
      : [...result.rows].sort((left, right) => {
          const yearDelta = Number(right.year ?? 0) - Number(left.year ?? 0);
          if (selection.year === undefined && yearDelta !== 0) return yearDelta;
          if (left.number !== right.number) return Number(left.number) - Number(right.number);
          return left.question_id.localeCompare(right.question_id);
        });
    if (
      selection.mode === "past_exam"
      && (
        selection.year === undefined
        || !hasCompletePastExamStructure(orderedRows, selection.year)
      )
    ) {
      return {
        items: [],
        total: 0,
        limit: selection.limit,
        offset: selection.offset,
      };
    }
    const total = Number(result.rows[0]?.total_count ?? result.rows.length);
    const page = orderedRows.slice(selection.offset, selection.offset + selection.limit);
    return {
      items: page.map((row) => mapPracticeItem(row, rankingByQuestion.get(row.question_id) ?? null)),
      total,
      limit: selection.limit,
      offset: selection.offset,
      ...(selection.concept_id
        ? {
            context: contextRow
              ? {
                  ...contextRow,
                  match_method: "exact_question_tag" as const,
                }
              : null,
          }
        : {}),
    };
  }

  async get(questionId: string): Promise<QuestionDto | null> {
    const result = await this.pool.query<PublicQuestionRow>(
      `SELECT ${publicColumns}
       FROM questions q
       JOIN question_import_batches b ON b.import_batch_id = q.import_batch_id
       JOIN question_learning_metadata meta ON meta.question_id = q.question_id
       WHERE q.course_id = $1
         AND q.question_id = $2
         AND q.review_status = 'approved'
         AND ${this.#contentReviewSql}
         AND meta.protect_full_paper = false
         AND ${this.#readExposureSql}`,
      [this.courseId, questionId],
    );
    return result.rows[0] ? mapPublicQuestion(result.rows[0]) : null;
  }

  async evaluate(
    userId: string,
    submission: AnswerSubmission,
    idempotencyKey: string,
  ): Promise<QuestionEvaluationBundle> {
    return withTransaction(this.pool, (client) => this.evaluateInTransaction(
      client,
      userId,
      submission,
      idempotencyKey,
    ));
  }

  async evaluateSnapshotInTransaction(
    client: SqlClient,
    userId: string,
    submission: AnswerSubmission,
    idempotencyKey: string,
    snapshot: SnapshotQuestionEvaluation,
  ): Promise<QuestionEvaluationBundle> {
    if (snapshot.courseId !== this.courseId) {
      throw new QuestionSubmissionError(
        "QUESTION_COURSE_MISMATCH",
        "冻结题目不属于当前题库。",
      );
    }
    return this.evaluateInTransaction(client, userId, submission, idempotencyKey, {
      frozenQuestion: snapshot,
    });
  }

  async evaluateInTransaction(
    client: SqlClient,
    userId: string,
    submission: AnswerSubmission,
    idempotencyKey: string,
    options: { frozenQuestion?: SnapshotQuestionEvaluation } = {},
  ): Promise<QuestionEvaluationBundle> {
      const fingerprint = submissionFingerprint(submission);
      const reservation = await client.query<{ user_id: string }>(
        `INSERT INTO practice_evaluation_idempotency(
           user_id, idempotency_key, request_fingerprint
         ) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING
         RETURNING user_id`,
        [userId, idempotencyKey, fingerprint],
      );
      if ((reservation.rowCount ?? 0) === 0) {
        const existing = await client.query<EvaluationIdempotencyRow>(
          `SELECT request_fingerprint, response_payload
           FROM practice_evaluation_idempotency
           WHERE user_id = $1 AND idempotency_key = $2
           LIMIT 1`,
          [userId, idempotencyKey],
        );
        const stored = existing.rows[0];
        if (!stored) {
          throw new Error("Question evaluation idempotency reservation could not be resolved.");
        }
        if (stored.request_fingerprint !== fingerprint) {
          throw new QuestionSubmissionError(
            "IDEMPOTENCY_KEY_CONFLICT",
            "同一个提交键不能用于不同作答。",
          );
        }
        return parseIdempotentEvaluation(stored.response_payload);
      }

      let resolvedSubmission = submission;
      let storedQuestion: StoredQuestion;
      if (options.frozenQuestion) {
        if (options.frozenQuestion.courseId !== this.courseId) {
          throw new QuestionSubmissionError(
            "QUESTION_COURSE_MISMATCH",
            "冻结题目不属于当前题库。",
          );
        }
        storedQuestion = options.frozenQuestion;
      } else {
        const questionResult = await client.query<StoredQuestionRow>(
          `SELECT ${publicColumns}, q.course_id, q.answer_key,
                  q.explanation_text, q.solution_text
           FROM questions q
           JOIN question_import_batches b ON b.import_batch_id = q.import_batch_id
           JOIN question_learning_metadata meta ON meta.question_id = q.question_id
           WHERE q.course_id = $1
             AND q.question_id = $2
             AND q.review_status = 'approved'
             AND ${this.#contentReviewSql}
             AND ${this.#readExposureSql}
           FOR SHARE`,
          [this.courseId, submission.question_id],
        );
        const row = questionResult.rows[0];
        if (!row) throw new QuestionNotFoundError(submission.question_id);
        storedQuestion = mapStoredQuestion(row);
        if (!submission.concept_id) {
          const conceptLinks = await client.query<{ concept_id: string }>(
            `SELECT link.concept_id
             FROM course_concept_question_links link
             JOIN course_core_concepts concept ON concept.concept_id = link.concept_id
             JOIN course_catalog_entries catalog ON catalog.course_id = concept.course_id
             WHERE link.question_id = $1
               AND link.status = 'active'
               AND catalog.question_subject = $2
               AND concept.course_id = $3
               AND concept.review_status = 'verified'
             ORDER BY link.concept_id
             LIMIT 2`,
            [submission.question_id, row.subject, this.courseId],
          );
          if (conceptLinks.rows.length === 1) {
            resolvedSubmission = {
              ...submission,
              concept_id: conceptLinks.rows[0]!.concept_id,
            };
          }
        }
      }
      if (submission.concept_id) {
        await validateExplicitConcept(
          client,
          submission.concept_id,
          submission.question_id,
          this.courseId,
          storedQuestion.question.subject,
        );
      }
      const result = evaluateStoredQuestion(storedQuestion, resolvedSubmission, {
        userId,
        now: this.#now,
        createId: this.#createId,
        persistenceStatus: "persisted",
      });

      await client.query(
        `INSERT INTO practice_attempts(
           attempt_id, user_id, course_id, question_id, answer_type,
           concept_id, selected_option_ids, response_text, status, submitted_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
        [
          result.attempt.attempt_id,
          result.attempt.user_id,
          result.attempt.course_id,
          result.attempt.question_id,
          result.attempt.answer_type,
          result.attempt.concept_id,
          result.attempt.selected_option_ids
            ? JSON.stringify(result.attempt.selected_option_ids)
            : null,
          result.attempt.response_text,
          result.attempt.status,
          result.attempt.submitted_at,
        ],
      );
      await client.query(
        `INSERT INTO evaluations(
           evaluation_id, attempt_id, grading_mode, status, is_correct, score,
           correct_option_ids, explanation_text, reference_solution,
           review_required, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
        [
          result.evaluation.evaluation_id,
          result.evaluation.submission_id,
          result.evaluation.grading_mode,
          result.evaluation.status,
          result.evaluation.is_correct,
          result.evaluation.score,
          JSON.stringify(result.evaluation.correct_option_ids),
          result.evaluation.explanation,
          result.evaluation.reference_solution,
          result.evaluation.review_required,
          result.evaluation.created_at,
        ],
      );
      await client.query(
        `INSERT INTO learning_evidence(
           evidence_id, evaluation_id, attempt_id, user_id, course_id,
           question_id, concept_id, outcome, grading_mode, evidence_payload,
           eligible_for_learning_state_update, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [
          result.evidence.evidence_id,
          result.evidence.evaluation_id,
          result.evidence.submission_id,
          result.attempt.user_id,
          result.attempt.course_id,
          result.evidence.question_id,
          result.evidence.concept_id,
          result.evidence.outcome,
          result.evidence.grading_mode,
          JSON.stringify({
            selected_option_ids: result.evidence.selected_option_ids,
            response_present: result.evidence.response_present,
            tags: result.evidence.tags,
            review_required: result.evidence.review_required,
            source: result.evidence.source,
          }),
          result.evidence.eligible_for_learning_state_update,
          result.evidence.created_at,
        ],
      );
      if (
        result.evidence.eligible_for_learning_state_update
        && (result.evidence.outcome === "correct" || result.evidence.outcome === "incorrect")
      ) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
          [userId, submission.question_id],
        );
        const currentMemory = await client.query<QuestionMemoryRow>(
          `SELECT due, stability, difficulty, elapsed_days, scheduled_days,
                  reps, lapses, learning_steps, state, last_review,
                  last_attempt_id, algorithm_version
           FROM student_question_memory_states
           WHERE user_id = $1 AND question_id = $2
           FOR UPDATE`,
          [userId, submission.question_id],
        );
        const memory = advanceQuestionMemory(
          currentMemory.rows[0] ? storedMemoryState(currentMemory.rows[0]) : null,
          {
            attemptId: result.attempt.attempt_id,
            outcome: result.evidence.outcome,
            reviewedAt: new Date(result.evidence.created_at),
          },
        );
        if (!memory.replayed) {
          await client.query(
            `INSERT INTO student_question_memory_states(
               user_id, question_id, due, stability, difficulty,
               elapsed_days, scheduled_days, reps, lapses, learning_steps,
               state, last_review, last_attempt_id, algorithm_version, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (user_id, question_id) DO UPDATE SET
               due = EXCLUDED.due,
               stability = EXCLUDED.stability,
               difficulty = EXCLUDED.difficulty,
               elapsed_days = EXCLUDED.elapsed_days,
               scheduled_days = EXCLUDED.scheduled_days,
               reps = EXCLUDED.reps,
               lapses = EXCLUDED.lapses,
               learning_steps = EXCLUDED.learning_steps,
               state = EXCLUDED.state,
               last_review = EXCLUDED.last_review,
               last_attempt_id = EXCLUDED.last_attempt_id,
               algorithm_version = EXCLUDED.algorithm_version,
               updated_at = EXCLUDED.updated_at
             WHERE student_question_memory_states.last_attempt_id
               IS DISTINCT FROM EXCLUDED.last_attempt_id`,
            [
              userId,
              submission.question_id,
              memory.state.due,
              memory.state.stability,
              memory.state.difficulty,
              memory.state.elapsed_days,
              memory.state.scheduled_days,
              memory.state.reps,
              memory.state.lapses,
              memory.state.learning_steps,
              memory.state.state,
              memory.state.last_review,
              memory.state.last_attempt_id,
              memory.state.algorithm_version,
              result.evidence.created_at,
            ],
          );
          await client.query(
            `UPDATE practice_mistake_review_states review
             SET next_review_at = $3,
                 algorithm_version = $4,
                 updated_at = $5
             FROM practice_mistakes mistake
             WHERE review.mistake_id = mistake.mistake_id
               AND review.user_id = $1
               AND mistake.user_id = $1
               AND mistake.question_id = $2
               AND mistake.status = 'needs_review'`,
            [
              userId,
              submission.question_id,
              memory.state.due,
              memory.state.algorithm_version,
              result.evidence.created_at,
            ],
          );
        }
      }
      const stored = await client.query(
        `UPDATE practice_evaluation_idempotency
         SET attempt_id = $4, response_payload = $5::jsonb
         WHERE user_id = $1 AND idempotency_key = $2 AND request_fingerprint = $3`,
        [
          userId,
          idempotencyKey,
          fingerprint,
          result.attempt.attempt_id,
          JSON.stringify(result),
        ],
      );
      if ((stored.rowCount ?? 0) !== 1) {
        throw new Error("Question evaluation idempotency response could not be saved.");
      }
      return { ...result, idempotency_replayed: false };
  }
}
