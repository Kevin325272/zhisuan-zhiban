import { describe, expect, it } from "vitest";

import {
  flattenComputerNetworksConcepts,
  loadComputerNetworksCurriculum,
  validateComputerNetworksCurriculumAgainstChunks,
} from "../src/services/course-content/computer-networks-curriculum-source.js";

describe("computer networks curated curriculum", () => {
  it("loads nine source-constrained chapters and fifty student-readable concepts", () => {
    const source = loadComputerNetworksCurriculum();
    const concepts = flattenComputerNetworksConcepts(source);

    expect(source.chapters).toHaveLength(9);
    expect(concepts).toHaveLength(50);
    expect(source.chapters.map((chapter) => chapter.title)).toEqual([
      "概述",
      "物理层",
      "数据链路层",
      "网络层",
      "运输层",
      "应用层",
      "网络安全",
      "互联网上的音频/视频服务",
      "无线网络和移动网络",
    ]);
    expect(source.chapters.map((chapter) => chapter.title).join(" ")).not.toMatch(
      /前言|目录|参考资料|参考文献|习题答案/u,
    );
    expect(concepts.every((concept) => concept.learning_content.explanation.length > 0)).toBe(true);
    expect(concepts.every((concept) => concept.learning_content.case_prompt.length > 0)).toBe(true);
    expect(concepts.every((concept) => concept.sources.length > 0)).toBe(true);
    expect(concepts.every((concept) => concept.sources.every((sourceRef) => sourceRef.print_page <= 440))).toBe(true);
    expect(concepts.every((concept) =>
      !concept.figure_guidance?.primary || concept.figure_guidance.primary.confidence === "high",
    )).toBe(true);
  });

  it("rejects a source reference when chapter or printed page drifts", () => {
    const source = loadComputerNetworksCurriculum();
    const first = source.chapters[0]!.modules[0]!.concepts[0]!;

    expect(() => validateComputerNetworksCurriculumAgainstChunks(source, new Map([
      [first.sources[0]!.chunk_id, {
        chapter: "第1章",
        printed_page: first.sources[0]!.print_page + 1,
      }],
    ]))).toThrow(/source.*page|chapter/u);
  });
});
