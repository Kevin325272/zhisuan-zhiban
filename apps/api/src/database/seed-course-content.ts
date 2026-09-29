import { withTransaction, type SqlPool } from "./client.js";
import type { CourseContentSource } from "../services/course-content/course-content-source.js";

const SOURCE_IDS = {
  knowledge: "source_co_knowledge_v1",
  qa: "source_co_qa_v1",
  training: "source_co_training_v1",
  curriculum: "source_co_curriculum_v1",
} as const;

function recordId(prefix: string, sourceItemId: string) {
  return `${prefix}_${encodeURIComponent(sourceItemId)}`;
}

export async function seedCourseContent(
  pool: SqlPool,
  source: CourseContentSource,
  now: () => Date = () => new Date(),
): Promise<{
  sources: number;
  knowledgeChunks: number;
  qaExamples: number;
  trainingRecords: number;
  figureAssets: number;
  figureReferences: number;
  figureCatalogEntries: number;
  conceptFigureLinks: number;
  curriculumModules: number;
  curriculumConcepts: number;
  curriculumSourceReferences: number;
}> {
  const timestamp = now().toISOString();
  const { manifest } = source;
  return withTransaction(pool, async (client) => {
    const descriptors = [
      {
        id: SOURCE_IDS.knowledge,
        kind: "knowledge_chunks",
        title: "计算机组成原理知识块",
        file: manifest.files.knowledge,
        path: source.paths.knowledge,
        ingestionMode: "postgresql_content",
      },
      {
        id: SOURCE_IDS.qa,
        kind: "qa_examples",
        title: "计算机组成原理课程问答示例",
        file: manifest.files.qa,
        path: source.paths.qa,
        ingestionMode: "postgresql_content",
      },
      {
        id: SOURCE_IDS.training,
        kind: "training_messages",
        title: "计算机组成原理训练消息参考集",
        file: manifest.files.training,
        path: source.paths.training,
        ingestionMode: source.trainingUsage,
      },
      {
        id: SOURCE_IDS.curriculum,
        kind: "curriculum_map",
        title: "计算机组成原理课程知识地图",
        file: manifest.files.curriculum_map,
        path: source.paths.curriculumMap,
        ingestionMode: "postgresql_content",
      },
    ] as const;

    for (const descriptor of descriptors) {
      await client.query(
        `INSERT INTO course_content_sources(
           source_id, course_id, dataset_id, source_kind, title,
           source_provider, author_name, edition, original_path, storage_ref,
           sha256, record_count, license_status, usage_scope, provenance_status,
           ingestion_mode, imported_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,NULL,NULL,NULL,$6,$7,$8,$9,
           'unverified','local_demo_only','source_unknown_unverified',$10,$11,$11
         )
         ON CONFLICT (source_id) DO UPDATE
         SET original_path = EXCLUDED.original_path,
             storage_ref = EXCLUDED.storage_ref,
             sha256 = EXCLUDED.sha256,
             record_count = EXCLUDED.record_count,
             ingestion_mode = EXCLUDED.ingestion_mode,
             updated_at = EXCLUDED.updated_at`,
        [
          descriptor.id,
          manifest.course_id,
          manifest.dataset_id,
          descriptor.kind,
          descriptor.title,
          descriptor.path.original,
          descriptor.path.storageRef,
          descriptor.file.sha256,
          descriptor.file.record_count,
          descriptor.ingestionMode,
          timestamp,
        ],
      );
    }

    for (const [ordinal, item] of source.knowledge.entries()) {
      await client.query(
        `INSERT INTO course_content_chunks(
           chunk_id, source_id, course_id, source_item_id, chapter, page,
           ordinal, content_text, content_format, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'plain_text',$9,$9)
         ON CONFLICT (chunk_id) DO UPDATE
         SET chapter = EXCLUDED.chapter,
             page = EXCLUDED.page,
             ordinal = EXCLUDED.ordinal,
             content_text = EXCLUDED.content_text,
             content_format = 'plain_text',
             updated_at = EXCLUDED.updated_at`,
        [
          recordId("co_chunk", item.id),
          SOURCE_IDS.knowledge,
          manifest.course_id,
          item.id,
          item.chapter,
          item.page,
          ordinal,
          item.text,
          timestamp,
        ],
      );
    }

    for (const [ordinal, item] of source.qa.entries()) {
      await client.query(
        `INSERT INTO course_qa_examples(
           qa_id, source_id, course_id, source_item_id, chapter, page, ordinal,
           question_text, answer_text, content_format, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6,$7,'plain_text',$8,$8)
         ON CONFLICT (qa_id) DO UPDATE
         SET ordinal = EXCLUDED.ordinal,
             question_text = EXCLUDED.question_text,
             answer_text = EXCLUDED.answer_text,
             content_format = 'plain_text',
             updated_at = EXCLUDED.updated_at`,
        [
          recordId("co_qa", item.id),
          SOURCE_IDS.qa,
          manifest.course_id,
          item.id,
          ordinal,
          item.question,
          item.answer,
          timestamp,
        ],
      );
    }

    await client.query(
      `DELETE FROM course_concept_figures
       WHERE concept_id IN (
         SELECT concept_id FROM course_core_concepts WHERE course_id = $1
       )`,
      [manifest.course_id],
    );
    await client.query(
      `DELETE FROM course_figure_catalog_entries WHERE course_id = $1`,
      [manifest.course_id],
    );
    await client.query(
      `DELETE FROM course_figure_assets
       WHERE course_id = $1
         AND verification_status = 'coordinate_verified'`,
      [manifest.course_id],
    );
    for (const asset of source.figureAssets) {
      await client.query(
        `INSERT INTO course_figure_assets(
           asset_id, course_id, figure_label, caption, textbook_title,
           author_name, edition, publisher, publication_year, isbn,
           print_page, pdf_physical_page, source_pdf_sha256, original_path,
           asset_sha256, storage_ref, mime_type, pixel_width, pixel_height,
           crop_box_pixels, chapter, tags, extraction_method,
           extraction_confidence, verification_status, usage_scope, license_status,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
           $18,$19,$20::jsonb,$21,$22::jsonb,$23,$24,$25,$26,$27,$28,$28
         )
         ON CONFLICT (asset_id) DO UPDATE
         SET figure_label = EXCLUDED.figure_label,
             caption = EXCLUDED.caption,
             textbook_title = EXCLUDED.textbook_title,
             author_name = EXCLUDED.author_name,
             edition = EXCLUDED.edition,
             publisher = EXCLUDED.publisher,
             publication_year = EXCLUDED.publication_year,
             isbn = EXCLUDED.isbn,
             print_page = EXCLUDED.print_page,
             pdf_physical_page = EXCLUDED.pdf_physical_page,
             source_pdf_sha256 = EXCLUDED.source_pdf_sha256,
             original_path = EXCLUDED.original_path,
             asset_sha256 = EXCLUDED.asset_sha256,
             storage_ref = EXCLUDED.storage_ref,
             mime_type = EXCLUDED.mime_type,
             pixel_width = EXCLUDED.pixel_width,
             pixel_height = EXCLUDED.pixel_height,
             crop_box_pixels = EXCLUDED.crop_box_pixels,
             chapter = EXCLUDED.chapter,
             tags = EXCLUDED.tags,
             extraction_method = EXCLUDED.extraction_method,
             extraction_confidence = EXCLUDED.extraction_confidence,
             verification_status = EXCLUDED.verification_status,
             usage_scope = EXCLUDED.usage_scope,
             license_status = EXCLUDED.license_status,
             updated_at = EXCLUDED.updated_at`,
        [
          asset.asset_id,
          manifest.course_id,
          asset.figure_label,
          asset.caption,
          asset.textbook_title,
          asset.author_name,
          asset.edition,
          asset.publisher,
          asset.publication_year,
          asset.isbn,
          asset.print_page,
          asset.pdf_physical_page,
          asset.source_pdf_sha256,
          asset.original_path,
          asset.sha256,
          asset.storage_ref,
          asset.mime_type,
          asset.pixel_width,
          asset.pixel_height,
          JSON.stringify(asset.crop_box_pixels),
          asset.chapter,
          JSON.stringify(asset.tags),
          asset.extraction_method,
          asset.extraction_confidence,
          asset.verification_status,
          asset.usage_scope,
          asset.license_status,
          timestamp,
        ],
      );

      await client.query(
        `INSERT INTO course_figure_references(
           reference_id, chunk_id, asset_id, figure_label, reference_text,
           ordinal, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT (reference_id) DO UPDATE
         SET chunk_id = EXCLUDED.chunk_id,
             asset_id = EXCLUDED.asset_id,
             figure_label = EXCLUDED.figure_label,
             reference_text = EXCLUDED.reference_text,
             ordinal = EXCLUDED.ordinal,
             updated_at = EXCLUDED.updated_at`,
        [
          asset.reference.reference_id,
          recordId("co_chunk", asset.reference.source_item_id),
          asset.asset_id,
          asset.figure_label,
          asset.reference.reference_text,
          asset.reference.ordinal,
          timestamp,
        ],
      );
    }

    for (const entry of source.figureCatalog) {
      await client.query(
        `INSERT INTO course_figure_catalog_entries(
           catalog_id, course_id, asset_id, figure_label, caption, chapter,
           print_page, pdf_physical_page, source_pdf_sha256, tags,
           extraction_status, extraction_confidence, crop_box_pixels,
           verification_status, usage_scope, license_status,
           candidate_print_pages, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,
           $14,$15,$16,$17::jsonb,$18,$18
         )`,
        [
          entry.catalog_id,
          manifest.course_id,
          entry.asset_id,
          entry.figure_label,
          entry.caption,
          entry.chapter,
          entry.print_page,
          entry.pdf_physical_page,
          entry.source_pdf_sha256,
          JSON.stringify(entry.tags),
          entry.extraction_status,
          entry.extraction_confidence,
          entry.crop_box_pixels ? JSON.stringify(entry.crop_box_pixels) : null,
          entry.verification_status,
          entry.usage_scope,
          entry.license_status,
          JSON.stringify(entry.candidate_print_pages),
          timestamp,
        ],
      );
    }

    const curriculumModules = source.curriculumMap.chapters.flatMap(
      (chapter) => chapter.modules,
    );
    const curriculumConcepts = curriculumModules.flatMap(
      (module) => module.concepts,
    );

    for (const chapter of source.curriculumMap.chapters) {
      for (const module of chapter.modules) {
        await client.query(
          `INSERT INTO course_learning_modules(
             module_id, source_id, course_id, chapter_id, source_chapter,
             chapter_title, chapter_ordinal, title, ordinal, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
           ON CONFLICT (module_id) DO UPDATE
           SET source_id = EXCLUDED.source_id,
               course_id = EXCLUDED.course_id,
               chapter_id = EXCLUDED.chapter_id,
               source_chapter = EXCLUDED.source_chapter,
               chapter_title = EXCLUDED.chapter_title,
               chapter_ordinal = EXCLUDED.chapter_ordinal,
               title = EXCLUDED.title,
               ordinal = EXCLUDED.ordinal,
               updated_at = EXCLUDED.updated_at`,
          [
            module.module_id,
            SOURCE_IDS.curriculum,
            manifest.course_id,
            chapter.chapter_id,
            chapter.source_chapter,
            chapter.title,
            chapter.ordinal,
            module.title,
            module.ordinal,
            timestamp,
          ],
        );
      }
    }

    for (const module of curriculumModules) {
      for (const concept of module.concepts) {
        await client.query(
          `INSERT INTO course_core_concepts(
             concept_id, module_id, course_id, title, learning_objective,
             learning_note_kind, learning_note_text, importance, review_status,
             ordinal, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
           ON CONFLICT (concept_id) DO UPDATE
           SET module_id = EXCLUDED.module_id,
               course_id = EXCLUDED.course_id,
               title = EXCLUDED.title,
               learning_objective = EXCLUDED.learning_objective,
               learning_note_kind = EXCLUDED.learning_note_kind,
               learning_note_text = EXCLUDED.learning_note_text,
               importance = EXCLUDED.importance,
               review_status = EXCLUDED.review_status,
               ordinal = EXCLUDED.ordinal,
               updated_at = EXCLUDED.updated_at`,
          [
            concept.concept_id,
            module.module_id,
            manifest.course_id,
            concept.title,
            concept.learning_objective,
            concept.learning_note.kind,
            concept.learning_note.text,
            concept.importance,
            concept.review_status,
            concept.ordinal,
            timestamp,
          ],
        );
      }
    }

    for (const concept of curriculumConcepts) {
      await client.query(
        `DELETE FROM course_concept_sources WHERE concept_id = $1`,
        [concept.concept_id],
      );
      await client.query(
        `DELETE FROM course_concept_terms WHERE concept_id = $1`,
        [concept.concept_id],
      );
      await client.query(
        `DELETE FROM course_concept_prerequisites WHERE concept_id = $1`,
        [concept.concept_id],
      );
      for (const [ordinal, reference] of concept.sources.entries()) {
        await client.query(
          `INSERT INTO course_concept_sources(
             concept_id, chunk_id, print_page, ordinal
           ) VALUES ($1,$2,$3,$4)`,
          [
            concept.concept_id,
            reference.chunk_id,
            reference.print_page,
            ordinal + 1,
          ],
        );
      }
      for (const [ordinal, term] of concept.key_terms.entries()) {
        await client.query(
          `INSERT INTO course_concept_terms(concept_id, term_text, ordinal)
           VALUES ($1,$2,$3)`,
          [concept.concept_id, term, ordinal + 1],
        );
      }
      for (const prerequisiteId of concept.prerequisite_concept_ids) {
        await client.query(
          `INSERT INTO course_concept_prerequisites(
             concept_id, prerequisite_concept_id
           ) VALUES ($1,$2)`,
          [concept.concept_id, prerequisiteId],
        );
      }
    }

    for (const link of source.conceptFigureLinks) {
      await client.query(
        `INSERT INTO course_concept_figures(
           link_id, concept_id, asset_id, figure_label, display_role,
           match_method, match_confidence, source_chunk_ids, evidence_text,
           display_enabled, ordinal, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$12
         )`,
        [
          link.link_id,
          link.concept_id,
          link.asset_id,
          link.figure_label,
          link.display_role,
          link.match_method,
          link.match_confidence,
          JSON.stringify(link.source_chunk_ids),
          link.evidence_text,
          link.display_enabled,
          link.ordinal,
          timestamp,
        ],
      );
    }

    await client.query(
      `UPDATE course_catalog_entries
       SET material_status = 'available', updated_at = $2
       WHERE course_id = $1`,
      [manifest.course_id, timestamp],
    );

    return {
      sources: descriptors.length,
      knowledgeChunks: source.knowledge.length,
      qaExamples: source.qa.length,
      trainingRecords: source.trainingCount,
      figureAssets: source.figureAssets.length,
      figureReferences: source.figureAssets.length,
      figureCatalogEntries: source.figureCatalog.length,
      conceptFigureLinks: source.conceptFigureLinks.length,
      curriculumModules: curriculumModules.length,
      curriculumConcepts: curriculumConcepts.length,
      curriculumSourceReferences: curriculumConcepts.reduce(
        (total, concept) => total + concept.sources.length,
        0,
      ),
    };
  });
}
