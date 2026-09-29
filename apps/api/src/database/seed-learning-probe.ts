import { withTransaction, type SqlPool } from "./client.js";

export const LEARNING_PROBE_DEMO_PAIR_GROUP_ID = "learning_probe_local_demo_co_storage_v1";
const IMPORT_BATCH_ID = "import_learning_probe_co_v1";
const ARCHIVE_SHA256 = "d".repeat(64);
const COURSE_ID = "course_408_co";
const CONCEPT_ID = "co_c04_01";
const ADMIN_USER_ID = "user_admin_001";
const SOURCE_URL = "https://xuetu.local/demo/learning-probe-co-storage-v1";
const REVIEW_NOTE = "本地演示审核，不代表正式课程教师验收。";

export interface LearningProbeDemoQuestion {
  questionId: string;
  number: number;
  questionText: string;
  options: ReadonlyArray<{ option_id: string; text: string; assets: readonly [] }>;
  correctOptionIds: readonly string[];
  explanation: string;
  tags: readonly string[];
  conceptId: typeof CONCEPT_ID;
  subject: "组成原理";
  sourceProvenance: string;
}

export const LEARNING_PROBE_DEMO_QUESTIONS: readonly LearningProbeDemoQuestion[] = [
  {
    questionId: "probe-co-storage-anchor-v1",
    number: 901,
    questionText: "关于寄存器、Cache、主存和辅助存储器构成的存储层次，下列趋势组合正确的是？",
    options: [
      { option_id: "A", text: "距离 CPU 越远，速度通常越低、容量通常越大、单位成本通常越低", assets: [] },
      { option_id: "B", text: "距离 CPU 越远，速度通常越高、容量通常越小、单位成本通常越高", assets: [] },
      { option_id: "C", text: "各层速度、容量和单位成本基本没有稳定差异", assets: [] },
      { option_id: "D", text: "距离 CPU 越远，速度和容量都必然降低", assets: [] },
    ],
    correctOptionIds: ["A"],
    explanation: "存储层次用少量高速存储器配合大容量低速存储器，越远离 CPU 通常容量越大、速度越低、单位成本越低。",
    tags: ["存储体系的层次结构", "存储层次", "Cache"],
    conceptId: CONCEPT_ID,
    subject: "组成原理",
    sourceProvenance: `${REVIEW_NOTE}题面角色：anchor。`,
  },
  {
    questionId: "probe-co-storage-contrast-v1",
    number: 902,
    questionText: "某设备选型要在 SRAM、DRAM、SSD 中分别承担高速小容量缓存、主存和大容量持久存储，下列匹配正确的是？",
    options: [
      { option_id: "A", text: "SRAM 用作高速小容量缓存，DRAM 用作主存，SSD 用作大容量持久存储", assets: [] },
      { option_id: "B", text: "SSD 用作高速小容量缓存，SRAM 用作大容量持久存储，DRAM 用作主存", assets: [] },
      { option_id: "C", text: "DRAM 用作高速小容量缓存，SSD 用作主存，SRAM 用作持久存储", assets: [] },
      { option_id: "D", text: "三者在速度、容量和断电保持能力上没有可用于选型的差异", assets: [] },
    ],
    correctOptionIds: ["A"],
    explanation: "SRAM 速度快但成本高、容量小，DRAM 常作为主存，SSD 适合容量较大的持久存储；这体现了存储层次的典型取舍。",
    tags: ["存储体系的层次结构", "SRAM", "DRAM", "SSD"],
    conceptId: CONCEPT_ID,
    subject: "组成原理",
    sourceProvenance: `${REVIEW_NOTE}题面角色：contrast，使用不同设备情境验证同一概念。`,
  },
] as const;

function assertDefinitions() {
  if (LEARNING_PROBE_DEMO_QUESTIONS.length !== 2) {
    throw new Error("Learning probe demo requires exactly two questions.");
  }
  const ids = new Set(LEARNING_PROBE_DEMO_QUESTIONS.map((item) => item.questionId));
  if (ids.size !== LEARNING_PROBE_DEMO_QUESTIONS.length) {
    throw new Error("Learning probe demo question IDs must be distinct.");
  }
  if (new Set(LEARNING_PROBE_DEMO_QUESTIONS.map((item) => item.conceptId)).size !== 1) {
    throw new Error("Learning probe demo questions must share one concept.");
  }
  if (LEARNING_PROBE_DEMO_QUESTIONS.some((item) => item.options.length < 2 || item.correctOptionIds.length !== 1)) {
    throw new Error("Learning probe demo question definitions are invalid.");
  }
}

export async function seedLearningProbeDemo(pool: SqlPool) {
  assertDefinitions();
  const now = new Date().toISOString();
  return withTransaction(pool, async (client) => {
    const course = await client.query<{ course_id: string }>(
      "SELECT course_id FROM courses WHERE course_id = $1 AND status = 'active'",
      [COURSE_ID],
    );
    if (!course.rows.some((row) => row.course_id === COURSE_ID)) {
      throw new Error(`Learning probe demo requires active course ${COURSE_ID}.`);
    }
    const concept = await client.query<{ concept_id: string }>(
      `SELECT concept_id
         FROM course_core_concepts
        WHERE concept_id = $1 AND course_id = $2 AND review_status = 'verified'`,
      [CONCEPT_ID, COURSE_ID],
    );
    if (!concept.rows.some((row) => row.concept_id === CONCEPT_ID)) {
      throw new Error(`Learning probe demo requires verified concept ${CONCEPT_ID}.`);
    }
    const reviewer = await client.query<{ user_id: string }>(
      `SELECT user_id
         FROM users
        WHERE user_id = $1 AND account_status = 'active'`,
      [ADMIN_USER_ID],
    );
    if (!reviewer.rows.some((row) => row.user_id === ADMIN_USER_ID)) {
      throw new Error(`Learning probe demo requires reviewer ${ADMIN_USER_ID}.`);
    }

    await client.query(
      `INSERT INTO question_import_batches(
         import_batch_id, dataset_id, archive_sha256, source_provider, source_url,
         license_status, usage_scope, status, question_count, started_at, completed_at
       ) VALUES ($1, 'learning_probe_demo_co_v1', $2, 'xuetu_local_demo', $3,
                 'unverified', 'local_demo_only', 'completed', 2, $4, $4)
       ON CONFLICT (import_batch_id) DO UPDATE SET
         dataset_id = EXCLUDED.dataset_id,
         archive_sha256 = EXCLUDED.archive_sha256,
         source_provider = EXCLUDED.source_provider,
         source_url = EXCLUDED.source_url,
         license_status = EXCLUDED.license_status,
         usage_scope = EXCLUDED.usage_scope,
         status = EXCLUDED.status,
         question_count = EXCLUDED.question_count,
         completed_at = EXCLUDED.completed_at`,
      [IMPORT_BATCH_ID, ARCHIVE_SHA256, SOURCE_URL, now],
    );

    for (const item of LEARNING_PROBE_DEMO_QUESTIONS) {
      await client.query(
        `INSERT INTO questions(
           question_id, course_id, import_batch_id, year, number, subject,
           question_type, multiple, question_text, options, tags, assets,
           answer_key, explanation_text, solution_text, source_url,
           license_status, usage_scope, review_status, reviewed_by, reviewed_at,
           review_note, created_at, updated_at
         ) VALUES ($1, $2, $3, NULL, $4, $5, 'choice', false, $6, $7::jsonb,
                   $8::text[], '[]'::jsonb, $9::jsonb, $10, NULL, $11,
                   'unverified', 'local_demo_only', 'approved', $12, $13, $14, $13, $13)
         ON CONFLICT (question_id) DO UPDATE SET
           course_id = EXCLUDED.course_id,
           import_batch_id = EXCLUDED.import_batch_id,
           year = EXCLUDED.year,
           number = EXCLUDED.number,
           subject = EXCLUDED.subject,
           question_type = EXCLUDED.question_type,
           multiple = EXCLUDED.multiple,
           question_text = EXCLUDED.question_text,
           options = EXCLUDED.options,
           tags = EXCLUDED.tags,
           assets = EXCLUDED.assets,
           answer_key = EXCLUDED.answer_key,
           explanation_text = EXCLUDED.explanation_text,
           source_url = EXCLUDED.source_url,
           license_status = EXCLUDED.license_status,
           usage_scope = EXCLUDED.usage_scope,
           review_status = CASE
             WHEN questions.review_status = 'rejected' THEN questions.review_status
             ELSE EXCLUDED.review_status
           END,
           reviewed_by = CASE
             WHEN questions.review_status = 'rejected' THEN questions.reviewed_by
             ELSE EXCLUDED.reviewed_by
           END,
           reviewed_at = CASE
             WHEN questions.review_status = 'rejected' THEN questions.reviewed_at
             ELSE EXCLUDED.reviewed_at
           END,
           review_note = CASE
             WHEN questions.review_status = 'rejected' THEN questions.review_note
             ELSE EXCLUDED.review_note
           END,
           updated_at = EXCLUDED.updated_at`,
        [
          item.questionId,
          COURSE_ID,
          IMPORT_BATCH_ID,
          item.number,
          item.subject,
          item.questionText,
          JSON.stringify(item.options),
          item.tags,
          JSON.stringify(item.correctOptionIds),
          item.explanation,
          SOURCE_URL,
          ADMIN_USER_ID,
          now,
          `${item.sourceProvenance}${REVIEW_NOTE}`,
        ],
      );
      await client.query(
        `INSERT INTO question_learning_metadata(
           question_id, source_type, allowed_modes, paper_year,
           protect_full_paper, importance, content_review_status,
           created_at, updated_at
         ) VALUES ($1, 'self_authored_practice', ARRAY['targeted']::text[], NULL,
                   false, 'core', 'teacher_verified', $2, $2)
         ON CONFLICT (question_id) DO UPDATE SET
           source_type = EXCLUDED.source_type,
           allowed_modes = EXCLUDED.allowed_modes,
           paper_year = EXCLUDED.paper_year,
           protect_full_paper = EXCLUDED.protect_full_paper,
           importance = EXCLUDED.importance,
           content_review_status = CASE
             WHEN question_learning_metadata.content_review_status = 'teacher_verified'
               THEN 'teacher_verified'
             ELSE EXCLUDED.content_review_status
           END,
           updated_at = EXCLUDED.updated_at`,
        [item.questionId, now],
      );
      await client.query(
        `INSERT INTO course_concept_question_links(
           concept_id, question_id, matched_tag, match_method, rule_version,
           status, created_at, updated_at
         ) VALUES ($1, $2, $3, 'exact_question_tag', 'v1_exact_unique_tag', 'active', $4, $4)
         ON CONFLICT (concept_id, question_id) DO UPDATE SET
           matched_tag = EXCLUDED.matched_tag,
           match_method = EXCLUDED.match_method,
           rule_version = EXCLUDED.rule_version,
           status = 'active',
           updated_at = EXCLUDED.updated_at`,
        [CONCEPT_ID, item.questionId, "存储体系的层次结构", now],
      );
    }

    const anchor = LEARNING_PROBE_DEMO_QUESTIONS[0];
    const contrast = LEARNING_PROBE_DEMO_QUESTIONS[1];
    if (!anchor || !contrast) throw new Error("Learning probe demo pair definitions are incomplete.");
    const pairs = [
      {
        pairId: "learning_probe_pair_co_storage_reachable_anchor_v1",
        questionId: "practice-408-v1-03",
        contrastQuestionId: contrast.questionId,
        role: "contrast",
        difference: "从存储层次总体趋势切换到 SRAM、DRAM、SSD 的设备选型情境。",
      },
      {
        pairId: "learning_probe_pair_co_storage_anchor_v1",
        questionId: anchor.questionId,
        contrastQuestionId: contrast.questionId,
        role: "contrast",
        difference: "从存储层次总体趋势切换到 SRAM、DRAM、SSD 的设备选型情境。",
      },
      {
        pairId: "learning_probe_pair_co_storage_contrast_v1",
        questionId: contrast.questionId,
        contrastQuestionId: anchor.questionId,
        role: "contrast",
        difference: "从设备选型情境切换到距离 CPU 的存储层次趋势判断。",
      },
    ] as const;
    for (const pair of pairs) {
      await client.query(
        `INSERT INTO learning_question_pairs(
           pair_id, pair_group_id, course_id, concept_id, question_id,
           contrast_question_id, hypothesis_code, surface_difference,
           question_role, content_review_status, source_provenance,
           algorithm_version, status, reviewed_by, reviewed_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'concept_definition', $7,
                   $8, 'teacher_verified', $9, 'evidence_probe_v1', 'active', $10, $11, $11, $11)
         ON CONFLICT (pair_id) DO UPDATE SET
           pair_group_id = EXCLUDED.pair_group_id,
           course_id = EXCLUDED.course_id,
           concept_id = EXCLUDED.concept_id,
           question_id = EXCLUDED.question_id,
           contrast_question_id = EXCLUDED.contrast_question_id,
           hypothesis_code = EXCLUDED.hypothesis_code,
           surface_difference = EXCLUDED.surface_difference,
           question_role = EXCLUDED.question_role,
           content_review_status = CASE
             WHEN learning_question_pairs.content_review_status = 'teacher_verified'
               THEN 'teacher_verified'
             ELSE EXCLUDED.content_review_status
           END,
           source_provenance = EXCLUDED.source_provenance,
           algorithm_version = EXCLUDED.algorithm_version,
           status = EXCLUDED.status,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at,
           updated_at = EXCLUDED.updated_at`,
        [
          pair.pairId,
          LEARNING_PROBE_DEMO_PAIR_GROUP_ID,
          COURSE_ID,
          CONCEPT_ID,
          pair.questionId,
          pair.contrastQuestionId,
          pair.difference,
          pair.role,
          `${REVIEW_NOTE}题对来源：本地演示题库。`,
          ADMIN_USER_ID,
          now,
        ],
      );
    }

    return { questions: LEARNING_PROBE_DEMO_QUESTIONS.length, links: LEARNING_PROBE_DEMO_QUESTIONS.length, pairs: pairs.length };
  });
}
