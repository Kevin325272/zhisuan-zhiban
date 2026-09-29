import type { CodeRunRequest, CodeRunResult } from "@xuetu/contracts";

import type { CodeEvaluator, CodeEvaluatorHealth } from "./code-evaluator.js";

interface CachedCodeEvaluatorOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface CacheEntry {
  expiresAt: number;
  result: Promise<CodeRunResult>;
}

export class CachedCodeEvaluator implements CodeEvaluator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly delegate: CodeEvaluator,
    options: CachedCodeEvaluatorOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 120_000;
    this.maxEntries = options.maxEntries ?? 50;
    this.now = options.now ?? Date.now;
  }

  async evaluate(taskId: string, request: CodeRunRequest): Promise<CodeRunResult> {
    const now = this.now();
    this.removeExpired(now);
    const key = JSON.stringify([
      taskId,
      request.language,
      request.source,
      request.custom_input ?? "",
    ]);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.result;

    const result = this.delegate.evaluate(taskId, request);
    const entry = { expiresAt: now + this.ttlMs, result };
    this.cache.set(key, entry);
    this.trimToLimit();

    try {
      return await result;
    } catch (error) {
      if (this.cache.get(key) === entry) this.cache.delete(key);
      throw error;
    }
  }

  health(): Promise<CodeEvaluatorHealth> {
    return this.delegate.health();
  }

  private removeExpired(now: number) {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }

  private trimToLimit() {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.cache.delete(oldestKey);
    }
  }
}
