import {
  programmingLanguageMeta,
  type ProgrammingLanguage,
} from "@xuetu/contracts";
import type { ReactNode } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-java";
import "prismjs/components/prism-python";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";

interface SyntaxHighlightedCodeProps {
  code: string;
  language: ProgrammingLanguage;
  className?: string;
}

function renderTokenStream(stream: Prism.TokenStream, keyPrefix: string): ReactNode {
  if (typeof stream === "string") return stream;
  if (Array.isArray(stream)) {
    return stream.map((token, index) => renderTokenStream(token, `${keyPrefix}-${index}`));
  }

  const aliases = stream.alias
    ? Array.isArray(stream.alias)
      ? stream.alias
      : [stream.alias]
    : [];

  return (
    <span className={["token", stream.type, ...aliases].join(" ")} key={keyPrefix}>
      {renderTokenStream(stream.content, `${keyPrefix}-content`)}
    </span>
  );
}

export function SyntaxHighlightedCode({
  code,
  language,
  className,
}: SyntaxHighlightedCodeProps) {
  const prismLanguage = programmingLanguageMeta[language].prism_language;
  const grammar = Prism.languages[prismLanguage];
  const tokens = grammar ? Prism.tokenize(code, grammar) : [code];
  const classes = ["syntax-highlighted-code", `language-${prismLanguage}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <code className={classes} data-language={language}>
      {tokens.map((token, index) => renderTokenStream(token, `token-${index}`))}
    </code>
  );
}
