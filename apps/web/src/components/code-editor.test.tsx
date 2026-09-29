import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it } from "vitest";
import {
  programmingLanguageIds,
  programmingLanguageMeta,
  type CodeTemplate,
  type ProgrammingLanguage,
} from "@xuetu/contracts";

import { CodeEditor, type CodeEditorHandle } from "./code-editor";

const templates: CodeTemplate[] = programmingLanguageIds.map((language) => ({
  language,
  file_name: programmingLanguageMeta[language].file_name,
  starter_code:
    language === "python"
      ? "def bfs():\n    return []"
      : "const value = 1;\n// second line\nreturn value;",
  fixed_code: "fixed",
}));

function EditorHarness({ errorLine = null }: { errorLine?: number | null }) {
  const [language, setLanguage] = useState<ProgrammingLanguage>("cpp");
  const [value, setValue] = useState("const value = 1;\n// second line\nreturn value;");
  const editorRef = createRef<CodeEditorHandle>();

  function changeLanguage(nextLanguage: ProgrammingLanguage) {
    setLanguage(nextLanguage);
    setValue(templates.find((item) => item.language === nextLanguage)!.starter_code);
  }

  return (
    <>
      <CodeEditor
        errorLine={errorLine}
        language={language}
        onChange={setValue}
        onLanguageChange={changeLanguage}
        ref={editorRef}
        templates={templates}
        value={value}
      />
      <button onClick={() => editorRef.current?.focusLine(2)} type="button">
        定位第二行
      </button>
    </>
  );
}

describe("CodeEditor", () => {
  it("edits source while keeping stable line numbers", () => {
    render(<EditorHarness />);

    const editor = screen.getByRole("textbox", { name: "BFS 代码" });
    expect(editor).toHaveAttribute("wrap", "off");
    expect(editor).toHaveAttribute("name", "bfs-source");
    expect(editor).toHaveAttribute("autocomplete", "off");
    fireEvent.change(editor, { target: { value: "one\ntwo\nthree\nfour" } });

    expect(editor).toHaveValue("one\ntwo\nthree\nfour");
    expect(screen.getByLabelText("代码行号").children).toHaveLength(4);
  });

  it("switches among all eight languages and updates the filename", () => {
    render(<EditorHarness />);

    const languageSelect = screen.getByRole("combobox", { name: "提交语言" });
    expect(languageSelect).toHaveAttribute("name", "submission-language");
    expect(screen.getAllByRole("option")).toHaveLength(8);
    expect(screen.getByRole("option", { name: "Python · Python 3.12" })).toBeInTheDocument();
    expect(screen.getByText("bfs.cpp")).toBeInTheDocument();

    fireEvent.change(languageSelect, { target: { value: "python" } });

    expect(languageSelect).toHaveValue("python");
    expect(screen.getByText("bfs.py")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "BFS 代码" })).toHaveValue(
      "def bfs():\n    return []",
    );
  });

  it("keeps the textarea editable over syntax tokens and syncs both scroll axes", () => {
    const { container } = render(<EditorHarness />);
    const editor = screen.getByRole("textbox", { name: "BFS 代码" }) as HTMLTextAreaElement;
    const highlightScroller = screen.getByTestId("code-highlight-scroll");

    expect(container.querySelector(".token.keyword")).toBeInTheDocument();
    editor.scrollTop = 41;
    editor.scrollLeft = 23;
    fireEvent.scroll(editor);

    expect(highlightScroller.scrollTop).toBe(41);
    expect(highlightScroller.scrollLeft).toBe(23);
  });

  it("marks and focuses a requested source line", () => {
    render(<EditorHarness errorLine={2} />);

    const editor = screen.getByRole("textbox", { name: "BFS 代码" }) as HTMLTextAreaElement;
    expect(screen.getByText("2")).toHaveClass("error-line");

    fireEvent.click(screen.getByRole("button", { name: "定位第二行" }));
    expect(editor).toHaveFocus();
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("// second line");
  });
});
