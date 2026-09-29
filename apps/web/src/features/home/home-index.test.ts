import { describe, expect, it } from "vitest";

import { homeCategories, searchHomeIndex } from "./home-index";

describe("home index", () => {
  it("matches Chinese labels and English BFS keywords", () => {
    expect(searchHomeIndex("能力").map((item) => item.title)).toEqual(["我的学习"]);
    expect(searchHomeIndex("bfs").map((item) => item.title)).toContain("BFS 运行轨迹");
  });

  it("routes material questions back to course context instead of a standalone source desk", () => {
    const results = searchHomeIndex("资料").map((item) => item.title);

    expect(results).toEqual(expect.arrayContaining(["专业课程"]));
    expect(results).not.toContain("AI 助学");
    expect(results).not.toContain("材料工作室");
  });

  it("keeps the legacy standalone ask surface out of student home entries", () => {
    expect(homeCategories.map((item) => item.href)).not.toContain("/student/ask");
    expect(searchHomeIndex("AI").map((item) => item.href)).not.toContain("/student/ask");
  });

  it("keeps the retired fixed-date review calendar out of student search", () => {
    expect(homeCategories.map((item) => item.href)).not.toContain("/student/review");
    expect(searchHomeIndex("复习日历")).toEqual([]);
  });
});
