import type {
  StudyMap,
  StudyMapQuery,
  StudyQuestion,
  StudyTopic,
} from "@xuetu/contracts";
import type { SqlQueryablePool } from "../../database/client.js";
import { DEMO_408_COURSE_IDS } from "../../config/student-registration.js";
import {
  studentQuestionExposureSql,
  studentQuestionExposureWithLocalPastExamsSql,
} from "../question-bank/student-question-exposure.js";
import { questionKeywordTopics } from "./question-keywords.js";

export function buildStudyMap(
  questions: StudyQuestion[],
  query: StudyMapQuery,
): StudyMap {
  const base = questions.filter(
    (q) =>
      (query.source === "all" || q.source === query.source) &&
      (!query.subject || q.subject === query.subject),
  );
  const items = base.filter(
    (q) =>
      (!query.year || q.year === query.year) &&
      (!query.topic || q.topics.some((t) => t.id === query.topic)) &&
      (!query.search ||
        [q.excerpt, ...q.topics.map((t) => t.title)]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query.search.toLocaleLowerCase())) &&
      (query.status === "all" || q.status === query.status),
  );
  const topicMap = new Map<
    string,
    StudyTopic & { count: number; years: Set<number> }
  >();
  for (const q of items)
    for (const topic of q.topics) {
      const value = topicMap.get(topic.id) ?? {
        ...topic,
        count: 0,
        years: new Set<number>(),
      };
      value.count++;
      if (q.year && q.source === "past_exam") value.years.add(q.year);
      topicMap.set(topic.id, value);
    }
  return {
    items,
    total: items.length,
    attempted: items.filter((q) => q.status !== "unseen").length,
    correct: items.filter((q) => q.status === "correct").length,
    years: [...new Set(base.flatMap((q) => (q.year ? [q.year] : [])))].sort(
      (a, b) => b - a,
    ),
    topics: [...topicMap.values()]
      .map((t) => ({ ...t, years: t.years.size }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
  };
}

export class QuestionInventory {
  constructor(
    private pool: SqlQueryablePool,
    private allowLocalPastExams = false,
  ) {}
  async list(userId: string): Promise<StudyQuestion[]> {
    const exposure = this.allowLocalPastExams
      ? studentQuestionExposureWithLocalPastExamsSql
      : studentQuestionExposureSql;
    const result = await this.pool.query<{
      id: string;
      year: number | null;
      number: number;
      subject: string;
      type: StudyQuestion["type"];
      source: StudyQuestion["source"];
      excerpt: string;
      stem: string;
      tags: string[];
      topics: StudyTopic[];
      status: StudyQuestion["status"];
    }>(
      `SELECT q.question_id AS id, q.year, q.number, q.subject, q.question_type AS type,
      CASE WHEN meta.source_type='past_exam' THEN 'past_exam' ELSE 'practice' END AS source,
      left(q.question_text,180) AS excerpt, q.question_text AS stem, q.tags,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.concept_id,'title',c.title) ORDER BY c.concept_id)
        FROM course_concept_question_links l JOIN course_core_concepts c ON c.concept_id=l.concept_id
        WHERE l.question_id=q.question_id AND l.status='active' AND c.review_status='verified'), '[]') AS topics,
      COALESCE(last_answer.status,'unseen') AS status
      FROM questions q JOIN question_learning_metadata meta USING(question_id)
      LEFT JOIN LATERAL (SELECT COALESCE(e.status,'pending_review') AS status
        FROM practice_attempts a LEFT JOIN evaluations e USING(attempt_id)
        WHERE a.user_id=$1 AND a.question_id=q.question_id
        ORDER BY a.submitted_at DESC,a.attempt_id DESC LIMIT 1) last_answer ON true
      WHERE q.review_status='approved' AND (
        (meta.content_review_status='teacher_verified' AND 'targeted'=ANY(meta.allowed_modes)
          AND NOT meta.protect_full_paper AND meta.source_type<>'self_authored_screening'
          AND ${studentQuestionExposureSql})
        OR (meta.source_type='past_exam' AND 'past_exam'=ANY(meta.allowed_modes) AND ${exposure}
          AND (meta.content_review_status='teacher_verified' OR ($2 AND meta.content_review_status='demo_validated'
            AND q.usage_scope='local_demo_only')))
      ) AND (meta.source_type<>'past_exam' OR q.course_id='course_408_001')
      AND EXISTS (SELECT 1 FROM course_memberships cm WHERE cm.user_id=$1
        AND cm.membership_role='student' AND cm.status='active'
        AND (cm.course_id=q.course_id OR (q.course_id='course_408_001' AND cm.course_id=ANY($3::text[]))))
      ORDER BY q.year DESC NULLS LAST,q.number,q.question_id`,
      [userId, this.allowLocalPastExams, DEMO_408_COURSE_IDS],
    );
    // The existing past-paper practice endpoint accepts complete 47-question papers only.
    const years = new Map<number, typeof result.rows>();
    for (const row of result.rows)
      if (row.source === "past_exam" && row.year) {
        const group = years.get(row.year) ?? [];
        group.push(row);
        years.set(row.year, group);
      }
    const complete = new Set(
      [...years]
        .filter(
          ([, rows]) =>
            rows.length === 47 &&
            new Set(rows.map((q) => q.number)).size === 47 &&
            rows.every((q) => q.number >= 1 && q.number <= 47) &&
            rows.filter((q) => q.type === "choice").length === 40 &&
            rows.filter((q) => q.type === "subjective").length === 7 &&
            ["数据结构", "组成原理", "操作系统", "计算机网络"].every((s) =>
              rows.some((q) => q.subject === s),
            ),
        )
        .map(([year]) => year),
    );
    return result.rows
      .filter(
        (q) =>
          q.source !== "past_exam" || (q.year !== null && complete.has(q.year)),
      )
      .map((q) => {
        const topics: StudyTopic[] = q.topics.length
          ? q.topics.map((t) => ({ ...t, kind: "concept" }))
          : q.tags.length
            ? [...new Set(q.tags)].map((tag) => ({
                id: `tag:${q.subject}:${tag}`,
                title: tag,
              }))
            : questionKeywordTopics(q.subject, q.stem);
        const params =
          q.source === "past_exam"
            ? new URLSearchParams({
                mode: "past_exam",
                year: String(q.year),
                question: String(q.number),
              })
            : new URLSearchParams({
                mode: "targeted",
                subject: q.subject,
                type: q.type,
                question_id: q.id,
              });
        return {
          id: q.id,
          year: q.year,
          number: q.number,
          subject: q.subject,
          type: q.type,
          source: q.source,
          excerpt: q.excerpt,
          topics,
          status: q.status,
          href: `/student/practice?${params}`,
        };
      });
  }
}
