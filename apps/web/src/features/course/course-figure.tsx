import { Expand, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface CourseFigureProps {
  label: string;
  caption: string;
  src: string;
  width: number;
  height: number;
}

export function CourseFigure({ label, caption, src, width, height }: CourseFigureProps) {
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const alt = `${label} ${caption}`;

  useEffect(() => {
    if (expanded) dialogRef.current?.showModal();
  }, [expanded]);

  return (
    <figure className="course-reader-figure">
      <figcaption>
        <span>{label}</span>
        <h4>{caption}</h4>
        <button aria-label={`放大图示：${caption}`} className="course-figure-expand" onClick={() => setExpanded(true)} title="放大图示" type="button">
          <Expand aria-hidden="true" size={18} />
        </button>
      </figcaption>
      <button aria-label={`查看大图：${caption}`} className="lesson-figure-image" onClick={() => setExpanded(true)} type="button">
        <img alt={alt} height={height} loading="lazy" src={src} width={width} />
      </button>
      {expanded ? (
        <dialog
          aria-labelledby={titleId}
          className="course-figure-dialog"
          onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
          onClose={() => setExpanded(false)}
          ref={dialogRef}
        >
          <header>
            <h2 id={titleId}>{alt}</h2>
            <button aria-label="关闭大图" autoFocus onClick={() => dialogRef.current?.close()} type="button"><X aria-hidden="true" size={22} /></button>
          </header>
          <div><img alt={alt} height={height} src={src} width={width} /></div>
        </dialog>
      ) : null}
    </figure>
  );
}
