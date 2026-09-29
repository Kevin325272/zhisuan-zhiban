import { describe, expect, it, vi } from "vitest";

import { createStructuredModelFetch } from "../src/services/openai-compatible-request.js";
import { parseOpenAiResponse } from "../src/services/openai-compatible-response.js";

const baseUrl = "https://provider.example.test/v1";
const model = "ZHIPU/GLM-5.3-Flash";

describe("structured provider protocol adapter", () => {
  it("leaves unconfigured fetches and unrelated URLs untouched", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    expect(createStructuredModelFetch({ baseUrl }, upstream)).toBe(upstream);
    const adapter = createStructuredModelFetch({ baseUrl, apiFormat: "chat_completions" }, upstream);
    const init = { method: "GET" };
    await adapter(`${baseUrl}/models`, init);
    expect(upstream).toHaveBeenCalledWith(`${baseUrl}/models`, init);
  });

  it("preserves authentication, cancellation, response identity and output budget", async () => {
    const response = new Response("provider error", { status: 429 });
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(response);
    const controller = new AbortController();
    const headers = { Authorization: "Bearer fixture-key", "Idempotency-Key": "fixture-request" };
    const adapter = createStructuredModelFetch({ baseUrl: `${baseUrl}/`, apiFormat: "chat_completions", reasoningEffort: "low", maxOutputTokens: 4096 }, upstream);
    const result = await adapter(`${baseUrl}/responses`, {
      method: "POST", headers, signal: controller.signal,
      body: JSON.stringify({ model, input: "private prompt", stream: false, max_output_tokens: 300, reasoning: { effort: "minimal" } }),
    });
    expect(result).toBe(response);
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe(`${baseUrl}/chat/completions`);
    expect(init?.signal).toBe(controller.signal);
    expect(init?.headers).toBe(headers);
    expect(JSON.parse(String(init?.body))).toEqual({ model, messages: [{ role: "user", content: "private prompt" }], stream: false, reasoning_effort: "low", max_tokens: 4096 });
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
  });

  it("retains the gateway budget when no explicit override is set", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    await createStructuredModelFetch({ baseUrl, apiFormat: "chat_completions" }, upstream)(`${baseUrl}/responses`, {
      method: "POST", body: JSON.stringify({ model, input: "prompt", stream: false, max_output_tokens: 1200 }),
    });
    const body = JSON.parse(String(upstream.mock.calls[0]?.[1]?.body));
    expect(body.max_tokens).toBe(1200);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("supports explicit Responses tuning without changing the input format", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    await createStructuredModelFetch({ baseUrl, apiFormat: "responses", reasoningEffort: "low", maxOutputTokens: 4096 }, upstream)(`${baseUrl}/responses`, {
      method: "POST", body: JSON.stringify({ model, input: "prompt", stream: false, max_output_tokens: 300, reasoning: { effort: "minimal" } }),
    });
    expect(upstream.mock.calls[0]?.[0]).toBe(`${baseUrl}/responses`);
    expect(JSON.parse(String(upstream.mock.calls[0]?.[1]?.body))).toEqual({ model, input: "prompt", stream: false, max_output_tokens: 4096, reasoning: { effort: "low" } });
  });

  it.each([undefined, [], [{ role: "user", content: [{ type: "unknown", text: "x" }] }]])("rejects unsupported input instead of silently omitting it: %j", async (input) => {
    const upstream = vi.fn<typeof fetch>();
    const adapter = createStructuredModelFetch({ baseUrl, apiFormat: "chat_completions" }, upstream);
    await expect(adapter(`${baseUrl}/responses`, { method: "POST", body: JSON.stringify({ model, input, stream: false }) })).rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("structured response final content", () => {
  it("accepts final visible text without exposing reasoning", () => {
    expect(parseOpenAiResponse({ model, choices: [{ finish_reason: "stop", message: { content: "  {\"status\":\"ready\"}  ", reasoning_content: "private reasoning" } }] })).toEqual({ providerModel: model, text: '{"status":"ready"}' });
  });

  it.each([
    { finish_reason: "length", message: { content: '{"valid":"but truncated"}' } },
    { finish_reason: "content_filter", message: { content: "filtered" } },
    { finish_reason: null, message: { content: "in progress" } },
    { finish_reason: "stop", message: { content: "text", refusal: "refused" } },
    { finish_reason: "stop", message: { content: "text", tool_calls: [{ id: "unexecuted" }] } },
    { finish_reason: "stop", message: { content: null, reasoning_content: "reasoning only" } },
  ])("rejects incomplete, refused or non-final content: %j", (choice) => {
    expect(parseOpenAiResponse({ model, choices: [choice] })?.text).toBeNull();
  });

  it("rejects malformed chat envelopes even if they contain output_text", () => {
    expect(parseOpenAiResponse({ model, choices: "bad", output_text: "must not be accepted" })).toBeNull();
    expect(parseOpenAiResponse({ model, choices: [] })?.text).toBeNull();
  });

  it("retains Responses compatibility and model identity", () => {
    expect(parseOpenAiResponse({ model, output: [{ content: [{ type: "output_text", text: "answer" }] }] })).toEqual({ providerModel: model, text: "answer" });
  });
});
