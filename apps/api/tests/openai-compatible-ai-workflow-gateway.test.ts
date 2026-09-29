import { describe, expect, it, vi } from "vitest";

import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  type AiWorkflowRequest,
} from "@xuetu/contracts";

import { OpenAiCompatibleAiWorkflowGateway } from "../src/services/ai-workflow/openai-compatible-ai-workflow-gateway.js";
import { AiUpstreamCircuitBreaker } from "../src/services/ai-upstream-circuit-breaker.js";

describe("Chat Completions workflow compatibility", () => {
  it("runs a source-constrained explanation through an explicitly selected chat provider", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("unsupported protocol", { status: 400 });
      return new Response(JSON.stringify({ model: "ZHIPU/GLM-5.3-Flash", choices: [{
        finish_reason: "stop",
        message: { role: "assistant", reasoning_content: "This must never become student-facing content", content: JSON.stringify({
          status: "success", request_id: "workflow_openai_explain_001",
          display_blocks: "MAR 保存本次访存地址。", reference_ids: ["co_k_1"],
          next_actions: [{ kind: "read", label: "继续阅读", target: "co_k_1" }],
        }) },
      }] }));
    });
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1", apiKey: "test-secret", model: "ZHIPU/GLM-5.3-Flash",
      apiFormat: "chat_completions", reasoningEffort: "low", maxOutputTokens: 4096,
      fetchImpl, allowUnverifiedSources: true,
    });
    const result = await gateway.run(explainRequest());
    expect(result.status).toBe("ready");
    expect(result.citations).toHaveLength(1);
    expect(result.model_trace).toMatchObject({ matched: true, provider_model: "ZHIPU/GLM-5.3-Flash" });
    expect(JSON.stringify(result)).not.toContain("This must never");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ reasoning_effort: "low", max_tokens: 4096, stream: false });
    expect(body.messages[0].content).not.toContain("user_student_001");
    expect(body.messages[0].content).not.toContain("correct_option_ids");
  });
});

function diagnoseRequest(): AiWorkflowRequest {
  return {
    contract_version: "0.2",
    request_id: "workflow_openai_diagnose_001",
    capability: "diagnose",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.diagnose,
    user_id: "user_student_001",
    course_id: "course_408_co",
    concept_id: "co_c01_01",
    source_chunk_ids: ["co_k_1"],
    attempt_id: "attempt_001",
    learning_evidence: [{
      evidence_id: "evidence_001",
      kind: "answer_result",
      summary: "地址寄存器相关题目作答错误。",
      observed_at: "2026-08-14T00:00:00.000Z",
    }],
    user_message: null,
    context: {
      student: { user_id: "user_student_001" },
      course: {
        course_id: "course_408_co",
        title: "计算机组成原理",
        discipline: "计算机科学与技术",
      },
      concept: {
        concept_id: "co_c01_01",
        title: "存储器地址寄存器",
        learning_objective: "区分 MAR 与其他寄存器保存的信息。",
        key_terms: ["MAR", "访存地址"],
      },
      source_chunks: [{
        source_chunk_id: "co_k_1",
        chapter: "存储器",
        locator: "内部定位信息不得发送给模型",
        content: "MAR 用于保存本次访问主存单元的地址。",
      }],
      reading_progress: null,
      qa_case: null,
      attempt: {
        attempt_id: "attempt_001",
        question_id: "question_001",
        subject: "计算机组成原理",
        question_text: "MAR 用于保存什么？",
        options: [
          { option_id: "A", text: "下一条指令地址" },
          { option_id: "B", text: "本次访存地址" },
        ],
        selected_option_ids: ["A"],
        submitted_at: "2026-08-14T00:00:00.000Z",
      },
      evaluation: {
        evaluation_id: "evaluation_001",
        grading_mode: "deterministic_choice",
        status: "incorrect",
        is_correct: false,
        score: 0,
        correct_option_ids: ["B"],
        explanation: "确定性判分完成。",
        created_at: "2026-08-14T00:00:01.000Z",
      },
    },
  };
}

function planRequest(): AiWorkflowRequest {
  const base = diagnoseRequest();
  return {
    ...base,
    request_id: "workflow_openai_plan_001",
    capability: "plan",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.plan,
    concept_id: null,
    attempt_id: null,
    learning_evidence: [
      {
        evidence_id: "workflow_task_current",
        kind: "weakness_signal",
        summary: "当前确定性任务：复习 Cache 地址映射；原因：存在尚未闭环的错题。",
        observed_at: "2026-08-14T00:00:00.000Z",
      },
      {
        evidence_id: "workflow_evidence_summary",
        kind: "weakness_signal",
        summary: "证据摘要：4 条课程阅读位置，11 次真实作答，3 个待复习项；证据充分。",
        observed_at: "2026-08-14T00:00:00.000Z",
      },
      {
        evidence_id: "reading_course_408_co_co_k_1",
        kind: "reading_progress",
        summary: "已阅读至段落 2。",
        observed_at: "2026-08-14T00:00:00.000Z",
      },
    ],
    user_message: "请说明下一步学习安排。",
    context: {
      ...base.context,
      concept: null,
      attempt: null,
      evaluation: null,
    },
  };
}

function explainRequest(): AiWorkflowRequest {
  const base = diagnoseRequest();
  return {
    ...base,
    request_id: "workflow_openai_explain_001",
    capability: "explain",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.explain,
    attempt_id: null,
    user_message: null,
    context: {
      ...base.context,
      attempt: null,
      evaluation: null,
    },
  };
}

function careRequest(): AiWorkflowRequest {
  return {
    contract_version: "0.2",
    request_id: "workflow_openai_care_001",
    capability: "care",
    slot: AI_WORKFLOW_SLOT_BY_CAPABILITY.care,
    user_id: "user_student_001",
    course_id: "course_408_co",
    concept_id: null,
    source_chunk_ids: [],
    attempt_id: null,
    learning_evidence: [],
    user_message: "我最近总是拖到很晚才开始，今天想先找一个能做下去的起点。",
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

function completion(answer: Record<string, unknown>, model = "gpt-5.6-terra") {
  return new Response(JSON.stringify({
    model,
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(answer) }],
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAI-compatible AI workflow gateway", () => {
  it("requests bounded diagrams and keeps them tied to the saved graphics preference", async () => {
    const diagram = { kind: "flow", title: "访存过程", summary: "地址送出后读取对应单元", nodes: [{ id: "address", label: "地址", description: "MAR 保存访问地址。" }, { id: "memory", label: "主存", description: "根据地址读取存储单元。" }], edges: [{ from: "address", to: "memory" }] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({ status: "success", request_id: "workflow_openai_explain_001", display_blocks: "根据地址访问主存。", reference_ids: ["co_k_1"], next_actions: [{ kind: "read", label: "继续阅读", target: "co_k_1" }], failure_reasons: [], diagram }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({ baseUrl: "https://relay.example.test/v1", apiKey: "test-only-key", model: "test-model", fetchImpl, allowUnverifiedSources: true });
    expect((await gateway.run({ ...explainRequest(), visual_explanations: true })).diagram).toEqual(diagram);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(JSON.parse(body.input.split("\n\nINPUT_JSON:\n")[1]).visual_explanations).toBe(true);
    expect(body.max_output_tokens).toBe(2400);
    fetchImpl.mockResolvedValue(completion({ status: "success", request_id: "workflow_openai_explain_001", display_blocks: "根据地址访问主存。", reference_ids: ["co_k_1"], next_actions: [{ kind: "read", label: "继续阅读", target: "co_k_1" }], failure_reasons: [], diagram }));
    expect((await gateway.run({ ...explainRequest(), visual_explanations: false })).diagram).toBeUndefined();
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).max_output_tokens).toBe(500);
  });
  it("drops a broken optional diagram without losing the text explanation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({ status: "success", request_id: "workflow_openai_explain_001", display_blocks: "根据地址访问主存。", reference_ids: ["co_k_1"], next_actions: [{ kind: "read", label: "继续阅读", target: "co_k_1" }], diagram: { nodes: [], html: "<script>bad</script>" } }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({ baseUrl: "https://relay.example.test/v1", apiKey: "test-only-key", model: "test-model", fetchImpl, allowUnverifiedSources: true });
    const result = await gateway.run({ ...explainRequest(), visual_explanations: true });
    expect(result.status).toBe("ready"); expect(result.diagram).toBeUndefined();
  });
  it("rejects a diagnostic diagram that reveals a correct option", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({ status: "success", request_id: "workflow_openai_diagnose_001", display_blocks: [{ kind: "feedback", content: "需要复查寄存器用途。" }, { kind: "hint", content: "区分地址与数据。" }], reference_ids: ["co_k_1"], next_actions: [{ kind: "read", label: "继续阅读", target: "co_k_1" }], diagram: { kind: "flow", title: "正确答案是B", summary: "查看寄存器", nodes: [{ id: "a", label: "寄存器", description: "寄存器的作用" }, { id: "b", label: "主存", description: "主存的作用" }], edges: [{ from: "a", to: "b" }] } }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({ baseUrl: "https://relay.example.test/v1", apiKey: "test-only-key", model: "test-model", fetchImpl, allowUnverifiedSources: true });
    const result = await gateway.run({ ...diagnoseRequest(), visual_explanations: true }); expect(result.status).toBe("failed"); expect(result.diagram).toBeUndefined();
  });
  it("fills an explicit explain intent when the browser omits user_message", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_explain_001",
      display_blocks: "先抓住 MAR 保存本次访存地址这一点。",
      reference_ids: ["co_k_1"],
      next_actions: [{ kind: "read", label: "继续阅读当前知识点", target: "co_k_1" }],
      failure_reasons: [],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(explainRequest())).resolves.toMatchObject({
      status: "ready",
      capability: "explain",
    });

    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { input: string };
    const modelContext = JSON.parse(
      requestBody.input.split("\n\nINPUT_JSON:\n")[1] ?? "null",
    ) as { user_message: string | null };
    expect(modelContext.user_message).toBe("请围绕当前知识点，结合课程片段解释核心概念，并给出一个可执行的练习方向。");
  });

  it("runs care with a consent-gated minimal context and non-diagnostic instructions", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_care_001",
      display_blocks: "听起来开始这一步最费力。我们先不改你的学习结论，可以从当前阅读任务里选一个十分钟的起点。",
      reference_ids: [],
      next_actions: [{
        kind: "read",
        label: "先继续当前课程阅读",
        target: "/student/courses/computer-organization",
      }],
      failure_reasons: [],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    const result = await gateway.run(careRequest());

    expect(result).toMatchObject({
      capability: "care",
      slot: "supportive_check_in",
      status: "ready",
      citations: [],
      evidence_refs: [],
      display_blocks: [{
        kind: "summary",
        title: "学伴交流",
      }],
      next_actions: [{
        kind: "continue_learning",
        target: "/student/courses/computer-organization",
      }],
    });

    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { input: string };
    expect(requestBody.input).toContain("不得诊断或推断焦虑、抑郁、疲劳等心理状态");
    expect(requestBody.input).toContain("不得承诺保密、医疗效果、考试结果");
    const supportiveOrder = [
      "只回应学生明确表达的感受",
      "先降低当下压力",
      "再提供选择",
      "最后最多给出一个小步骤",
    ];
    expect(supportiveOrder.every((instruction) => requestBody.input.includes(instruction))).toBe(true);
    expect(supportiveOrder.map((instruction) => requestBody.input.indexOf(instruction)))
      .toEqual([...supportiveOrder]
        .map((instruction) => requestBody.input.indexOf(instruction))
        .sort((left, right) => left - right));
    expect(requestBody.input).toContain("由服务端确定性安全分支在调用模型前处理");
    const modelContext = JSON.parse(
      requestBody.input.split("\n\nINPUT_JSON:\n")[1] ?? "null",
    ) as Record<string, unknown>;
    expect(Object.keys(modelContext).sort()).toEqual([
      "allowed_action_targets",
      "allowed_reference_ids",
      "capability",
      "care_check_in",
      "course",
      "request_id",
      "user_message",
    ]);
    expect(modelContext).toMatchObject({
      allowed_reference_ids: [],
      care_check_in: {
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
      },
    });
    expect(JSON.stringify(modelContext)).not.toContain("user_student_001");
    expect(JSON.stringify(modelContext)).not.toContain("learning_evidence");
    expect(JSON.stringify(modelContext)).not.toContain("score");
    expect(JSON.stringify(modelContext)).not.toContain("correct_option_ids");
  });

  it("returns an honest care fallback when the relay is unavailable", async () => {
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("upstream unavailable", { status: 503 }),
      ),
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(careRequest())).resolves.toMatchObject({
      capability: "care",
      status: "unavailable",
      display_blocks: [],
      citations: [],
      evidence_refs: [],
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        fallback_message: "学伴交流暂不可用，你仍可按原任务继续或使用今天的轻量步骤。",
      },
    });
  });

  it("runs a constrained diagnose request without sending the answer key or service secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_diagnose_001",
      display_blocks: [
        { kind: "feedback", content: "你把不同寄存器保存的地址类型混淆了。" },
        { kind: "hint", content: "先判断本次操作是否需要访问主存，再确定应保存哪类地址。" },
      ],
      reference_ids: ["co_k_1"],
      next_actions: [{
        kind: "practice",
        label: "复述 MAR 的职责后完成一道相关练习",
        target: "co_c01_01",
      }],
      failure_reasons: [],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      timeoutMs: 20_000,
      fetchImpl,
      allowUnverifiedSources: true,
    });
    const request = diagnoseRequest();
    request.source_chunk_ids = Array.from({ length: 5 }, (_value, index) => `co_k_${index + 1}`);
    request.context.source_chunks = request.source_chunk_ids.map((sourceChunkId, index) => ({
      source_chunk_id: sourceChunkId,
      chapter: `章节 ${index + 1}`,
      locator: `内部定位 ${index + 1}`,
      content: `${index + 1}`.repeat(5_000),
    }));

    const result = await gateway.run(request);

    expect(result).toMatchObject({
      status: "ready",
      capability: "diagnose",
      model_trace: {
        requested_model: "gpt-5.6-terra",
        provider_model: "gpt-5.6-terra",
        matched: true,
      },
      citations: [{ source_chunk_id: "co_k_1" }],
      next_actions: [{
        kind: "start_practice",
        target: "co_c01_01",
      }],
    });
    expect(result.display_blocks.map((block) => block.kind)).toEqual(["feedback", "hint"]);
    expect(gateway.status("diagnose")).toMatchObject({ state: "available", label: "AI 学伴可用" });
    expect(gateway.status("plan")).toMatchObject({ state: "configured", checked_at: null });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://relay.example.test/v1/responses");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer server-only-key");
    expect(headers.get("Idempotency-Key")).toBe("workflow_openai_diagnose_001");
    const body = String(init?.body);
    expect(body).toContain('"model":"gpt-5.6-terra"');
    const requestBody = JSON.parse(body) as {
      input: string;
      max_output_tokens: number;
      reasoning: { effort: string };
    };
    expect(requestBody).not.toHaveProperty("instructions");
    expect(requestBody.input).toContain("\n\nINPUT_JSON:\n");
    expect(requestBody).toMatchObject({
      max_output_tokens: 500,
      reasoning: { effort: "minimal" },
    });
    const modelContext = JSON.parse(
      requestBody.input.split("\n\nINPUT_JSON:\n")[1] ?? "null",
    ) as {
      allowed_reference_ids: string[];
      source_chunks: Array<{ source_chunk_id: string; content: string }>;
    };
    expect(modelContext.source_chunks).toHaveLength(3);
    expect(modelContext.source_chunks.every((chunk) => chunk.content.length <= 1_800)).toBe(true);
    expect(modelContext.allowed_reference_ids).toEqual(
      modelContext.source_chunks.map((chunk) => chunk.source_chunk_id),
    );
    expect(body).not.toContain("server-only-key");
    expect(body).not.toContain("correct_option_ids");
    expect(body).not.toContain("evaluation_001");
    expect(body).not.toContain("内部定位信息不得发送给模型");
  });

  it("rejects citations and actions that refer to source chunks omitted from the model context", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_diagnose_001",
      display_blocks: [
        { kind: "feedback", content: "请重新核对当前知识点。" },
        { kind: "hint", content: "只依据本次发送的课程片段定位概念。" },
      ],
      reference_ids: ["co_k_4"],
      next_actions: [{ kind: "read", label: "阅读第四段", target: "co_k_4" }],
      failure_reasons: [],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });
    const request = diagnoseRequest();
    request.source_chunk_ids = Array.from({ length: 5 }, (_value, index) => `co_k_${index + 1}`);
    request.context.source_chunks = request.source_chunk_ids.map((sourceChunkId, index) => ({
      source_chunk_id: sourceChunkId,
      chapter: `章节 ${index + 1}`,
      locator: `内部定位 ${index + 1}`,
      content: `仅发送范围测试 ${index + 1}`,
    }));

    await expect(gateway.run(request)).resolves.toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      citations: [],
      next_actions: [],
    });

    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { input: string };
    const modelContext = JSON.parse(
      requestBody.input.split("\n\nINPUT_JSON:\n")[1] ?? "null",
    ) as { allowed_action_targets: string[]; allowed_reference_ids: string[] };
    expect(modelContext.allowed_reference_ids).not.toContain("co_k_4");
    expect(modelContext.allowed_action_targets).not.toContain("co_k_4");
  });

  it("reports a provider-model substitution without trusting it as the requested model", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_plan_001",
      display_blocks: "先复习近期薄弱知识点，再完成一次相关训练。",
      reference_ids: [],
      next_actions: [{ kind: "practice", label: "开始今日训练", target: "course_408_co" }],
      failure_reasons: [],
    }, "relay-substitute-model"));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(planRequest())).resolves.toMatchObject({
      status: "ready",
      model_trace: {
        requested_model: "gpt-5.6-terra",
        provider_model: "relay-substitute-model",
        matched: false,
      },
    });
  });

  it("accepts a source-optional plan and maps it to a constrained next action", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_plan_001",
      display_blocks: "先复习近期薄弱知识点，再完成一次相关训练。",
      reference_ids: [],
      next_actions: [{ kind: "practice", label: "开始今日训练", target: "course_408_co" }],
      failure_reasons: [],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1/",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    const result = await gateway.run(planRequest());

    expect(result).toMatchObject({
      status: "ready",
      capability: "plan",
      display_blocks: [{ kind: "summary", content: "先复习近期薄弱知识点，再完成一次相关训练。" }],
      citations: [],
      evidence_refs: [
        {
          evidence_id: "workflow_task_current",
          label: "当前任务依据",
          summary: "当前确定性任务：复习 Cache 地址映射；原因：存在尚未闭环的错题。",
        },
        {
          evidence_id: "workflow_evidence_summary",
          label: "学习任务依据",
          summary: "证据摘要：4 条课程阅读位置，11 次真实作答，3 个待复习项；证据充分。",
        },
      ],
      next_actions: [{ kind: "start_practice", target: "course_408_co" }],
    });
  });

  it("normalizes a sparse successful plan when the relay omits display blocks", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_plan_001",
      display_blocks: [],
      reference_ids: [],
      next_actions: [{ kind: "practice", label: "开始练习", target: "course_408_co" }],
      failure_reasons: [],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(planRequest())).resolves.toMatchObject({
      status: "ready",
      display_blocks: [{ kind: "summary", content: "开始练习" }],
      next_actions: [{ kind: "start_practice", target: "course_408_co" }],
    });
  });

  it("maps a minimal context failure before requiring optional model fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "failed",
      request_id: "workflow_openai_diagnose_001",
      failure_reasons: ["context_incomplete"],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(diagnoseRequest())).resolves.toMatchObject({
      status: "insufficient_context",
      failure: { code: "CONTEXT_INCOMPLETE" },
      display_blocks: [],
      citations: [],
    });
  });

  it("fails closed when a diagnose response omits either feedback or hint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_diagnose_001",
      display_blocks: [{ kind: "feedback", content: "你混淆了两个寄存器的职责。" }],
      reference_ids: ["co_k_1"],
      next_actions: [{ kind: "practice", label: "继续练习", target: "co_c01_01" }],
      failure_reasons: [],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(diagnoseRequest())).resolves.toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      display_blocks: [],
    });
  });

  it("fails closed when the model leaks an explicit answer or invents a citation", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion({
        status: "success",
        request_id: "workflow_openai_diagnose_001",
        display_blocks: "正确答案是 B。",
        reference_ids: ["co_k_1"],
        next_actions: ["继续练习"],
        failure_reasons: [],
      }))
      .mockResolvedValueOnce(completion({
        status: "success",
        request_id: "workflow_openai_diagnose_001",
        display_blocks: "请回看寄存器职责。",
        reference_ids: ["invented_chunk"],
        next_actions: ["继续练习"],
        failure_reasons: [],
      }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(diagnoseRequest())).resolves.toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      display_blocks: [],
    });
    await expect(gateway.run(diagnoseRequest())).resolves.toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      citations: [],
    });
  });

  it("fails closed when a diagnose response reveals a short correct option text", async () => {
    const shortOptionRequest = diagnoseRequest();
    shortOptionRequest.context.attempt = {
      ...shortOptionRequest.context.attempt!,
      options: [
        { option_id: "A", text: "甲" },
        { option_id: "B", text: "乙" },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "success",
      request_id: "workflow_openai_diagnose_001",
      display_blocks: [
        { kind: "feedback", content: "这里应使用乙。" },
        { kind: "hint", content: "先比较两个选项的定义。" },
      ],
      reference_ids: ["co_k_1"],
      next_actions: ["继续练习"],
      failure_reasons: [],
    }));

    const result = await new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    }).run(shortOptionRequest);

    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED" },
      display_blocks: [],
    });
  });

  it("preserves an honest insufficient-context result from the model", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({
      status: "failed",
      request_id: "workflow_openai_diagnose_001",
      display_blocks: [
        { kind: "feedback", content: "当前课程片段不足以支持可靠错因判断。" },
        { kind: "hint", content: "先回到课程资料补齐相关规则。" },
      ],
      reference_ids: ["co_k_1"],
      next_actions: [{ kind: "read", label: "继续阅读当前知识点", target: "co_c01_01" }],
      failure_reasons: ["context_incomplete"],
    }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(diagnoseRequest())).resolves.toMatchObject({
      status: "insufficient_context",
      failure: {
        code: "CONTEXT_INCOMPLETE",
        retryable: false,
      },
      display_blocks: [],
      citations: [],
    });
  });

  it("degrades structurally when the relay is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream unavailable", { status: 503 }),
    );
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(planRequest())).resolves.toMatchObject({
      status: "unavailable",
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      },
    });
    expect(gateway.status()).toMatchObject({ state: "unavailable" });
  });

  it("opens a bounded relay circuit after consecutive retryable failures", async () => {
    let now = 0;
    const circuitBreaker = new AiUpstreamCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 1_000,
      now: () => now,
    });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(completion({
        status: "success",
        request_id: "workflow_openai_plan_001",
        display_blocks: "服务恢复后生成学习安排。",
        reference_ids: [],
        next_actions: [{ kind: "practice", label: "开始今日训练", target: "course_408_co" }],
        failure_reasons: [],
      }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
      circuitBreaker,
    });

    await expect(gateway.run(planRequest())).resolves.toMatchObject({ status: "unavailable" });
    await expect(gateway.run(planRequest())).resolves.toMatchObject({ status: "unavailable" });
    await expect(gateway.run(planRequest())).resolves.toMatchObject({
      status: "unavailable",
      failure: { code: "UPSTREAM_UNAVAILABLE", retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now = 1_001;
    await expect(gateway.run(planRequest())).resolves.toMatchObject({ status: "ready" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("accepts a fenced JSON response but fails closed for malformed model output", async () => {
    const answer = {
      status: "success",
      request_id: "workflow_openai_plan_001",
      display_blocks: "先复习近期薄弱知识点，再完成一次相关训练。",
      reference_ids: [],
      next_actions: [{ kind: "practice", label: "开始今日训练", target: "course_408_co" }],
      failure_reasons: [],
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "gpt-5.6-terra",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(completion({ not_the_contract: true }));
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(planRequest())).resolves.toMatchObject({ status: "ready" });
    await expect(gateway.run(planRequest())).resolves.toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_FAILED", retryable: false },
    });
  });

  it("returns insufficient_context before calling the model when diagnosis evidence is incomplete", async () => {
    const request = diagnoseRequest();
    request.context.source_chunks = [];
    request.source_chunk_ids = [];
    const fetchImpl = vi.fn<typeof fetch>();
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(request)).resolves.toMatchObject({
      status: "insufficient_context",
      failure: { code: "CONTEXT_INCOMPLETE", retryable: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not send local-demo textbook chunks to the relay by default", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      fetchImpl,
    });
    const result = await gateway.run(diagnoseRequest());

    expect(result).toMatchObject({
      status: "insufficient_context",
      failure: { code: "CONTEXT_INCOMPLETE" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gateway.status("diagnose")).toMatchObject({
      state: "configured",
      checked_at: null,
    });
  });

  it("maps relay timeouts without throwing into the student route", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1",
      apiKey: "server-only-key",
      model: "gpt-5.6-terra",
      timeoutMs: 5,
      fetchImpl,
      allowUnverifiedSources: true,
    });

    await expect(gateway.run(planRequest())).resolves.toMatchObject({
      status: "failed",
      failure: { code: "WORKFLOW_TIMEOUT", retryable: true },
    });
  });

  it("keeps timeouts retryable when headers arrive before a stalled response body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) =>
      new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const gateway = new OpenAiCompatibleAiWorkflowGateway({
      baseUrl: "https://relay.example.test/v1", apiKey: "test-key", model: "gpt-5.6-terra",
      timeoutMs: 5, fetchImpl, allowUnverifiedSources: true,
    });
    await expect(gateway.run(planRequest())).resolves.toMatchObject({
      status: "failed", failure: { code: "WORKFLOW_TIMEOUT", retryable: true },
    });
  });
});
