export interface AiRequestLimitOptions {
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
  maxTrackedUsers: number;
  now?: () => number;
}

interface UserBucket {
  requests: number[];
  concurrent: number;
  lastTouchedAt: number;
}

export type AiRequestLease =
  | { allowed: true; release: () => void }
  | {
      allowed: false;
      reason: "rate" | "concurrency" | "capacity";
      retryAfterSeconds: number;
    };

export interface AiRequestLimitSnapshot {
  total_allowed: number;
  total_rejected: number;
  rejected_by_reason: {
    rate: number;
    concurrency: number;
    capacity: number;
  };
  current_concurrent: number;
  peak_concurrent: number;
  tracked_users: number;
}

export const DEFAULT_AI_REQUEST_LIMITS = {
  maxRequests: 30,
  windowMs: 60_000,
  maxConcurrent: 2,
  maxTrackedUsers: 10_000,
} as const;

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

export class PerUserAiRequestLimiter {
  readonly #buckets = new Map<string, UserBucket>();
  readonly #options: AiRequestLimitOptions;
  readonly #now: () => number;
  #totalAllowed = 0;
  #totalRejected = 0;
  #rejectedByReason: AiRequestLimitSnapshot["rejected_by_reason"] = {
    rate: 0,
    concurrency: 0,
    capacity: 0,
  };
  #currentConcurrent = 0;
  #peakConcurrent = 0;

  constructor(options: Partial<AiRequestLimitOptions> = {}) {
    this.#options = {
      maxRequests: positiveInteger(
        options.maxRequests ?? DEFAULT_AI_REQUEST_LIMITS.maxRequests,
        "maxRequests",
      ),
      windowMs: positiveInteger(
        options.windowMs ?? DEFAULT_AI_REQUEST_LIMITS.windowMs,
        "windowMs",
      ),
      maxConcurrent: positiveInteger(
        options.maxConcurrent ?? DEFAULT_AI_REQUEST_LIMITS.maxConcurrent,
        "maxConcurrent",
      ),
      maxTrackedUsers: positiveInteger(
        options.maxTrackedUsers ?? DEFAULT_AI_REQUEST_LIMITS.maxTrackedUsers,
        "maxTrackedUsers",
      ),
      ...(options.now ? { now: options.now } : {}),
    };
    this.#now = options.now ?? Date.now;
  }

  acquire(userId: string): AiRequestLease {
    const now = this.#now();
    this.#prune(now);
    let bucket = this.#buckets.get(userId);
    if (!bucket) {
      this.#makeRoom();
      if (this.#buckets.size >= this.#options.maxTrackedUsers) {
        this.#recordRejected("capacity");
        return { allowed: false, reason: "capacity", retryAfterSeconds: 1 };
      }
      bucket = { requests: [], concurrent: 0, lastTouchedAt: now };
      this.#buckets.set(userId, bucket);
    }
    bucket.lastTouchedAt = now;
    bucket.requests = bucket.requests.filter(
      (requestedAt) => requestedAt > now - this.#options.windowMs,
    );

    if (bucket.concurrent >= this.#options.maxConcurrent) {
      this.#recordRejected("concurrency");
      return { allowed: false, reason: "concurrency", retryAfterSeconds: 1 };
    }
    if (bucket.requests.length >= this.#options.maxRequests) {
      const resetAt = (bucket.requests[0] ?? now) + this.#options.windowMs;
      this.#recordRejected("rate");
      return {
        allowed: false,
        reason: "rate",
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
      };
    }

    bucket.requests.push(now);
    bucket.concurrent += 1;
    this.#totalAllowed += 1;
    this.#currentConcurrent += 1;
    this.#peakConcurrent = Math.max(this.#peakConcurrent, this.#currentConcurrent);
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        bucket.concurrent = Math.max(0, bucket.concurrent - 1);
        this.#currentConcurrent = Math.max(0, this.#currentConcurrent - 1);
        bucket.lastTouchedAt = this.#now();
      },
    };
  }

  snapshot(): AiRequestLimitSnapshot {
    return {
      total_allowed: this.#totalAllowed,
      total_rejected: this.#totalRejected,
      rejected_by_reason: { ...this.#rejectedByReason },
      current_concurrent: this.#currentConcurrent,
      peak_concurrent: this.#peakConcurrent,
      tracked_users: this.#buckets.size,
    };
  }

  #recordRejected(reason: keyof AiRequestLimitSnapshot["rejected_by_reason"]) {
    this.#totalRejected += 1;
    this.#rejectedByReason[reason] += 1;
  }

  #prune(now: number) {
    for (const [userId, bucket] of this.#buckets) {
      bucket.requests = bucket.requests.filter(
        (requestedAt) => requestedAt > now - this.#options.windowMs,
      );
      if (bucket.concurrent === 0 && bucket.requests.length === 0) {
        this.#buckets.delete(userId);
      }
    }
  }

  #makeRoom() {
    if (this.#buckets.size < this.#options.maxTrackedUsers) return;
    const removable = [...this.#buckets.entries()]
      .filter(([, bucket]) => bucket.concurrent === 0)
      .sort((left, right) => left[1].lastTouchedAt - right[1].lastTouchedAt)[0];
    if (removable) this.#buckets.delete(removable[0]);
  }
}
