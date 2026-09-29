import { describe, expect, it } from "vitest";

import {
  loadDataStructuresCurriculum,
  validateDataStructuresCurriculumAgainstChunks,
} from "../src/services/course-content/data-structures-curriculum-source.js";

describe("data structures curated curriculum", () => {
  it("loads a three-level, source-constrained student map instead of OCR chapters", () => {
    const source = loadDataStructuresCurriculum();
    const concepts = source.chapters.flatMap((chapter) =>
      chapter.modules.flatMap((module) => module.concepts),
    );

    expect(source.chapters).toHaveLength(8);
    expect(concepts.length).toBeGreaterThanOrEqual(40);
    expect(concepts.length).toBeLessThanOrEqual(50);
    expect(source.chapters.map((chapter) => chapter.title)).not.toContain(
      "参考资料",
    );
    expect(concepts.every((concept) => concept.learning_content.explanation.length > 0)).toBe(true);
    expect(concepts.every((concept) => concept.learning_content.case_prompt.length > 0)).toBe(true);
    expect(concepts.every((concept) => concept.sources.length > 0)).toBe(true);
  });

  it("rejects a source reference whose page or chapter drifts", () => {
    const source = loadDataStructuresCurriculum();
    const first = source.chapters[0]!.modules[0]!.concepts[0]!;
    expect(() => validateDataStructuresCurriculumAgainstChunks(source, new Map([
      [first.sources[0]!.chunk_id, {
        chapter: "第1章",
        printed_page: first.sources[0]!.print_page + 1,
      }],
    ]))).toThrow(/source.*page|chapter/u);
  });
});
