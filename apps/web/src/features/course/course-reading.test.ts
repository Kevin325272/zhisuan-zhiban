import { describe, expect, it } from "vitest";

import {
  buildReadingParagraphs,
  extractFigureContext,
  extractLessonTerms,
  resolvePracticeRoute,
} from "./course-reading";

describe("course reading rules", () => {
  it("removes imported 408 figure placeholders before building student paragraphs", () => {
    const paragraphs = buildReadingParagraphs([
      "网络由节点和链路组成。",
      "{{figure:cn_v8_fig_1_1}} {{figure:cn_v8_fig_1_2}}",
      "链路层负责相邻节点之间的帧传输。 {{figure:ds_v2_fig_1_3}}",
      "操作系统材料中的图示锚点也不应显示。{{figure:os_v4_fig_1_5}}",
    ].join("\n\n"));

    expect(paragraphs.join(" ")).toBe(
      "网络由节点和链路组成。 链路层负责相邻节点之间的帧传输。 操作系统材料中的图示锚点也不应显示。",
    );
    expect(paragraphs.join(" ")).not.toMatch(/\{\{figure:/u);
    expect(paragraphs).not.toContain("");
  });

  it("rejects malformed OCR quote spans when extracting key terms", () => {
    const terms = extractLessonTerms(
      "计算机系统由“硬件”和“软件”组成。当然,“软件“性能必须依托“硬 件”的支撑。",
      "1 计算机系统概论",
    );

    expect(terms).toEqual(expect.arrayContaining(["计算机系统", "硬件", "软件"]));
    expect(terms.some((term) => term.includes("依托") || /\s/u.test(term))).toBe(false);
  });

  it("finds the unchanged source sentence for a split textbook figure label", () => {
    const source = "机器自动运行目标程序。\n\n其过程如图\n\n1.1 所示。\n\n随后输出结果。";

    expect(extractFigureContext(source, "图1.1")).toBe("其过程如图 1.1 所示。");
    expect(extractFigureContext(source, "图1.2")).toBeNull();
  });

  it("keeps concept scope only when persisted reliable questions exist", () => {
    expect(resolvePracticeRoute(
      "/student/practice?subject=%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%BD%91%E7%BB%9C",
      { concept_id: "cn_c01_01", practice_question_count: 2 },
    )).toEqual({
      href: "/student/practice?subject=%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%BD%91%E7%BB%9C&concept_id=cn_c01_01",
      mode: "concept",
      questionCount: 2,
    });

    expect(resolvePracticeRoute(
      "/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86",
      { concept_id: "co_c01_03", practice_question_count: 0 },
    )).toEqual({
      href: "/student/practice?subject=%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86",
      mode: "course",
      questionCount: 0,
    });
  });
});
