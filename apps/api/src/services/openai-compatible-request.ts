import { z } from "zod";

import type { LlmRequestOptions } from "../config/llm.js";

const inputSchema = z.union([
  z.string().min(1),
  z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("input_text"), text: z.string() }),
      z.object({
        type: z.literal("input_image"),
        image_url: z.string().min(1),
        detail: z.enum(["auto", "low", "high"]).optional(),
      }),
    ])).min(1),
  })).min(1),
]);

function chatMessages(input: unknown) {
  const parsed = inputSchema.parse(input);
  if (typeof parsed === "string") return [{ role: "user", content: parsed }];
  return parsed.map((message) => ({
    role: message.role,
    content: message.content.map((part) => part.type === "input_text"
      ? { type: "text", text: part.text }
      : {
          type: "image_url",
          image_url: { url: part.image_url, ...(part.detail ? { detail: part.detail } : {}) },
        }),
  }));
}

/** Adapt only this provider's structured requests; keep the real response and abort signal. */
export function createStructuredModelFetch(
  options: LlmRequestOptions & { baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  if (!options.apiFormat && !options.reasoningEffort && !options.maxOutputTokens) return fetchImpl;
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  return async (url, init) => {
    if (String(url) !== `${baseUrl}/responses` || init?.method !== "POST") {
      return fetchImpl(url, init);
    }
    if (typeof init.body !== "string") throw new TypeError("Structured model request body must be JSON text.");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (body.stream !== false) throw new TypeError("Structured model requests must be non-streaming.");
    const maxOutputTokens = options.maxOutputTokens ?? body.max_output_tokens;
    if (options.apiFormat === "chat_completions") {
      return fetchImpl(`${baseUrl}/chat/completions`, {
        ...init,
        body: JSON.stringify({
          model: body.model,
          messages: chatMessages(body.input),
          stream: false,
          ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
          ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
        }),
      });
    }
    return fetchImpl(url, {
      ...init,
      body: JSON.stringify({
        ...body,
        ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
        ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      }),
    });
  };
}
