import { z } from "zod";

const responsesEnvelopeSchema = z
  .object({
    model: z.string().trim().min(1).max(200).optional(),
    output_text: z.string().optional(),
    output: z.array(z.object({
      content: z.array(z.object({
        text: z.string().optional(),
      }).passthrough()).optional(),
    }).passthrough()).optional(),
  })
  .passthrough();

const chatEnvelopeSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable(),
    message: z.object({
      content: z.string().nullable(),
      refusal: z.string().nullable().optional(),
      tool_calls: z.array(z.unknown()).optional(),
    }).passthrough(),
  })),
});

export function parseOpenAiResponse(raw: unknown) {
  if (raw !== null && typeof raw === "object" && "choices" in raw) {
    const parsed = chatEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return null;
    const choice = parsed.data.choices[0];
    const completed = choice?.finish_reason === "stop"
      && !choice.message.refusal
      && !choice.message.tool_calls?.length;
    return {
      text: completed ? choice.message.content?.trim() || null : null,
      providerModel: parsed.data.model ?? null,
    };
  }
  const parsed = responsesEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const topLevel = parsed.data.output_text?.trim();
  const text = topLevel || (parsed.data.output ?? [])
      .flatMap((item) => item.content ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim()
    || null;
  return {
    text,
    providerModel: parsed.data.model ?? null,
  };
}

export function extractOpenAiResponseText(raw: unknown) {
  return parseOpenAiResponse(raw)?.text ?? null;
}
