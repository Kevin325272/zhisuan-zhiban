import { describe, expect, it } from "vitest";

import { AiUpstreamCircuitBreaker } from "../src/services/ai-upstream-circuit-breaker.js";

describe("AI upstream circuit breaker", () => {
  it("opens after the configured failure threshold and closes after cooldown", () => {
    let now = 100;
    const breaker = new AiUpstreamCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 500,
      now: () => now,
    });

    expect(breaker.canRequest()).toBe(true);
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(true);
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(false);

    now = 601;
    expect(breaker.canRequest()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.canRequest()).toBe(true);
  });
});
