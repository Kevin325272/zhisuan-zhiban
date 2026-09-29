import {
  notebookEntrySchema, questionNotebookId,
  type NotebookEntry, type NotebookList, type NotebookQuery, type NotebookQuestion, type NotebookWrite,
} from "@xuetu/contracts";
import type { SqlQueryablePool } from "../database/client.js";
import { DEMO_408_COURSE_IDS } from "../config/student-registration.js";
import { studentQuestionExposureSql, studentQuestionExposureWithLocalPastExamsSql } from "./question-bank/student-question-exposure.js";

export class NotebookError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}
export interface StudentNotebook {
  list(userId: string, query: NotebookQuery): Promise<NotebookList>;
  get(userId: string, id: string): Promise<NotebookEntry | null>;
  save(userId: string, id: string, input: NotebookWrite): Promise<NotebookEntry>;
  remove(userId: string, id: string, version: number): Promise<void>;
}
type EntryRow = Record<string, unknown> & { created_at: Date; updated_at: Date };
function entry(row: EntryRow): NotebookEntry {
  return notebookEntrySchema.parse({
    id: row.entry_id, title: row.title, content: row.content, subject: row.subject,
    question_id: row.question_id, question: row.question_snapshot, bookmarked: row.bookmarked,
    version: row.version, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(),
  });
}
function conflict(): never {
  throw new NotebookError("NOTEBOOK_CONFLICT", "这条笔记已在另一个页面更新，请重新读取后再保存。", 409);
}
export class PostgresStudentNotebook implements StudentNotebook {
  constructor(private readonly pool: SqlQueryablePool, private readonly allowLocalPastExams = false) {}

  async list(userId: string, query: NotebookQuery) {
    const search = `%${query.search.replace(/[\\%_]/gu, "\\$&")}%`;
    const where = `user_id=$1 AND (btrim(content)<>'' OR bookmarked) AND ($2::text IS NULL OR subject=$2)
      AND (title ILIKE $3 OR content ILIKE $3 OR question_snapshot->>'excerpt' ILIKE $3)
      AND ($4='all' OR ($4='notes' AND btrim(content)<>'') OR ($4='bookmarks' AND bookmarked))`;
    const values = [userId, query.subject ?? null, search, query.filter];
    const [rows, total, counts] = await Promise.all([
      this.pool.query<EntryRow>(`SELECT * FROM student_notebook_entries WHERE ${where} ORDER BY updated_at DESC, entry_id LIMIT $5 OFFSET $6`, [...values, query.limit, query.offset]),
      this.pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM student_notebook_entries WHERE ${where}`, values),
      this.pool.query<{ notes_count: number; bookmarks_count: number }>(`SELECT count(*) FILTER (WHERE btrim(content)<>'')::int AS notes_count, count(*) FILTER (WHERE bookmarked)::int AS bookmarks_count FROM student_notebook_entries WHERE user_id=$1`, [userId]),
    ]);
    return { items: rows.rows.map(entry), total: total.rows[0]!.total, ...counts.rows[0]! };
  }
  async get(userId: string, id: string) {
    const result = await this.pool.query<EntryRow>(`SELECT * FROM student_notebook_entries WHERE user_id=$1 AND entry_id=$2`, [userId, id]);
    return result.rows[0] ? entry(result.rows[0]) : null;
  }
  private async question(userId: string, questionId: string): Promise<NotebookQuestion> {
    const result = await this.pool.query<{
      question_id: string; year: number | null; number: number; subject: string;
      question_type: "choice" | "subjective"; question_text: string; tags: string[]; source_type: string;
    }>(`SELECT q.question_id,q.year,q.number,q.subject,q.question_type,left(q.question_text,600) AS question_text,q.tags,meta.source_type
      FROM questions q JOIN question_learning_metadata meta ON meta.question_id=q.question_id
      WHERE q.question_id=$2 AND q.review_status='approved'
      AND meta.source_type <> 'self_authored_screening'
      AND (meta.content_review_status='teacher_verified' OR ($3::boolean AND meta.content_review_status='demo_validated' AND q.usage_scope='local_demo_only' AND meta.source_type='past_exam'))
      AND EXISTS (SELECT 1 FROM course_memberships cm WHERE cm.user_id=$1
        AND (cm.course_id=q.course_id OR (q.course_id='course_408_001' AND cm.course_id=ANY($4::text[])))
        AND cm.membership_role='student' AND cm.status='active')
      AND ${this.allowLocalPastExams ? studentQuestionExposureWithLocalPastExamsSql : studentQuestionExposureSql}`, [userId, questionId, this.allowLocalPastExams, DEMO_408_COURSE_IDS]);
    const q = result.rows[0];
    if (!q) throw new NotebookError("NOTEBOOK_QUESTION_UNAVAILABLE", "当前题目不可用，请返回题库重新选择。", 404);
    const params = new URLSearchParams({ subject: q.subject, question_id: q.question_id, type: q.question_type });
    if (q.source_type === "past_exam" && q.year !== null) {
      params.set("mode", "past_exam"); params.set("year", String(q.year)); params.set("question", String(q.number));
    }
    return { id: q.question_id, year: q.year, number: q.number, subject: q.subject, type: q.question_type, excerpt: q.question_text, tags: q.tags.slice(0, 12), href: `/student/practice?${params}` };
  }
  async save(userId: string, id: string, input: NotebookWrite) {
    if ((input.question_id && id !== questionNotebookId(input.question_id)) || (!input.question_id && id.startsWith("question:"))) {
      throw new NotebookError("NOTEBOOK_ID_INVALID", "笔记与题目不匹配。", 400);
    }
    const existing = input.version > 0 ? await this.get(userId, id) : null;
    if (input.version > 0 && !existing) conflict();
    const question = input.question_id ? existing?.question ?? await this.question(userId, input.question_id) : null;
    const subject = question?.subject === "计算机组成原理" ? "组成原理" : question?.subject ?? input.subject;
    const values = [userId, id, input.title, input.content, subject, input.question_id, question ? JSON.stringify(question) : null, input.bookmarked];
    const result = input.version === 0
      ? await this.pool.query<EntryRow>(`INSERT INTO student_notebook_entries(user_id,entry_id,title,content,subject,question_id,question_snapshot,bookmarked) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT DO NOTHING RETURNING *`, values)
      : await this.pool.query<EntryRow>(`UPDATE student_notebook_entries SET title=$3,content=$4,subject=$5,question_snapshot=$7::jsonb,bookmarked=$8,version=version+1,updated_at=now() WHERE user_id=$1 AND entry_id=$2 AND question_id IS NOT DISTINCT FROM $6 AND version=$9 RETURNING *`, [...values, input.version]);
    if (!result.rows[0]) conflict();
    return entry(result.rows[0]);
  }
  async remove(userId: string, id: string, version: number) {
    const result = await this.pool.query(`DELETE FROM student_notebook_entries WHERE user_id=$1 AND entry_id=$2 AND version=$3`, [userId, id, version]);
    if (!result.rowCount) conflict();
  }
}
