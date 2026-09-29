import {
  flattenComputerNetworksConcepts,
  loadComputerNetworksCurriculum,
  validateComputerNetworksCurriculumAgainstChunks,
  type ComputerNetworksCurriculumSource,
} from "../services/course-content/computer-networks-curriculum-source.js";
import type { SqlQueryablePool } from "./client.js";
import { withTransaction } from "./client.js";

interface DatasetRow {
  dataset_id: string;
  archive_sha256: string;
  license_status: string;
  usage_scope: string;
}

interface ChunkRow {
  chunk_id: string;
  source_item_id: string;
  chapter: string;
  printed_page: number;
  content_text: string;
  ordinal: number;
}

interface FigureRow {
  figure_asset_id: string;
  source_chunk_id: string;
  figure_no: string;
  title: string;
  review_status: string;
  image_available: boolean;
  confidence: string;
}

const SOURCE_ID = "cn_curriculum_map_v1";
const COURSE_ID = "course_408_cn";
const DATASET_ID = "408-three-course-source-v1_course_408_cn";

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function sourceReferences(source: ComputerNetworksCurriculumSource) {
  return flattenComputerNetworksConcepts(source).flatMap((concept) => concept.sources);
}

function assertDataset(dataset: DatasetRow | undefined, source: ComputerNetworksCurriculumSource) {
  if (!dataset) throw new Error("408 computer-networks source dataset is not seeded.");
  if (dataset.archive_sha256.toLowerCase() !== source.source_archive_sha256) {
    throw new Error("Computer networks curriculum archive hash does not match source dataset.");
  }
  if (dataset.license_status !== "unverified" || dataset.usage_scope !== "local_demo_only") {
    throw new Error("Computer networks source boundary is not the tracked local-demo boundary.");
  }
}

export interface ComputerNetworksCurriculumSeedResult {
  source: number;
  chunks: number;
  modules: number;
  concepts: number;
  sourceReferences: number;
  figureLinks: number;
}

export async function seedComputerNetworksCurriculum(
  pool: SqlQueryablePool,
  source: ComputerNetworksCurriculumSource = loadComputerNetworksCurriculum(),
  now: () => Date = () => new Date(),
): Promise<ComputerNetworksCurriculumSeedResult> {
  const references = sourceReferences(source);
  const chunkIds = unique(references.map((reference) => reference.chunk_id));
  const [datasetResult, chunkResult] = await Promise.all([
    pool.query<DatasetRow>(
      `SELECT dataset_id, archive_sha256, license_status, usage_scope
       FROM course_source_datasets
       WHERE dataset_id = $1 AND course_id = $2`,
      [DATASET_ID, COURSE_ID],
    ),
    pool.query<ChunkRow>(
      `SELECT chunk_id, source_item_id, chapter, printed_page, content_text, ordinal
       FROM course_source_chunks
       WHERE course_id = $1 AND chunk_id = ANY($2::text[])`,
      [COURSE_ID, chunkIds],
    ),
  ]);
  assertDataset(datasetResult.rows[0], source);
  const chunksById = new Map(
    chunkResult.rows.map((chunk) => [chunk.chunk_id, {
      chapter: chunk.chapter,
      printed_page: Number(chunk.printed_page),
    }]),
  );
  validateComputerNetworksCurriculumAgainstChunks(source, chunksById);
  if (chunksById.size !== chunkIds.length) {
    throw new Error("Computer networks curriculum references an unseeded source chunk.");
  }

  const figureRequests = flattenComputerNetworksConcepts(source)
    .flatMap((concept) => concept.figure_guidance?.primary
      ? [{ concept, figure: concept.figure_guidance.primary }]
      : []);
  const figureResult = figureRequests.length === 0
    ? { rows: [] as FigureRow[] }
    : await pool.query<FigureRow>(
        `SELECT sr.figure_asset_id, sr.source_chunk_id, sf.figure_no, sf.title,
                sf.review_status, sf.image_available, sr.confidence
         FROM course_source_figure_relations sr
         JOIN course_source_figure_assets sf
           ON sf.figure_asset_id = sr.figure_asset_id
          AND sf.course_id = sr.course_id
         WHERE sr.course_id = $1
           AND sr.figure_asset_id = ANY($2::text[])
           AND sr.confidence = 'high'
           AND sf.image_available = true
           AND sf.review_status <> 'needs_human_review'`,
        [COURSE_ID, figureRequests.map(({ figure }) => figure.asset_id)],
      );
  const figuresByAsset = new Map(figureResult.rows.map((row) => [row.figure_asset_id, row]));
  for (const request of figureRequests) {
    const row = figuresByAsset.get(request.figure.asset_id);
    if (!row
      || row.source_chunk_id !== request.figure.source_chunk_id
      || row.figure_no.replace("-", ".") !== request.figure.figure_label
      || row.confidence !== "high"
      || !row.image_available
      || row.review_status === "needs_human_review") {
      throw new Error(`Figure ${request.figure.figure_label} failed the high-confidence source check.`);
    }
  }

  const timestamp = now();
  const curriculumModules = source.chapters.flatMap((chapter) => chapter.modules);
  const concepts = flattenComputerNetworksConcepts(source);
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO course_content_sources(
         source_id, course_id, dataset_id, source_kind, title,
         source_provider, author_name, edition, original_path, storage_ref,
         sha256, record_count, license_status, usage_scope, provenance_status,
         ingestion_mode, imported_at, updated_at
       ) VALUES ($1,$2,$3,'curriculum_map',$4,$5,$6,$7,$8,$9,$10,$11,
                 'unverified','local_demo_only','source_unknown_unverified',
                 'postgresql_content',$12,$12)
       ON CONFLICT (source_id) DO UPDATE SET
         course_id = EXCLUDED.course_id,
         dataset_id = EXCLUDED.dataset_id,
         title = EXCLUDED.title,
         source_provider = EXCLUDED.source_provider,
         author_name = EXCLUDED.author_name,
         edition = EXCLUDED.edition,
         original_path = EXCLUDED.original_path,
         storage_ref = EXCLUDED.storage_ref,
         sha256 = EXCLUDED.sha256,
         record_count = EXCLUDED.record_count,
         license_status = EXCLUDED.license_status,
         usage_scope = EXCLUDED.usage_scope,
         provenance_status = EXCLUDED.provenance_status,
         ingestion_mode = EXCLUDED.ingestion_mode,
         updated_at = EXCLUDED.updated_at`,
      [
        SOURCE_ID,
        COURSE_ID,
        DATASET_ID,
        "计算机网络课程化知识地图（来源约束版）",
        "408-three-course-source-v1",
        "用户提供的 408 源资料",
        "第8版（源层元数据）",
        "data/course-materials/408-three-courses/curated/computer-networks-curriculum.json",
        "data/course-materials/408-three-courses/curated/computer-networks-curriculum.json",
        source.source_archive_sha256,
        chunkIds.length,
        timestamp,
      ],
    );

    await client.query(
      `DELETE FROM course_source_concept_figures
       WHERE concept_id IN (SELECT concept_id FROM course_core_concepts WHERE course_id = $1)`,
      [COURSE_ID],
    );
    await client.query(
      `DELETE FROM course_concept_sources
       WHERE concept_id IN (SELECT concept_id FROM course_core_concepts WHERE course_id = $1)`,
      [COURSE_ID],
    );
    await client.query(
      `DELETE FROM course_concept_terms
       WHERE concept_id IN (SELECT concept_id FROM course_core_concepts WHERE course_id = $1)`,
      [COURSE_ID],
    );
    await client.query(
      `DELETE FROM course_concept_prerequisites
       WHERE concept_id IN (SELECT concept_id FROM course_core_concepts WHERE course_id = $1)`,
      [COURSE_ID],
    );
    for (const chunk of chunkResult.rows) {
      if (!chunkIds.includes(chunk.chunk_id)) continue;
      await client.query(
        `INSERT INTO course_content_chunks(
           chunk_id, source_id, course_id, source_item_id, chapter, page,
           ordinal, content_text, content_format, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'plain_text',$9,$9)
         ON CONFLICT (chunk_id) DO UPDATE SET
           source_id = EXCLUDED.source_id,
           course_id = EXCLUDED.course_id,
           source_item_id = EXCLUDED.source_item_id,
           chapter = EXCLUDED.chapter,
           page = EXCLUDED.page,
           ordinal = EXCLUDED.ordinal,
           content_text = EXCLUDED.content_text,
           content_format = EXCLUDED.content_format,
           updated_at = EXCLUDED.updated_at`,
        [chunk.chunk_id, SOURCE_ID, COURSE_ID, chunk.source_item_id, chunk.chapter,
          chunk.printed_page, Number(chunk.ordinal), chunk.content_text, timestamp],
      );
    }

    for (const curriculumChapter of source.chapters) {
      for (const learningModule of curriculumChapter.modules) {
        await client.query(
          `INSERT INTO course_learning_modules(
             module_id, source_id, course_id, chapter_id, source_chapter,
             chapter_title, chapter_ordinal, title, ordinal, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
           ON CONFLICT (module_id) DO UPDATE SET
             source_id = EXCLUDED.source_id,
             course_id = EXCLUDED.course_id,
             chapter_id = EXCLUDED.chapter_id,
             source_chapter = EXCLUDED.source_chapter,
             chapter_title = EXCLUDED.chapter_title,
             chapter_ordinal = EXCLUDED.chapter_ordinal,
             title = EXCLUDED.title,
             ordinal = EXCLUDED.ordinal,
             updated_at = EXCLUDED.updated_at`,
          [learningModule.module_id, SOURCE_ID, COURSE_ID, curriculumChapter.chapter_id,
            curriculumChapter.source_chapter, curriculumChapter.title, curriculumChapter.ordinal,
            learningModule.title, learningModule.ordinal, timestamp],
        );
        for (const curriculumConcept of learningModule.concepts) {
          await client.query(
            `INSERT INTO course_core_concepts(
               concept_id, module_id, course_id, title, learning_objective,
               learning_note_kind, learning_note_text, learning_explanation,
               case_prompt, practice_tags, importance, review_status, ordinal,
                created_at, updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$14)
              ON CONFLICT (concept_id) DO UPDATE SET
                module_id = EXCLUDED.module_id,
                course_id = EXCLUDED.course_id,
                title = EXCLUDED.title,
                learning_objective = EXCLUDED.learning_objective,
                learning_note_kind = EXCLUDED.learning_note_kind,
                learning_note_text = EXCLUDED.learning_note_text,
                learning_explanation = EXCLUDED.learning_explanation,
                case_prompt = EXCLUDED.case_prompt,
                practice_tags = EXCLUDED.practice_tags,
                importance = EXCLUDED.importance,
                review_status = EXCLUDED.review_status,
                ordinal = EXCLUDED.ordinal,
                updated_at = EXCLUDED.updated_at`,
            [curriculumConcept.concept_id, learningModule.module_id, COURSE_ID,
              curriculumConcept.title, curriculumConcept.learning_objective,
              curriculumConcept.learning_note.kind, curriculumConcept.learning_note.text,
              JSON.stringify(curriculumConcept.learning_content.explanation),
              curriculumConcept.learning_content.case_prompt,
              JSON.stringify(curriculumConcept.learning_content.practice_tags),
              curriculumConcept.importance, curriculumConcept.review_status,
              curriculumConcept.ordinal, timestamp],
          );
          for (const [index, reference] of curriculumConcept.sources.entries()) {
            await client.query(
              `INSERT INTO course_concept_sources(concept_id, chunk_id, print_page, ordinal)
               VALUES ($1,$2,$3,$4)`,
              [curriculumConcept.concept_id, reference.chunk_id, reference.print_page, index + 1],
            );
          }
          for (const [index, term] of curriculumConcept.key_terms.entries()) {
            await client.query(
              `INSERT INTO course_concept_terms(concept_id, term_text, ordinal)
               VALUES ($1,$2,$3)`,
              [curriculumConcept.concept_id, term, index + 1],
            );
          }
          for (const prerequisite of curriculumConcept.prerequisite_concept_ids) {
            await client.query(
              `INSERT INTO course_concept_prerequisites(concept_id, prerequisite_concept_id)
               VALUES ($1,$2)`,
              [curriculumConcept.concept_id, prerequisite],
            );
          }
          const primary = curriculumConcept.figure_guidance?.primary;
          const figureRow = primary ? figuresByAsset.get(primary.asset_id) : undefined;
          if (primary && figureRow) {
            await client.query(
              `INSERT INTO course_source_concept_figures(
                 link_id, concept_id, figure_asset_id, source_chunk_id,
                 display_role, match_confidence, display_enabled, ordinal,
                 created_at, updated_at
               ) VALUES ($1,$2,$3,$4,'primary',1,true,1,$5,$5)`,
              [`cn_link_${curriculumConcept.concept_id}_${primary.asset_id}`,
                curriculumConcept.concept_id, primary.asset_id, primary.source_chunk_id, timestamp],
            );
          }
        }
      }
    }
    await client.query(
      `UPDATE course_catalog_entries SET material_status = 'available', updated_at = $2
       WHERE course_id = $1`,
      [COURSE_ID, timestamp],
    );
  });

  return {
    source: 1,
    chunks: chunkIds.length,
    modules: curriculumModules.length,
    concepts: concepts.length,
    sourceReferences: references.length,
    figureLinks: figureRequests.length,
  };
}
