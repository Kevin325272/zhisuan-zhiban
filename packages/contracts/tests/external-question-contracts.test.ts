import { describe, expect, it } from "vitest";

import {
  externalQuestionConceptCandidateSchema,
  externalQuestionConfirmationSchema,
  externalQuestionDetailSchema,
  externalQuestionExplanationSchema,
  externalQuestionRecognitionSchema,
} from "../src/index.js";

const recognition = {
  status: "recognized" as const,
  subject: "data_structures" as const,
  question_type: "choice" as const,
  question_text: "队列的基本操作遵循哪一种原则？",
  options: [
    { label: "A", text: "先进先出" },
    { label: "B", text: "先进后出" },
  ],
  formulae: ["T(n) = 2T(n/2) + n"],
  diagram_description: null,
  knowledge_keywords: ["队列", "先进先出"],
  warnings: [],
};

describe("external question contracts", () => {
  it("accepts a bounded structured 408 recognition result", () => {
    expect(externalQuestionRecognitionSchema.parse(recognition)).toEqual(recognition);
  });

  it("requires a warning when the image cannot be recognized", () => {
    expect(externalQuestionRecognitionSchema).toBeDefined();
    expect(() => externalQuestionRecognitionSchema.parse({
      ...recognition,
      status: "needs_better_image",
      subject: "unknown",
      question_type: "unknown",
      question_text: "",
      options: [],
      formulae: [],
      knowledge_keywords: [],
      warnings: [],
    })).toThrow();
  });

  it("rejects unknown subjects and duplicate option labels at confirmation", () => {
    expect(externalQuestionConfirmationSchema).toBeDefined();
    expect(() => externalQuestionConfirmationSchema.parse({
      subject: "unknown",
      question_type: "choice",
      question_text: recognition.question_text,
      options: recognition.options,
      formulae: [],
      diagram_description: null,
    })).toThrow();

    expect(() => externalQuestionConfirmationSchema.parse({
      subject: "data_structures",
      question_type: "choice",
      question_text: recognition.question_text,
      options: [
        { label: "A", text: "先进先出" },
        { label: "A", text: "先进后出" },
      ],
      formulae: [],
      diagram_description: null,
    })).toThrow();
  });

  it("rejects final answers from direction and steps responses", () => {
    expect(externalQuestionExplanationSchema).toBeDefined();
    for (const depth of ["direction", "steps"] as const) {
      expect(() => externalQuestionExplanationSchema.parse({
        depth,
        summary: "识别队列操作顺序。",
        knowledge_points: [{
          concept_id: "ds_c01",
          title: "队列",
          reason: "题干直接涉及队列。",
        }],
        approach: ["观察入队与出队的先后关系。"],
        steps: depth === "steps" ? ["先写出元素进入队列的顺序。"] : [],
        self_check: "最先进入的元素应当何时离开？",
        final_answer: "A. 先进先出",
        uncertainty: null,
      })).toThrow();
    }
  });

  it("caps verified concept candidates at eight", () => {
    expect(externalQuestionConceptCandidateSchema).toBeDefined();
    expect(externalQuestionDetailSchema).toBeDefined();
    const candidate = {
      concept_id: "ds_c01",
      course_id: "course_408_ds",
      course_slug: "data-structures",
      title: "队列",
      reason: "题干包含课程术语“队列”。",
      reading_href: "/student/courses/data-structures?concept=ds_c01",
      practice_href: "/student/practice?mode=targeted&subject=数据结构&concept_id=ds_c01",
    };
    expect(externalQuestionConceptCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(() => externalQuestionDetailSchema.parse({
      external_question_id: "external_question_001",
      status: "recognized",
      content_revision: 0,
      image_url: "/api/v1/student/external-questions/external_question_001/image",
      recognition,
      confirmation: null,
      concept_candidates: Array.from({ length: 9 }, (_, index) => ({
        ...candidate,
        concept_id: `ds_c${index}`,
      })),
      explanations: [],
      saved_at: null,
      expires_at: "2026-08-25T00:00:00.000Z",
      created_at: "2026-08-24T00:00:00.000Z",
      updated_at: "2026-08-24T00:00:00.000Z",
      storage_ref: "private-file.webp",
    })).toThrow();
  });
});
