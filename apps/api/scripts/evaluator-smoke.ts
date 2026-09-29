import {
  programmingLanguageIds,
  type CodeRunRequest,
  type ProgrammingLanguage,
} from "@xuetu/contracts";

import { readEvaluatorConfig } from "../src/config/evaluator.js";
import { loadLocalEnvironment } from "../src/config/local-env.js";
import { getProgrammingLanguageDefinition } from "../src/domain/programming-languages.js";
import { Judge0Client } from "../src/services/evaluator/judge0-client.js";
import { Judge0CodeEvaluator } from "../src/services/evaluator/judge0-evaluator.js";
import { Judge0LanguageResolver } from "../src/services/evaluator/language-resolver.js";
import { MockBfsCodeEvaluator } from "../src/services/evaluator/mock-bfs-evaluator.js";
import { shortestPathTemplates } from "../src/services/evaluator/shortest-path-task.js";

loadLocalEnvironment();
const config = readEvaluatorConfig();
if (config.mode !== "judge0" || !config.baseUrl) {
  throw new Error("evaluator:smoke requires EVALUATOR_MODE=judge0 and EVALUATOR_BASE_URL.");
}
const client = new Judge0Client(config);
const evaluator = new Judge0CodeEvaluator({
  client,
  resolver: new Judge0LanguageResolver(client, config.languageIds),
  allowMockFallback: false,
  fallback: new MockBfsCodeEvaluator(),
});

async function runScenario(
  language: ProgrammingLanguage,
  taskId: string,
  label: string,
  request: CodeRunRequest,
  expectedStatus: "passed" | "failed",
) {
  const result = await evaluator.evaluate(taskId, request);
  if (result.execution_mode !== "sandbox" || result.status !== expectedStatus) {
    throw new Error(
      `${language}/${label} produced an unexpected result: ${JSON.stringify({
        status: result.status,
        execution_mode: result.execution_mode,
        degraded_reason: result.degraded_reason,
        stderr: result.stderr,
      })}`,
    );
  }
  console.log(
    JSON.stringify({
      language,
      scenario: label,
      evaluator: result.evaluator_label,
      status: result.status,
      cases: `${result.passed_count}/${result.total_count}`,
      duration_ms: result.duration_ms,
      memory_kb: result.memory_kb,
      case_metrics: result.test_cases.map((testCase) => ({
        id: testCase.test_case_id,
        status: testCase.status,
        duration_ms: testCase.duration_ms,
        memory_kb: testCase.memory_kb,
      })),
    }),
  );
}

for (const language of programmingLanguageIds) {
  const definition = getProgrammingLanguageDefinition(language);
  await runScenario(
    language,
    "task_bfs_bug_001",
    "bfs-fixed",
    { language, source: definition.fixed_code, custom_input: null },
    "passed",
  );
  await runScenario(
    language,
    "task_bfs_transfer_001",
    "shortest-path-reference",
    { language, source: shortestPathTemplates[language].reference_code, custom_input: null },
    "passed",
  );
}

for (const language of ["cpp", "python"] as const) {
  await runScenario(
    language,
    "task_bfs_bug_001",
    "bfs-wrong",
    {
      language,
      source: getProgrammingLanguageDefinition(language).starter_code,
      custom_input: "start=7\n7 8\n7 9\n8 10\n9 10",
    },
    "failed",
  );
}
