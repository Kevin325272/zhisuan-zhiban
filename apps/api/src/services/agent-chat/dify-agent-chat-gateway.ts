import {
  AgentChatError,
  type AgentChatContext,
  type AgentChatGateway,
  type AgentChatGatewayOptions,
} from "./agent-chat-gateway.js";

interface DifyAgentChatGatewayConfig {
  endpoint: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// 计算机考研智能体工作流的能力分支（与 AiWorkflowCapability 同源）。
// 实测结论：学习问答走概念讲解（explain）；实验排障走 plan——explain/coach
// 分支对 ARP 排障问题会触发上游幻觉门禁；教师教研走案例分步提示（coach），
// 产出带片段引用的分步讲评设计。
const capabilityByContext: Record<AgentChatContext, string> = {
  study: "explain",
  lab: "plan",
  teacher: "coach",
};

// 浮窗 Agent 携带的授权教材演示切片。本机演示库无课程正文数据，无法按题检索，
// 因此内置少量覆盖 408 计网常见考点的摘录；上游工作流只依据这些片段作答，
// 片段未覆盖的问题会被上游幻觉门禁拦下（此时浮窗退回本地演示回复）。
const COURSE_SNIPPET_BANK = [
  "[片段ID: cn_k0001] 第1章 概述：计算机网络由节点和链路组成，路由器把多个网络互连成互连网。网络层（IP）负责主机到主机之间的分组交付，按目的 IP 地址逐跳转发。传输层负责端到端进程间通信，TCP 提供可靠字节流，报文段最终封装进 IP 分组在网络中传输。",
  "[片段ID: cn_k0202] 第2章 传输层：TCP 通过超时重传与确认机制提供可靠传输，发送方为每个报文段设置重传计时器，超时未收到确认即重传该报文段。",
  "[片段ID: cn_k0302] 第3章 网络层：ARP 协议在同一链路内把目的 IP 地址解析为 MAC 地址，仅在本局域网广播，跨网段通信必须经过默认网关转发。默认网关配置错误或不可达时，主机发出的 ARP 请求无法得到响应，数据报无法离开本网段。",
  "[片段ID: cn_k0401] 第4章 应用层：HTTP 基于 TCP 的请求-响应协议，请求报文含方法、URL、首部行；响应报文含状态码与实体。常见状态码：200 成功、404 未找到、500 服务器错误。",
].join("\n");

interface SseFrame {
  event: string;
  data: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await response.json() as unknown;
    return asRecord(body);
  } catch {
    return null;
  }
}

async function* readSseFrames(response: Response): AsyncGenerator<SseFrame> {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const body = await response.text();
    yield* body.replaceAll("\r\n", "\n").split("\n\n").filter(Boolean)
      .map(frameToSse)
      .filter((frame): frame is SseFrame => frame !== null);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    // 上游 SSE 可能使用 \r\n 行分隔，统一归一化后再按空行切帧。
    buffer += decoder
      .decode(value ?? new Uint8Array(), { stream: !done })
      .replaceAll("\r\n", "\n");
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const frame = frameToSse(raw);
      if (frame) yield frame;
      separator = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
}

function frameToSse(raw: string): SseFrame | null {
  const lines = raw.split("\n");
  const explicitType = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const dataLine = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (dataLine === undefined) return null;
  let data: unknown;
  try {
    data = JSON.parse(dataLine) as unknown;
  } catch {
    return null;
  }
  // Dify 将事件名嵌在 data JSON 的 event 字段里，且会先发一个无数据的 ping 帧。
  const embedded = asRecord(data)?.event;
  const event = explicitType === "ping"
    ? null
    : explicitType ?? (typeof embedded === "string" ? embedded : "message");
  if (!event) return null;
  return { event, data };
}

function workflowOutputs(data: unknown) {
  const record = asRecord(data);
  const inner = asRecord(record?.data) ?? record;
  return asRecord(inner?.outputs) ?? null;
}

function upstreamErrorText(data: unknown): string | null {
  const record = asRecord(data);
  const message = record?.message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function normalizeAnswer(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function statusOf(answer: unknown): string | null {
  const record = asRecord(answer);
  const status = record?.status;
  return typeof status === "string" ? status : null;
}

function failureReasons(answer: unknown): string[] {
  const record = asRecord(answer);
  const reasons = record?.failure_reasons;
  return Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
}

/**
 * 从工作流 answer 输出中提取回复正文。
 * answer 可能是纯文本、JSON 字符串或嵌套对象（display_blocks / answer / content 等）。
 */
function extractReplyText(answer: unknown): string {
  if (typeof answer === "string") {
    try {
      return extractReplyText(JSON.parse(answer) as unknown);
    } catch {
      return answer.trim();
    }
  }
  if (Array.isArray(answer)) {
    // 计划类分支的 answer 可能是 JSON 字符串化的 display_blocks 数组。
    return answer
      .map((block) => typeof block === "string" ? block : asRecord(block)?.content)
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  const record = asRecord(answer);
  if (!record) return "";
  const blocks = record.display_blocks;
  if (Array.isArray(blocks)) {
    const parts = blocks
      .map((block) => typeof block === "string" ? block : asRecord(block)?.content)
      .filter((part): part is string => typeof part === "string");
    const text = parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
    if (text) return text;
  }
  if (typeof blocks === "string" && blocks.trim()) return blocks.trim();
  for (const key of ["answer", "content", "reply", "response", "summary"]) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const nested = JSON.parse(value) as unknown;
      if (nested !== null && typeof nested === "object") {
        return extractReplyText(nested);
      }
    } catch {
      // 非 JSON 字符串按原文返回。
    }
    return value.trim();
  }
  return "";
}

/**
 * 上游工作流把校验门禁 LLM 的原始文本（推理块 + 内嵌 JSON）直接塞进
 * display_blocks.content。这里剥离推理块并解析内嵌 JSON：
 * 门禁判定 failed 时给出拒绝原因，否则取内嵌的 answer 正文。
 */
function resolveBlockText(content: string): { text: string; rejected: string | null } {
  const thinkEnd = content.indexOf("</think>");
  if (content.startsWith("<think>")) {
    if (thinkEnd < 0) return { text: "", rejected: "智能体未生成有效回复。" };
    content = content.slice(thinkEnd + "</think>".length).trim();
  } else if (thinkEnd >= 0) {
    content = content.slice(thinkEnd + "</think>".length).trim();
  }
  if (!content) return { text: "", rejected: null };
  if (content.startsWith("{") || content.startsWith("[")) {
    try {
      const inner = JSON.parse(content) as unknown;
      const record = asRecord(inner);
      if (record && statusOf(record) === "failed") {
        const uncertainties = record.uncertainties;
        const extra = Array.isArray(uncertainties)
          ? uncertainties.filter((value): value is string => typeof value === "string")
          : [];
        return {
          text: "",
          rejected: failureReasons(record).concat(extra).join("；")
            || "智能体未生成有效回复。",
        };
      }
      return { text: extractReplyText(inner), rejected: null };
    } catch {
      // 推理残留不是 JSON，按原文返回。
    }
  }
  return { text: content, rejected: null };
}

/**
 * 提取最终回复正文：display_blocks 逐块经过推理块剥离与门禁判定，
 * 其余形态退回通用提取逻辑。
 */
function extractAnswerText(answer: unknown): { text: string; rejected: string | null } {
  const record = asRecord(answer);
  if (record) {
    const blocks = record.display_blocks;
    if (Array.isArray(blocks)) {
      let text = "";
      for (const block of blocks) {
        const content = typeof block === "string" ? block : asRecord(block)?.content;
        if (typeof content !== "string" || !content.trim()) continue;
        const resolved = resolveBlockText(content);
        if (resolved.rejected) return resolved;
        if (resolved.text) text += (text ? "\n\n" : "") + resolved.text;
      }
      if (text) return { text, rejected: null };
    }
    if (typeof blocks === "string" && blocks.trim()) {
      return resolveBlockText(blocks);
    }
  }
  return { text: extractReplyText(answer), rejected: null };
}

export class DifyAgentChatGateway implements AgentChatGateway {
  readonly #endpoint: string;
  readonly #secret: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(config: DifyAgentChatGatewayConfig) {
    this.#endpoint = config.endpoint.replace(/\/$/u, "");
    this.#secret = config.secret;
    this.#timeoutMs = config.timeoutMs ?? 60_000;
    this.#fetch = config.fetchImpl ?? fetch;
  }

  async streamReply(
    options: AgentChatGatewayOptions,
    onDelta: (chunk: string) => void,
  ): Promise<string> {
    const controller = new AbortController();
    options.signal?.addEventListener("abort", () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.#secret}`,
          "Content-Type": "application/json",
          "Idempotency-Key": options.requestId,
          "X-Xuetu-Contract-Version": "0.2",
        },
        body: JSON.stringify({
          inputs: {
            user_text: options.message,
            capability: capabilityByContext[options.context],
            textbook_snippets: COURSE_SNIPPET_BANK,
          },
          response_mode: "streaming",
          user: options.userId,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await readJsonSafe(response);
        const retryable = response.status === 429 || response.status >= 500;
        throw new AgentChatError(
          retryable ? "UPSTREAM_UNAVAILABLE" : "UPSTREAM_REJECTED",
          body?.message && typeof body.message === "string"
            ? body.message
            : `智能体服务拒绝了请求（HTTP ${response.status}）。`,
          retryable,
        );
      }
      let answer: unknown = null;
      let upstreamError: string | null = null;
      for await (const frame of readSseFrames(response)) {
        if (frame.event === "error") {
          upstreamError = upstreamErrorText(frame.data);
          break;
        }
        if (frame.event !== "workflow_finished") continue;
        const run = asRecord(frame.data);
        const runData = asRecord(run?.data);
        if (runData?.status === "failed") {
          upstreamError = typeof runData.error === "string" && runData.error.trim()
            ? runData.error.trim()
            : "智能体工作流执行失败。";
          break;
        }
        answer = workflowOutputs(frame.data)?.answer ?? workflowOutputs(frame.data);
        break;
      }
      if (upstreamError) {
        throw new AgentChatError("UPSTREAM_REJECTED", upstreamError, false);
      }
      if (answer === null) {
        throw new AgentChatError(
          "UPSTREAM_STREAM_INTERRUPTED",
          "智能体服务未返回完整结果。",
          true,
        );
      }
      // answer 可能是 JSON 字符串，先归一化为对象再校验状态与正文。
      const normalized = typeof answer === "string"
        ? normalizeAnswer(answer)
        : answer;
      if (statusOf(normalized) === "failed") {
        const reasons = failureReasons(normalized);
        throw new AgentChatError(
          "UPSTREAM_REJECTED",
          reasons.join("；") || "智能体未生成有效回复。",
          false,
        );
      }
      const { text, rejected } = extractAnswerText(normalized);
      if (rejected) {
        throw new AgentChatError("UPSTREAM_REJECTED", rejected, false);
      }
      if (!text) {
        throw new AgentChatError(
          "AGENT_ANSWER_INVALID",
          "智能体未生成可展示的回复。",
          false,
        );
      }
      onDelta(text);
      return text;
    } catch (error) {
      if (error instanceof AgentChatError) throw error;
      if (
        controller.signal.aborted
        || (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw new AgentChatError("UPSTREAM_TIMEOUT", "智能体服务响应超时。", true);
      }
      throw new AgentChatError("UPSTREAM_UNAVAILABLE", "无法连接智能体服务。", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
