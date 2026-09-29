import { describe, expect, it } from "vitest";

import { studentCareCrisisSignalPresent } from "../src/index.js";

describe("student care crisis safety policy", () => {
  it.each([
    "我真的不想活了",
    "我准备自杀",
    "我想结束自己的生命",
    "我控制不住想伤害自己",
    "I want to kill myself",
    "I do not want to live anymore",
  ])("detects an explicit immediate-safety message: %s", (message) => {
    expect(studentCareCrisisSignalPresent(message)).toBe(true);
  });

  it.each([
    "最近很累，完全学不进去",
    "这道题太难了，我不想做了",
    "我有点担心复习进度",
    "今天想先休息一下",
    "This chapter is killing me, but I want a smaller task.",
  ])("does not label ordinary study pressure as a crisis: %s", (message) => {
    expect(studentCareCrisisSignalPresent(message)).toBe(false);
  });

  it("treats missing or blank messages as non-crisis input", () => {
    expect(studentCareCrisisSignalPresent(null)).toBe(false);
    expect(studentCareCrisisSignalPresent(undefined)).toBe(false);
    expect(studentCareCrisisSignalPresent("   ")).toBe(false);
  });
});
