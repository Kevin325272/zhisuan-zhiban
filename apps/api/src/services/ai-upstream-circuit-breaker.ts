interface AiUpstreamCircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export class AiUpstreamCircuitBreaker {
  readonly #failureThreshold: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;
  #consecutiveFailures = 0;
  #openUntil = 0;

  constructor(options: AiUpstreamCircuitBreakerOptions = {}) {
    this.#failureThreshold = Math.max(1, options.failureThreshold ?? 2);
    this.#cooldownMs = Math.max(1, options.cooldownMs ?? 30_000);
    this.#now = options.now ?? Date.now;
  }

  canRequest() {
    if (this.#openUntil === 0) return true;
    if (this.#now() < this.#openUntil) return false;
    this.#consecutiveFailures = 0;
    this.#openUntil = 0;
    return true;
  }

  recordSuccess() {
    this.#consecutiveFailures = 0;
    this.#openUntil = 0;
  }

  recordFailure() {
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= this.#failureThreshold) {
      this.#openUntil = this.#now() + this.#cooldownMs;
    }
  }
}
