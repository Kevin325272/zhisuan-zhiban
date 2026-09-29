import {
  programmingLanguageMeta,
  type CodeTemplate,
  type ProgrammingLanguage,
} from "@xuetu/contracts";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type UIEvent,
} from "react";

import { SyntaxHighlightedCode } from "./syntax-highlighted-code";

export interface CodeEditorHandle {
  focusLine: (line: number) => void;
}

interface CodeEditorProps {
  value: string;
  language: ProgrammingLanguage;
  templates: CodeTemplate[];
  onLanguageChange: (language: ProgrammingLanguage) => void;
  onChange: (value: string) => void;
  errorLine?: number | null;
  ariaLabel?: string;
  languageSelectAriaLabel?: string;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    language,
    templates,
    onLanguageChange,
    onChange,
    errorLine = null,
    ariaLabel = "BFS 代码",
    languageSelectAriaLabel = "提交语言",
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLOListElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lines = value.split("\n");
  const activeTemplate = templates.find((template) => template.language === language);

  useImperativeHandle(ref, () => ({
    focusLine(line) {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const safeLine = Math.max(1, Math.min(line, lines.length));
      const lineStart = lines
        .slice(0, safeLine - 1)
        .reduce((offset, current) => offset + current.length + 1, 0);
      const lineEnd = lineStart + (lines[safeLine - 1]?.length ?? 0);

      textarea.focus();
      textarea.setSelectionRange(lineStart, lineEnd);
      textarea.scrollTop = Math.max(0, (safeLine - 4) * 18.6);
      if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
      if (highlightRef.current) highlightRef.current.scrollTop = textarea.scrollTop;
    },
  }));

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
  }

  function handleScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = event.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
  }

  return (
    <div className={`code-editor-shell${errorLine ? " has-error" : ""}`}>
      <div className="editor-titlebar">
        <label className="editor-language-select">
          <span>提交语言</span>
          <select
            aria-label={languageSelectAriaLabel}
            name="submission-language"
            onChange={(event) => onLanguageChange(event.target.value as ProgrammingLanguage)}
            value={language}
          >
            {templates.map((template) => (
              <option key={template.language} value={template.language}>
                {programmingLanguageMeta[template.language].label} · {programmingLanguageMeta[template.language].version}
              </option>
            ))}
          </select>
        </label>
        <span className="editor-file-name">
          {activeTemplate?.file_name ?? programmingLanguageMeta[language].file_name}
        </span>
      </div>
      <div className="editor-body">
        <ol aria-label="代码行号" className="editor-line-numbers" ref={gutterRef}>
          {lines.map((_, index) => {
            const lineNumber = index + 1;
            return (
              <li className={lineNumber === errorLine ? "error-line" : undefined} key={lineNumber}>
                {lineNumber}
              </li>
            );
          })}
        </ol>
        <div className="editor-code-surface">
          <pre
            aria-hidden="true"
            className="editor-highlight-scroll"
            data-testid="code-highlight-scroll"
            ref={highlightRef}
          >
            <SyntaxHighlightedCode code={value} language={language} />
          </pre>
          <textarea
            aria-label={ariaLabel}
            aria-invalid={Boolean(errorLine)}
            autoComplete="off"
            name="bfs-source"
            onChange={handleChange}
            onScroll={handleScroll}
            ref={textareaRef}
            spellCheck={false}
            value={value}
            wrap="off"
          />
        </div>
      </div>
    </div>
  );
});
