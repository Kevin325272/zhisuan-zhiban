import {
  externalQuestionConceptCandidateSchema,
  externalQuestionSubjectSchema,
  type ExternalQuestionConceptCandidate,
  type ExternalQuestionSubject,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";

export interface ExternalQuestionConceptSource {
  conceptId: string;
  courseId: string;
  courseSlug:
    | "data-structures"
    | "computer-organization"
    | "operating-systems"
    | "computer-networks";
  title: string;
  learningObjective: string;
  terms: string[];
}

export interface RankedExternalQuestionConcept {
  conceptId: string;
  title: string;
  score: number;
  reason: string;
  candidate: ExternalQuestionConceptCandidate;
}

export interface ExternalQuestionConceptMatchInput {
  text: string;
  formulae: string[];
  diagramDescription: string | null;
  keywords: string[];
  concepts: ExternalQuestionConceptSource[];
}

export interface ExternalQuestionConceptMatcher {
  match(input: {
    userId: string;
    subject: ExternalQuestionSubject;
    text: string;
    formulae: string[];
    diagramDescription: string | null;
    keywords: string[];
  }): Promise<ExternalQuestionConceptCandidate[]>;
}

interface ConceptRow {
  concept_id: string;
  course_id: string;
  course_slug: string;
  title: string;
  learning_objective: string;
  terms: unknown;
}

const subjectCourse = {
  data_structures: {
    courseId: "course_408_ds",
    courseSlug: "data-structures",
    practiceSubject: "数据结构",
  },
  computer_organization: {
    courseId: "course_408_co",
    courseSlug: "computer-organization",
    practiceSubject: "组成原理",
  },
  operating_systems: {
    courseId: "course_408_os",
    courseSlug: "operating-systems",
    practiceSubject: "操作系统",
  },
  computer_networks: {
    courseId: "course_408_cn",
    courseSlug: "computer-networks",
    practiceSubject: "计算机网络",
  },
} as const satisfies Record<ExternalQuestionSubject, {
  courseId: string;
  courseSlug: ExternalQuestionConceptSource["courseSlug"];
  practiceSubject: string;
}>;

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function boundedStrings(value: unknown, maximum = 80) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum);
}

function titleTokens(title: string) {
  const tokens = title
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .split(/[\s\p{P}\p{S}]+/gu)
    .map(normalize)
    .filter((token) => token.length >= 2);
  return tokens.length > 0 ? [...new Set(tokens)] : [normalize(title)].filter(Boolean);
}

function reasonFor(input: {
  exactTitle: boolean;
  matchingTerm: string | null;
  titleMatched: boolean;
  objectiveMatched: boolean;
}) {
  if (input.exactTitle) return "题目关键词与概念标题精确一致。";
  if (input.matchingTerm) return `题目关键词命中课程术语“${input.matchingTerm.slice(0, 40)}”。`;
  if (input.titleMatched) return "题干中出现了该概念标题。";
  if (input.objectiveMatched) return "题目关键词与该概念的学习目标一致。";
  return "题目内容与该课程概念相关。";
}

function candidateFor(source: ExternalQuestionConceptSource, reason: string) {
  const course = Object.values(subjectCourse).find((item) => item.courseId === source.courseId);
  if (!course || course.courseSlug !== source.courseSlug) {
    throw new Error("External-question concept has an unsupported course mapping.");
  }
  return externalQuestionConceptCandidateSchema.parse({
    concept_id: source.conceptId,
    course_id: source.courseId,
    course_slug: source.courseSlug,
    title: source.title,
    reason,
    reading_href: `/student/courses/${source.courseSlug}?concept_id=${encodeURIComponent(source.conceptId)}`,
    practice_href: `/student/practice?subject=${encodeURIComponent(course.practiceSubject)}&concept_id=${encodeURIComponent(source.conceptId)}`,
  });
}

export function rankExternalQuestionConcepts(
  input: ExternalQuestionConceptMatchInput,
): RankedExternalQuestionConcept[] {
  const segments = [
    input.text,
    ...input.formulae,
    input.diagramDescription ?? "",
  ].map(normalize).filter(Boolean);
  const searchable = segments.join("");
  const normalizedKeywords = input.keywords
    .map(normalize)
    .filter((item) => item.length >= 2 && searchable.includes(item));
  const exactSegments = new Set([...segments, ...normalizedKeywords]);

  return input.concepts
    .map((source): RankedExternalQuestionConcept | null => {
      const normalizedTitle = normalize(source.title);
      if (!normalizedTitle) return null;
      const exactTitle = exactSegments.has(normalizedTitle);
      const matchingTerm = source.terms.find((term) => {
        const normalizedTerm = normalize(term);
        return normalizedTerm.length >= 2 && (
          searchable.includes(normalizedTerm)
          || normalizedKeywords.some((keyword) => keyword === normalizedTerm || keyword.includes(normalizedTerm))
        );
      }) ?? null;
      const titleMatched = titleTokens(source.title).some((token) => searchable.includes(token));
      const normalizedObjective = normalize(source.learningObjective);
      const objectiveMatched = normalizedKeywords.some((keyword) => normalizedObjective.includes(keyword));

      const score = Math.min(
        8,
        (exactTitle ? 8 : 0)
          + (matchingTerm ? 4 : 0)
          + (titleMatched ? 2 : 0)
          + (objectiveMatched ? 1 : 0),
      );
      if (score < 4) return null;
      const reason = reasonFor({ exactTitle, matchingTerm, titleMatched, objectiveMatched });
      return {
        conceptId: source.conceptId,
        title: source.title,
        score,
        reason,
        candidate: candidateFor(source, reason),
      };
    })
    .filter((item): item is RankedExternalQuestionConcept => item !== null)
    .sort((left, right) => right.score - left.score || left.conceptId.localeCompare(right.conceptId))
    .slice(0, 8);
}

export class PostgresExternalQuestionConceptMatcher implements ExternalQuestionConceptMatcher {
  constructor(private readonly pool: SqlQueryablePool) {}

  async match(input: {
    userId: string;
    subject: ExternalQuestionSubject;
    text: string;
    formulae: string[];
    diagramDescription: string | null;
    keywords: string[];
  }): Promise<ExternalQuestionConceptCandidate[]> {
    const subject = externalQuestionSubjectSchema.parse(input.subject);
    const course = subjectCourse[subject];
    const result = await this.pool.query<ConceptRow>(
      `SELECT concept.concept_id,
              concept.course_id,
              catalog.slug AS course_slug,
              concept.title,
              concept.learning_objective,
              COALESCE(ARRAY(
                SELECT term.term_text
                FROM course_concept_terms term
                WHERE term.concept_id = concept.concept_id
                ORDER BY term.ordinal
              ), '{}') AS terms
       FROM course_core_concepts concept
       JOIN course_catalog_entries catalog ON catalog.course_id = concept.course_id
       JOIN course_memberships membership
         ON membership.course_id = concept.course_id
        AND membership.user_id = $1
        AND membership.membership_role = 'student'
        AND membership.status = 'active'
       WHERE concept.course_id = $2
         AND concept.review_status = 'verified'
       ORDER BY concept.concept_id`,
      [input.userId, course.courseId],
    );
    const concepts = result.rows.map((row): ExternalQuestionConceptSource => {
      if (row.course_id !== course.courseId || row.course_slug !== course.courseSlug) {
        throw new Error("External-question concept course mapping is inconsistent.");
      }
      return {
        conceptId: row.concept_id,
        courseId: row.course_id,
        courseSlug: course.courseSlug,
        title: row.title,
        learningObjective: row.learning_objective,
        terms: boundedStrings(row.terms),
      };
    });
    return rankExternalQuestionConcepts({
      text: input.text,
      formulae: input.formulae,
      diagramDescription: input.diagramDescription,
      keywords: input.keywords,
      concepts,
    }).map((item) => item.candidate);
  }
}
