import { describe, expect, it, vi } from "vitest";

import type {
  ExternalQuestionConceptCandidate,
  ExternalQuestionConfirmation,
  ExternalQuestionExplanation,
  ExternalQuestionRecognition,
} from "@xuetu/contracts";

import { AiUpstreamCircuitBreaker } from "../src/services/ai-upstream-circuit-breaker.js";
import {
  ExternalQuestionAiError,
  UnavailableExternalQuestionAiGateway,
} from "../src/services/external-questions/external-question.js";
import { OpenAiCompatibleExternalQuestionGateway } from "../src/services/external-questions/openai-compatible-external-question-gateway.js";

const recognition: ExternalQuestionRecognition = {
  status: "recognized",
  subject: "data_structures",
  question_type: "choice",
  question_text: "设 T(n)=2T(n/2)+n，其渐进复杂度是？",
  options: [
    { label: "A", text: "O(n)" },
    { label: "B", text: "O(n log n)" },
  ],
  formulae: ["T(n) = 2T(n/2) + n"],
  diagram_description: null,
  knowledge_keywords: ["递归式", "主定理"],
  warnings: [],
};
const confirmation: ExternalQuestionConfirmation = {
  subject: "data_structures",
  question_type: "choice",
  question_text: recognition.question_text,
  options: recognition.options,
  formulae: recognition.formulae,
  diagram_description: null,
};
const concepts: ExternalQuestionConceptCandidate[] = [{
  concept_id: "ds_recurrence",
  course_id: "course_408_ds",
  course_slug: "data-structures",
  title: "递归算法复杂度",
  reason: "题目关键词命中课程术语“递归式”。",
  reading_href: "/student/courses/data-structures?concept_id=ds_recurrence",
  practice_href: "/student/practice?subject=%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&concept_id=ds_recurrence",
}];

function completion(value: unknown, model = "gpt-5.6-terra") {
  return new Response(JSON.stringify({
    model,
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function direction(overrides: Partial<ExternalQuestionExplanation> = {}): ExternalQuestionExplanation {
  return {
    depth: "direction",
    summary: "先对照主定理的标准形式识别三个参数。",
    knowledge_points: [{
      concept_id: "ds_recurrence",
      title: "递归算法复杂度",
      reason: "该递归式可直接映射到主定理。",
    }],
    approach: ["先比较 n^(log_b a) 与 f(n) 的增长阶。"],
    steps: [],
    self_check: "你能写出 a、b 和 f(n) 吗？",
    final_answer: null,
    uncertainty: null,
    ...overrides,
  };
}

function gateway(fetchImpl: typeof fetch, options: {
  timeoutMs?: number;
  circuitBreaker?: AiUpstreamCircuitBreaker;
} = {}) {
  return new OpenAiCompatibleExternalQuestionGateway({
    baseUrl: "https://relay.example.test/v1",
    apiKey: "server-only-photo-key",
    model: "gpt-5.6-terra",
    fetchImpl,
    ...options,
  });
}

describe("OpenAI-compatible external-question recognition", () => {
  it.each([false, true])("preserves a single image and validates model identity over chat (mismatch=%s)", async (mismatch) => {
    const model = "ZHIPU/GLM-5.3-Flash";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: mismatch ? "another-model" : model,
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(recognition), reasoning_content: "private reasoning" } }],
    }), { headers: { "Content-Type": "application/json" } }));
    const instance = new OpenAiCompatibleExternalQuestionGateway({
      baseUrl: "https://provider.example.test/v1", apiKey: "fixture-key", model,
      apiFormat: "chat_completions", reasoningEffort: "low", maxOutputTokens: 4096, fetchImpl,
    });
    const result = instance.recognize({ requestId: "chat-recognize", imageBytes: Buffer.from("fixture-image") });
    if (mismatch) await expect(result).rejects.toMatchObject({ code: "RECOGNITION_INVALID_RESPONSE" });
    else expect((await result).recognition).toEqual(recognition);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toMatch(/\/chat\/completions$/u);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ reasoning_effort: "low", max_tokens: 4096, stream: false });
    const parts = body.messages.flatMap((message: { content: unknown[] }) => message.content);
    expect(parts.filter((part: { type: string }) => part.type === "image_url")).toEqual([
      { type: "image_url", image_url: { url: `data:image/webp;base64,${Buffer.from("fixture-image").toString("base64")}`, detail: "high" } },
    ]);
    expect(parts.filter((part: { type: string }) => part.type === "text")).toHaveLength(1);
    expect(body).not.toHaveProperty("input");
  });

  it("sends exactly one private image and extraction instruction without learner data", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion(recognition));
    const result = await gateway(fetchImpl).recognize({
      requestId: "recognize-001",
      imageBytes: Buffer.from("sanitized-webp-image"),
    });

    expect(result).toEqual({
      recognition,
      modelTrace: {
        requested_model: "gpt-5.6-terra",
        provider_model: "gpt-5.6-terra",
        matched: true,
        latency_ms: expect.any(Number),
      },
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://relay.example.test/v1/responses");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer server-only-photo-key");
    expect(headers.get("Idempotency-Key")).toBe("recognize-001");

    const bodyText = String(init?.body);
    expect(bodyText).not.toContain("server-only-photo-key");
    expect(bodyText).not.toContain("student_private_001");
    expect(bodyText).not.toContain("external-question-storage");
    expect(bodyText).not.toContain("answer_key");
    expect(bodyText).not.toContain("learning_evidence");
    const body = JSON.parse(bodyText) as {
      model: string;
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>;
      max_output_tokens: number;
      reasoning: { effort: string };
    };
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      max_output_tokens: 1_200,
      reasoning: { effort: "minimal" },
    });
    const parts = body.input.flatMap((item) => item.content);
    expect(parts.filter((part) => part.type === "input_image")).toHaveLength(1);
    expect(parts.filter((part) => part.type === "input_text")).toHaveLength(1);
    expect(parts.find((part) => part.type === "input_image")?.image_url)
      .toMatch(/^data:image\/webp;base64,/u);
    expect(parts.find((part) => part.type === "input_text")?.text)
      .toMatch(/不可信|只提取|不得求解/u);
  });

  it("normalizes a blank optional diagram description to null", async () => {
    const result = await gateway(vi.fn<typeof fetch>().mockResolvedValue(completion({
      ...recognition,
      diagram_description: "   ",
    }))).recognize({
      requestId: "recognize-blank-diagram",
      imageBytes: Buffer.from("image"),
    });

    expect(result.recognition).toEqual({
      ...recognition,
      diagram_description: null,
    });
  });

  it.each([
    ["needs_better_image", {
      ...recognition,
      status: "needs_better_image",
      subject: "unknown",
      question_type: "unknown",
      question_text: "",
      options: [],
      formulae: [],
      knowledge_keywords: [],
      warnings: ["图片模糊，请重新上传清晰截图。"],
    }],
    ["unsupported", {
      ...recognition,
      status: "unsupported",
      subject: "unknown",
      question_type: "unknown",
      question_text: "",
      options: [],
      formulae: [],
      knowledge_keywords: [],
      warnings: ["图片中没有可识别的单道 408 题目。"],
    }],
  ] as const)("accepts the bounded %s recognition state", async (_status, payload) => {
    const result = await gateway(vi.fn<typeof fetch>().mockResolvedValue(completion(payload)))
      .recognize({ requestId: `recognize-${_status}`, imageBytes: Buffer.from("image") });
    expect(result.recognition).toEqual(payload);
  });

  it.each([
    ["malformed JSON", "not-json", "RECOGNITION_INVALID_RESPONSE"],
    ["illegal answer field", { ...recognition, correct_option: "B" }, "RECOGNITION_INVALID_RESPONSE"],
    ["provider model mismatch", recognition, "RECOGNITION_INVALID_RESPONSE", "gpt-5.6-sol"],
  ])("fails closed for %s", async (_name, payload, code, providerModel = "gpt-5.6-terra") => {
    await expect(gateway(vi.fn<typeof fetch>().mockResolvedValue(completion(payload, providerModel)))
      .recognize({ requestId: "recognize-invalid", imageBytes: Buffer.from("image") }))
      .rejects.toMatchObject({ code });
  });

  it("maps image rejection, upstream pressure, timeout and an open circuit", async () => {
    await expect(gateway(vi.fn<typeof fetch>().mockResolvedValue(new Response("unsupported", { status: 415 })))
      .recognize({ requestId: "recognize-415", imageBytes: Buffer.from("image") }))
      .rejects.toMatchObject({ code: "IMAGE_INPUT_UNAVAILABLE", retryable: false });

    for (const status of [429, 503]) {
      await expect(gateway(vi.fn<typeof fetch>().mockResolvedValue(new Response("busy", { status })))
        .recognize({ requestId: `recognize-${status}`, imageBytes: Buffer.from("image") }))
        .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    }

    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    ));
    await expect(gateway(timeoutFetch, { timeoutMs: 5 })
      .recognize({ requestId: "recognize-timeout", imageBytes: Buffer.from("image") }))
      .rejects.toMatchObject({ code: "WORKFLOW_TIMEOUT", retryable: true });

    const breaker = new AiUpstreamCircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000 });
    breaker.recordFailure();
    const neverCalled = vi.fn<typeof fetch>();
    await expect(gateway(neverCalled, { circuitBreaker: breaker })
      .recognize({ requestId: "recognize-circuit", imageBytes: Buffer.from("image") }))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation to the upstream request", async () => {
    const caller = new AbortController();
    let upstreamSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      upstreamSignal = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        caller.signal.addEventListener("abort", () => {
          if (upstreamSignal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
          } else {
            resolve(completion(recognition));
          }
        }, { once: true });
      });
    });

    const pending = gateway(fetchImpl, { timeoutMs: 5_000 }).recognize({
      requestId: "recognize-caller-abort",
      imageBytes: Buffer.from("image"),
      signal: caller.signal,
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    caller.abort();

    await expect(pending).rejects.toMatchObject({
      name: "ExternalQuestionRequestAbortedError",
    });
    expect(upstreamSignal?.aborted).toBe(true);
  });
});

describe("OpenAI-compatible external-question tutoring", () => {
  it("sends confirmed text and an allowed-concept whitelist without image or learner state", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion(direction()));
    const result = await gateway(fetchImpl).explain({
      requestId: "explain-direction-001",
      confirmation,
      conceptCandidates: concepts,
      depth: "direction",
    });

    expect(result.explanation).toEqual(direction());
    const bodyText = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(bodyText).not.toContain("data:image");
    expect(bodyText).not.toContain("base64");
    expect(bodyText).not.toContain("student_private_001");
    expect(bodyText).not.toContain("learning_evidence");
    expect(bodyText).toContain("ds_recurrence");
    expect(bodyText).toContain(confirmation.question_text);
    expect(bodyText).toMatch(/只给方向|不得给出最终答案/u);
  });

  it("normalizes relay-safe scalar and blank explanation fields", async () => {
    const result = await gateway(vi.fn<typeof fetch>().mockResolvedValue(completion({
      ...direction(),
      knowledge_points: [{
        concept_id: "ds_recurrence",
        title: "递归算法复杂度",
      }],
      approach: "先比较 n^(log_b a) 与 f(n) 的增长阶。",
      final_answer: "",
      uncertainty: "   ",
    }))).explain({
      requestId: "explain-normalized-relay-shape",
      confirmation,
      conceptCandidates: concepts,
      depth: "direction",
    });

    expect(result.explanation).toEqual(direction({
      knowledge_points: [{
        concept_id: "ds_recurrence",
        title: "递归算法复杂度",
        reason: concepts[0]!.reason,
      }],
      uncertainty: null,
    }));
  });

  it.each(["direction", "steps"] as const)(
    "discards a leaked final answer at %s depth",
    async (depth) => {
      const result = await gateway(vi.fn<typeof fetch>().mockResolvedValue(completion(direction({
        depth,
        final_answer: "B",
      }))))
        .explain({
          requestId: `explain-${depth}`,
          confirmation,
          conceptCandidates: concepts,
          depth,
        });

      expect(result.explanation.final_answer).toBeNull();
      expect(JSON.stringify(result.explanation)).not.toContain("B");
    },
  );

  it("rejects an unknown concept ID and accepts a bounded complete explanation", async () => {
    await expect(gateway(vi.fn<typeof fetch>().mockResolvedValue(completion(direction({
      knowledge_points: [{
        concept_id: "concept_not_allowed",
        title: "越界知识点",
        reason: "模型自行添加。",
      }],
    }))))
      .explain({
        requestId: "explain-unknown-concept",
        confirmation,
        conceptCandidates: concepts,
        depth: "direction",
      }))
      .rejects.toMatchObject({ code: "EXPLANATION_INVALID_RESPONSE" });

    const complete = direction({
      depth: "complete",
      steps: ["代入 a=2、b=2。", "比较 f(n)=n 与 n^(log_2 2)。"],
      final_answer: "根据主定理可得 O(n log n)。",
      uncertainty: "该结论基于题干中的递归式没有遗漏附加条件。",
    });
    await expect(gateway(vi.fn<typeof fetch>().mockResolvedValue(completion(complete)))
      .explain({
        requestId: "explain-complete",
        confirmation,
        conceptCandidates: concepts,
        depth: "complete",
      })).resolves.toMatchObject({ explanation: complete });
  });

  it("fails when the model returns a different depth or reports another model", async () => {
    await expect(gateway(vi.fn<typeof fetch>().mockResolvedValue(completion(direction({ depth: "steps" }))))
      .explain({
        requestId: "explain-wrong-depth",
        confirmation,
        conceptCandidates: concepts,
        depth: "direction",
      })).rejects.toMatchObject({ code: "EXPLANATION_INVALID_RESPONSE" });

    await expect(gateway(vi.fn<typeof fetch>().mockResolvedValue(completion(direction(), "gpt-5.6-sol")))
      .explain({
        requestId: "explain-wrong-model",
        confirmation,
        conceptCandidates: concepts,
        depth: "direction",
      })).rejects.toMatchObject({ code: "EXPLANATION_INVALID_RESPONSE" });
    });
  });

  it("normalizes bounded relay arrays while keeping knowledge points on the whitelist", async () => {
    const result = await gateway(vi.fn<typeof fetch>().mockResolvedValue(completion({
      depth: "direction",
      summary: "先识别递归式的标准形式，再比较各项增长阶。",
      knowledge_points: ["递归算法复杂度", "模型自行添加的概念"],
      approach: "先比较 n^(log_b a) 与 f(n) 的增长阶。",
      steps: [],
      self_check: ["你能写出 a、b 和 f(n) 吗？", "再说出主定理的适用条件。"],
      final_answer: "",
      uncertainty: "",
    }))).explain({
      requestId: "explain-array-relay-shape",
      confirmation,
      conceptCandidates: concepts,
      depth: "direction",
    });

    expect(result.explanation).toEqual(direction({
      summary: "先识别递归式的标准形式，再比较各项增长阶。",
      knowledge_points: [{
        concept_id: "ds_recurrence",
        title: "递归算法复杂度",
        reason: concepts[0]!.reason,
      }],
      self_check: "你能写出 a、b 和 f(n) 吗？\n再说出主定理的适用条件。",
    }));
  });

  it("normalizes an empty complete-explanation uncertainty array to null", async () => {
    const result = await gateway(vi.fn<typeof fetch>().mockResolvedValue(completion({
      ...direction({
        depth: "complete",
        steps: ["数组共有 8 个存储单元。", "牺牲一个单元后可用容量为 7。"],
        final_answer: "B，7 个。",
      }),
      uncertainty: [],
    }))).explain({
      requestId: "explain-complete-empty-uncertainty-array",
      confirmation,
      conceptCandidates: concepts,
      depth: "complete",
    });

    expect(result.explanation.uncertainty).toBeNull();
  });

it("exposes bounded AI errors", () => {
  expect(new ExternalQuestionAiError(
    "UPSTREAM_UNAVAILABLE",
    503,
    true,
    "AI 讲题服务暂不可用。",
  )).toMatchObject({
    name: "ExternalQuestionAiError",
    code: "UPSTREAM_UNAVAILABLE",
    statusCode: 503,
    retryable: true,
  });
});

it("fails explicitly when no server-side relay is configured", async () => {
  const unavailable = new UnavailableExternalQuestionAiGateway();
  await expect(unavailable.recognize({
    requestId: "recognize-unavailable",
    imageBytes: Buffer.from("image"),
  })).rejects.toMatchObject({
    code: "UPSTREAM_UNAVAILABLE",
    statusCode: 503,
    retryable: false,
  });
  await expect(unavailable.explain({
    requestId: "explain-unavailable",
    confirmation,
    conceptCandidates: concepts,
    depth: "direction",
  })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
});
