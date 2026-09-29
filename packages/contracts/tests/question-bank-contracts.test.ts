import { describe, expect, it } from "vitest";

import {
  answerSubmissionSchema,
  courseLearningSummarySchema,
  courseMembershipSchema,
  courseRecordSchema,
  materialRecordSchema,
  materialCreateRequestSchema,
  learningConceptProgressSchema,
  managedQuestionSummarySchema,
  mockExamSessionSchema,
  mockExamStartRequestSchema,
  mockExamSubmissionResultSchema,
  mockExamSubmitRequestSchema,
  pastExamCatalogResponseSchema,
  pastExamPaperSummarySchema,
  platformRoleSchema,
  platformUserSchema,
  practiceLearningEvidenceSchema,
  practiceAttemptRecordSchema,
  practiceModeSchema,
  practiceSelectionSchema,
  questionDtoSchema,
  questionEvaluationResultSchema,
  questionLearningMetadataSchema,
  questionManagementRecordSchema,
  questionPracticeItemSchema,
  questionRankingExplanationSchema,
  questionReviewUpdateSchema,
  questionSourceTypeSchema,
} from "../src/index.js";

const source = {
  provider: "csgraduates.com",
  dataset_id: "408_json_data",
  source_url: "https://www.csgraduates.com/study_methods/408quiz/2026/#1",
  license_status: "unverified",
  usage_scope: "local_demo_only",
} as const;

describe("408 question-bank contracts", () => {
  it("describes a complete past-paper catalog without answer-bearing fields", () => {
    const paper = pastExamPaperSummarySchema.parse({
      year: 2026,
      question_count: 47,
      choice_count: 40,
      subjective_count: 7,
      subjects: [
        { subject: "数据结构", question_count: 11 },
        { subject: "组成原理", question_count: 12 },
        { subject: "操作系统", question_count: 12 },
        { subject: "计算机网络", question_count: 12 },
      ],
      attempted_count: 9,
      next_question_number: 10,
      is_complete: true,
    });
    const catalog = pastExamCatalogResponseSchema.parse({ items: [paper] });

    expect(catalog.items[0]).toMatchObject({
      year: 2026,
      question_count: 47,
      attempted_count: 9,
      next_question_number: 10,
      is_complete: true,
    });
    expect(JSON.stringify(catalog)).not.toMatch(
      /answer|solution|explanation|payload|correct_option/iu,
    );
  });

  it("rejects inconsistent paper totals, duplicate subjects, and invalid progress", () => {
    const base = {
      year: 2026,
      question_count: 47,
      choice_count: 40,
      subjective_count: 7,
      subjects: [
        { subject: "数据结构", question_count: 11 },
        { subject: "组成原理", question_count: 12 },
        { subject: "操作系统", question_count: 12 },
        { subject: "计算机网络", question_count: 12 },
      ],
      attempted_count: 0,
      next_question_number: 1,
      is_complete: true,
    };

    expect(pastExamPaperSummarySchema.safeParse({
      ...base,
      subjective_count: 6,
    }).success).toBe(false);
    expect(pastExamPaperSummarySchema.safeParse({
      ...base,
      subjects: [
        { subject: "数据结构", question_count: 23 },
        { subject: "数据结构", question_count: 24 },
      ],
    }).success).toBe(false);
    expect(pastExamPaperSummarySchema.safeParse({
      ...base,
      attempted_count: 48,
    }).success).toBe(false);
    expect(pastExamPaperSummarySchema.safeParse({
      ...base,
      attempted_count: 47,
      next_question_number: 1,
    }).success).toBe(false);
    expect(pastExamPaperSummarySchema.safeParse({
      ...base,
      next_question_number: 48,
    }).success).toBe(false);
    expect(pastExamPaperSummarySchema.safeParse({
      ...base,
      question_count: 46,
      choice_count: 39,
      is_complete: true,
    }).success).toBe(false);
  });

  it("defines five distinct training modes and four governed source types", () => {
    expect(practiceModeSchema.options).toEqual([
      "diagnostic",
      "targeted",
      "past_exam",
      "mock_exam",
      "mistake_review",
    ]);
    expect(questionSourceTypeSchema.options).toEqual([
      "past_exam",
      "mock_exam",
      "self_authored_screening",
      "self_authored_practice",
    ]);
    expect(practiceModeSchema.safeParse("adaptive_ai").success).toBe(false);
  });

  it("distinguishes technically validated demo papers from teacher verification", () => {
    expect(questionLearningMetadataSchema.parse({
      source_type: "past_exam",
      allowed_modes: ["past_exam"],
      paper_year: 2026,
      protect_full_paper: false,
      importance: "core",
      content_review_status: "demo_validated",
    }).content_review_status).toBe("demo_validated");
  });

  it("keeps source metadata and personalized ranking separate from public question content", () => {
    const screeningQuestion = questionDtoSchema.parse({
      id: "screening-408-v3-01",
      year: null,
      number: 1,
      subject: "数据结构",
      type: "choice",
      multiple: false,
      question: "元素依次入栈后，最后入栈的元素位于哪里？",
      options: [
        { option_id: "A", text: "栈顶", assets: [] },
        { option_id: "B", text: "栈底", assets: [] },
      ],
      tags: ["栈的抽象与存储"],
      assets: [],
      content_format: "plain_text",
      source: {
        provider: "智算智伴课程组",
        dataset_id: "408_onboarding_screening_v3",
        source_url: "https://xuetu.local/onboarding/408-v3",
        license_status: "verified",
        usage_scope: "authorized_product_use",
      },
    });
    const learning = questionLearningMetadataSchema.parse({
      source_type: "self_authored_screening",
      allowed_modes: ["diagnostic"],
      paper_year: null,
      protect_full_paper: false,
      importance: "core",
      content_review_status: "pending_teacher_review",
    });
    const ranking = questionRankingExplanationSchema.parse({
      algorithm_version: "fsrs_v6_weighted_v1",
      priority_score: 34,
      evidence_level: "limited",
      components: {
        memory_risk: 0.35,
        concept_weakness: 0,
        repeated_error: 0,
        importance: 1,
        novelty: 1,
      },
      reason_lines: ["尚无稳定作答证据", "核心知识点", "未练习过"],
    });
    const item = questionPracticeItemSchema.parse({
      question: screeningQuestion,
      learning_metadata: learning,
      ranking,
    });

    expect(item.question.year).toBeNull();
    expect(item.learning_metadata.allowed_modes).toEqual(["diagnostic"]);
    expect(item.ranking?.evidence_level).toBe("limited");
    expect(item).not.toHaveProperty("answer_key");
    expect(questionRankingExplanationSchema.safeParse({
      ...ranking,
      components: { ...ranking.components, memory_risk: 1.01 },
    }).success).toBe(false);
  });

  it("defines server-owned mock-exam start, unique answers, and partial score semantics", () => {
    expect(mockExamStartRequestSchema.parse({ year: 2023 })).toEqual({ year: 2023 });
    expect(mockExamStartRequestSchema.parse({})).toEqual({});

    const answer = {
      question_id: "2023-01",
      answer_type: "choice" as const,
      selected_option_ids: ["A"],
    };
    expect(mockExamSubmitRequestSchema.parse({ answers: [answer] }).answers).toHaveLength(1);
    expect(mockExamSubmitRequestSchema.safeParse({ answers: [answer, answer] }).success).toBe(false);

    const question = questionDtoSchema.parse({
      id: "2023-01",
      year: 2023,
      number: 1,
      subject: "数据结构",
      type: "choice",
      multiple: false,
      question: "示例真题。",
      options: [
        { option_id: "A", text: "选项 A", assets: [] },
        { option_id: "B", text: "选项 B", assets: [] },
      ],
      tags: [],
      assets: [],
      content_format: "plain_text",
      source,
    });
    const learning = questionLearningMetadataSchema.parse({
      source_type: "past_exam",
      allowed_modes: ["targeted", "past_exam", "mock_exam"],
      paper_year: 2023,
      protect_full_paper: false,
      importance: "core",
      content_review_status: "teacher_verified",
    });
    const session = mockExamSessionSchema.parse({
      session_id: "mock_session_001",
      year: 2023,
      status: "active",
      duration_minutes: 40,
      server_now: "2026-08-24T06:00:00.000Z",
      started_at: "2026-08-24T06:00:00.000Z",
      expires_at: "2026-08-24T09:00:00.000Z",
      submitted_at: null,
      resumed: false,
      questions: [{ question, learning_metadata: learning, ranking: null }],
    });
    expect(session.duration_minutes).toBe(40);
    expect(session.server_now).toBe("2026-08-24T06:00:00.000Z");
    expect(session.questions[0]).not.toHaveProperty("answer_key");

    const result = mockExamSubmissionResultSchema.parse({
      session_id: "mock_session_001",
      year: 2023,
      status: "submitted",
      submitted_at: "2026-08-24T08:30:00.000Z",
      question_count: 47,
      answered_count: 45,
      unanswered_count: 2,
      objective: {
        question_count: 40,
        answered_count: 40,
        correct_count: 32,
        score: 64,
        max_score: 80,
      },
      subjective: {
        question_count: 7,
        submitted_count: 5,
        pending_review_count: 5,
      },
      score_status: "partial_pending_subjective_review",
      evaluations: [],
    });
    expect(result.objective.score).toBe(64);
    expect(result.score_status).toBe("partial_pending_subjective_review");
  });

  it("exposes only the reliable practice count needed to route learning-record entries", () => {
    const concept = learningConceptProgressSchema.parse({
      concept_id: "ds_c02_01",
      title: "线性表的定义与相邻关系",
      status: "reading",
      attempt_count: 0,
      correct_count: 0,
      incorrect_count: 0,
      mistake_count: 0,
      practice_question_count: 0,
    });

    expect(concept.practice_question_count).toBe(0);
    expect(() => learningConceptProgressSchema.parse({
      ...concept,
      practice_question_count: -1,
    })).toThrow();
  });

  it("keeps student, teacher, and administrator roles distinct", () => {
    expect(platformRoleSchema.options).toEqual(["student", "teacher", "admin"]);
    expect(platformRoleSchema.parse("teacher")).not.toBe(platformRoleSchema.parse("admin"));
  });

  it("defines migratable user, course, membership, and material records", () => {
    expect(
      platformUserSchema.parse({
        user_id: "user_teacher_001",
        display_name: "演示教师",
        account_status: "active",
        auth_source: "local_development",
        created_at: "2026-07-27T00:00:00.000Z",
        updated_at: "2026-07-27T00:00:00.000Z",
      }),
    ).not.toHaveProperty("password");

    expect(
      courseRecordSchema.parse({
        course_id: "course_408_001",
        course_code: "CS408",
        title: "计算机学科专业基础",
        discipline: "计算机科学与技术",
        status: "active",
        created_by: "user_admin_001",
        created_at: "2026-07-27T00:00:00.000Z",
        updated_at: "2026-07-27T00:00:00.000Z",
      }).discipline,
    ).toBe("计算机科学与技术");

    expect(
      courseMembershipSchema.parse({
        course_id: "course_408_001",
        user_id: "user_teacher_001",
        membership_role: "teacher",
        status: "active",
        created_at: "2026-07-27T00:00:00.000Z",
      }).membership_role,
    ).toBe("teacher");

    expect(
      materialRecordSchema.parse({
        material_id: "material_001",
        course_id: "course_408_001",
        title: "数据结构课程讲义",
        material_type: "course_handout",
        source_url: null,
        storage_ref: "local://materials/data-structures.pdf",
        review_status: "pending_review",
        license_status: "unverified",
        created_by: "user_teacher_001",
        created_at: "2026-07-27T00:00:00.000Z",
        updated_at: "2026-07-27T00:00:00.000Z",
      }).review_status,
    ).toBe("pending_review");
  });

  it("accepts a strict public plain-text question DTO without answer-bearing fields", () => {
    const parsed = questionDtoSchema.parse({
      id: "2026-01",
      year: 2026,
      number: 1,
      subject: "数据结构",
      type: "choice",
      multiple: false,
      question: "顺序表的哪项操作必然移动元素？",
      options: [
        { option_id: "A", text: "表头插入", assets: [] },
        { option_id: "B", text: "表尾删除", assets: [] },
      ],
      tags: ["线性表"],
      assets: [],
      content_format: "plain_text",
      source,
    });

    expect(parsed.content_format).toBe("plain_text");
    expect(Object.keys(parsed)).not.toContain("answer");
    expect(
      questionDtoSchema.safeParse({
        ...parsed,
        answer: "A",
      }).success,
    ).toBe(false);
    expect(
      questionDtoSchema.safeParse({
        ...parsed,
        question_html: "<strong>A</strong>",
      }).success,
    ).toBe(false);
  });

  it("preserves the largest verified multi-image question without exposing payloads", () => {
    const assets = Array.from({ length: 102 }, (_, index) => ({
      asset_id: `asset_${index}`,
      role: "question" as const,
      option_id: null,
      reference_kind: "embedded_source" as const,
      source_reference: `embedded:sha256:${index.toString(16).padStart(64, "0")}`,
      mime_type: "image/png",
      availability: "authenticated_api" as const,
    }));

    expect(
      questionDtoSchema.parse({
        id: "2011-47",
        year: 2011,
        number: 47,
        subject: "计算机网络",
        type: "subjective",
        multiple: false,
        question: "根据所给报文与拓扑完成分析。",
        options: [],
        tags: ["综合题"],
        assets,
        content_format: "plain_text",
        source,
      }).assets,
    ).toHaveLength(102);
    expect(assets.every((asset) => !asset.source_reference.startsWith("data:"))).toBe(true);
  });

  it("normalizes selection defaults and rejects unsafe pagination", () => {
    expect(
      practiceSelectionSchema.parse({
        subject: "数据结构",
        year: 2026,
        type: "choice",
        tags: ["线性表"],
      }),
    ).toEqual({
      subject: "数据结构",
      year: 2026,
      type: "choice",
      tags: ["线性表"],
      mode: "targeted",
      tag_match: "all",
      limit: 20,
      offset: 0,
    });

    expect(practiceSelectionSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({ mode: "adaptive_ai" }).success).toBe(false);
  });

  it("requires one unfiltered year for past-paper practice", () => {
    expect(practiceSelectionSchema.safeParse({ mode: "past_exam" }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({
      mode: "past_exam",
      year: 2026,
      subject: "数据结构",
    }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({
      mode: "past_exam",
      year: 2026,
      type: "choice",
    }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({
      mode: "past_exam",
      year: 2026,
      tags: ["栈"],
    }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({
      mode: "past_exam",
      year: 2026,
      concept_id: "ds_c02_02",
    }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({
      mode: "past_exam",
      year: 2026,
      question_id: "2026-01",
    }).success).toBe(false);

    expect(practiceSelectionSchema.parse({
      mode: "past_exam",
      year: 2026,
      limit: 1,
      offset: 46,
    })).toMatchObject({
      mode: "past_exam",
      year: 2026,
      tags: [],
      limit: 1,
      offset: 46,
    });
  });

  it("accepts a curated course concept as an optional practice boundary", () => {
    expect(
      practiceSelectionSchema.parse({
        subject: "数据结构",
        type: "choice",
        concept_id: "ds_c02_02",
      }),
    ).toMatchObject({
      subject: "数据结构",
      type: "choice",
      concept_id: "ds_c02_02",
    });

    expect(
      answerSubmissionSchema.parse({
        question_id: "2026-01",
        concept_id: "ds_c02_02",
        answer_type: "choice",
        selected_option_ids: ["A"],
      }),
    ).toMatchObject({
      question_id: "2026-01",
      concept_id: "ds_c02_02",
    });
  });

  it("accepts a specific existing question as a controlled re-practice boundary", () => {
    expect(
      practiceSelectionSchema.parse({
        subject: "数据结构",
        type: "choice",
        question_id: "2026-01",
      }),
    ).toMatchObject({
      question_id: "2026-01",
      tags: [],
      tag_match: "all",
    });
  });

  it("uses a discriminated submission contract for choice and subjective answers", () => {
    expect(
      answerSubmissionSchema.parse({
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
      }),
    ).toEqual({
      question_id: "2026-01",
      answer_type: "choice",
      selected_option_ids: ["A"],
    });

    expect(
      answerSubmissionSchema.parse({
        question_id: "2026-41",
        answer_type: "subjective",
        response_text: "先给出算法思想，再写伪代码。",
      }),
    ).toMatchObject({ answer_type: "subjective" });

    expect(
      answerSubmissionSchema.safeParse({
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: [],
      }).success,
    ).toBe(false);
  });

  it("separates deterministic choice grading from pending subjective review", () => {
    const deterministic = questionEvaluationResultSchema.parse({
      evaluation_id: "eval_001",
      submission_id: "submission_001",
      question_id: "2026-01",
      grading_mode: "deterministic_choice",
      status: "correct",
      is_correct: true,
      score: 100,
      correct_option_ids: ["A"],
      explanation: "表头操作会移动现有元素。",
      reference_solution: null,
      answer_assets: [],
      review_required: false,
      created_at: "2026-07-27T00:00:00.000Z",
      source,
    });
    expect(deterministic.is_correct).toBe(true);

    const pending = questionEvaluationResultSchema.parse({
      evaluation_id: "eval_002",
      submission_id: "submission_002",
      question_id: "2026-41",
      grading_mode: "ai_or_teacher_review_required",
      status: "pending_review",
      is_correct: null,
      score: null,
      correct_option_ids: [],
      explanation: null,
      reference_solution: "参考解法仅供复核，不代表学生答案已被判为正确。",
      answer_assets: [],
      review_required: true,
      created_at: "2026-07-27T00:00:00.000Z",
      source,
    });
    expect(pending.status).toBe("pending_review");

    expect(
      questionEvaluationResultSchema.safeParse({
        ...pending,
        status: "correct",
        is_correct: true,
        score: 100,
        review_required: false,
      }).success,
    ).toBe(false);
  });

  it("prevents pending-review evidence from claiming a mastery update", () => {
    const base = {
      evidence_id: "evidence_001",
      evaluation_id: "eval_002",
      submission_id: "submission_002",
      question_id: "2026-41",
      subject: "数据结构",
      year: 2026,
      question_type: "subjective",
      outcome: "pending_review",
      grading_mode: "ai_or_teacher_review_required",
      selected_option_ids: null,
      response_present: true,
      tags: ["二叉搜索树"],
      review_required: true,
      eligible_for_learning_state_update: false,
      persistence_status: "not_persisted",
      created_at: "2026-07-27T00:00:00.000Z",
      source,
    } as const;

    expect(practiceLearningEvidenceSchema.parse(base).outcome).toBe("pending_review");
    expect(
      practiceLearningEvidenceSchema.safeParse({
        ...base,
        eligible_for_learning_state_update: true,
      }).success,
    ).toBe(false);
  });

  it("defines managed-question and persisted-attempt records without weakening answer boundaries", () => {
    const publicQuestion = questionDtoSchema.parse({
      id: "2026-01",
      year: 2026,
      number: 1,
      subject: "数据结构",
      type: "choice",
      multiple: false,
      question: "顺序表的哪项操作必然移动元素？",
      options: [
        { option_id: "A", text: "表头插入", assets: [] },
        { option_id: "B", text: "表尾删除", assets: [] },
      ],
      tags: ["线性表"],
      assets: [],
      content_format: "plain_text",
      source,
    });

    expect(
      questionManagementRecordSchema.parse({
        question: publicQuestion,
        course_id: "course_408_001",
        import_batch_id: "import_408_001",
        review_status: "pending_review",
        reviewed_by: null,
        reviewed_at: null,
        created_at: "2026-07-27T00:00:00.000Z",
        updated_at: "2026-07-27T00:00:00.000Z",
      }).review_status,
    ).toBe("pending_review");

    expect(
      practiceAttemptRecordSchema.parse({
        attempt_id: "attempt_001",
        user_id: "user_student_001",
        course_id: "course_408_001",
        question_id: "2026-01",
        answer_type: "choice",
        selected_option_ids: ["A"],
        response_text: null,
        status: "evaluated",
        submitted_at: "2026-07-27T00:00:00.000Z",
      }).status,
    ).toBe("evaluated");
  });

  it("defines teacher/admin maintenance and stored-record summary boundaries", () => {
    expect(
      materialCreateRequestSchema.parse({
        title: "数据结构实验指导",
        material_type: "course_handout",
        source_url: null,
        storage_ref: "local://materials/lab-guide.pdf",
        license_status: "unverified",
      }).license_status,
    ).toBe("unverified");
    expect(
      materialCreateRequestSchema.safeParse({
        title: "无来源材料",
        material_type: "other",
        source_url: null,
        storage_ref: null,
      }).success,
    ).toBe(false);

    expect(
      questionReviewUpdateSchema.parse({
        review_status: "approved",
        review_note: "已核对原题与答案。",
      }).review_status,
    ).toBe("approved");

    expect(
      managedQuestionSummarySchema.parse({
        question_id: "practice-408-v1-01",
        course_id: "course_408_001",
        year: null,
        number: 1,
        subject: "数据结构",
        type: "choice",
        tags: ["循环队列"],
        source_url: "https://xuetu.local/practice/408-v1",
        license_status: "verified",
        usage_scope: "authorized_product_use",
        review_status: "pending_review",
        reviewed_by: null,
        reviewed_at: null,
        updated_at: "2026-08-25T00:00:00.000Z",
      }).year,
    ).toBeNull();

    expect(
      courseLearningSummarySchema.parse({
        course_id: "course_408_001",
        active_students: 1,
        attempt_count: 2,
        deterministic_correct_count: 1,
        deterministic_incorrect_count: 0,
        pending_review_count: 1,
        evidence_count: 2,
        generated_at: "2026-07-27T00:00:00.000Z",
        data_scope: "stored_records_only",
      }).data_scope,
    ).toBe("stored_records_only");
  });
});
