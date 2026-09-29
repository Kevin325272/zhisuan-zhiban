export interface AuthRateLimitPolicy {
  maxAttempts: number;
  windowMs: number;
}

export interface AuthRateLimitOptions {
  login?: Partial<AuthRateLimitPolicy>;
  register?: Partial<AuthRateLimitPolicy>;
  maxTrackedClients?: number;
  now?: () => number;
}

export interface AuthRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  windowResetAt: number;
}

interface AttemptBucket {
  attempts: number;
  resetAt: number;
}

export const DEFAULT_AUTH_RATE_LIMITS = {
  login: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  register: { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  maxTrackedClients: 10_000,
} as const;

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

export class FixedWindowAuthRateLimiter {
  readonly #buckets = new Map<string, AttemptBucket>();
  readonly #policy: AuthRateLimitPolicy;
  readonly #maxTrackedClients: number;
  readonly #now: () => number;

  constructor(
    policy: AuthRateLimitPolicy,
    options: { maxTrackedClients: number; now?: () => number },
  ) {
    this.#policy = {
      maxAttempts: positiveInteger(policy.maxAttempts, "maxAttempts"),
      windowMs: positiveInteger(policy.windowMs, "windowMs"),
    };
    this.#maxTrackedClients = positiveInteger(options.maxTrackedClients, "maxTrackedClients");
    this.#now = options.now ?? Date.now;
  }

  consume(clientKey: string): AuthRateLimitDecision {
    const now = this.#now();
    this.#removeExpired(now);
    const current = this.#buckets.get(clientKey);
    if (current && current.resetAt > now) {
      if (current.attempts >= this.#policy.maxAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
          windowResetAt: current.resetAt,
        };
      }
      current.attempts += 1;
      return {
        allowed: true,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        windowResetAt: current.resetAt,
      };
    }

    this.#makeRoom();
    this.#buckets.set(clientKey, {
      attempts: 1,
      resetAt: now + this.#policy.windowMs,
    });
    return {
      allowed: true,
      retryAfterSeconds: Math.max(1, Math.ceil(this.#policy.windowMs / 1000)),
      windowResetAt: now + this.#policy.windowMs,
    };
  }

  release(clientKey: string, windowResetAt: number) {
    const current = this.#buckets.get(clientKey);
    if (!current || current.resetAt !== windowResetAt) return;
    if (current.attempts <= 1) {
      this.#buckets.delete(clientKey);
      return;
    }
    current.attempts -= 1;
  }

  #removeExpired(now: number) {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
  }

  #makeRoom() {
    while (this.#buckets.size >= this.#maxTrackedClients) {
      const oldestKey = this.#buckets.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.#buckets.delete(oldestKey);
    }
  }
}

export function resolveAuthRateLimitOptions(options: AuthRateLimitOptions = {}) {
  const maxTrackedClients = options.maxTrackedClients ?? DEFAULT_AUTH_RATE_LIMITS.maxTrackedClients;
  return {
    login: {
      ...DEFAULT_AUTH_RATE_LIMITS.login,
      ...options.login,
    },
    register: {
      ...DEFAULT_AUTH_RATE_LIMITS.register,
      ...options.register,
    },
    maxTrackedClients,
    ...(options.now ? { now: options.now } : {}),
  };
}
