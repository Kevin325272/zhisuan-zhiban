import type {
  MemoryCard,
  MemoryCardSeed,
  MemoryCardWrite,
  MemoryReview,
  MemoryReviewResult,
  MemoryToday,
  StudyCollection,
  StudyCollectionDetail,
  StudyCollectionWrite,
  StudyMapQuery,
} from "@xuetu/contracts";
import type { CardInput } from "ts-fsrs";
import {
  withTransaction,
  type SqlClient,
  type SqlQueryablePool,
} from "../../database/client.js";
import { QuestionInventory, buildStudyMap } from "./question-inventory.js";
import { memoryDay, scheduleMemoryCard } from "./memory-scheduler.js";

export class StudyLibraryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
const missing = () =>
  new StudyLibraryError(
    "STUDY_ITEM_NOT_FOUND",
    "这条记录不存在或已被移除。",
    404,
  );
const conflict = () =>
  new StudyLibraryError(
    "STUDY_VERSION_CONFLICT",
    "记录已更新，请重新读取后再试。",
  );
interface CardRow {
  card_id: string;
  front: string;
  back: string;
  subject: MemoryCard["subject"];
  source_note_id: string | null;
  version: number;
  due_at: Date;
  reviews: number;
  memory_state: CardInput | null;
}
const publicCard = (row: CardRow): MemoryCard => ({
  id: row.card_id,
  front: row.front,
  back: row.back,
  subject: row.subject,
  source_note_id: row.source_note_id,
  version: row.version,
  due_at: row.due_at.toISOString(),
  reviews: row.reviews,
});

export class PostgresStudentStudyLibrary {
  private inventory: QuestionInventory;
  constructor(
    private pool: SqlQueryablePool,
    allowLocalPastExams = false,
    private now = () => new Date(),
  ) {
    this.inventory = new QuestionInventory(pool, allowLocalPastExams);
  }
  async map(userId: string, query: StudyMapQuery) {
    return buildStudyMap(await this.inventory.list(userId), query);
  }
  async collections(userId: string): Promise<StudyCollection[]> {
    return (
      await this.pool.query<StudyCollection>(
        `SELECT c.collection_id AS id,c.name,c.version,
      (SELECT count(*)::int FROM student_study_collection_questions q
        WHERE q.user_id=c.user_id AND q.collection_id=c.collection_id) AS count
      FROM student_study_collections c WHERE c.user_id=$1 ORDER BY c.created_at,c.collection_id`,
        [userId],
      )
    ).rows;
  }
  async collection(userId: string, id: string): Promise<StudyCollectionDetail> {
    const collection = (await this.collections(userId)).find(
      (c) => c.id === id,
    );
    if (!collection) throw missing();
    const ids = new Set(
      (
        await this.pool.query<{ question_id: string }>(
          "SELECT question_id FROM student_study_collection_questions WHERE user_id=$1 AND collection_id=$2",
          [userId, id],
        )
      ).rows.map((r) => r.question_id),
    );
    const questions = (await this.inventory.list(userId)).filter((q) =>
      ids.has(q.id),
    );
    return {
      collection,
      questions,
      unavailable: Math.max(0, ids.size - questions.length),
    };
  }
  async saveCollection(
    userId: string,
    id: string,
    input: StudyCollectionWrite,
  ) {
    try {
      const result =
        input.version === 0
          ? await this.pool.query(
              `INSERT INTO student_study_collections(user_id,collection_id,name) VALUES($1,$2,$3)
            ON CONFLICT (user_id,collection_id) DO NOTHING RETURNING collection_id`,
              [userId, id, input.name],
            )
          : await this.pool.query(
              `UPDATE student_study_collections SET name=$3,version=version+1
            WHERE user_id=$1 AND collection_id=$2 AND version=$4 RETURNING collection_id`,
              [userId, id, input.name, input.version],
            );
      if (!result.rowCount) throw conflict();
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new StudyLibraryError(
          "STUDY_NAME_EXISTS",
          "已经有同名题本，请换个名字。",
        );
      throw error;
    }
    return (await this.collections(userId)).find((c) => c.id === id)!;
  }
  async removeCollection(userId: string, id: string, version: number) {
    const result = await this.pool.query(
      "DELETE FROM student_study_collections WHERE user_id=$1 AND collection_id=$2 AND version=$3 RETURNING collection_id",
      [userId, id, version],
    );
    if (!result.rowCount) throw conflict();
  }
  async memberships(userId: string, questionId: string) {
    return (
      await this.pool.query<{ collection_id: string }>(
        "SELECT collection_id FROM student_study_collection_questions WHERE user_id=$1 AND question_id=$2",
        [userId, questionId],
      )
    ).rows.map((r) => r.collection_id);
  }
  async setMembership(
    userId: string,
    id: string,
    questionId: string,
    included: boolean,
  ) {
    if (
      included &&
      !(await this.inventory.list(userId)).some((q) => q.id === questionId)
    )
      throw missing();
    await withTransaction(this.pool, async (client) => {
      const parent = await client.query(
        "SELECT collection_id FROM student_study_collections WHERE user_id=$1 AND collection_id=$2 FOR UPDATE",
        [userId, id],
      );
      if (!parent.rowCount) throw missing();
      const result = included
        ? await client.query(
            `INSERT INTO student_study_collection_questions(user_id,collection_id,question_id)
            VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
            [userId, id, questionId],
          )
        : await client.query(
            "DELETE FROM student_study_collection_questions WHERE user_id=$1 AND collection_id=$2 AND question_id=$3",
            [userId, id, questionId],
          );
      if (result.rowCount)
        await client.query(
          "UPDATE student_study_collections SET version=version+1 WHERE user_id=$1 AND collection_id=$2",
          [userId, id],
        );
    });
  }
  async cards(userId: string) {
    const rows = await this.pool.query<CardRow>(
      "SELECT * FROM student_memory_cards WHERE user_id=$1 ORDER BY created_at DESC,card_id",
      [userId],
    );
    return rows.rows.map(publicCard);
  }
  async cardSeeds(userId: string): Promise<MemoryCardSeed[]> {
    return (
      await this.pool.query<MemoryCardSeed>(
        `SELECT c.concept_id AS id,c.title,catalog.question_subject AS subject,
      c.title || '：复习时要留意什么？' AS front,c.learning_note_text AS back
      FROM course_core_concepts c JOIN course_catalog_entries catalog USING(course_id)
      WHERE c.review_status='verified' AND EXISTS (SELECT 1 FROM course_memberships cm
        WHERE cm.course_id=c.course_id AND cm.user_id=$1 AND cm.membership_role='student' AND cm.status='active')
      ORDER BY catalog.question_subject,c.ordinal,c.concept_id`,
        [userId],
      )
    ).rows;
  }
  private async lock(client: SqlClient, userId: string) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('memory-cards:' || $1,0))",
      [userId],
    );
  }
  async saveCard(userId: string, id: string, input: MemoryCardWrite) {
    return withTransaction(this.pool, async (client) => {
      await this.lock(client, userId);
      if (input.source_note_id) {
        const source = await client.query(
          "SELECT entry_id FROM student_notebook_entries WHERE user_id=$1 AND entry_id=$2",
          [userId, input.source_note_id],
        );
        if (!source.rowCount) throw missing();
      }
      const now = this.now();
      const current = (
        await client.query<CardRow>(
          "SELECT * FROM student_memory_cards WHERE user_id=$1 AND card_id=$2",
          [userId, id],
        )
      ).rows[0];
      if (
        (input.version === 0 && current) ||
        (input.version > 0 && (!current || current.version !== input.version))
      )
        throw conflict();
      const changed =
        current &&
        (current.front !== input.front || current.back !== input.back);
      const values = [
        userId,
        id,
        input.front,
        input.back,
        input.subject,
        input.source_note_id,
        now,
      ];
      const result = !current
        ? await client.query<CardRow>(
            `INSERT INTO student_memory_cards(user_id,card_id,front,back,subject,source_note_id,due_at)
            VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            values,
          )
        : await client.query<CardRow>(
            `UPDATE student_memory_cards SET front=$3,back=$4,subject=$5,source_note_id=$6,
            version=version+1,due_at=CASE WHEN $8 THEN $7 ELSE due_at END,
            memory_state=CASE WHEN $8 THEN NULL ELSE memory_state END,reviews=CASE WHEN $8 THEN 0 ELSE reviews END
            WHERE user_id=$1 AND card_id=$2 RETURNING *`,
            [...values, Boolean(changed)],
          );
      if (changed)
        await client.query(
          "UPDATE student_memory_day_cards SET completed=false WHERE user_id=$1 AND day=$2 AND card_id=$3",
          [userId, memoryDay(now), id],
        );
      return publicCard(result.rows[0]!);
    });
  }
  async removeCard(userId: string, id: string, version: number) {
    await withTransaction(this.pool, async (client) => {
      await this.lock(client, userId);
      if (
        !(
          await client.query(
            "DELETE FROM student_memory_cards WHERE user_id=$1 AND card_id=$2 AND version=$3 RETURNING card_id",
            [userId, id, version],
          )
        ).rowCount
      )
        throw conflict();
    });
  }
  async today(userId: string): Promise<MemoryToday> {
    return withTransaction(this.pool, async (client) => {
      await this.lock(client, userId);
      const now = this.now(),
        day = memoryDay(now);
      const started =
        (
          await client.query(
            "SELECT day FROM student_memory_days WHERE user_id=$1 AND day=$2",
            [userId, day],
          )
        ).rowCount! > 0;
      const rows = (
        await client.query<CardRow & { completed: boolean }>(
          `SELECT c.*,d.completed FROM student_memory_day_cards d
        JOIN student_memory_cards c USING(user_id,card_id) WHERE d.user_id=$1 AND d.day=$2 ORDER BY d.position`,
          [userId, day],
        )
      ).rows;
      const pending = rows.filter((r) => !r.completed);
      const due = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM student_memory_cards WHERE user_id=$1 AND due_at<=$2",
        [userId, now],
      );
      const future = pending
        .filter((r) => r.due_at > now)
        .map((r) => r.due_at.getTime());
      return {
        day,
        started,
        total: rows.length,
        completed: rows.filter((r) => r.completed).length,
        ready: pending.filter((r) => r.due_at <= now).map(publicCard),
        next_due_at: future.length
          ? new Date(Math.min(...future)).toISOString()
          : null,
        due_count: due.rows[0]!.count,
      };
    });
  }
  async startDay(userId: string) {
    await withTransaction(this.pool, async (client) => {
      await this.lock(client, userId);
      const now = this.now(),
        day = memoryDay(now);
      const candidates = await client.query<{ card_id: string }>(
        "SELECT card_id FROM student_memory_cards WHERE user_id=$1 AND due_at<=$2 ORDER BY due_at,card_id LIMIT 20",
        [userId, now],
      );
      if (!candidates.rowCount) return;
      // An empty day after explicit card deletion may be started again.
      await client.query(
        `DELETE FROM student_memory_days d WHERE user_id=$1 AND day=$2
        AND NOT EXISTS (SELECT 1 FROM student_memory_day_cards c WHERE c.user_id=d.user_id AND c.day=d.day)`,
        [userId, day],
      );
      const inserted = await client.query(
        "INSERT INTO student_memory_days(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING day",
        [userId, day],
      );
      if (!inserted.rowCount) return;
      for (const [position, card] of candidates.rows.entries())
        await client.query(
          "INSERT INTO student_memory_day_cards(user_id,day,card_id,position) VALUES($1,$2,$3,$4)",
          [userId, day, card.card_id, position],
        );
    });
    return this.today(userId);
  }
  async review(
    userId: string,
    input: MemoryReview,
  ): Promise<MemoryReviewResult> {
    return withTransaction(this.pool, async (client) => {
      await this.lock(client, userId);
      const previous = (
        await client.query<{ input: MemoryReview; result: MemoryReviewResult }>(
          "SELECT input,result FROM student_memory_reviews WHERE user_id=$1 AND request_id=$2",
          [userId, input.request_id],
        )
      ).rows[0];
      if (previous) {
        if (
          !(Object.keys(input) as (keyof MemoryReview)[]).every(
            (k) => previous.input[k] === input[k],
          )
        )
          throw conflict();
        return previous.result;
      }
      const now = this.now();
      if (input.day !== memoryDay(now))
        throw new StudyLibraryError(
          "MEMORY_DAY_CHANGED",
          "已进入新的一天，请重新载入今日卡片。",
        );
      const row = (
        await client.query<CardRow & { completed: boolean }>(
          `SELECT c.*,d.completed FROM student_memory_cards c
        JOIN student_memory_day_cards d USING(user_id,card_id)
        WHERE c.user_id=$1 AND c.card_id=$2 AND d.day=$3`,
          [userId, input.card_id, input.day],
        )
      ).rows[0];
      if (!row) throw missing();
      if (row.completed || row.version !== input.version || row.due_at > now)
        throw conflict();
      const next = scheduleMemoryCard(row.memory_state, input.rating, now);
      const updated = (
        await client.query<CardRow>(
          `UPDATE student_memory_cards SET memory_state=$3::jsonb,
        due_at=$4,reviews=reviews+1,version=version+1 WHERE user_id=$1 AND card_id=$2 RETURNING *`,
          [userId, input.card_id, JSON.stringify(next.state), next.due],
        )
      ).rows[0]!;
      await client.query(
        "UPDATE student_memory_day_cards SET completed=$4 WHERE user_id=$1 AND day=$2 AND card_id=$3",
        [userId, input.day, input.card_id, next.completed],
      );
      const result = { card: publicCard(updated), completed: next.completed };
      await client.query(
        "INSERT INTO student_memory_reviews(user_id,request_id,input,result) VALUES($1,$2,$3::jsonb,$4::jsonb)",
        [
          userId,
          input.request_id,
          JSON.stringify(input),
          JSON.stringify(result),
        ],
      );
      return result;
    });
  }
}
export type StudentStudyLibrary = Pick<
  PostgresStudentStudyLibrary,
  | "map"
  | "collections"
  | "collection"
  | "saveCollection"
  | "removeCollection"
  | "memberships"
  | "setMembership"
  | "cards"
  | "cardSeeds"
  | "saveCard"
  | "removeCard"
  | "today"
  | "startDay"
  | "review"
>;
