import type { CodeRunRequest, CodeRunResult } from "@xuetu/contracts";

import { runTaskCode } from "../code-runner.js";
import type { CodeEvaluator, CodeEvaluatorHealth } from "./code-evaluator.js";

export class MockBfsCodeEvaluator implements CodeEvaluator {
  async evaluate(taskId: string, request: CodeRunRequest): Promise<CodeRunResult> {
    return runTaskCode(taskId, request);
  }

  async health(): Promise<CodeEvaluatorHealth> {
    return {
      status: "mock",
      label: "演示评测",
      detail: "当前使用确定性演示评测器，耗时和内存不是实际运行指标。",
    };
  }
}
