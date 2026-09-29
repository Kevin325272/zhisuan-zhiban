import "../../styles/course-source-page.css";
import type { CourseSourcePage } from "@xuetu/contracts";
import { ChevronLeft, ChevronRight, Expand, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { CourseSourceExcerpt } from "./course-source-excerpt";

interface SourceReference { chunk_id: string; chunk_offset: number; print_page: number }
interface Props {
  page: CourseSourcePage;
  paragraphCount: number;
  chunkId: string;
  sources: readonly SourceReference[];
  onSelectSource: (offset: number) => void;
  excerpt?: CourseSourceExcerpt | null;
}

export function CourseSourceDocument({ page, paragraphCount, chunkId, sources, onSelectSource, excerpt }: Props) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(100);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const label = page.print_page ? `第 ${page.print_page} 页` : `PDF 第 ${page.physical_page} 页`;
  const alt = `${page.title} · ${label}原文`;
  const index = sources.findIndex((source) => source.chunk_id === chunkId);
  const count = Math.max(1, paragraphCount);
  const src = page.image_url + (retry ? `&retry=${retry}` : "");
  const [opened, setOpened] = useState(false);
  const displayRange = excerpt && Number.isFinite(excerpt.top) && Number.isFinite(excerpt.bottom)
    && excerpt.top >= 0 && excerpt.bottom <= 1 && excerpt.bottom > excerpt.top ? excerpt : null;
  const displayHeight = page.height * (displayRange ? displayRange.bottom - displayRange.top : 1);

  function open() {
    setZoom(100);
    setOpened(true);
    dialog.current?.showModal();
  }

  const errorView = <div className="source-document-error" role="alert">
    <strong>原文页加载失败</strong>
    <button onClick={() => { setRetry((value) => value + 1); setFailed(false); }} type="button"><RotateCcw size={16} />重新加载原文</button>
  </div>;

  return <section className="course-original-document" aria-label="讲义原文">
    <header className="source-document-toolbar">
      <div><h3>讲义原文</h3><span>{label}</span></div>
      <div>
        {sources.length > 1 ? <nav aria-label="本知识点原文页">
          <button aria-label="上一原文页" disabled={index <= 0} onClick={() => onSelectSource(sources[index - 1]!.chunk_offset)} type="button"><ChevronLeft size={17} /></button>
          <span aria-live="polite">{index + 1} / {sources.length}</span>
          <button aria-label="下一原文页" disabled={index < 0 || index >= sources.length - 1} onClick={() => onSelectSource(sources[index + 1]!.chunk_offset)} type="button"><ChevronRight size={17} /></button>
        </nav> : null}
        <button onClick={open} type="button"><Expand aria-hidden="true" size={16} />{displayRange ? "查看整页" : "放大原文"}</button>
      </div>
    </header>
    {failed ? errorView : <div className="source-document-sheet" data-source-excerpt={displayRange ? "true" : undefined} style={{ aspectRatio: `${page.width} / ${displayHeight}` }}>
      <img alt={displayRange ? `${alt}（本节节选）` : alt} width={page.width} height={page.height} src={src} onError={() => setFailed(true)}
        style={displayRange ? { position: "absolute", top: 0, transform: `translateY(-${displayRange.top * 100}%)` } : undefined} />
      {/* One continuous raster, with invisible bookmark bands. Legacy paragraph
          bookmarks map proportionally to the source page; these are positions,
          not assertions that OCR paragraphs or equations have been corrected. */}
      {Array.from({ length: count }, (_, i) => <span aria-hidden="true" data-reading-paragraph={i} className="source-page-bookmark" key={i} style={{ top: `${i / count * 100}%`, height: `${100 / count}%` }} />)}
    </div>}
    <dialog className="source-document-dialog" aria-labelledby={titleId} ref={dialog} onClose={() => setOpened(false)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header>
        <h2 id={titleId}>{page.title} · {label}</h2>
        <div>
          <button aria-label="缩小原文" disabled={zoom <= 75} onClick={() => setZoom((value) => Math.max(75, value - 25))} type="button"><Minus size={18} /></button>
          <button onClick={() => setZoom(100)} title="适合宽度" type="button">{zoom}%</button>
          <button aria-label="放大原文比例" disabled={zoom >= 200} onClick={() => setZoom((value) => Math.min(200, value + 25))} type="button"><Plus size={18} /></button>
          <button aria-label="关闭原文大图" onClick={() => dialog.current?.close()} type="button"><X size={20} /></button>
        </div>
      </header>
      <div className="source-document-zoom-body">
        {opened ? failed ? errorView : <img alt={alt} src={src} width={page.width} height={page.height} style={{ width: `${zoom}%` }} onError={() => setFailed(true)} /> : null}
      </div>
    </dialog>
  </section>;
}
