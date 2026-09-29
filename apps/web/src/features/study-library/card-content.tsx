import katex from "katex";
import "katex/dist/katex.min.css";

/** Only KaTeX-generated markup is inserted; ordinary text always goes through React escaping. */
export function CardContent({ text }: { text: string }) {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|(?<!\\)\$[^$\n]+?(?<!\\)\$)/gu);
  return (
    <div className="study-card-content">
      {parts.map((part, index) => {
        const display = part.startsWith("$$") && part.endsWith("$$"),
          inline = !display && part.startsWith("$") && part.endsWith("$");
        if (!display && !inline) return <span key={index}>{part}</span>;
        const html = katex.renderToString(
          part.slice(display ? 2 : 1, display ? -2 : -1),
          {
            displayMode: display,
            throwOnError: false,
            trust: false,
            strict: "ignore",
            maxExpand: 200,
            maxSize: 20,
          },
        );
        return (
          <span
            key={index}
            className={display ? "study-formula-block" : "study-formula"}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}
