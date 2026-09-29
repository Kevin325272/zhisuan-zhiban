import { withTransaction, type SqlPool } from "./client.js";

/**
 * Build only deterministic, source-constrained associations. A question tag
 * must exactly equal a concept title/term/practice tag after whitespace
 * normalization. Ambiguous tags are excluded unless the concept title itself
 * contains the tag. This is a rule-based availability index, not human
 * annotation and not an AI classification claim.
 */
export async function seedConceptPracticeLinks(pool: SqlPool) {
  return withTransaction(pool, async (client) => {
    await client.query(`
      UPDATE course_concept_question_links link
      SET status = 'disabled', updated_at = now()
      WHERE link.concept_id IN (
        SELECT concept_id
        FROM course_core_concepts
        WHERE course_id IN ('course_408_ds', 'course_408_co', 'course_408_os', 'course_408_cn')
      )
    `);

    const result = await client.query<{ active_count: string }>(`
      WITH course_subject(course_id, subject) AS (
        VALUES
          ('course_408_ds', '数据结构'),
          ('course_408_co', '组成原理'),
          ('course_408_os', '操作系统'),
          ('course_408_cn', '计算机网络')
      ),
      terms AS (
        SELECT c.course_id, c.concept_id, c.title,
               lower(regexp_replace(term_source.term, '\\s+', '', 'g')) AS normalized_term
        FROM course_core_concepts c
        CROSS JOIN LATERAL (
          SELECT c.title AS term
          UNION
          SELECT term_text FROM course_concept_terms t WHERE t.concept_id = c.concept_id
          UNION
          SELECT jsonb_array_elements_text(COALESCE(c.practice_tags, '[]'::jsonb))
        ) term_source
        WHERE c.review_status = 'verified'
      ),
      candidates AS (
        SELECT DISTINCT t.course_id, t.concept_id, t.title, q.question_id, qt.tag
        FROM terms t
        JOIN course_subject cs ON cs.course_id = t.course_id
        JOIN questions q
          ON q.subject = cs.subject
         AND q.question_type = 'choice'
         AND q.review_status <> 'rejected'
        CROSS JOIN LATERAL unnest(q.tags) qt(tag)
        WHERE lower(regexp_replace(qt.tag, '\\s+', '', 'g')) = t.normalized_term
      ),
      unique_tags AS (
        SELECT course_id, tag, COUNT(DISTINCT concept_id) AS concept_count
        FROM candidates
        GROUP BY course_id, tag
      ),
      safe_candidates AS (
        SELECT c.*
        FROM candidates c
        JOIN unique_tags u USING (course_id, tag)
        WHERE u.concept_count = 1
           OR lower(regexp_replace(c.title, '\\s+', '', 'g'))
              LIKE '%' || lower(regexp_replace(c.tag, '\\s+', '', 'g')) || '%'
      ),
      upserted AS (
        INSERT INTO course_concept_question_links(
          concept_id, question_id, matched_tag, match_method, rule_version,
          status, created_at, updated_at
        )
        SELECT DISTINCT ON (concept_id, question_id)
          concept_id, question_id, tag, 'exact_question_tag',
          'v1_exact_unique_tag', 'active', now(), now()
        FROM safe_candidates
        ORDER BY concept_id, question_id, length(tag), tag
        ON CONFLICT (concept_id, question_id) DO UPDATE SET
          matched_tag = EXCLUDED.matched_tag,
          match_method = EXCLUDED.match_method,
          rule_version = EXCLUDED.rule_version,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
        RETURNING 1
      )
      SELECT COUNT(*)::text AS active_count FROM upserted
    `);

    const count = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM course_concept_question_links
       WHERE status = 'active' AND match_method = 'exact_question_tag'`,
    );
    return { activeLinks: Number(count.rows[0]?.count ?? result.rows[0]?.active_count ?? 0) };
  });
}
