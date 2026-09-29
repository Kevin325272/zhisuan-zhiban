import type { CourseKnowledgeChunk } from "@xuetu/contracts";

export interface CourseSourceExcerpt {
  /** Vertical bounds in the unchanged original page, from 0 to 1. */
  top: number;
  bottom: number;
}

type SourceChunk = Pick<CourseKnowledgeChunk, "chunk_id" | "text" | "source_page">;

// Visually checked against 数据结构 C语言版 第2版, printed p.125 / PDF p.139.
// The whitespace above “4.4 字符串” starts this excerpt. Keep the original
// image intact; its version hash prevents using these bounds with another scan.
const STRING_SECTION = {
  conceptId: "ds_c04_04",
  chunkId: "ds_k0125",
  pageId: "5b7373571eb2-p139",
  imageUrl: "/api/v1/408/courses/data-structures/source-pages/5b7373571eb2-p139?v=bd7a56346fa246c3c48561b5bc1dc7957838c750de23fc85b7e6edd75a43a756",
  heading: /^[\t ]*4\.4[\t ]*字[\t ]*符[\t ]*串[\t ]*\r?$/gmu,
  excerpt: { top: 0.815, bottom: 1 },
} as const;

/** Select a reviewed display range without rewriting or mutating source text. */
export function getCourseReadingSource(chunk: SourceChunk, conceptId: string | null) {
  const unchanged = { text: chunk.text, excerpt: null as CourseSourceExcerpt | null };
  if (conceptId !== STRING_SECTION.conceptId || chunk.chunk_id !== STRING_SECTION.chunkId) return unchanged;
  const page = chunk.source_page;
  if (page && (page.page_id !== STRING_SECTION.pageId || page.image_url !== STRING_SECTION.imageUrl)) return unchanged;
  const headings = [...chunk.text.matchAll(STRING_SECTION.heading)];
  if (headings.length !== 1) return unchanged;
  return {
    text: chunk.text.slice(headings[0]!.index),
    excerpt: page ? STRING_SECTION.excerpt : null,
  };
}
