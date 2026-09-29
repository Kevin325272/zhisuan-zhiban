import {
  courseCatalogResponseSchema,
  courseChapterListSchema,
  courseCurriculumMapSchema,
  courseKnowledgePageSchema,
  courseQaPageSchema,
  courseReadingProgressResponseSchema,
  courseReadingProgressSchema,
  type CourseCatalogItem,
  type CourseContentBoundary,
  type CourseContentPageQuery,
  type CourseCurriculumChapter,
  type CourseReadingProgressUpdate,
} from "@xuetu/contracts";

import type { SqlQueryablePool } from "../../database/client.js";
import {
  CourseContentNotFoundError,
  CourseReadingPositionError,
  type CourseContentService,
} from "./course-content.js";

const AVAILABLE_NOTICE = "组成原理教材版本与页码已核验，资料使用授权未核验，仅限本地挑战杯演示。";
const PENDING_NOTICE = "课程讲解资料待接入；当前仅提供题库训练。";

function count(value: string | number | bigint) {
  return Number(value);
}

function availableBoundary(): CourseContentBoundary {
  return {
    usage_scope: "local_demo_only",
    license_status: "unverified",
    provenance_status: "source_unknown_unverified",
    notice: AVAILABLE_NOTICE,
  };
}

function pendingBoundary(): CourseContentBoundary {
  return {
    usage_scope: "local_demo_only",
    license_status: "unverified",
    provenance_status: "not_ingested",
    notice: PENDING_NOTICE,
  };
}

interface CatalogRow {
  course_id: string;
  slug: string;
  course_code: string;
  title: string;
  summary: string;
  question_subject: string;
  display_order: number;
  material_status: "available" | "pending";
  question_count: string | number | bigint;
  knowledge_chunk_count: string | number | bigint;
  core_concept_count: string | number | bigint;
  qa_example_count: string | number | bigint;
  chapter_count: string | number | bigint;
}

interface StartRow {
  course_slug: string;
  chunk_id: string;
  chapter: string;
  page: number;
}

interface ChapterRow {
  chapter: string;
  chunk_count: string | number | bigint;
  page_start: number;
  page_end: number;
  first_chunk_id: string;
}

interface KnowledgeRow {
  chunk_id: string;
  source_item_id: string;
  chapter: string;
  page: number;
  content_text: string;
}

interface FigureReferenceRow {
  reference_id: string;
  chunk_id: string;
  figure_label: string;
  reference_text: string;
  ordinal: number;
  asset_id: string;
  caption: string;
  textbook_title: string;
  author_name: string;
  edition: string;
  publisher: string;
  publication_year: number;
  isbn: string;
  print_page: number;
  pdf_physical_page: number;
  source_pdf_sha256: string;
  asset_sha256: string;
  storage_ref: string;
  mime_type: "image/png";
  pixel_width: number;
  pixel_height: number;
  verification_status: "human_verified";
  usage_scope: "local_demo_only";
  license_status: "unverified";
}

interface QaRow {
  qa_id: string;
  source_item_id: string;
  chapter: string | null;
  page: number | null;
  question_text: string;
  answer_text: string;
}

interface ReadingProgressRow {
  course_slug: string;
  chapter: string;
  chunk_id: string;
  chunk_offset: string | number | bigint;
  paragraph_index: number;
  source_expanded: boolean;
  updated_at: string | Date;
}

interface CurriculumModuleRow {
  course_id: string;
  module_id: string;
  chapter_id: string;
  source_chapter: string;
  chapter_title: string;
  chapter_ordinal: number;
  module_title: string;
  module_ordinal: number;
}

interface CurriculumConceptRow {
  concept_id: string;
  module_id: string;
  title: string;
  learning_objective: string;
  learning_note_kind: "misconception" | "reminder";
  learning_note_text: string;
  learning_explanation: unknown;
  case_prompt: string | null;
  practice_tags: unknown;
  practice_question_count: string | number | bigint;
  importance: "core" | "extended";
  review_status: "verified" | "needs_review";
  ordinal: number;
}

interface CurriculumSourceRow {
  concept_id: string;
  chunk_id: string;
  print_page: number;
  chunk_offset: string | number | bigint;
  ordinal: number;
}

interface CurriculumTermRow {
  concept_id: string;
  term_text: string;
  ordinal: number;
}

interface CurriculumPrerequisiteRow {
  concept_id: string;
  prerequisite_concept_id: string;
}

interface CurriculumFigureRow {
  concept_id: string;
  display_role: "primary" | "related";
  ordinal: number;
  figure_label: string;
  caption: string;
  storage_ref: string;
  mime_type: "image/png" | "image/webp";
  pixel_width: number;
  pixel_height: number;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

export class PostgresCourseContent implements CourseContentService {
  constructor(
    private readonly pool: SqlQueryablePool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listCourses() {
    const [catalogResult, startResult] = await Promise.all([
      this.pool.query<CatalogRow>(
        `SELECT c.course_id, e.slug, c.course_code, c.title, e.summary,
                e.question_subject, e.display_order, e.material_status,
                COALESCE(q.question_count, 0) AS question_count,
                COALESCE(k.knowledge_chunk_count, 0) AS knowledge_chunk_count,
                COALESCE(cm.core_concept_count, 0) AS core_concept_count,
                COALESCE(a.qa_example_count, 0) AS qa_example_count,
                COALESCE(cm.chapter_count, k.chapter_count, 0) AS chapter_count
         FROM course_catalog_entries e
         JOIN courses c ON c.course_id = e.course_id AND c.status = 'active'
         LEFT JOIN (
           SELECT subject, COUNT(*) AS question_count
           FROM questions
           GROUP BY subject
         ) q ON q.subject = e.question_subject
         LEFT JOIN (
           SELECT course_id, COUNT(*) AS knowledge_chunk_count,
                  COUNT(DISTINCT chapter) AS chapter_count
           FROM course_content_chunks
           GROUP BY course_id
         ) k ON k.course_id = e.course_id
         LEFT JOIN (
           SELECT c.course_id, COUNT(*) AS core_concept_count,
                  COUNT(DISTINCT m.chapter_id) AS chapter_count
           FROM course_core_concepts c
           JOIN course_learning_modules m ON m.module_id = c.module_id
           GROUP BY c.course_id
         ) cm ON cm.course_id = e.course_id
         LEFT JOIN (
           SELECT course_id, COUNT(*) AS qa_example_count
           FROM course_qa_examples
           GROUP BY course_id
         ) a ON a.course_id = e.course_id
         ORDER BY e.display_order`,
      ),
      this.pool.query<StartRow>(
        `SELECT e.slug AS course_slug, k.chunk_id, k.chapter, k.page
         FROM course_catalog_entries e
         JOIN course_learning_modules m ON m.course_id = e.course_id
         JOIN course_core_concepts c ON c.module_id = m.module_id
         JOIN course_concept_sources s ON s.concept_id = c.concept_id
         JOIN course_content_chunks k ON k.chunk_id = s.chunk_id
         WHERE e.material_status = 'available'
         ORDER BY e.display_order, m.chapter_ordinal, m.ordinal, c.ordinal, s.ordinal
         LIMIT 1`,
      ),
    ]);

    const courses: CourseCatalogItem[] = catalogResult.rows.map((row) => ({
      course_id: row.course_id,
      slug: row.slug,
      course_code: row.course_code,
      title: row.title,
      summary: row.summary,
      question_subject: row.question_subject,
      display_order: Number(row.display_order),
      question_count: count(row.question_count),
      material_status: row.material_status,
      knowledge_chunk_count: count(row.knowledge_chunk_count),
      core_concept_count: count(row.core_concept_count),
      qa_example_count: count(row.qa_example_count),
      chapter_count: count(row.chapter_count),
      source_boundary:
        row.material_status === "available" ? availableBoundary() : pendingBoundary(),
    }));
    const start = startResult.rows[0];
    return courseCatalogResponseSchema.parse({
      courses,
      recommended_start: start
        ? {
            course_slug: start.course_slug,
            chunk_id: start.chunk_id,
            chapter: start.chapter,
            page: Number(start.page),
            basis: "first_available_content",
          }
        : null,
      generated_at: this.now().toISOString(),
    });
  }

  private async assertCourse(courseSlug: string) {
    const result = await this.pool.query(
      `SELECT 1 FROM course_catalog_entries WHERE slug = $1 LIMIT 1`,
      [courseSlug],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new CourseContentNotFoundError(courseSlug);
    }
  }

  async listChapters(courseSlug: string) {
    await this.assertCourse(courseSlug);
    const result = await this.pool.query<ChapterRow>(
      `SELECT k.chapter, COUNT(*) AS chunk_count,
              MIN(k.page) AS page_start, MAX(k.page) AS page_end,
              (array_agg(k.chunk_id ORDER BY k.ordinal))[1] AS first_chunk_id
       FROM course_catalog_entries e
       JOIN course_content_chunks k ON k.course_id = e.course_id
       WHERE e.slug = $1
       GROUP BY k.chapter
       ORDER BY MIN(k.ordinal)`,
      [courseSlug],
    );
    return courseChapterListSchema.parse({
      course_slug: courseSlug,
      items: result.rows.map((row) => ({
        chapter: row.chapter,
        chunk_count: count(row.chunk_count),
        page_start: Number(row.page_start),
        page_end: Number(row.page_end),
        first_chunk_id: row.first_chunk_id,
      })),
    });
  }

  async getCurriculumMap(courseSlug: string) {
    await this.assertCourse(courseSlug);
    const [
      moduleResult,
      conceptResult,
      sourceResult,
      termResult,
      prerequisiteResult,
      figureResult,
    ] =
      await Promise.all([
        this.pool.query<CurriculumModuleRow>(
          `SELECT m.module_id, m.chapter_id, m.source_chapter, m.chapter_title,
                  m.chapter_ordinal, m.title AS module_title, m.ordinal AS module_ordinal,
                  e.course_id
           FROM course_catalog_entries e
           JOIN course_learning_modules m ON m.course_id = e.course_id
           WHERE e.slug = $1
           ORDER BY m.chapter_ordinal, m.ordinal`,
          [courseSlug],
        ),
        this.pool.query<CurriculumConceptRow>(
          `SELECT c.concept_id, c.module_id, c.title, c.learning_objective,
                  c.learning_note_kind, c.learning_note_text,
                  c.learning_explanation, c.case_prompt, c.practice_tags,
                  (
                    SELECT COUNT(*)
                    FROM course_concept_question_links link
                    WHERE link.concept_id = c.concept_id
                      AND link.status = 'active'
                  ) AS practice_question_count,
                  c.importance,
                  c.review_status, c.ordinal
           FROM course_catalog_entries e
           JOIN course_core_concepts c ON c.course_id = e.course_id
           JOIN course_learning_modules m ON m.module_id = c.module_id
           WHERE e.slug = $1
           ORDER BY m.chapter_ordinal, m.ordinal, c.ordinal`,
          [courseSlug],
        ),
        this.pool.query<CurriculumSourceRow>(
          `SELECT s.concept_id, s.chunk_id, s.print_page, s.ordinal,
                  (
                    SELECT COUNT(*)
                    FROM course_content_chunks earlier
                    WHERE earlier.course_id = k.course_id
                      AND earlier.chapter = k.chapter
                      AND earlier.ordinal < k.ordinal
                  ) AS chunk_offset
           FROM course_catalog_entries e
           JOIN course_core_concepts c ON c.course_id = e.course_id
           JOIN course_concept_sources s ON s.concept_id = c.concept_id
           JOIN course_content_chunks k ON k.chunk_id = s.chunk_id
           WHERE e.slug = $1
           ORDER BY c.concept_id, s.ordinal`,
          [courseSlug],
        ),
        this.pool.query<CurriculumTermRow>(
          `SELECT t.concept_id, t.term_text, t.ordinal
           FROM course_catalog_entries e
           JOIN course_core_concepts c ON c.course_id = e.course_id
           JOIN course_concept_terms t ON t.concept_id = c.concept_id
           WHERE e.slug = $1
           ORDER BY t.concept_id, t.ordinal`,
          [courseSlug],
        ),
        this.pool.query<CurriculumPrerequisiteRow>(
          `SELECT p.concept_id, p.prerequisite_concept_id
           FROM course_catalog_entries e
           JOIN course_core_concepts c ON c.course_id = e.course_id
           JOIN course_concept_prerequisites p ON p.concept_id = c.concept_id
           WHERE e.slug = $1
           ORDER BY p.concept_id, p.prerequisite_concept_id`,
          [courseSlug],
        ),
        this.pool.query<CurriculumFigureRow>(
          `SELECT figure_rows.concept_id, figure_rows.display_role,
                  figure_rows.ordinal, figure_rows.figure_label,
                  figure_rows.caption, figure_rows.storage_ref,
                  figure_rows.mime_type, figure_rows.pixel_width,
                  figure_rows.pixel_height
           FROM (
             SELECT f.concept_id, f.display_role, f.ordinal,
                    a.figure_label, a.caption, a.storage_ref, a.mime_type,
                    a.pixel_width, a.pixel_height
             FROM course_catalog_entries e
             JOIN course_core_concepts c ON c.course_id = e.course_id
             JOIN course_concept_figures f ON f.concept_id = c.concept_id
             JOIN course_figure_assets a
               ON a.asset_id = f.asset_id AND a.figure_label = f.figure_label
             WHERE e.slug = $1
               AND f.display_enabled = true
               AND f.match_confidence >= 0.920
               AND a.extraction_confidence >= 0.920
             UNION ALL
             SELECT sf.concept_id, sf.display_role, sf.ordinal,
                    REPLACE(a.figure_no, '-', '.') AS figure_label,
                    a.title AS caption,
                    '/api/v1/408/courses/' || e.slug || '/source-figures/' || a.figure_asset_id AS storage_ref,
                    'image/webp' AS mime_type,
                    (a.pixel_size ->> 'width')::integer AS pixel_width,
                    (a.pixel_size ->> 'height')::integer AS pixel_height
             FROM course_catalog_entries e
             JOIN course_core_concepts c ON c.course_id = e.course_id
             JOIN course_source_concept_figures sf ON sf.concept_id = c.concept_id
             JOIN course_source_figure_assets a
               ON a.figure_asset_id = sf.figure_asset_id
              AND a.course_id = e.course_id
             WHERE e.slug = $1
               AND sf.display_enabled = true
               AND sf.match_confidence >= 0.920
               AND a.image_available = true
               AND a.review_status <> 'needs_human_review'
           ) figure_rows
           ORDER BY figure_rows.concept_id, figure_rows.ordinal`,
          [courseSlug],
        ),
      ]);

    if (moduleResult.rows.length === 0 || conceptResult.rows.length === 0) {
      throw new CourseContentNotFoundError(courseSlug);
    }

    const sourcesByConcept = new Map<string, CurriculumSourceRow[]>();
    for (const source of sourceResult.rows) {
      const entries = sourcesByConcept.get(source.concept_id) ?? [];
      entries.push(source);
      sourcesByConcept.set(source.concept_id, entries);
    }
    const termsByConcept = new Map<string, string[]>();
    for (const term of termResult.rows) {
      const entries = termsByConcept.get(term.concept_id) ?? [];
      entries.push(term.term_text);
      termsByConcept.set(term.concept_id, entries);
    }
    const prerequisitesByConcept = new Map<string, string[]>();
    for (const prerequisite of prerequisiteResult.rows) {
      const entries = prerequisitesByConcept.get(prerequisite.concept_id) ?? [];
      entries.push(prerequisite.prerequisite_concept_id);
      prerequisitesByConcept.set(prerequisite.concept_id, entries);
    }
    const figuresByConcept = new Map<string, CurriculumFigureRow[]>();
    for (const figure of figureResult.rows) {
      const entries = figuresByConcept.get(figure.concept_id) ?? [];
      entries.push(figure);
      figuresByConcept.set(figure.concept_id, entries);
    }
    const conceptsByModule = new Map<string, CurriculumConceptRow[]>();
    for (const concept of conceptResult.rows) {
      const entries = conceptsByModule.get(concept.module_id) ?? [];
      entries.push(concept);
      conceptsByModule.set(concept.module_id, entries);
    }

    const chapters: CourseCurriculumChapter[] = [];
    for (const module of moduleResult.rows) {
      let chapter = chapters.find((item) => item.chapter_id === module.chapter_id);
      if (!chapter) {
        chapter = {
          chapter_id: module.chapter_id,
          source_chapter: module.source_chapter,
          title: module.chapter_title,
          ordinal: Number(module.chapter_ordinal),
          modules: [],
        };
        chapters.push(chapter);
      }
      chapter.modules.push({
        module_id: module.module_id,
        title: module.module_title,
        ordinal: Number(module.module_ordinal),
        concepts: (conceptsByModule.get(module.module_id) ?? []).map((concept) => {
          const figures = figuresByConcept.get(concept.concept_id) ?? [];
          const toStudentFigure = (figure: CurriculumFigureRow) => ({
            figure_label: figure.figure_label,
            caption: figure.caption,
            storage_ref: figure.storage_ref,
            mime_type: figure.mime_type,
            pixel_width: Number(figure.pixel_width),
            pixel_height: Number(figure.pixel_height),
          });
          const explanation = stringArray(concept.learning_explanation);
          const learningContent = concept.case_prompt && explanation.length > 0
            ? {
                explanation,
                case_prompt: concept.case_prompt,
                practice_tags: stringArray(concept.practice_tags),
              }
            : null;
          return {
            concept_id: concept.concept_id,
            title: concept.title,
            learning_objective: concept.learning_objective,
            prerequisite_concept_ids: prerequisitesByConcept.get(concept.concept_id) ?? [],
            key_terms: termsByConcept.get(concept.concept_id) ?? [],
            learning_note: {
              kind: concept.learning_note_kind,
              text: concept.learning_note_text,
            },
            learning_content: learningContent,
            sources: (sourcesByConcept.get(concept.concept_id) ?? []).map((source) => ({
              chunk_id: source.chunk_id,
              print_page: Number(source.print_page),
              chunk_offset: count(source.chunk_offset),
            })),
            importance: concept.importance,
            review_status: concept.review_status,
            ordinal: Number(concept.ordinal),
            practice_question_count: count(concept.practice_question_count),
            figure_guidance: {
              primary: figures.find((figure) => figure.display_role === "primary")
                ? toStudentFigure(
                    figures.find((figure) => figure.display_role === "primary")!,
                  )
                : null,
              related: figures
                .filter((figure) => figure.display_role === "related")
                .slice(0, 12)
                .map(toStudentFigure),
            },
          };
        }),
      });
    }

    const conceptCount = conceptResult.rows.length;
    const sourceReferenceCount = sourceResult.rows.length;
    return courseCurriculumMapSchema.parse({
      course_id: moduleResult.rows[0]?.course_id ?? "course_408_co",
      course_slug: courseSlug,
      title: "课程知识地图",
      curation_method: "source_constrained_course_design",
      chapters,
      concept_count: conceptCount,
      traceability: {
        source_reference_count: sourceReferenceCount,
        valid_source_reference_count: sourceReferenceCount,
        rate: sourceReferenceCount === 0 ? 0 : 1,
      },
      generated_at: this.now().toISOString(),
    });
  }

  async listKnowledge(courseSlug: string, query: CourseContentPageQuery) {
    await this.assertCourse(courseSlug);
    const parameters: unknown[] = [courseSlug];
    const chapterFilter = query.chapter
      ? (parameters.push(query.chapter), ` AND k.chapter = $${parameters.length}`)
      : "";
    const total = await this.pool.query<{ total: string | number | bigint }>(
      `SELECT COUNT(*) AS total
       FROM course_catalog_entries e
       JOIN course_content_chunks k ON k.course_id = e.course_id
       WHERE e.slug = $1${chapterFilter}`,
      parameters,
    );
    const limitPosition = parameters.push(query.limit);
    const offsetPosition = parameters.push(query.offset);
    const result = await this.pool.query<KnowledgeRow>(
      `SELECT k.chunk_id, k.source_item_id, k.chapter, k.page, k.content_text
       FROM course_catalog_entries e
       JOIN course_content_chunks k ON k.course_id = e.course_id
       WHERE e.slug = $1${chapterFilter}
       ORDER BY k.ordinal
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      parameters,
    );
    const chunkIds = result.rows.map((row) => row.chunk_id);
    const figures = chunkIds.length === 0
      ? { rows: [] as FigureReferenceRow[] }
      : await this.pool.query<FigureReferenceRow>(
          `SELECT r.reference_id, r.chunk_id, r.figure_label, r.reference_text,
                  r.ordinal, a.asset_id, a.caption, a.textbook_title,
                  a.author_name, a.edition, a.publisher, a.publication_year,
                  a.isbn, a.print_page, a.pdf_physical_page,
                  a.source_pdf_sha256, a.asset_sha256, a.storage_ref,
                  a.mime_type, a.pixel_width, a.pixel_height,
                  a.verification_status, a.usage_scope, a.license_status
           FROM course_figure_references r
           JOIN course_figure_assets a
             ON a.asset_id = r.asset_id AND a.figure_label = r.figure_label
           WHERE r.chunk_id = ANY($1::text[])
             AND a.verification_status = 'human_verified'
           ORDER BY r.chunk_id, r.ordinal`,
          [chunkIds],
        );
    const figuresByChunk = new Map<string, FigureReferenceRow[]>();
    for (const figure of figures.rows) {
      const entries = figuresByChunk.get(figure.chunk_id) ?? [];
      entries.push(figure);
      figuresByChunk.set(figure.chunk_id, entries);
    }
    return courseKnowledgePageSchema.parse({
      course_slug: courseSlug,
      items: result.rows.map((row) => ({
        chunk_id: row.chunk_id,
        source_item_id: row.source_item_id,
        chapter: row.chapter,
        page: Number(row.page),
        text: row.content_text,
        content_format: "plain_text",
        source_boundary: availableBoundary(),
        figure_references: (figuresByChunk.get(row.chunk_id) ?? []).map((figure) => ({
          reference_id: figure.reference_id,
          figure_label: figure.figure_label,
          reference_text: figure.reference_text,
          ordinal: Number(figure.ordinal),
          asset: {
            asset_id: figure.asset_id,
            figure_label: figure.figure_label,
            caption: figure.caption,
            textbook_title: figure.textbook_title,
            author_name: figure.author_name,
            edition: figure.edition,
            publisher: figure.publisher,
            publication_year: Number(figure.publication_year),
            isbn: figure.isbn,
            print_page: Number(figure.print_page),
            pdf_physical_page: Number(figure.pdf_physical_page),
            source_pdf_sha256: figure.source_pdf_sha256,
            asset_sha256: figure.asset_sha256,
            storage_ref: figure.storage_ref,
            mime_type: figure.mime_type,
            pixel_width: Number(figure.pixel_width),
            pixel_height: Number(figure.pixel_height),
            verification_status: figure.verification_status,
            usage_scope: figure.usage_scope,
            license_status: figure.license_status,
          },
        })),
      })),
      total: count(total.rows[0]?.total ?? 0),
      limit: query.limit,
      offset: query.offset,
    });
  }

  async listQaExamples(courseSlug: string, query: CourseContentPageQuery) {
    await this.assertCourse(courseSlug);
    const parameters: unknown[] = [courseSlug];
    const chapterFilter = query.chapter
      ? (parameters.push(query.chapter), ` AND q.chapter = $${parameters.length}`)
      : "";
    const total = await this.pool.query<{ total: string | number | bigint }>(
      `SELECT COUNT(*) AS total
       FROM course_catalog_entries e
       JOIN course_qa_examples q ON q.course_id = e.course_id
       WHERE e.slug = $1${chapterFilter}`,
      parameters,
    );
    const limitPosition = parameters.push(query.limit);
    const offsetPosition = parameters.push(query.offset);
    const result = await this.pool.query<QaRow>(
      `SELECT q.qa_id, q.source_item_id, q.chapter, q.page,
              q.question_text, q.answer_text
       FROM course_catalog_entries e
       JOIN course_qa_examples q ON q.course_id = e.course_id
       WHERE e.slug = $1${chapterFilter}
       ORDER BY q.ordinal
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      parameters,
    );
    return courseQaPageSchema.parse({
      course_slug: courseSlug,
      items: result.rows.map((row) => ({
        qa_id: row.qa_id,
        source_item_id: row.source_item_id,
        chapter: row.chapter,
        page: row.page === null ? null : Number(row.page),
        question: row.question_text,
        answer: row.answer_text,
        content_format: "plain_text",
        source_boundary: availableBoundary(),
      })),
      total: count(total.rows[0]?.total ?? 0),
      limit: query.limit,
      offset: query.offset,
    });
  }

  async getReadingProgress(userId: string, courseSlug: string) {
    const result = await this.pool.query<ReadingProgressRow>(
      `SELECT e.slug AS course_slug, p.chapter, p.chunk_id,
              (
                SELECT COUNT(*)
                FROM course_content_chunks earlier
                WHERE earlier.course_id = p.course_id
                  AND earlier.chapter = p.chapter
                  AND earlier.ordinal < k.ordinal
              ) AS chunk_offset,
              p.paragraph_index, p.source_expanded, p.updated_at
       FROM course_reading_progress p
       JOIN course_catalog_entries e ON e.course_id = p.course_id
       JOIN course_content_chunks k
         ON k.chunk_id = p.chunk_id AND k.course_id = p.course_id
       WHERE p.user_id = $1 AND e.slug = $2
       LIMIT 1`,
      [userId, courseSlug],
    );
    const row = result.rows[0];
    return courseReadingProgressResponseSchema.parse({
      progress: row
        ? {
            course_slug: row.course_slug,
            chapter: row.chapter,
            chunk_id: row.chunk_id,
            chunk_offset: count(row.chunk_offset),
            paragraph_index: Number(row.paragraph_index),
            source_expanded: row.source_expanded,
            updated_at:
              row.updated_at instanceof Date
                ? row.updated_at.toISOString()
                : new Date(row.updated_at).toISOString(),
          }
        : null,
    });
  }

  async saveReadingProgress(
    userId: string,
    courseSlug: string,
    update: CourseReadingProgressUpdate,
  ) {
    const stored = await this.pool.query(
      `WITH resolved AS (
         SELECT $1::text AS user_id, e.course_id, k.chunk_id,
                $4::text AS chapter, $5::integer AS paragraph_index,
                $6::boolean AS source_expanded, CURRENT_TIMESTAMP AS recorded_at
         FROM course_catalog_entries e
         JOIN course_content_chunks k
           ON k.chunk_id = $3
          AND k.course_id = e.course_id
          AND k.chapter = $4
         WHERE e.slug = $2
       ), saved_position AS (
         INSERT INTO course_reading_progress(
           user_id, course_id, chunk_id, chapter, paragraph_index,
           source_expanded, updated_at
         )
         SELECT user_id, course_id, chunk_id, chapter, paragraph_index,
                source_expanded, recorded_at
         FROM resolved
         ON CONFLICT (user_id, course_id) DO UPDATE
         SET chunk_id = EXCLUDED.chunk_id,
             chapter = EXCLUDED.chapter,
             paragraph_index = EXCLUDED.paragraph_index,
             source_expanded = EXCLUDED.source_expanded,
             updated_at = EXCLUDED.updated_at
         RETURNING user_id, course_id, chunk_id, chapter, paragraph_index, updated_at
       )
       INSERT INTO course_reading_history(
         user_id, course_id, chunk_id, chapter, max_paragraph_index,
         first_read_at, last_read_at
       )
       SELECT user_id, course_id, chunk_id, chapter, paragraph_index,
              updated_at, updated_at
       FROM saved_position
       ON CONFLICT (user_id, course_id, chunk_id) DO UPDATE
       SET chapter = EXCLUDED.chapter,
           max_paragraph_index = GREATEST(
             course_reading_history.max_paragraph_index,
             EXCLUDED.max_paragraph_index
           ),
           last_read_at = EXCLUDED.last_read_at
       RETURNING user_id`,
      [
        userId,
        courseSlug,
        update.chunk_id,
        update.chapter,
        update.paragraph_index,
        update.source_expanded,
      ],
    );
    if ((stored.rowCount ?? 0) === 0) {
      throw new CourseReadingPositionError(courseSlug, update.chunk_id);
    }
    const refreshed = await this.getReadingProgress(userId, courseSlug);
    if (!refreshed.progress) {
      throw new CourseReadingPositionError(courseSlug, update.chunk_id);
    }
    return courseReadingProgressSchema.parse(refreshed.progress);
  }
}
