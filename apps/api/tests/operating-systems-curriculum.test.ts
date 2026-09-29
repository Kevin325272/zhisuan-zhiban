import { describe, expect, it } from "vitest";

import {
  flattenOperatingSystemsConcepts,
  loadOperatingSystemsCurriculum,
  validateOperatingSystemsCurriculumAgainstChunks,
} from "../src/services/course-content/operating-systems-curriculum-source.js";

describe("operating systems curated curriculum", () => {
  it("loads twelve source-constrained chapters and a student-readable three-level map", () => {
    const source = loadOperatingSystemsCurriculum();
    const concepts = flattenOperatingSystemsConcepts(source);

    expect(source.chapters).toHaveLength(12);
    expect(concepts).toHaveLength(60);
    expect(source.chapters.map((chapter) => chapter.title)).not.toContain("参考文献");
    expect(concepts.every((concept) => concept.learning_content.explanation.length > 0)).toBe(true);
    expect(concepts.every((concept) => concept.learning_content.case_prompt.length > 0)).toBe(true);
    expect(concepts.every((concept) => concept.sources.length > 0)).toBe(true);
    expect(concepts.every((concept) =>
      !concept.figure_guidance?.primary || concept.figure_guidance.primary.confidence === "high",
    )).toBe(true);
  });

  it("rejects a source reference when chapter or printed page drifts", () => {
    const source = loadOperatingSystemsCurriculum();
    const first = source.chapters[0]!.modules[0]!.concepts[0]!;

    expect(() => validateOperatingSystemsCurriculumAgainstChunks(source, new Map([
      [first.sources[0]!.chunk_id, {
        chapter: "第1章",
        printed_page: first.sources[0]!.print_page + 1,
      }],
    ]))).toThrow(/source.*page|chapter/u);
  });
});
