import { describe, expect, it } from "vitest";

import {
  admissionsCurrentTargetSchema,
  admissionsTargetSearchQuerySchema,
  admissionsTargetSearchResponseSchema,
  admissionsTargetSelectionSchema,
} from "../src/index.js";

const target = {
  target_id: "admission_target_anhui_081200",
  school: "安徽大学",
  training_unit: "计算机科学与技术学院",
  program_code: "081200",
  program_name: "计算机科学与技术",
  study_mode: "全日制",
  available_years: [2026, 2025, 2024],
  retest_lines: [
    {
      line_id: "retest_000001",
      year: 2024,
      retest_score: 273,
      subject_scores: {
        politics: 37,
        foreign_language: 37,
        business_course_1: 56,
        business_course_2: 56,
      },
      direction: "(14)物联网技术与应用",
      source_url: "https://www.ludengkaoyan.com/school81/qrz/fsx/?nf=2024",
      source_kind: "third_party_public" as const,
    },
  ],
};

describe("student admissions contracts", () => {
  it("accepts paginated search and an optional year without a browser user id", () => {
    expect(admissionsTargetSearchQuerySchema.parse({ q: "安徽", year: "2024", page: "2", page_size: "10" }))
      .toEqual({ q: "安徽", year: 2024, page: 2, page_size: 10 });
    expect(admissionsTargetSearchQuerySchema.safeParse({ userId: "another_student" }).success)
      .toBe(false);
  });

  it("keeps historical cutoff lines traceable and carries an explicit verification boundary", () => {
    const parsed = admissionsTargetSearchResponseSchema.parse({
      items: [target],
      total: 1,
      page: 1,
      page_size: 20,
      available_years: [2026, 2025, 2024],
      data_boundary: {
        scope: "retest_cutoff_information_only",
        notice: "复试线信息来自本地公开资料整理，选择前请以院校官网当年公告为准。",
      },
    });

    expect(parsed.items[0]?.retest_lines[0]?.retest_score).toBe(273);
    expect(parsed.items[0]?.available_years).toEqual([2026, 2025, 2024]);
  });

  it("supports selecting, replacing and clearing one structured target", () => {
    expect(admissionsTargetSelectionSchema.parse({ target_id: target.target_id })).toEqual({
      target_id: target.target_id,
    });
    expect(admissionsCurrentTargetSchema.parse({ target, saved_at: "2026-08-12T08:00:00.000Z" }))
      .toMatchObject({ target: { school: "安徽大学" } });
    expect(admissionsCurrentTargetSchema.parse({ target: null, saved_at: null })).toEqual({
      target: null,
      saved_at: null,
    });
  });

  it("rejects provenance, authorization and ownership internals at the student boundary", () => {
    for (const internal of [
      { source_workbook_sha256: "a".repeat(64) },
      { original_path: "C:\\private\\院校复试信息.xlsx" },
      { license_status: "unverified" },
      { review_status: "pending_official_verification" },
      { user_id: "user_student_001" },
    ]) {
      expect(admissionsTargetSearchResponseSchema.safeParse({
        items: [{ ...target, ...internal }],
        total: 1,
        page: 1,
        page_size: 20,
        available_years: [2026, 2025, 2024],
        data_boundary: {
          scope: "retest_cutoff_information_only",
          notice: "以院校官网当年公告为准。",
        },
      }).success).toBe(false);
    }
  });
});
