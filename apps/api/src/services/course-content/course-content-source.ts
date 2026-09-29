import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import { z } from "zod";

const sourceItemIdSchema = z.union([
  z.string().trim().min(1).max(200),
  z.number().int().nonnegative(),
]);

const knowledgeRecordSchema = z.object({
  id: sourceItemIdSchema,
  chapter: z.string().trim().min(1).max(300),
  page: z.number().int().positive(),
  text: z.string().trim().min(1).max(100_000),
}).strict();

const qaRecordSchema = z.object({
  id: sourceItemIdSchema,
  question: z.string().trim().min(1).max(30_000),
  answer: z.string().trim().min(1).max(100_000),
}).strict();

const trainingRecordSchema = z.object({
  messages: z.tuple([
    z.object({ role: z.literal("user"), content: z.string().trim().min(1) }).strict(),
    z.object({ role: z.literal("assistant"), content: z.string().trim().min(1) }).strict(),
  ]),
}).strict();

const figureAssetRecordSchema = z.object({
  asset_id: z.string().trim().min(1).max(200),
  figure_label: z.string().regex(/^图\d{1,2}\.\d{1,3}$/u),
  caption: z.string().trim().min(1).max(300),
  textbook_title: z.string().trim().min(1).max(300),
  author_name: z.string().trim().min(1).max(100),
  edition: z.string().trim().min(1).max(100),
  publisher: z.string().trim().min(1).max(200),
  publication_year: z.number().int().min(1900).max(2100),
  isbn: z.string().regex(/^\d{3}-\d-\d{2}-\d{6}-\d$/u),
  print_page: z.number().int().positive(),
  pdf_physical_page: z.number().int().positive(),
  source_pdf_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  original_path: z.string().trim().min(1).max(2_000),
  file: z.string().regex(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.png$/u),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  storage_ref: z.string().regex(
    /^\/course-assets\/computer-organization\/[a-z0-9/_-]+\.png$/u,
  ),
  mime_type: z.literal("image/png"),
  pixel_width: z.number().int().positive().max(10_000),
  pixel_height: z.number().int().positive().max(10_000),
  crop_box_pixels: z.object({
    render_dpi: z.number().int().positive().max(1_200),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  chapter: z.string().trim().min(2).max(300),
  tags: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  extraction_status: z.literal("displayable"),
  extraction_method: z.enum(["manual_pdf_crop", "windows_ocr_caption_anchor"]),
  extraction_confidence: z.number().min(0.92).max(1),
  verification_status: z.enum(["human_verified", "coordinate_verified"]),
  usage_scope: z.literal("local_demo_only"),
  license_status: z.literal("unverified"),
  reference: z.object({
    reference_id: z.string().trim().min(1).max(200),
    source_item_id: sourceItemIdSchema,
    reference_text: z.string().trim().min(1).max(500),
    ordinal: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const figureCatalogRecordSchema = z.object({
  catalog_id: z.string().trim().min(1).max(200),
  figure_label: z.string().regex(/^图\d{1,2}\.\d{1,3}$/u),
  caption: z.string().trim().min(1).max(300),
  chapter: z.string().trim().min(2).max(300),
  print_page: z.number().int().positive(),
  pdf_physical_page: z.number().int().positive(),
  source_pdf_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  tags: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  extraction_status: z.enum([
    "displayable",
    "caption_not_located",
    "caption_unconfirmed",
    "crop_failed",
    "low_confidence",
    "rejected_low_confidence",
    "rejected_too_blank",
    "rejected_oversized",
    "rejected_too_small",
    "rejected_text_contamination",
    "rejected_multi_figure_crop",
    "duplicate_crop",
  ]),
  extraction_confidence: z.number().min(0).max(1),
  crop_box_pixels: z.object({
    render_dpi: z.number().int().positive().max(1_200),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict().nullable(),
  verification_status: z.enum([
    "human_verified",
    "coordinate_verified",
    "detected_only",
  ]),
  usage_scope: z.literal("local_demo_only"),
  license_status: z.literal("unverified"),
  asset_id: z.string().trim().min(1).max(200).nullable(),
  candidate_print_pages: z.array(z.number().int().positive()).min(1),
}).strict();

const conceptFigureLinkRecordSchema = z.object({
  link_id: z.string().trim().min(1).max(240),
  concept_id: z.string().regex(/^co_c\d{2}_\d{2}$/u),
  asset_id: z.string().trim().min(1).max(200),
  figure_label: z.string().regex(/^图\d{1,2}\.\d{1,3}$/u),
  display_role: z.enum(["primary", "related"]),
  match_method: z.enum(["direct_reference", "semantic_candidate"]),
  match_confidence: z.number().min(0.92).max(1),
  source_chunk_ids: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
  evidence_text: z.string().trim().min(1).max(600),
  display_enabled: z.boolean(),
  ordinal: z.number().int().nonnegative(),
}).strict();

const curriculumConceptSourceSchema = z.object({
  chunk_id: z.string().trim().min(1).max(200),
  print_page: z.number().int().positive(),
}).strict();

const curriculumConceptSchema = z.object({
  concept_id: z.string().regex(/^co_c\d{2}_\d{2}$/u),
  title: z.string().trim().min(2).max(120),
  learning_objective: z.string().trim().min(10).max(600),
  prerequisite_concept_ids: z.array(z.string().regex(/^co_c\d{2}_\d{2}$/u)).max(20),
  key_terms: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  learning_note: z.object({
    kind: z.enum(["misconception", "reminder"]),
    text: z.string().trim().min(1).max(500),
  }).strict(),
  sources: z.array(curriculumConceptSourceSchema).min(1).max(8),
  importance: z.enum(["core", "extended"]),
  review_status: z.enum(["verified", "needs_review"]),
  ordinal: z.number().int().positive(),
}).strict();

const curriculumModuleSchema = z.object({
  module_id: z.string().regex(/^co_m\d{2}_\d{2}$/u),
  title: z.string().trim().min(2).max(120),
  ordinal: z.number().int().positive(),
  concepts: z.array(curriculumConceptSchema).min(1).max(7),
}).strict();

const curriculumChapterSchema = z.object({
  chapter_id: z.string().regex(/^co_ch\d{2}$/u),
  source_chapter: z.string().trim().min(2).max(300),
  title: z.string().trim().min(2).max(120),
  ordinal: z.number().int().min(1).max(20),
  modules: z.array(curriculumModuleSchema).min(1).max(5),
}).strict();

const curriculumMapSourceSchema = z.object({
  schema_version: z.literal("1.0"),
  course_id: z.literal("course_408_co"),
  course_slug: z.literal("computer-organization"),
  title: z.literal("课程知识地图"),
  curation_method: z.literal("source_constrained_course_design"),
  chapters: z.array(curriculumChapterSchema).min(1).max(20),
}).strict();

const manifestFileSchema = z.object({
  file: z.string().min(1).max(200),
  original_path: z.string().min(1).max(2_000).optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  record_count: z.number().int().nonnegative(),
}).strict();

const manifestSchema = z.object({
  dataset_id: z.string().min(1).max(200),
  course_slug: z.literal("computer-organization"),
  course_id: z.literal("course_408_co"),
  original_directory: z.string().min(1).max(2_000),
  license_status: z.literal("unverified"),
  usage_scope: z.literal("local_demo_only"),
  provenance_status: z.literal("source_unknown_unverified"),
  files: z.object({
    knowledge: manifestFileSchema,
    qa: manifestFileSchema,
    training: manifestFileSchema.extend({
      usage: z.literal("reference_only_not_model_training"),
    }).strict(),
    figure_assets: manifestFileSchema,
    figure_catalog: manifestFileSchema,
    concept_figure_links: manifestFileSchema,
    curriculum_map: manifestFileSchema,
  }).strict(),
}).strict();

type Manifest = z.infer<typeof manifestSchema>;
export type CourseFigureAssetSource = z.infer<typeof figureAssetRecordSchema> & {
  reference: z.infer<typeof figureAssetRecordSchema>["reference"] & {
    source_item_id: string;
  };
};
export type CourseCurriculumMapSource = z.infer<typeof curriculumMapSourceSchema>;
export type CourseFigureCatalogSource = z.infer<typeof figureCatalogRecordSchema>;
export type CourseConceptFigureLinkSource = z.infer<typeof conceptFigureLinkRecordSchema>;

export interface CourseContentSource {
  manifest: Manifest;
  knowledge: Array<{ id: string; chapter: string; page: number; text: string }>;
  qa: Array<{ id: string; question: string; answer: string }>;
  figureAssets: CourseFigureAssetSource[];
  figureCatalog: CourseFigureCatalogSource[];
  conceptFigureLinks: CourseConceptFigureLinkSource[];
  curriculumMap: CourseCurriculumMapSource;
  trainingCount: number;
  trainingUsage: "reference_only_not_model_training";
  paths: {
    knowledge: { original: string; storageRef: string };
    qa: { original: string; storageRef: string };
    training: { original: string; storageRef: string };
    curriculumMap: { original: string; storageRef: string };
  };
}

export class CourseContentSourceError extends Error {}

function hash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertUniqueIds(records: Array<{ id: string }>, label: string) {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new CourseContentSourceError(`Duplicate ${label} id: ${record.id}`);
    }
    ids.add(record.id);
  }
}

function readVerifiedJson(
  root: string,
  descriptor: { file: string; sha256: string; record_count: number },
  label: string,
) {
  if (basename(descriptor.file) !== descriptor.file) {
    throw new CourseContentSourceError(`Unsafe ${label} source filename.`);
  }
  const rawRoot = resolve(root, "raw");
  const path = resolve(join(rawRoot, descriptor.file));
  if (!path.startsWith(`${rawRoot}${sep}`) && path !== rawRoot) {
    throw new CourseContentSourceError(`Unsafe ${label} source path.`);
  }
  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch (error) {
    throw new CourseContentSourceError(`Cannot read ${label} source: ${String(error)}`);
  }
  if (hash(buffer) !== descriptor.sha256) {
    throw new CourseContentSourceError(`${label} SHA256 does not match manifest.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new CourseContentSourceError(`${label} is not valid JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.length !== descriptor.record_count) {
    throw new CourseContentSourceError(`${label} record count does not match manifest.`);
  }
  return parsed;
}

function readVerifiedAssetManifest(
  root: string,
  descriptor: { file: string; sha256: string; record_count: number },
  label: string,
) {
  if (basename(descriptor.file) !== descriptor.file) {
    throw new CourseContentSourceError(`Unsafe ${label} manifest filename.`);
  }
  const assetRoot = resolve(root, "assets");
  const path = resolve(join(assetRoot, descriptor.file));
  if (!path.startsWith(`${assetRoot}${sep}`) || path === assetRoot) {
    throw new CourseContentSourceError(`Unsafe ${label} manifest path.`);
  }
  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch (error) {
    throw new CourseContentSourceError(
      `Cannot read ${label} manifest: ${String(error)}`,
    );
  }
  if (hash(buffer) !== descriptor.sha256) {
    throw new CourseContentSourceError(`${label} manifest SHA256 does not match.`);
  }
  const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== descriptor.record_count) {
    throw new CourseContentSourceError(
      `${label} manifest record count does not match.`,
    );
  }
  return parsed;
}

function readVerifiedCurriculumMap(
  root: string,
  descriptor: { file: string; sha256: string; record_count: number },
) {
  if (basename(descriptor.file) !== descriptor.file) {
    throw new CourseContentSourceError("Unsafe curriculum-map filename.");
  }
  const curatedRoot = resolve(root, "curated");
  const path = resolve(join(curatedRoot, descriptor.file));
  if (!path.startsWith(`${curatedRoot}${sep}`) || path === curatedRoot) {
    throw new CourseContentSourceError("Unsafe curriculum-map path.");
  }
  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch (error) {
    throw new CourseContentSourceError(`Cannot read curriculum map: ${String(error)}`);
  }
  if (hash(buffer) !== descriptor.sha256) {
    throw new CourseContentSourceError("Curriculum-map SHA256 does not match manifest.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new CourseContentSourceError("Curriculum map is not valid JSON.");
  }
  return parsed;
}

function assertVerifiedFigureAsset(root: string, asset: CourseFigureAssetSource) {
  const assetRoot = resolve(root, "assets");
  const path = resolve(join(assetRoot, ...asset.file.split("/")));
  if (!path.startsWith(`${assetRoot}${sep}`) || path === assetRoot) {
    throw new CourseContentSourceError(`Unsafe figure asset path: ${asset.file}`);
  }
  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch (error) {
    throw new CourseContentSourceError(
      `Cannot read figure asset ${asset.figure_label}: ${String(error)}`,
    );
  }
  if (hash(buffer) !== asset.sha256) {
    throw new CourseContentSourceError(
      `Figure asset ${asset.figure_label} SHA256 does not match manifest.`,
    );
  }
  if (
    buffer.length < 24 ||
    buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  ) {
    throw new CourseContentSourceError(`Figure asset ${asset.figure_label} is not a PNG.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== asset.pixel_width || height !== asset.pixel_height) {
    throw new CourseContentSourceError(
      `Figure asset ${asset.figure_label} dimensions do not match manifest.`,
    );
  }
  if (
    asset.crop_box_pixels.width !== width ||
    asset.crop_box_pixels.height !== height
  ) {
    throw new CourseContentSourceError(
      `Figure asset ${asset.figure_label} crop box does not match the rendered asset.`,
    );
  }
}

function sourcePaths(root: string, manifest: Manifest, key: keyof Manifest["files"]) {
  const descriptor = manifest.files[key];
  return {
    original: descriptor.original_path ?? join(manifest.original_directory, descriptor.file),
    storageRef: `data/course-materials/computer-organization/raw/${descriptor.file}`,
  };
}

function validateCurriculumMap(
  curriculumMap: CourseCurriculumMapSource,
  knowledge: Array<{ id: string; chapter: string; page: number; text: string }>,
  expectedConceptCount: number,
) {
  const chapters = curriculumMap.chapters;
  const modules = chapters.flatMap((chapter) => chapter.modules);
  const concepts = modules.flatMap((module) => module.concepts);
  if (concepts.length !== expectedConceptCount) {
    throw new CourseContentSourceError(
      "Curriculum-map concept count does not match manifest.",
    );
  }
  if (concepts.length < 30 || concepts.length > 50) {
    throw new CourseContentSourceError(
      "Curriculum map must contain between 30 and 50 core concepts.",
    );
  }
  for (const chapter of chapters) {
    const chapterConcepts = chapter.modules.flatMap((module) => module.concepts);
    if (chapterConcepts.length < 3 || chapterConcepts.length > 7) {
      throw new CourseContentSourceError(
        `Curriculum chapter ${chapter.source_chapter} must contain 3-7 concepts.`,
      );
    }
    if (/前言|目录|参考资料/u.test(chapter.source_chapter)) {
      throw new CourseContentSourceError("Curriculum map cannot include front matter.");
    }
  }
  assertUniqueIds(chapters.map((chapter) => ({ id: chapter.chapter_id })), "curriculum chapter");
  assertUniqueIds(modules.map((module) => ({ id: module.module_id })), "curriculum module");
  assertUniqueIds(concepts.map((concept) => ({ id: concept.concept_id })), "curriculum concept");

  const conceptIds = new Set(concepts.map((concept) => concept.concept_id));
  const knowledgeByChunkId = new Map(
    knowledge.map((item) => [`co_chunk_${encodeURIComponent(item.id)}`, item]),
  );
  for (const chapter of chapters) {
    for (const concept of chapter.modules.flatMap((module) => module.concepts)) {
      if (/^图\d{1,2}\.\d{1,3}$/u.test(concept.title)) {
        throw new CourseContentSourceError(
          `Figure label cannot be a curriculum concept: ${concept.title}`,
        );
      }
      for (const prerequisiteId of concept.prerequisite_concept_ids) {
        if (!conceptIds.has(prerequisiteId) || prerequisiteId === concept.concept_id) {
          throw new CourseContentSourceError(
            `Invalid prerequisite ${prerequisiteId} for ${concept.concept_id}.`,
          );
        }
      }
      for (const reference of concept.sources) {
        const chunk = knowledgeByChunkId.get(reference.chunk_id);
        if (
          !chunk
          || chunk.page !== reference.print_page
          || chunk.chapter !== chapter.source_chapter
        ) {
          throw new CourseContentSourceError(
            `Curriculum source ${reference.chunk_id} does not match its raw chapter/page.`,
          );
        }
      }
    }
  }

  const prerequisites = new Map(
    concepts.map((concept) => [concept.concept_id, concept.prerequisite_concept_ids]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (conceptId: string) => {
    if (visiting.has(conceptId)) {
      throw new CourseContentSourceError(`Curriculum prerequisite cycle at ${conceptId}.`);
    }
    if (visited.has(conceptId)) return;
    visiting.add(conceptId);
    for (const prerequisiteId of prerequisites.get(conceptId) ?? []) {
      visit(prerequisiteId);
    }
    visiting.delete(conceptId);
    visited.add(conceptId);
  };
  for (const concept of concepts) visit(concept.concept_id);
}

export function loadCourseContentSource(root: string): CourseContentSource {
  let manifest: Manifest;
  try {
    manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")),
    );
  } catch (error) {
    throw new CourseContentSourceError(`Invalid course-content manifest: ${String(error)}`);
  }

  try {
    let knowledge;
    let qa;
    let training;
    let figureAssets;
    let figureCatalog;
    let conceptFigureLinks;
    let curriculumMap;
    try {
      knowledge = z.array(knowledgeRecordSchema)
        .parse(readVerifiedJson(root, manifest.files.knowledge, "knowledge.json"))
        .map((item) => ({ ...item, id: String(item.id) }));
    } catch (error) {
      throw new CourseContentSourceError(`Invalid knowledge.json record: ${String(error)}`);
    }
    try {
      qa = z.array(qaRecordSchema)
        .parse(readVerifiedJson(root, manifest.files.qa, "qa.json"))
        .map((item) => ({ ...item, id: String(item.id) }));
    } catch (error) {
      throw new CourseContentSourceError(`Invalid qa.json record: ${String(error)}`);
    }
    try {
      training = z.array(trainingRecordSchema)
        .parse(readVerifiedJson(root, manifest.files.training, "training.json"));
    } catch (error) {
      throw new CourseContentSourceError(`Invalid training.json record: ${String(error)}`);
    }
    try {
      figureAssets = z.array(figureAssetRecordSchema)
        .parse(readVerifiedAssetManifest(
          root,
          manifest.files.figure_assets,
          "figure-assets",
        ))
        .map((item) => ({
          ...item,
          reference: {
            ...item.reference,
            source_item_id: String(item.reference.source_item_id),
          },
        }));
    } catch (error) {
      throw new CourseContentSourceError(
        `Invalid figure_assets.json record: ${String(error)}`,
      );
    }
    try {
      figureCatalog = z.array(figureCatalogRecordSchema).parse(
        readVerifiedAssetManifest(
          root,
          manifest.files.figure_catalog,
          "figure-catalog",
        ),
      );
    } catch (error) {
      throw new CourseContentSourceError(
        `Invalid figure_catalog.json record: ${String(error)}`,
      );
    }
    try {
      conceptFigureLinks = z.array(conceptFigureLinkRecordSchema).parse(
        readVerifiedAssetManifest(
          root,
          manifest.files.concept_figure_links,
          "concept-figure-links",
        ),
      );
    } catch (error) {
      throw new CourseContentSourceError(
        `Invalid concept_figure_links.json record: ${String(error)}`,
      );
    }
    try {
      curriculumMap = curriculumMapSourceSchema.parse(
        readVerifiedCurriculumMap(root, manifest.files.curriculum_map),
      );
    } catch (error) {
      throw new CourseContentSourceError(`Invalid curriculum-map record: ${String(error)}`);
    }
    assertUniqueIds(knowledge, "knowledge");
    assertUniqueIds(qa, "qa");
    assertUniqueIds(
      figureAssets.map((item) => ({ id: item.asset_id })),
      "figure asset",
    );
    assertUniqueIds(
      figureAssets.map((item) => ({ id: item.reference.reference_id })),
      "figure reference",
    );
    assertUniqueIds(
      figureCatalog.map((item) => ({ id: item.catalog_id })),
      "figure catalog",
    );
    assertUniqueIds(
      conceptFigureLinks.map((item) => ({ id: item.link_id })),
      "concept figure link",
    );

    const knowledgeById = new Map(knowledge.map((item) => [item.id, item]));
    const assetById = new Map(figureAssets.map((item) => [item.asset_id, item]));
    for (const asset of figureAssets) {
      assertVerifiedFigureAsset(root, asset);
      const sourceItem = knowledgeById.get(asset.reference.source_item_id);
      if (!sourceItem) {
        throw new CourseContentSourceError(
          `Figure asset ${asset.figure_label} references an unknown knowledge item.`,
        );
      }
      const normalizedText = sourceItem.text.replace(/\s+/gu, "");
      if (
        !normalizedText.includes(asset.figure_label)
        || sourceItem.chapter !== asset.chapter
      ) {
        throw new CourseContentSourceError(
          `Figure asset ${asset.figure_label} does not match its knowledge chapter/reference.`,
        );
      }
      if (asset.pdf_physical_page !== asset.print_page + 7) {
        throw new CourseContentSourceError(
          `Figure asset ${asset.figure_label} does not match the audited PDF page offset.`,
        );
      }
    }
    validateCurriculumMap(
      curriculumMap,
      knowledge,
      manifest.files.curriculum_map.record_count,
    );
    const concepts = curriculumMap.chapters.flatMap((chapter) =>
      chapter.modules.flatMap((module) => module.concepts)
    );
    const conceptIds = new Set(concepts.map((concept) => concept.concept_id));
    const chunkIds = new Set(knowledge.map((item) => `co_chunk_${encodeURIComponent(item.id)}`));
    const catalogByAssetId = new Map(
      figureCatalog
        .filter((item) => item.asset_id)
        .map((item) => [item.asset_id as string, item]),
    );
    for (const catalogItem of figureCatalog) {
      if (catalogItem.pdf_physical_page !== catalogItem.print_page + 7) {
        throw new CourseContentSourceError(
          `Figure catalog ${catalogItem.figure_label} has an invalid PDF page offset.`,
        );
      }
      if (
        catalogItem.extraction_status === "displayable"
        && (
          !catalogItem.asset_id
          || !catalogItem.crop_box_pixels
          || !assetById.has(catalogItem.asset_id)
        )
      ) {
        throw new CourseContentSourceError(
          `Displayable figure catalog ${catalogItem.figure_label} has no verified asset.`,
        );
      }
    }
    for (const link of conceptFigureLinks) {
      const asset = assetById.get(link.asset_id);
      if (
        !conceptIds.has(link.concept_id)
        || !asset
        || asset.figure_label !== link.figure_label
        || !catalogByAssetId.has(link.asset_id)
        || link.source_chunk_ids.some((chunkId) => !chunkIds.has(chunkId))
      ) {
        throw new CourseContentSourceError(
          `Concept figure link ${link.link_id} does not match its concept, asset or source chunks.`,
        );
      }
    }

    return {
      manifest,
      knowledge,
      qa,
      figureAssets,
      figureCatalog,
      conceptFigureLinks,
      curriculumMap,
      trainingCount: training.length,
      trainingUsage: manifest.files.training.usage,
      paths: {
        knowledge: sourcePaths(root, manifest, "knowledge"),
        qa: sourcePaths(root, manifest, "qa"),
        training: sourcePaths(root, manifest, "training"),
        curriculumMap: {
          original: join(root, "curated", manifest.files.curriculum_map.file),
          storageRef:
            `data/course-materials/computer-organization/curated/${manifest.files.curriculum_map.file}`,
        },
      },
    };
  } catch (error) {
    if (error instanceof CourseContentSourceError) throw error;
    throw new CourseContentSourceError(`Invalid course source record: ${String(error)}`);
  }
}
