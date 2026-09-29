import { describe, expect, it } from "vitest";

import * as workflowContracts from "../src/index.js";

import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  aiWorkflowCapabilitySchema,
  aiWorkflowInvocationSchema,
  aiWorkflowRequestSchema,
  aiWorkflowResponseSchema,
  courseCurriculumMapSchema,
} from "../src/index.js";

describe("computer-organization curriculum-map contracts", () => {
  const curriculum = {
    course_id: "course_408_co",
    course_slug: "computer-organization",
    title: "课程知识地图",
    curation_method: "source_constrained_course_design",
    chapters: [
      {
        chapter_id: "co_ch01",
        source_chapter: "1 计算机系统概论",
        title: "计算机系统概论",
        ordinal: 1,
        modules: [
          {
            module_id: "co_m01_01",
            title: "计算机系统与层次",
            ordinal: 1,
            concepts: [
              {
                concept_id: "co_c01_01",
                title: "硬件、软件与计算机系统",
                learning_objective: "区分硬件与软件，并说明二者为何共同构成计算机系统。",
                prerequisite_concept_ids: [],
                key_terms: ["硬件", "软件", "计算机系统"],
                learning_note: {
                  kind: "misconception",
                  text: "不要把计算机系统只理解为看得见的硬件设备。",
                },
                sources: [
                  {
                    chunk_id: "co_chunk_k0012",
                    print_page: 3,
                    chunk_offset: 0,
                  },
                ],
                importance: "core",
                review_status: "verified",
                ordinal: 1,
              },
            ],
          },
        ],
      },
    ],
    concept_count: 1,
    traceability: {
      source_reference_count: 1,
      valid_source_reference_count: 1,
      rate: 1,
    },
    generated_at: "2026-07-28T00:00:00.000Z",
  } as const;

  it("keeps a three-level curriculum map traceable to exact raw chunks", () => {
    const result = courseCurriculumMapSchema.parse(curriculum);

    expect(result.chapters[0]?.modules[0]?.concepts[0]?.sources[0]).toEqual({
      chunk_id: "co_chunk_k0012",
      print_page: 3,
      chunk_offset: 0,
    });
    expect(result.concept_count).toBe(1);
  });

  it("rejects derived counts and front-matter concepts", () => {
    expect(() => courseCurriculumMapSchema.parse({
      ...curriculum,
      concept_count: 2,
    })).toThrow("Concept count");

    expect(() => courseCurriculumMapSchema.parse({
      ...curriculum,
      chapters: [{
        ...curriculum.chapters[0],
        source_chapter: "前言、目录或参考资料",
      }],
    })).toThrow("Front matter");
  });
});

describe("AI learning-workflow adapter contract", () => {
  const request = {
    contract_version: "0.2",
    request_id: "workflow_req_001",
    capability: "explain",
    slot: "contextual_explanation",
    user_id: "user_student_001",
    course_id: "course_408_co",
    concept_id: "co_c01_01",
    source_chunk_ids: ["co_chunk_k0012"],
    attempt_id: null,
    learning_evidence: [],
    user_message: "硬件和软件的关系是什么？",
    context: {
      student: { user_id: "user_student_001" },
      course: {
        course_id: "course_408_co",
        title: "计算机组成原理",
        discipline: "计算机科学与技术",
      },
      concept: {
        concept_id: "co_c01_01",
        title: "硬件、软件与计算机系统",
        learning_objective: "区分硬件与软件，并说明二者如何共同构成计算机系统。",
        key_terms: ["硬件", "软件"],
      },
      source_chunks: [{
        source_chunk_id: "co_chunk_k0012",
        chapter: "1 计算机系统概论",
        locator: "教材来源块 k0012",
        content: "计算机系统由硬件和软件共同组成。",
      }],
      reading_progress: null,
      qa_case: null,
      attempt: null,
      evaluation: null,
    },
  } as const;

  it("maps the five student capabilities to one stable slot each", () => {
    expect(aiWorkflowCapabilitySchema.options).toEqual([
      "plan",
      "explain",
      "coach",
      "diagnose",
      "care",
    ]);
    expect(AI_WORKFLOW_SLOT_BY_CAPABILITY).toEqual({
      plan: "learning_orchestration",
      explain: "contextual_explanation",
      coach: "guided_case",
      diagnose: "practice_reflection",
      care: "supportive_check_in",
    });
  });

  it("models runtime connection truth without equating configuration with availability", () => {
    const schema = (
      workflowContracts as unknown as Record<string, { parse(value: unknown): unknown }>
    ).aiWorkflowRuntimeStatusSchema;

    expect(schema).toBeDefined();
    expect(schema?.parse({
      state: "configured",
      label: "AI 服务已配置，尚未验证",
      detail: "完成一次受契约约束的成功调用后才会显示可用。",
      checked_at: null,
    })).toMatchObject({ state: "configured", checked_at: null });
    expect(() => schema?.parse({
      state: "connected",
      label: "已连接专业知识库",
      detail: null,
      checked_at: null,
    })).toThrow();
  });

  it("validates the browser invocation without accepting server context or secrets", () => {
    expect(aiWorkflowInvocationSchema.parse({
      contract_version: "0.2",
      capability: "plan",
      course_id: "course_408_co",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      user_message: null,
    }).capability).toBe("plan");

    expect(() => aiWorkflowInvocationSchema.parse({
      contract_version: "0.2",
      capability: "explain",
      course_id: "course_408_co",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      user_message: null,
    })).toThrow("concept_id");

    expect(() => aiWorkflowInvocationSchema.parse({
      contract_version: "0.2",
      capability: "coach",
      course_id: "course_408_co",
      concept_id: "co_c01_01",
      qa_id: null,
      attempt_id: null,
      user_message: null,
    })).toThrow("qa_id");

    expect(() => aiWorkflowInvocationSchema.parse({
      contract_version: "0.2",
      capability: "diagnose",
      course_id: "course_408_co",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      user_message: null,
    })).toThrow("attempt_id");

    expect(() => aiWorkflowInvocationSchema.parse({
      contract_version: "0.2",
      capability: "plan",
      course_id: "course_408_co",
      concept_id: null,
      qa_id: null,
      attempt_id: null,
      user_message: null,
      secret: "must-never-reach-the-browser-contract",
    })).toThrow();
  });

  it("requires the database-built course, concept, source and evidence context", () => {
    const result = aiWorkflowRequestSchema.parse(request);

    expect(result.capability).toBe("explain");
    expect(result.source_chunk_ids).toEqual(["co_chunk_k0012"]);
    expect(result.context.source_chunks[0]?.content).toContain("硬件和软件");
    expect(() => aiWorkflowRequestSchema.parse({
      ...request,
      slot: "guided_case",
    })).toThrow("capability");
    expect(() => aiWorkflowRequestSchema.parse({
      ...request,
      source_chunk_ids: ["co_chunk_other"],
    })).toThrow("source_chunk_ids");
  });

  it("models the honest not-connected fallback without fabricated content", () => {
    const result = aiWorkflowResponseSchema.parse({
      contract_version: "0.2",
      request_id: request.request_id,
      capability: request.capability,
      slot: request.slot,
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [
        {
          action_id: "continue_reading",
          kind: "continue_learning",
          label: "继续阅读课程资料",
          target: "co_c01_01",
        },
      ],
      failure: {
        code: "WORKFLOW_NOT_CONNECTED",
        message: "AI 学习工作流尚未接入。",
        retryable: false,
        fallback_message: "先使用课程资料、案例和确定性评测继续学习。",
      },
    });

    expect(result.status).toBe("unavailable");
    expect(result.display_blocks).toHaveLength(0);
    expect(() => aiWorkflowResponseSchema.parse({
      ...result,
      failure: null,
    })).toThrow("Unavailable workflow responses require a failure");
  });

  it("models insufficient context separately from service failure", () => {
    const result = aiWorkflowResponseSchema.parse({
      contract_version: "0.2",
      request_id: "workflow_req_context",
      capability: "diagnose",
      slot: "practice_reflection",
      status: "insufficient_context",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: {
        code: "CONTEXT_INCOMPLETE",
        message: "当前作答记录不足以构建诊断上下文。",
        retryable: false,
        fallback_message: "确定性评测结果仍可正常查看。",
      },
    });
    expect(result.status).toBe("insufficient_context");
  });

  it("requires a ready diagnosis to explain the error, offer a hint, cite course material and give a next action", () => {
    expect(() => aiWorkflowResponseSchema.parse({
      contract_version: "0.2",
      request_id: "workflow_req_diagnose_quality",
      capability: "diagnose",
      slot: "practice_reflection",
      status: "ready",
      display_blocks: [{
        block_id: "diagnosis_notice",
        kind: "notice",
        title: "诊断结果",
        content: "这里只是一个不完整的诊断响应。",
      }],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: null,
    })).toThrow(/diagnose/i);
  });

  it("rejects answer-bearing or internal fields in the student response", () => {
    expect(() => aiWorkflowResponseSchema.parse({
      contract_version: "0.2",
      request_id: "workflow_req_leak",
      capability: "diagnose",
      slot: "practice_reflection",
      status: "ready",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      next_actions: [],
      failure: null,
      correct_option_ids: ["A"],
    })).toThrow();
  });
});
