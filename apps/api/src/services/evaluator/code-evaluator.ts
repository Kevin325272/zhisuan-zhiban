import type { CodeRunRequest, CodeRunResult } from "@xuetu/contracts";

export type CodeEvaluatorHealthStatus =
  | "sandbox"
  | "degraded_mock"
  | "mock"
  | "unavailable";

export interface CodeEvaluatorHealth {
  status: CodeEvaluatorHealthStatus;
  label: string;
  detail: string | null;
}

export interface CodeEvaluator {
  evaluate(taskId: string, request: CodeRunRequest): Promise<CodeRunResult>;
  health(): Promise<CodeEvaluatorHealth>;
}

export type CodeEvaluatorErrorCategory =
  | "configuration"
  | "infrastructure"
  | "language";

export class CodeEvaluatorError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly retryable: boolean,
    readonly category: CodeEvaluatorErrorCategory,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CodeEvaluatorError";
  }
}
