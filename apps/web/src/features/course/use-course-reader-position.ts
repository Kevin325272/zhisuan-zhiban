import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { scrollReaderTo, visibleReadingParagraph } from "./course-reader-scroll";

interface ReaderPositionOptions {
  bodyRef: RefObject<HTMLDivElement | null>;
  chunkId: string | null;
  conceptId?: string | null;
  paragraphIndex: number;
  paragraphCount: number;
  resumeApplied: boolean;
  sourceExpanded: boolean;
  startAtSource?: boolean;
  onParagraphChange: (index: number) => void;
}

export function useCourseReaderPosition(options: ReaderPositionOptions) {
  const { bodyRef, chunkId, paragraphIndex, paragraphCount, resumeApplied, sourceExpanded } = options;
  const readingKey = chunkId ? `${options.conceptId ?? ""}:${chunkId}` : null;
  const optionsRef = useRef(options);
  const restoredRef = useRef<string | null>(null);
  const previousChunkRef = useRef<string | null>(null);
  useLayoutEffect(() => { optionsRef.current = options; });

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !chunkId) return;
    const changedChunk = previousChunkRef.current !== null && previousChunkRef.current !== readingKey;
    if (resumeApplied && restoredRef.current !== readingKey) {
      const target = body.querySelector<HTMLElement>(`[data-reading-paragraph="${paragraphIndex}"]`);
      if (!target) return;
      const frame = requestAnimationFrame(() => {
        scrollReaderTo(body, target);
        restoredRef.current = readingKey;
        previousChunkRef.current = readingKey;
      });
      return () => cancelAnimationFrame(frame);
    }
    if (changedChunk && !resumeApplied) {
      // New knowledge points open at the start of the reader, not midway through the previous page.
      const frame = requestAnimationFrame(() => {
        const target = optionsRef.current.startAtSource
          ? body.querySelector<HTMLElement>(".course-original-document") ?? body : body;
        scrollReaderTo(body, target, 0);
        previousChunkRef.current = readingKey;
      });
      return () => cancelAnimationFrame(frame);
    }
    previousChunkRef.current = readingKey;
  }, [bodyRef, chunkId, readingKey, paragraphCount, paragraphIndex, resumeApplied]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !chunkId || !sourceExpanded) return;
    let frame = 0;
    const track = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const index = visibleReadingParagraph(body);
        const current = optionsRef.current;
        if (index !== null && index !== current.paragraphIndex) current.onParagraphChange(index);
      });
    };
    window.addEventListener("scroll", track, { passive: true });
    body.addEventListener("scroll", track, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", track);
      body.removeEventListener("scroll", track);
    };
  }, [bodyRef, chunkId, sourceExpanded]);
}
