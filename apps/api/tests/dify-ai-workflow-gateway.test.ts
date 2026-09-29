import { describe, expect, it, vi } from "vitest";

import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  type AiWorkflowRequest,
} from "@xuetu/contracts";

import { DifyAiWorkflowGateway } from "../src/services/ai-workflow/dify-ai-workflow-gateway.js";

function request(
  overrides: Partial<AiWorkflowRequest> = {},
): AiWorkflowRequest {
  return {
    contract_version: "0.2",
    request_id: "workflow_dify_001",
    capability: "explain",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.explain,
    user_id: "user_student_001",
    course_id: "course_408_co",
    concept_id: "co_c01_01",
    source_chunk_ids: ["co_k_1"],
    attempt_id: null,
    learning_evidence: [{
      evidence_id: "evidence_001",
      kind: "reading_progress",
      summary: "已阅读当前知识点。",
      observed_at: "2026-07-28T00:00:00.000Z",
    }],
    user_message: "请解释当前概念。",
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
        learning_objective: "区分硬件与软件。",
        key_terms: ["硬件", "软件"],
      },
      source_chunks: [{
        source_chunk_id: "co_k_1",
        chapter: "1 计算机系统概论",
        locator: "课程资料固定测试定位",
        content: "计算机系统由硬件和软件共同组成。",
      }],
      reading_progress: null,
      qa_case: null,
      attempt: null,
      evaluation: null,
    },
    ...overrides,
  };
}

function careRequest(): AiWorkflowRequest {
  return {
    contract_version: "0.2",
    request_id: "workflow_dify_care_001",
    capability: "care",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.care,
    user_id: "user_student_001",
    course_id: "course_408_co",
    concept_id: null,
    source_chunk_ids: [],
    attempt_id: null,
    learning_evidence: [],
    user_message: "我想先理清今天怎么开始。",
    context: {
      student: { user_id: "user_student_001" },
      course: {
        course_id: "course_408_co",
        title: "计算机组成原理",
        discipline: "计算机科学与技术",
      },
      concept: null,
      source_chunks: [],
      reading_progress: null,
      qa_case: null,
      attempt: null,
      evaluation: null,
      care_check_in: {
        conversation_id: "care_talk_001",
        recent_turns: [
          { role: "assistant", content: "今天想先从哪里开始？" },
          { role: "user", content: "我想把任务拆小一点。" },
        ],
        signal_code: "rhythm_drop",
        reason_summary: "最近一周完成学习任务的天数比此前少。",
        consented_at: "2026-08-20T01:05:00.000Z",
        current_task: {
          task_id: "task_current_001",
          task_type: "course_reading",
          course_id: "course_408_co",
          course_title: "计算机组成原理",
          concept_title: null,
          title: "继续课程阅读",
          estimated_minutes: 20,
          href: "/student/courses/computer-organization",
        },
      },
    },
  };
}

function difyResponse(answer: Record<string, unknown>) {
  return new Response(JSON.stringify({
    data: {
      outputs: { answer: JSON.stringify(answer) },
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function difyNativeResponse(outputs: Record<string, unknown>) {
  return new Response(JSON.stringify({
    data: { outputs },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Dify AI workflow gateway", () => {
  it("sends care as a minimal consent-gated workflow input", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(difyResponse({
      status: "success",
      request_id: "workflow_dify_care_001",
      display_blocks: "我们先不改学习结论，从当前任务里找一个容易开始的步骤。",
      reference_ids: [],
      next_actions: [{
        kind: "read",
        label: "继续当前课程阅读",
        target: "/student/courses/computer-organization",
      }],
      failure_reasons: [],
    }));
    const gateway = new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    const result = await gateway.run(careRequest());

    expect(result).toMatchObject({
      capability: "care",
      status: "ready",
      citations: [],
      evidence_refs: [],
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      inputs: Record<string, unknown>;
    };
    expect(Object.keys(body.inputs).sort()).toEqual([
      "capability",
      "care_check_in",
      "care_guardrails",
      "course",
      "request_id",
      "response_language",
      "user_text",
    ]);
    expect(String(body.inputs.care_guardrails)).toContain("不得诊断心理状态");
    expect(String(body.inputs.care_guardrails)).toContain("不得修改成绩、掌握度、错题或任务状态");
    const careGuardrails = String(body.inputs.care_guardrails);
    const supportiveOrder = [
      "只回应学生明确表达的感受",
      "先降低当下压力",
      "再提供选择",
      "最后最多给出一个小步骤",
    ];
    expect(supportiveOrder.every((instruction) => careGuardrails.includes(instruction))).toBe(true);
    expect(supportiveOrder.map((instruction) => careGuardrails.indexOf(instruction)))
      .toEqual([...supportiveOrder]
        .map((instruction) => careGuardrails.indexOf(instruction))
        .sort((left, right) => left - right));
    expect(careGuardrails).toContain("由服务端确定性安全分支在调用模型前处理");
    const careCheckIn = JSON.parse(String(body.inputs.care_check_in)) as Record<string, unknown>;
    expect(careCheckIn).toMatchObject({
      conversation_id: "care_talk_001",
      recent_turns: [
        { role: "assistant", content: "今天想先从哪里开始？" },
        { role: "user", content: "我想把任务拆小一点。" },
      ],
      signal_code: "rhythm_drop",
      reason_summary: "最近一周完成学习任务的天数比此前少。",
      current_task: {
        task_id: "task_current_001",
        href: "/student/courses/computer-organization",
      },
    });
    expect(JSON.stringify(body.inputs)).not.toContain("user_student_001");
    expect(JSON.stringify(body.inputs)).not.toContain("learning_evidence");
    expect(JSON.stringify(body.inputs)).not.toContain("score");
  });

  it("maps the native workflow response and sends only server-built context", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(difyResponse({
      status: "success",
      request_id: "workflow_dify_001",
      display_blocks: "硬件执行指令，软件描述任务。",
      reference_ids: ["co_k_1"],
      next_actions: ["继续阅读当前知识点"],
      evidence_candidate: "已完成概念阅读",
      failure_reasons: [],
    }));
    const gateway = new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    const result = await gateway.run(request());

    expect(result).toMatchObject({
      status: "ready",
      request_id: "workflow_dify_001",
      capability: "explain",
      citations: [{ source_chunk_id: "co_k_1" }],
      next_actions: [{ label: "继续阅读当前知识点" }],
    });
    expect(result.display_blocks[0]).toMatchObject({
      kind: "summary",
      content: "硬件执行指令，软件描述任务。",
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://workflow.example.test/v1/workflows/run");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer server-only-secret");
    const body = JSON.parse(String(init?.body)) as {
      inputs: Record<string, unknown>;
      user: string;
      response_mode: string;
    };
    expect(body.response_mode).toBe("blocking");
    expect(body.user).toBe("xuetu-ai-workflow");
    expect(body.inputs.capability).toBe("explain");
    expect(body.inputs.request_id).toBe("workflow_dify_001");
    expect(String(body.inputs.textbook_snippets)).toContain("[片段ID: co_k_1]");
    expect(String(body.inputs.textbook_snippets)).not.toContain("课程资料固定测试定位");
    expect(String(init?.body)).not.toContain("server-only-secret");
  });

  it("accepts the workflow contract when data.outputs is the result object itself", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(difyNativeResponse({
      status: "success",
      request_id: "workflow_dify_001",
      display_blocks: "硬件执行指令，软件描述任务。",
      reference_ids: ["co_k_1"],
      next_actions: ["继续阅读当前知识点"],
      failure_reasons: [],
    }));

    const result = await new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    }).run(request());

    expect(result).toMatchObject({
      status: "ready",
      request_id: "workflow_dify_001",
      citations: [{ source_chunk_id: "co_k_1" }],
    });
  });

  it("does not send local-demo textbook chunks to Dify by default", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
    }).run(request());

    expect(result).toMatchObject({
      status: "insufficient_context",
      failure: { code: "CONTEXT_INCOMPLETE" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts the structured display block shape returned by the live workflow", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(difyResponse({
      status: "success",
      request_id: "workflow_dify_001",
      display_blocks: [{
        kind: "explanation",
        content: "硬件负责执行，软件负责描述任务。",
      }],
      reference_ids: ["co_k_1"],
      next_actions: [{
        kind: "read",
        label: "继续阅读当前知识点",
        target: "co_k_1",
      }],
      evidence_candidate: "已完成概念阅读",
      failure_reasons: [],
    }));

    const result = await new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    }).run(request());

    expect(result).toMatchObject({
      status: "ready",
      display_blocks: [{
        kind: "summary",
        content: "硬件负责执行，软件负责描述任务。",
      }],
      next_actions: [{
        kind: "continue_learning",
        label: "继续阅读当前知识点",
        target: "co_k_1",
      }],
    });
  });

  it("adapts the workflow group's native diagnose contract without requiring request_id echo", async () => {
    const diagnoseRequest = request({
      request_id: "workflow_dify_diagnose_001",
      capability: "diagnose",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
      concept_id: "co_c01_01",
      attempt_id: "attempt_001",
      user_message: null,
      context: {
        ...request().context,
        attempt: {
          attempt_id: "attempt_001",
          question_id: "question_001",
          subject: "组成原理",
          question_text: "MAR用于保存什么？",
          options: [
            { option_id: "A", text: "指令地址" },
            { option_id: "B", text: "访存地址" },
          ],
          selected_option_ids: ["A"],
          submitted_at: "2026-07-28T00:00:00.000Z",
        },
        evaluation: {
          evaluation_id: "evaluation_001",
          grading_mode: "deterministic_choice",
          status: "incorrect",
          is_correct: false,
          score: 0,
          correct_option_ids: ["B"],
          explanation: "已完成确定性判分。",
          created_at: "2026-07-28T00:00:01.000Z",
        },
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(difyNativeResponse({
      status: "ready",
      error_analysis: "你把 MAR 与 PC 保存的地址类型混淆了。",
      step_by_step_hints: [
        "先判断本次操作访问的是主存还是下一条指令。",
        "再回看两个寄存器各自保存的地址类型。",
      ],
      knowledge_references: [{
        source_chunk_id: "co_k_1",
        title: "1 计算机系统概论",
      }],
      next_actions: ["先复述地址寄存器的作用，再完成一道相关练习"],
    }));

    const gateway = new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    });
    const result = await gateway.run(diagnoseRequest);

    expect(result.status).toBe("ready");
    expect(result.display_blocks.map((block) => block.kind)).toEqual([
      "feedback",
      "hint",
    ]);
    expect(result.display_blocks[0]?.content).toContain("MAR 与 PC");
    expect(result.display_blocks[1]?.content).toContain("访问的是主存");
    expect(result.citations).toEqual([
      expect.objectContaining({ source_chunk_id: "co_k_1" }),
    ]);
    expect(gateway.status("diagnose")).toMatchObject({ state: "available" });
    expect(gateway.status("plan")).toMatchObject({ state: "configured", checked_at: null });
    const bodyText = String(fetchImpl.mock.calls[0]?.[1]?.body);
    const body = JSON.parse(bodyText) as {
      inputs: Record<string, unknown>;
      user: string;
    };
    expect(Object.keys(body.inputs).sort()).toEqual([
      "backend_diagnosis_basis",
      "capability",
      "course",
      "deterministic_assessment",
      "knowledge_points",
      "knowledge_reference_inputs",
      "learner_response",
      "learning_evidence_bundle",
      "request_id",
      "response_language",
      "student_profile_summary",
      "task_content",
      "textbook_snippets",
      "user_text",
      "student_profile",
    ].sort());
    expect(body.inputs.capability).toBe("diagnose");
    expect(String(body.inputs.user_text)).toContain("MAR用于保存什么");
    expect(String(body.inputs.user_text)).not.toContain("正确答案");
    expect(String(body.inputs.textbook_snippets)).toContain("[片段ID: co_k_1]");
    expect(String(body.inputs.textbook_snippets)).not.toContain("课程资料固定测试定位");
    expect(body.user).not.toBe("user_student_001");
    expect(bodyText).not.toContain("correct_option_ids");
    expect(bodyText).not.toContain("evaluation_001");
    expect(bodyText).not.toContain("attempt_001");
    expect(bodyText).not.toContain("question_001");
  });

  it("accepts the live workflow's legacy answer envelope through the same safety checks", async () => {
    const diagnoseRequest = request({
      request_id: "workflow_dify_legacy_diagnose_001",
      capability: "diagnose",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
      attempt_id: "attempt_legacy_001",
      context: {
        ...request().context,
        attempt: {
          attempt_id: "attempt_legacy_001",
          question_id: "question_legacy_001",
          subject: "组成原理",
          question_text: "两个寄存器的职责如何区分？",
          options: [
            { option_id: "A", text: "职责甲" },
            { option_id: "B", text: "职责乙" },
          ],
          selected_option_ids: ["A"],
          submitted_at: "2026-07-28T00:00:00.000Z",
        },
        evaluation: {
          evaluation_id: "evaluation_legacy_001",
          grading_mode: "deterministic_choice",
          status: "incorrect",
          is_correct: false,
          score: 0,
          correct_option_ids: ["B"],
          explanation: "已完成确定性判分。",
          created_at: "2026-07-28T00:00:01.000Z",
        },
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(difyResponse({
      status: "success",
      request_id: "workflow_dify_legacy_diagnose_001",
      display_blocks: [
        { kind: "feedback", content: "你混淆了两个寄存器各自记录的信息。" },
        { kind: "hint", content: "先按信息流向比较它们的职责。" },
      ],
      reference_ids: ["co_k_1"],
      next_actions: [{ kind: "practice", label: "完成一道相关练习", target: "co_c01_01" }],
      evidence_candidate: null,
      failure_reasons: [],
    }));

    const result = await new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    }).run(diagnoseRequest);

    expect(result).toMatchObject({
      status: "ready",
      request_id: "workflow_dify_legacy_diagnose_001",
      citations: [{ source_chunk_id: "co_k_1" }],
      display_blocks: [
        { kind: "feedback" },
        { kind: "hint" },
      ],
    });
  });

  it("fails closed on an out-of-context citation or an explicit answer leak", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(difyResponse({
        status: "success",
        request_id: "workflow_dify_001",
        display_blocks: "说明",
        reference_ids: ["not-submitted"],
        next_actions: ["继续学习"],
        evidence_candidate: null,
        failure_reasons: [],
      }))
      .mockResolvedValueOnce(difyResponse({
        status: "success",
        request_id: "workflow_dify_diagnose_001",
        display_blocks: "错因反馈。正确答案是 B。",
        reference_ids: ["co_k_1"],
        next_actions: ["继续练习"],
        evidence_candidate: "标签",
        failure_reasons: [],
      }));
    const gateway = new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    const citationLeak = await gateway.run(request());
    expect(citationLeak).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      display_blocks: [],
    });

    const diagnoseLeak = await gateway.run(request({
      request_id: "workflow_dify_diagnose_001",
      capability: "diagnose",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
      attempt_id: "attempt_001",
      context: {
        ...request().context,
        attempt: {
          attempt_id: "attempt_001",
          question_id: "question_001",
          subject: "组成原理",
          question_text: "题目",
          options: [
            { option_id: "A", text: "选项一" },
            { option_id: "B", text: "选项二" },
          ],
          selected_option_ids: ["A"],
          submitted_at: "2026-07-28T00:00:00.000Z",
        },
        evaluation: {
          evaluation_id: "evaluation_001",
          grading_mode: "deterministic_choice",
          status: "incorrect",
          is_correct: false,
          score: 0,
          correct_option_ids: ["B"],
          explanation: "判分结果。",
          created_at: "2026-07-28T00:00:01.000Z",
        },
      },
    }));
    expect(diagnoseLeak).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      display_blocks: [],
    });
  });

  it("keeps a plan usable but visibly degraded when its optional citation is not traceable", async () => {
    const planRequest = request({
      request_id: "workflow_dify_plan_001",
      capability: "plan",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.plan,
      concept_id: null,
      source_chunk_ids: ["co_k_1"],
      user_message: null,
      context: {
        ...request().context,
        concept: null,
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(difyResponse({
      status: "success",
      request_id: "workflow_dify_plan_001",
      display_blocks: [{
        kind: "explanation",
        content: "建议先复习当前章节，再完成一题自测。",
      }],
      reference_ids: ["ch05_plan"],
      next_actions: [{ kind: "read", label: "继续阅读", target: "ch05_03" }],
      evidence_candidate: null,
      failure_reasons: [],
    }));

    const result = await new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    }).run(planRequest);

    expect(result).toMatchObject({
      status: "degraded",
      display_blocks: [{ content: "建议先复习当前章节，再完成一题自测。" }],
      citations: [],
      failure: { code: "WORKFLOW_FAILED" },
    });
  });

  it("fails closed for ordinal, numeric, option-text, and next-action answer leaks", async () => {
    const diagnoseRequest = request({
      request_id: "workflow_dify_leak_001",
      capability: "diagnose",
      slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
      attempt_id: "attempt_001",
      context: {
        ...request().context,
        attempt: {
          attempt_id: "attempt_001",
          question_id: "question_001",
          subject: "组成原理",
          question_text: "MAR用于保存什么？",
          options: [
            { option_id: "1", text: "下一条指令地址" },
            { option_id: "2", text: "本次访存地址" },
            { option_id: "3", text: "当前栈顶数据" },
          ],
          selected_option_ids: ["1"],
          submitted_at: "2026-07-28T00:00:00.000Z",
        },
        evaluation: {
          evaluation_id: "evaluation_001",
          grading_mode: "deterministic_choice",
          status: "incorrect",
          is_correct: false,
          score: 0,
          correct_option_ids: ["2"],
          explanation: "判分结果。",
          created_at: "2026-07-28T00:00:01.000Z",
        },
      },
    });
    const leakedAnswers = [
      "正确的是第二项。",
      "应选 2。",
      "本次访存地址。",
      "继续练习并选择第二项。",
    ];
    const fetchImpl = vi.fn<typeof fetch>();
    for (const [index, display] of leakedAnswers.entries()) {
      fetchImpl.mockResolvedValueOnce(difyNativeResponse({
        status: "success",
        request_id: "workflow_dify_leak_001",
        display_blocks: display,
        reference_ids: ["co_k_1"],
        next_actions: index === 3 ? ["选择第二项后继续练习"] : ["继续练习"],
        failure_reasons: [],
      }));
    }
    const gateway = new DifyAiWorkflowGateway({
      endpoint: "https://workflow.example.test/v1/workflows/run",
      secret: "server-only-secret",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    for (let index = 0; index < leakedAnswers.length; index += 1) {
      const result = await gateway.run(diagnoseRequest);
      expect(result, `leak case ${index + 1}`).toMatchObject({
        status: "failed",
        failure: { code: "WORKFLOW_FAILED" },
        display_blocks: [],
      });
    }
  });
});
