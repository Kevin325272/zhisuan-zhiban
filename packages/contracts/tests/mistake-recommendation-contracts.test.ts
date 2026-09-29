import { describe, expect, it } from "vitest";

import * as contracts from "../src/index.js";

type Parseable = {
  parse(input: unknown): unknown;
  safeParse(input: unknown): { success: boolean };
};

function recommendation() {
  const schema = (contracts as Record<string, unknown>).mistakeRecommendationSchema as Parseable | undefined;
  expect(schema).toBeDefined();
  return schema;
}

function response() {
  const schema = (contracts as Record<string, unknown>).mistakeRecommendationResponseSchema as Parseable | undefined;
  expect(schema).toBeDefined();
  return schema;
}

const item = {
  mistake_id: "mistake_001",
  course_id: "course_408_ds",
  course_title: "数据结构",
  question_id: "question_001",
  question_number: 1,
  concept_id: "ds_c02_02",
  concept_title: "顺序表的存储表示",
  priority_score: 82,
  algorithm_version: "evidence_weighted_v1",
  next_review_at: "2026-08-17T08:00:00.000Z",
  due_status: "due",
  evidence_level: "limited",
  reason_lines: ["已到复习时间", "同一题已错 2 次"],
  evidence_refs: ["mistake:mistake_001", "concept:ds_c02_02"],
  practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_c02_02",
} as const;

describe("mistake recommendation contracts", () => {
  it("exposes a strict student-safe recommendation DTO", () => {
    const schema = recommendation();
    if (!schema) return;

    expect(schema.parse(item)).toMatchObject({
      mistake_id: "mistake_001",
      priority_score: 82,
      algorithm_version: "evidence_weighted_v1",
    });
    expect(schema.safeParse({ ...item, correct_option_ids: ["A"] }).success).toBe(false);
    expect(schema.safeParse({ ...item, internal_score_breakdown: { urgency: 1 } }).success).toBe(false);
  });

  it("rejects unbounded scores, unsupported status, and empty reasons", () => {
    const schema = recommendation();
    if (!schema) return;

    expect(schema.safeParse({ ...item, priority_score: 101 }).success).toBe(false);
    expect(schema.safeParse({ ...item, due_status: "expired" }).success).toBe(false);
    expect(schema.safeParse({ ...item, reason_lines: [] }).success).toBe(false);
  });

  it("permits an explicit empty queue without inventing a recommendation", () => {
    const schema = response();
    if (!schema) return;

    expect(schema.parse({
      algorithm_version: "evidence_weighted_v1",
      generated_at: "2026-08-16T08:00:00.000Z",
      items: [],
    })).toMatchObject({ items: [] });
  });
});
