import { describe, expect, it } from "vitest";

import { programmingLanguageDefinitions } from "../src/domain/programming-languages.js";
import {
  builtInBfsCases,
  expectedOutputFor,
  parseCustomGraph,
} from "../src/services/evaluator/bfs-cases.js";
import { buildBfsProgram } from "../src/services/evaluator/language-harnesses.js";

const entryMarkers = {
  c: "int main(void)",
  cpp: "int main()",
  java: "public class Main",
  python: 'if __name__ == "__main__"',
  javascript: "const __xuetuGraph",
  typescript: "const __xuetuGraph",
  go: "func main()",
  rust: "fn main()",
} as const;

describe("BFS language harnesses", () => {
  const diamond = builtInBfsCases.find((item) => item.id === "case_diamond")!;

  for (const definition of programmingLanguageDefinitions) {
    it(`builds a complete ${definition.language} program without changing the editor source`, () => {
      const built = buildBfsProgram(
        definition.language,
        definition.fixed_code,
        diamond,
      );

      expect(built.source).toContain(entryMarkers[definition.language]);
      expect(built.source).toContain("__xuetu");
      expect(built.source).toContain("4");
      expect(built.fileName).toBe(definition.file_name);
      expect(definition.fixed_code).not.toContain("__xuetu");
    });
  }

  it("normalizes Java and Go entry-point constraints", () => {
    const java = programmingLanguageDefinitions.find((item) => item.language === "java")!;
    const go = programmingLanguageDefinitions.find((item) => item.language === "go")!;

    const javaProgram = buildBfsProgram("java", java.fixed_code, diamond).source;
    const goProgram = buildBfsProgram("go", go.fixed_code, diamond).source;

    expect(javaProgram).toContain("class BfsTraversal");
    expect(javaProgram).not.toContain("public class BfsTraversal");
    expect(javaProgram).toContain("public class Main");
    expect(goProgram.startsWith("package main\n")).toBe(true);
    expect(goProgram).toContain('import "fmt"');
  });

  it("keeps the trusted expected output and custom graph behavior in one module", () => {
    expect(expectedOutputFor(diamond)).toBe("1 2 3 4");
    const custom = parseCustomGraph("start=7\n7 8\n7 9\n8 9");
    expect(custom).toMatchObject({ id: "case_custom", start: 7 });
    expect(expectedOutputFor(custom)).toBe("7 8 9");
  });
});
