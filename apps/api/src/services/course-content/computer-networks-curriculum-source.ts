import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const rootDefault = fileURLToPath(
  new URL("../../../../../data/course-materials/408-three-courses/curated/computer-networks-curriculum.json", import.meta.url),
);

const sourceReferenceSchema = z.object({
  chunk_id: z.string().regex(/^cn_k\d{4}$/u),
  print_page: z.number().int().positive().max(440),
}).strict();

const figureSchema = z.object({
  asset_id: z.string().regex(/^cn_v8_fig_\d{1,2}_\d{1,3}$/u),
  figure_label: z.string().regex(/^图\d{1,2}\.\d{1,3}$/u),
  caption: z.string().trim().min(1).max(300),
  source_chunk_id: z.string().regex(/^cn_k\d{4}$/u),
  confidence: z.literal("high"),
}).strict();

const conceptSchema = z.object({
  concept_id: z.string().regex(/^cn_c\d{2}_\d{2}$/u),
  title: z.string().trim().min(2).max(120),
  learning_objective: z.string().trim().min(10).max(600),
  prerequisite_concept_ids: z.array(z.string().regex(/^cn_c\d{2}_\d{2}$/u)).max(20),
  key_terms: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  learning_note: z.object({
    kind: z.enum(["misconception", "reminder"]),
    text: z.string().trim().min(1).max(500),
  }).strict(),
  learning_content: z.object({
    explanation: z.array(z.string().trim().min(10).max(800)).min(1).max(4),
    case_prompt: z.string().trim().min(10).max(500),
    practice_tags: z.array(z.string().trim().min(1).max(80)).max(8),
  }).strict(),
  sources: z.array(sourceReferenceSchema).min(1).max(8),
  importance: z.enum(["core", "extended"]),
  review_status: z.literal("verified"),
  ordinal: z.number().int().positive(),
  figure_guidance: z.object({
    primary: figureSchema.nullable(),
    related: z.array(figureSchema).max(4),
  }).strict().optional(),
}).strict();

const moduleSchema = z.object({
  module_id: z.string().regex(/^cn_m\d{2}_\d{2}$/u),
  title: z.string().trim().min(2).max(120),
  ordinal: z.number().int().positive(),
  concepts: z.array(conceptSchema).min(1).max(7),
}).strict();

const chapterSchema = z.object({
  chapter_id: z.string().regex(/^cn_ch\d{2}$/u),
  source_chapter: z.string().regex(/^第[1-9]章$/u),
  title: z.string().trim().min(2).max(120),
  ordinal: z.number().int().min(1).max(9),
  modules: z.array(moduleSchema).min(1).max(5),
}).strict();

const curriculumSchema = z.object({
  schema_version: z.literal("1.0"),
  course_id: z.literal("course_408_cn"),
  course_slug: z.literal("computer-networks"),
  title: z.literal("课程知识地图"),
  curation_method: z.literal("source_constrained_course_design"),
  source_dataset_id: z.string().min(1),
  source_archive_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  chapters: z.array(chapterSchema).length(9),
}).strict();

export type ComputerNetworksCurriculumSource = z.infer<typeof curriculumSchema>;
export type ComputerNetworksCurriculumChapter = ComputerNetworksCurriculumSource["chapters"][number];
export type ComputerNetworksCurriculumModule = ComputerNetworksCurriculumChapter["modules"][number];
export type ComputerNetworksCurriculumConcept = ComputerNetworksCurriculumModule["concepts"][number];

export interface ComputerNetworksSourceChunkReference {
  chapter: string;
  printed_page: number;
}

export class ComputerNetworksCurriculumSourceError extends Error {}

export function flattenComputerNetworksConcepts(source: ComputerNetworksCurriculumSource) {
  return source.chapters.flatMap((chapter) => chapter.modules.flatMap((module) => module.concepts));
}

export function validateComputerNetworksCurriculumAgainstChunks(
  source: ComputerNetworksCurriculumSource,
  chunks: ReadonlyMap<string, ComputerNetworksSourceChunkReference>,
) {
  const concepts = flattenComputerNetworksConcepts(source);
  const conceptIds = new Set(concepts.map((concept) => concept.concept_id));
  if (concepts.length !== 50) {
    throw new ComputerNetworksCurriculumSourceError("Computer networks curriculum must contain exactly 50 concepts.");
  }
  if (new Set(source.chapters.map((chapter) => chapter.chapter_id)).size !== source.chapters.length) {
    throw new ComputerNetworksCurriculumSourceError("Duplicate computer networks chapter id.");
  }
  if (new Set(concepts.map((concept) => concept.concept_id)).size !== concepts.length) {
    throw new ComputerNetworksCurriculumSourceError("Duplicate computer networks concept id.");
  }
  for (const chapter of source.chapters) {
    if (chapter.ordinal !== source.chapters.indexOf(chapter) + 1) {
      throw new ComputerNetworksCurriculumSourceError("Computer networks chapters must stay in source order.");
    }
    if (/前言|目录|参考资料|参考文献|附录|词汇索引|习题答案/u.test(`${chapter.source_chapter}${chapter.title}`)) {
      throw new ComputerNetworksCurriculumSourceError("Non-learning content cannot enter the student map.");
    }
    for (const module of chapter.modules) {
      for (const concept of module.concepts) {
        for (const prerequisiteId of concept.prerequisite_concept_ids) {
          if (!conceptIds.has(prerequisiteId) || prerequisiteId === concept.concept_id) {
            throw new ComputerNetworksCurriculumSourceError(`Invalid prerequisite ${prerequisiteId}.`);
          }
        }
        for (const reference of concept.sources) {
          const chunk = chunks.get(reference.chunk_id);
          if (!chunk) throw new ComputerNetworksCurriculumSourceError(`Missing source chunk ${reference.chunk_id}.`);
          if (chunk.chapter !== chapter.source_chapter || chunk.printed_page !== reference.print_page) {
            throw new ComputerNetworksCurriculumSourceError(`Curriculum source ${reference.chunk_id} does not match chapter/page.`);
          }
        }
        const figures = [
          ...(concept.figure_guidance?.primary ? [concept.figure_guidance.primary] : []),
          ...(concept.figure_guidance?.related ?? []),
        ];
        for (const item of figures) {
          if (!concept.sources.some((sourceRef) => sourceRef.chunk_id === item.source_chunk_id)) {
            throw new ComputerNetworksCurriculumSourceError(`Figure ${item.figure_label} is not anchored to ${concept.concept_id}.`);
          }
        }
      }
    }
  }
  return true;
}

export function loadComputerNetworksCurriculum(path = rootDefault): ComputerNetworksCurriculumSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ComputerNetworksCurriculumSourceError(`Cannot read computer networks curriculum: ${String(error)}`);
  }
  try {
    const source = curriculumSchema.parse(parsed);
    const structuralChunks = new Map<string, ComputerNetworksSourceChunkReference>();
    for (const chapter of source.chapters) {
      for (const module of chapter.modules) {
        for (const concept of module.concepts) {
          for (const reference of concept.sources) {
            structuralChunks.set(reference.chunk_id, {
              chapter: chapter.source_chapter,
              printed_page: reference.print_page,
            });
          }
        }
      }
    }
    validateComputerNetworksCurriculumAgainstChunks(source, structuralChunks);
    return source;
  } catch (error) {
    if (error instanceof ComputerNetworksCurriculumSourceError) throw error;
    throw new ComputerNetworksCurriculumSourceError(`Invalid computer networks curriculum: ${String(error)}`);
  }
}
