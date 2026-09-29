import { algorithmTraceSchema } from "@xuetu/contracts";
import { describe, expect, it } from "vitest";

import { programmingLanguageDefinitions } from "../src/domain/programming-languages.js";
import { createBfsTrace } from "../src/services/algorithm-trace.js";

describe("language-aware BFS traces", () => {
  for (const definition of programmingLanguageDefinitions) {
    it(`uses the ${definition.language} source and semantic lines`, () => {
      const wrong = createBfsTrace(definition.language, "visited-on-dequeue");
      const fixed = createBfsTrace(definition.language, "visited-on-enqueue");

      expect(algorithmTraceSchema.parse(wrong)).toBeDefined();
      expect(algorithmTraceSchema.parse(fixed)).toBeDefined();
      expect(wrong).toMatchObject({
        language: definition.language,
        file_name: definition.file_name,
        source_code: definition.starter_code,
      });
      expect(fixed).toMatchObject({
        language: definition.language,
        file_name: definition.file_name,
        source_code: definition.fixed_code,
      });

      for (const trace of [wrong, fixed]) {
        const lineCount = trace.source_code.split(/\r?\n/).length;
        expect(trace.steps.every((step) => step.code_line <= lineCount)).toBe(true);
      }
    });
  }
});
