import { withTransaction, type SqlPool } from "./client.js";

const STUDY_ID = "pilot_408_queue_v1";
const CONCEPT_ID = "ds_c03_02";
const BASELINE_QUESTION_ID = "2010-02";
const TRANSFER_QUESTION_ID = "2021-02";

const noticeText = [
  "本次试用用于了解智算智伴的可用性和任务完成情况。参加完全自愿，可随时停止。",
  "系统只记录匿名编号、身份角色标签、任务用时、客观作答、达到阅读位置的来源曝光记录和本页反馈。",
  "请不要在开放反馈中填写姓名、学号、手机号、联系方式、账号密码或其他敏感信息。",
  "小样本结果只用于说明可行性和观察到的变化，不用于证明统计显著的教学效果。",
].join("\n");

const studyDefinition = {
  study_id: STUDY_ID,
  title: "队列知识点三阶段试用",
  notice_version: "pilot_notice_v1",
  notice_text: noticeText,
  status: "active" as const,
  created_by: "user_admin_001",
};

type PilotStudySeedRow = Pick<
  typeof studyDefinition,
  "study_id" | "title" | "notice_version" | "notice_text" | "status"
>;

type PilotTaskSeed = {
  taskId: string;
  ordinal: number;
  stage: "baseline" | "guided" | "transfer";
  evidenceKind: "verified_choice_attempt" | "verified_course_reading";
  title: string;
  instructions: string;
  questionId: string | null;
  href: string;
  assistancePolicy: "independent" | "platform_guidance";
};

type PilotTaskSeedRow = Omit<PilotTaskSeed, "taskId" | "evidenceKind" | "questionId" | "assistancePolicy"> & {
  task_id: string;
  evidence_kind: PilotTaskSeed["evidenceKind"];
  question_id: string | null;
  assistance_policy: PilotTaskSeed["assistancePolicy"];
  study_id: string;
  course_id: string;
  concept_id: string | null;
};

function assertStudyProtocol(row: PilotStudySeedRow) {
  const fields: Array<keyof PilotStudySeedRow> = [
    "study_id",
    "title",
    "notice_version",
    "notice_text",
  ];
  if (fields.some((field) => row[field] !== studyDefinition[field])) {
    throw new Error(`Pilot study protocol ${STUDY_ID} is immutable and differs from the seed.`);
  }
  if (row.status !== "active") {
    throw new Error(`Pilot study protocol ${STUDY_ID} is ${row.status}; seed will not reactivate it.`);
  }
}

function assertTaskProtocol(row: PilotTaskSeedRow, expected: PilotTaskSeed) {
  if (
    row.study_id !== STUDY_ID
    || row.task_id !== expected.taskId
    || Number(row.ordinal) !== expected.ordinal
    || row.stage !== expected.stage
    || row.evidence_kind !== expected.evidenceKind
    || row.title !== expected.title
    || row.instructions !== expected.instructions
    || row.course_id !== "course_408_ds"
    || row.concept_id !== CONCEPT_ID
    || row.question_id !== expected.questionId
    || row.href !== expected.href
    || row.assistance_policy !== expected.assistancePolicy
  ) {
    throw new Error(`Pilot task protocol ${expected.taskId} is immutable and differs from the seed.`);
  }
}

export async function seedPilotStudy(pool: SqlPool) {
  return withTransaction(pool, async (client) => {
    const concept = await client.query<{ concept_id: string }>(
      `SELECT concept_id
       FROM course_core_concepts
       WHERE concept_id = $1 AND course_id = $2`,
      [CONCEPT_ID, "course_408_ds"],
    );
    if (!concept.rows.some((row) => row.concept_id === CONCEPT_ID)) {
      throw new Error(`Pilot study requires concept ${CONCEPT_ID}.`);
    }

    const questions = await client.query<{ question_id: string }>(
      `SELECT question_id
       FROM questions
       WHERE question_id IN ($1, $2)
         AND question_type = 'choice'
         AND review_status <> 'rejected'`,
      [BASELINE_QUESTION_ID, TRANSFER_QUESTION_ID],
    );
    const available = new Set(questions.rows.map((row) => row.question_id));
    for (const questionId of [BASELINE_QUESTION_ID, TRANSFER_QUESTION_ID]) {
      if (!available.has(questionId)) {
        throw new Error(`Pilot study requires question ${questionId}.`);
      }
    }

    const existingStudy = await client.query<PilotStudySeedRow>(
      `SELECT study_id, title, notice_version, notice_text, status
       FROM pilot_studies
       WHERE study_id = $1
       FOR UPDATE`,
      [STUDY_ID],
    );
    if (existingStudy.rows[0]) {
      assertStudyProtocol(existingStudy.rows[0]);
    } else {
      const insertedStudy = await client.query<PilotStudySeedRow>(
        `INSERT INTO pilot_studies(
           study_id, title, notice_version, notice_text, status, created_by,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (study_id) DO NOTHING
         RETURNING study_id, title, notice_version, notice_text, status`,
        [
          studyDefinition.study_id,
          studyDefinition.title,
          studyDefinition.notice_version,
          studyDefinition.notice_text,
          studyDefinition.status,
          studyDefinition.created_by,
        ],
      );
      const persistedStudy = insertedStudy.rows[0]
        ?? (await client.query<PilotStudySeedRow>(
          `SELECT study_id, title, notice_version, notice_text, status
           FROM pilot_studies
           WHERE study_id = $1
           FOR UPDATE`,
          [STUDY_ID],
        )).rows[0];
      if (!persistedStudy) {
        throw new Error(`Pilot study ${STUDY_ID} was not inserted or found.`);
      }
      assertStudyProtocol(persistedStudy);
    }

    const tasks = [
      {
        taskId: "pilot_queue_baseline_v1",
        ordinal: 1,
        stage: "baseline",
        evidenceKind: "verified_choice_attempt",
        title: "独立完成基线题",
        instructions: "请按当前理解独立作答，不查看课程讲解，也不使用 AI 提示。",
        questionId: BASELINE_QUESTION_ID,
        href: `/student/practice?subject=${encodeURIComponent("数据结构")}&concept_id=${CONCEPT_ID}&question_id=${BASELINE_QUESTION_ID}&pilot_task_id=pilot_queue_baseline_v1`,
        assistancePolicy: "independent",
      },
      {
        taskId: "pilot_queue_guided_v1",
        ordinal: 2,
        stage: "guided",
        evidenceKind: "verified_course_reading",
        title: "学习队列核心规则",
        instructions: "进入队列知识讲解，展开来源内容并至少阅读到第 3 段；返回后由系统核验阅读位置和来源曝光记录。",
        questionId: null,
        href: `/student/courses/data-structures?concept_id=${CONCEPT_ID}&pilot_task_id=pilot_queue_guided_v1`,
        assistancePolicy: "platform_guidance",
      },
      {
        taskId: "pilot_queue_transfer_v1",
        ordinal: 3,
        stage: "transfer",
        evidenceKind: "verified_choice_attempt",
        title: "独立完成迁移题",
        instructions: "请在不返回讲解和不使用 AI 提示的情况下独立完成这道同类新题。",
        questionId: TRANSFER_QUESTION_ID,
        href: `/student/practice?subject=${encodeURIComponent("数据结构")}&concept_id=${CONCEPT_ID}&question_id=${TRANSFER_QUESTION_ID}&pilot_task_id=pilot_queue_transfer_v1`,
        assistancePolicy: "independent",
      },
    ] satisfies readonly PilotTaskSeed[];

    const existingTasks = await client.query<PilotTaskSeedRow>(
      `SELECT task_id, study_id, ordinal, stage, evidence_kind, title,
              instructions, course_id, concept_id, question_id, href,
              assistance_policy
       FROM pilot_tasks
       WHERE task_id = ANY($1::text[])
       FOR UPDATE`,
      [tasks.map((task) => task.taskId)],
    );
    const existingById = new Map(existingTasks.rows.map((row) => [row.task_id, row]));

    for (const task of tasks) {
      const existing = existingById.get(task.taskId);
      if (existing) {
        assertTaskProtocol(existing, task);
        continue;
      }
      await client.query(
        `INSERT INTO pilot_tasks(
           task_id, study_id, ordinal, stage, evidence_kind, title,
           instructions, course_id, concept_id, question_id, href,
           assistance_policy, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )
         ON CONFLICT (task_id) DO NOTHING`,
        [
          task.taskId,
          STUDY_ID,
          task.ordinal,
          task.stage,
          task.evidenceKind,
          task.title,
          task.instructions,
          "course_408_ds",
          CONCEPT_ID,
          task.questionId,
          task.href,
          task.assistancePolicy,
        ],
      );
    }

    const persistedTasks = await client.query<PilotTaskSeedRow>(
      `SELECT task_id, study_id, ordinal, stage, evidence_kind, title,
              instructions, course_id, concept_id, question_id, href,
              assistance_policy
       FROM pilot_tasks
       WHERE task_id = ANY($1::text[])
       FOR UPDATE`,
      [tasks.map((task) => task.taskId)],
    );
    const persistedById = new Map(persistedTasks.rows.map((row) => [row.task_id, row]));
    for (const task of tasks) {
      const persisted = persistedById.get(task.taskId);
      if (!persisted) throw new Error(`Pilot task ${task.taskId} was not inserted or found.`);
      assertTaskProtocol(persisted, task);
    }

    return { studies: 1, tasks: tasks.length };
  });
}
