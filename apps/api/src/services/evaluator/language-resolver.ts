import type { ProgrammingLanguage } from "@xuetu/contracts";

import { CodeEvaluatorError } from "./code-evaluator.js";
import type { Judge0Language } from "./judge0-client.js";

interface LanguageCatalogClient {
  listLanguages(): Promise<Judge0Language[]>;
}

const matchers: Record<ProgrammingLanguage, (name: string) => boolean> = {
  c: (name) => /^C\s*\(/iu.test(name) && !/^C\+\+/iu.test(name),
  cpp: (name) => /^C\+\+/iu.test(name),
  java: (name) => /^Java\s*\(/iu.test(name),
  python: (name) => /^Python\s*\(/iu.test(name),
  javascript: (name) => /^(JavaScript|Node\.js)\s*\(/iu.test(name),
  typescript: (name) => /^TypeScript\s*\(/iu.test(name),
  go: (name) => /^Go\s*\(/iu.test(name),
  rust: (name) => /^Rust\s*\(/iu.test(name),
};

const labels: Record<ProgrammingLanguage, string> = {
  c: "C",
  cpp: "C++",
  java: "Java",
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  go: "Go",
  rust: "Rust",
};

function versionParts(name: string) {
  return (name.match(/\d+/gu) ?? []).map(Number);
}

function compareVersions(left: Judge0Language, right: Judge0Language) {
  const a = versionParts(left.name);
  const b = versionParts(right.name);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (b[index] ?? 0) - (a[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return right.id - left.id;
}

export class Judge0LanguageResolver {
  private catalogPromise: Promise<Judge0Language[]> | null = null;

  constructor(
    private readonly client: LanguageCatalogClient,
    private readonly overrides: Partial<Record<ProgrammingLanguage, number>>,
  ) {}

  async resolve(language: ProgrammingLanguage): Promise<Judge0Language> {
    const override = this.overrides[language];
    if (override !== undefined) {
      return { id: override, name: `${labels[language]} runtime #${override}` };
    }

    this.catalogPromise ??= this.client.listLanguages();
    const catalog = await this.catalogPromise;
    const match = catalog.filter((item) => matchers[language](item.name)).sort(compareVersions)[0];
    if (!match) {
      throw new CodeEvaluatorError(
        `当前隔离沙箱未安装 ${labels[language]} 运行时。`,
        "EVALUATOR_LANGUAGE_UNAVAILABLE",
        422,
        false,
        "language",
        { language },
      );
    }
    return match;
  }
}
