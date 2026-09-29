import {
  type AiWorkflowCapability,
  type AiWorkflowResponse,
  type AiWorkflowRuntimeStatus,
} from "@xuetu/contracts";

import { runtimeStatusForWorkflowResponse } from "./model-workflow-response.js";

const DEFAULT_RUNTIME_STATUS_TTL_MS = 5 * 60 * 1_000;

interface RuntimeStatusTrackerOptions {
  ttlMs?: number | undefined;
  now?: (() => number) | undefined;
}

interface RuntimeObservation {
  status: AiWorkflowRuntimeStatus;
  expiresAt: number;
}

function configuredStatus(): AiWorkflowRuntimeStatus {
  return {
    state: "configured",
    label: "AI 服务已配置，尚未验证",
    detail: "完成一次受契约约束的成功调用后才会显示可用。",
    checked_at: null,
  };
}

export class AiWorkflowRuntimeStatusTracker {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #observations = new Map<AiWorkflowCapability, RuntimeObservation>();

  constructor(options: RuntimeStatusTrackerOptions = {}) {
    this.#ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_RUNTIME_STATUS_TTL_MS);
    this.#now = options.now ?? Date.now;
  }

  status(capability: AiWorkflowCapability): AiWorkflowRuntimeStatus {
    const observation = this.#observations.get(capability);
    if (!observation || observation.expiresAt <= this.#now()) {
      if (observation) this.#observations.delete(capability);
      return configuredStatus();
    }
    return { ...observation.status };
  }

  record(response: AiWorkflowResponse) {
    const observedAt = this.#now();
    this.#observations.set(response.capability, {
      status: runtimeStatusForWorkflowResponse(
        response,
        new Date(observedAt).toISOString(),
      ),
      expiresAt: observedAt + this.#ttlMs,
    });
  }
}
