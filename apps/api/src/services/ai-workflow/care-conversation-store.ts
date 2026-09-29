import type { AiWorkflowCareTurn } from "@xuetu/contracts";

export interface CareConversationStore {
  read(userId: string, conversationId: string): AiWorkflowCareTurn[];
  appendExchange(
    userId: string,
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
  ): void;
}

interface CareConversationStoreOptions {
  ttlMs?: number;
  maxTurns?: number;
  maxTurnChars?: number;
  now?: () => number;
}

interface StoredConversation {
  expiresAt: number;
  turns: AiWorkflowCareTurn[];
}

const DEFAULT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_TURNS = 6;
const DEFAULT_MAX_TURN_CHARS = 2_000;

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export class EphemeralCareConversationStore implements CareConversationStore {
  readonly #entries = new Map<string, StoredConversation>();
  readonly #ttlMs: number;
  readonly #maxTurns: number;
  readonly #maxTurnChars: number;
  readonly #now: () => number;

  constructor(options: CareConversationStoreOptions = {}) {
    this.#ttlMs = positiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, "ttlMs");
    this.#maxTurns = positiveInteger(options.maxTurns ?? DEFAULT_MAX_TURNS, "maxTurns");
    this.#maxTurnChars = positiveInteger(
      options.maxTurnChars ?? DEFAULT_MAX_TURN_CHARS,
      "maxTurnChars",
    );
    this.#now = options.now ?? Date.now;
  }

  read(userId: string, conversationId: string): AiWorkflowCareTurn[] {
    const key = this.#key(userId, conversationId);
    const stored = this.#entries.get(key);
    if (!stored) return [];
    if (stored.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return [];
    }
    return stored.turns.map((turn) => ({ ...turn }));
  }

  appendExchange(
    userId: string,
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
  ) {
    const turns = [
      ...this.read(userId, conversationId),
      { role: "user" as const, content: this.#boundedContent(userMessage) },
      { role: "assistant" as const, content: this.#boundedContent(assistantMessage) },
    ].slice(-this.#maxTurns);
    this.#entries.set(this.#key(userId, conversationId), {
      expiresAt: this.#now() + this.#ttlMs,
      turns,
    });
  }

  #boundedContent(content: string) {
    const bounded = content.trim().slice(0, this.#maxTurnChars);
    if (!bounded) throw new Error("Care conversation turns must not be empty.");
    return bounded;
  }

  #key(userId: string, conversationId: string) {
    return `${userId.length}:${userId}${conversationId}`;
  }
}
