import {
  flattenDataStructuresConcepts,
  loadDataStructuresCurriculum,
  validateDataStructuresCurriculumAgainstChunks,
  type DataStructuresCurriculumSource,
} from "../services/course-content/data-structures-curriculum-source.js";
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

const SOURCE_ID = "ds_curriculum_map_v1";
const COURSE_ID = "course_408_ds";
const DATASET_ID = "408-three-course-source-v1_course_408_ds";

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function sourceReferences(source: DataStructuresCurriculumSource) {
  return flattenDataStructuresConcepts(source).flatMap((concept) => concept.sources);
}

function assertDataset(dataset: DatasetRow | undefined, source: DataStructuresCurriculumSource) {
  if (!dataset) throw new Error("408 data-structures source dataset is not seeded.");
  if (dataset.archive_sha256.toLowerCase() !== source.source_archive_sha256) {
    throw new Error("Data structures curriculum archive hash does not match source dataset.");
  }
  if (dataset.license_status !== "unverified" || dataset.usage_scope !== "local_demo_only") {
    throw new Error("Data structures source boundary is not the tracked local-demo boundary.");
  }
}

export interface DataStructuresCurriculumSeedResult {
  source: number;
  chunks: number;
  modules: number;
  concepts: number;
  sourceReferences: number;
  figureLinks: number;
}

export async function seedDataStructuresCurriculum(
  pool: SqlQueryablePool,
  source: DataStructuresCurriculumSource = loadDataStructuresCurriculum(),
  now: () => Date = () => new Date(),
): Promise<DataStructuresCurriculumSeedResult> {
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
  validateDataStructuresCurriculumAgainstChunks(source, chunksById);
  if (chunksById.size !== chunkIds.length) {
    throw new Error("Data structures curriculum references an unseeded source chunk.");
  }

  const figureRequests = flattenDataStructuresConcepts(source)
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
  const concepts = flattenDataStructuresConcepts(source);
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
        "数据结构课程化知识地图（来源约束版）",
        "408-three-course-source-v1",
        "用户提供的 408 源资料",
        "第2版（源层元数据）",
        "data/course-materials/408-three-courses/curated/data-structures-curriculum.json",
        "data/course-materials/408-three-courses/curated/data-structures-curriculum.json",
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

    for (const chapter of source.chapters) {
      for (const module of chapter.modules) {
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
          [module.module_id, SOURCE_ID, COURSE_ID, chapter.chapter_id, chapter.source_chapter,
            chapter.title, chapter.ordinal, module.title, module.ordinal, timestamp],
        );
        for (const concept of module.concepts) {
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
            [concept.concept_id, module.module_id, COURSE_ID, concept.title,
              concept.learning_objective, concept.learning_note.kind, concept.learning_note.text,
              JSON.stringify(concept.learning_content.explanation), concept.learning_content.case_prompt,
              JSON.stringify(concept.learning_content.practice_tags), concept.importance,
              concept.review_status, concept.ordinal, timestamp],
          );
          for (const [index, reference] of concept.sources.entries()) {
            await client.query(
              `INSERT INTO course_concept_sources(concept_id, chunk_id, print_page, ordinal)
               VALUES ($1,$2,$3,$4)`,
              [concept.concept_id, reference.chunk_id, reference.print_page, index + 1],
            );
          }
          for (const term of concept.key_terms) {
            await client.query(
              `INSERT INTO course_concept_terms(concept_id, term_text, ordinal)
               VALUES ($1,$2,$3)`,
              [concept.concept_id, term, concept.key_terms.indexOf(term) + 1],
            );
          }
          for (const prerequisite of concept.prerequisite_concept_ids) {
            await client.query(
              `INSERT INTO course_concept_prerequisites(concept_id, prerequisite_concept_id)
               VALUES ($1,$2)`,
              [concept.concept_id, prerequisite],
            );
          }
          const figure = concept.figure_guidance?.primary;
          const figureRow = figure ? figuresByAsset.get(figure.asset_id) : undefined;
          if (figure && figureRow) {
            await client.query(
              `INSERT INTO course_source_concept_figures(
                 link_id, concept_id, figure_asset_id, source_chunk_id,
                 display_role, match_confidence, display_enabled, ordinal,
                 created_at, updated_at
               ) VALUES ($1,$2,$3,$4,'primary',1,true,1,$5,$5)`,
              [`ds_link_${concept.concept_id}_${figure.asset_id}`, concept.concept_id,
                figure.asset_id, figure.source_chunk_id, timestamp],
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
