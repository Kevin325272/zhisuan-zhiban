import { describe, expect, it, vi } from "vitest";

import { Judge0LanguageResolver } from "../src/services/evaluator/language-resolver.js";

describe("Judge0 language resolver", () => {
  it("selects the newest matching runtime without confusing C and C++", async () => {
    const listLanguages = vi.fn(async () => [
      { id: 50, name: "C (GCC 9.2.0)" },
      { id: 104, name: "C (GCC 14.1.0)" },
      { id: 54, name: "C++ (GCC 9.2.0)" },
      { id: 105, name: "C++ (GCC 14.1.0)" },
      { id: 71, name: "Python (3.8.1)" },
      { id: 100, name: "Python (3.12.5)" },
    ]);
    const resolver = new Judge0LanguageResolver({ listLanguages }, {});

    await expect(resolver.resolve("c")).resolves.toEqual({
      id: 104,
      name: "C (GCC 14.1.0)",
    });
    await expect(resolver.resolve("cpp")).resolves.toEqual({
      id: 105,
      name: "C++ (GCC 14.1.0)",
    });
    await expect(resolver.resolve("python")).resolves.toEqual({
      id: 100,
      name: "Python (3.12.5)",
    });
    expect(listLanguages).toHaveBeenCalledOnce();
  });

  it("uses an explicit runtime ID without fetching the language catalog", async () => {
    const listLanguages = vi.fn(async () => []);
    const resolver = new Judge0LanguageResolver({ listLanguages }, { rust: 108 });

    await expect(resolver.resolve("rust")).resolves.toEqual({
      id: 108,
      name: "Rust runtime #108",
    });
    expect(listLanguages).not.toHaveBeenCalled();
  });

  it("returns a typed non-retryable error when a runtime is unavailable", async () => {
    const resolver = new Judge0LanguageResolver(
      { listLanguages: async () => [{ id: 105, name: "C++ (GCC 14.1.0)" }] },
      {},
    );

    await expect(resolver.resolve("typescript")).rejects.toMatchObject({
      code: "EVALUATOR_LANGUAGE_UNAVAILABLE",
      statusCode: 422,
      retryable: false,
      category: "language",
    });
  });
});
