import { streamAgentChat } from "../../api/client";
import type { AgentContext } from "./agent-quick-prompts";
import { streamMockReply, type StreamSignal } from "./agent-mock-replies";

/**
 * 真实智能体接入：通过 SSE 拉取 408 考研智能体的回复，
 * 再用与本地演示一致的打字机节拍派发（尊重 prefers-reduced-motion）。
 * 服务未接入、调用失败或回复校验不通过时返回 null，由调用方退回本地演示回复，
 * 保证离线演示（如 iCAN 现场网络受限）仍然可用。
 */
export async function streamAgentReply(
  context: AgentContext,
  message: string,
  onDelta: (chunk: string) => void,
  signal: StreamSignal,
): Promise<string | null> {
  const controller = new AbortController();
  let text = "";
  let failed = false;
  try {
    await streamAgentChat(message, context, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "agent.delta") {
          text += event.delta ?? "";
        } else if (event.type === "agent.done") {
          text = event.text ?? text;
        } else if (event.type === "agent.failed") {
          failed = true;
        }
      },
    });
  } catch {
    controller.abort();
    return null;
  }
  if (failed || !text.trim()) return null;
  if (!signal.cancelled) {
    await streamMockReply(text, onDelta, signal);
  }
  return text;
}
