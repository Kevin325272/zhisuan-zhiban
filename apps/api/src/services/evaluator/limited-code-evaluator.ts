import type { CodeRunRequest, CodeRunResult } from "@xuetu/contracts";

import {
  CodeEvaluatorError,
  type CodeEvaluator,
  type CodeEvaluatorHealth,
} from "./code-evaluator.js";

export class LimitedCodeEvaluator implements CodeEvaluator {
  private activeRuns = 0;

  constructor(
    private readonly delegate: CodeEvaluator,
    private readonly maxConcurrentRuns: number,
  ) {}

  async evaluate(taskId: string, request: CodeRunRequest): Promise<CodeRunResult> {
    if (this.activeRuns >= this.maxConcurrentRuns) {
      throw new CodeEvaluatorError(
        "当前评测任务较多，请稍后重试。",
        "EVALUATOR_BUSY",
        429,
        true,
        "infrastructure",
        { max_concurrent_runs: this.maxConcurrentRuns },
      );
    }

    this.activeRuns += 1;
    try {
      return await this.delegate.evaluate(taskId, request);
    } finally {
      this.activeRuns -= 1;
    }
  }

  health(): Promise<CodeEvaluatorHealth> {
    return this.delegate.health();
  }
}
