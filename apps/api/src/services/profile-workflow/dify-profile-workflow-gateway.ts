import type { StudentProfileWorkflowResponse } from "@xuetu/contracts";

import type {
  ProfileWorkflowContext,
} from "./profile-workflow-context.js";
import {
  profileWorkflowFailure,
  profileWorkflowSelectionSchema,
  resolveProfileWorkflowSelection,
  type ProfileWorkflowSelection,
} from "./profile-workflow-result.js";

export type { ProfileWorkflowContext } from "./profile-workflow-context.js";

interface DifyProfileWorkflowGatewayOptions {
  endpoint: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function upstreamOutputs(raw: unknown): ProfileWorkflowSelection | null {
  const envelope = asRecord(raw);
  const data = asRecord(envelope?.data);
  const outputs = asRecord(data?.outputs);
  if (!outputs) return null;
  const parsed = profileWorkflowSelectionSchema.safeParse(outputs);
  return parsed.success ? parsed.data : null;
}

export class DifyProfileWorkflowGateway {
  readonly configured = true;
  readonly #endpoint: string;
  readonly #secret: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: DifyProfileWorkflowGatewayOptions) {
    this.#endpoint = options.endpoint.replace(/\/$/u, "");
    this.#secret = options.secret;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async run(context: ProfileWorkflowContext): Promise<StudentProfileWorkflowResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#secret}`,
          "Content-Type": "application/json",
          "Idempotency-Key": context.request_id,
          "X-Xuetu-Contract-Version": "0.2",
        },
        body: JSON.stringify({
          inputs: context.inputs,
          response_mode: "blocking",
          user: "xuetu-profile-workflow",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          return profileWorkflowFailure(
            context,
            "unavailable",
            "UPSTREAM_UNAVAILABLE",
            "画像工作流暂时不可用。",
            true,
          );
        }
        return profileWorkflowFailure(
          context,
          "failed",
          "WORKFLOW_FAILED",
          `画像工作流拒绝了请求（HTTP ${response.status}）。`,
          false,
        );
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return profileWorkflowFailure(
          context,
          "failed",
          "WORKFLOW_FAILED",
          "画像工作流返回了无法解析的数据。",
          false,
        );
      }

      const outputs = upstreamOutputs(raw);
      if (!outputs) {
        return profileWorkflowFailure(
          context,
          "failed",
          "WORKFLOW_FAILED",
          "画像工作流响应未通过安全契约校验。",
          false,
        );
      }

      return resolveProfileWorkflowSelection(context, outputs);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return profileWorkflowFailure(
          context,
          "failed",
          "WORKFLOW_TIMEOUT",
          "画像工作流在20秒内未返回。",
          true,
        );
      }
      return profileWorkflowFailure(
        context,
        "unavailable",
        "UPSTREAM_UNAVAILABLE",
        "无法连接画像工作流。",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class UnavailableProfileWorkflowGateway {
  readonly configured = false;

  async run(context: ProfileWorkflowContext): Promise<StudentProfileWorkflowResponse> {
    return profileWorkflowFailure(
      context,
      "unavailable",
      "WORKFLOW_NOT_CONNECTED",
      "画像工作流尚未接入。",
      true,
    );
  }
}
