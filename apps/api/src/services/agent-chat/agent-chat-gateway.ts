export type AgentChatContext = "study" | "lab" | "teacher";

export interface AgentChatGatewayOptions {
  requestId: string;
  userId: string;
  context: AgentChatContext;
  message: string;
  /** 客户端断开时中止上游请求。 */
  signal?: AbortSignal;
}

export interface AgentChatGateway {
  /**
   * 调用全局智能体并流式返回回复：收到完整结果时以 onDelta 派发一次全文，
   * resolve 最终文本；失败抛出 AgentChatError。
   */
  streamReply(
    options: AgentChatGatewayOptions,
    onDelta: (chunk: string) => void,
  ): Promise<string>;
}

export class AgentChatError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "AgentChatError";
    this.code = code;
    this.retryable = retryable;
  }
}
