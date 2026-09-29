import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyntaxHighlightedCode } from "./syntax-highlighted-code";

describe("SyntaxHighlightedCode", () => {
  const samples = [
    {
      language: "cpp" as const,
      code: 'const char* message = "hello"; // comment',
    },
    {
      language: "python" as const,
      code: 'def greet():\n    return "hello"  # comment',
    },
    {
      language: "rust" as const,
      code: 'fn greet() -> &\'static str { "hello" } // comment',
    },
  ];

  for (const sample of samples) {
    it(`renders ${sample.language} keyword, string, and comment tokens`, () => {
      const { container } = render(
        <SyntaxHighlightedCode code={sample.code} language={sample.language} />,
      );

      expect(container.querySelector(".token.keyword")).toBeInTheDocument();
      expect(container.querySelector(".token.string")).toBeInTheDocument();
      expect(container.querySelector(".token.comment")).toBeInTheDocument();
    });
  }

  it("keeps script-like source as text", () => {
    const code = '<script>alert("x")</script>';
    const { container } = render(
      <SyntaxHighlightedCode code={code} language="javascript" />,
    );

    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container).toHaveTextContent(code);
  });
});
