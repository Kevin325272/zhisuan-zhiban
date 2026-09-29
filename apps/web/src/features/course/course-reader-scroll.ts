export function isFocusedReader(body: HTMLElement) {
  return Boolean(body.closest('[data-reading-focus="true"]'));
}

export function readerVisibleTop(body: HTMLElement) {
  const heading = body.closest(".course-lesson-panel")?.querySelector(".course-reader-heading");
  return Math.max(0, body.getBoundingClientRect().top, heading?.getBoundingClientRect().bottom ?? 0);
}

export function scrollReaderTo(body: HTMLElement, target: HTMLElement, offset = 24) {
  const heading = body.closest(".course-lesson-panel")?.querySelector(".course-reader-heading");
  if (isFocusedReader(body)) {
    body.scrollTo?.({ top: body.scrollTop + target.getBoundingClientRect().top - body.getBoundingClientRect().top - offset, behavior: "instant" });
  } else {
    const topbar = document.querySelector(".learning-shell .topbar");
    const top = (topbar?.getBoundingClientRect().height ?? 68) + (heading?.getBoundingClientRect().height ?? 0);
    window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - top - offset), behavior: "instant" });
  }
}

/** Read the current visible paragraph, including when the reader scrolls back. */
export function visibleReadingParagraph(body: HTMLElement): number | null {
  const top = readerVisibleTop(body);
  const footer = body.closest(".course-lesson-panel")?.querySelector(".lesson-pagination");
  const bottom = Math.min(window.innerHeight, body.getBoundingClientRect().bottom, footer?.getBoundingClientRect().top ?? window.innerHeight);
  if (bottom <= top) return null;
  const marker = top + Math.min(24, (bottom - top) * 0.1);
  const paragraphs = Array.from(body.querySelectorAll<HTMLElement>("[data-reading-paragraph]"));
  const visible = paragraphs.filter((paragraph) => {
    const box = paragraph.getBoundingClientRect();
    return box.bottom > top && box.top < bottom;
  });
  if (!visible.length) return null;
  // Adjacent source-page bands have no paragraph gap. Browser pixel rounding
  // and the sticky header border must not move a restored bookmark backwards.
  const tolerance = paragraphs[0]?.classList.contains("source-page-bookmark") ? 2 : 0;
  const selected = visible.find((paragraph) => paragraph.getBoundingClientRect().bottom > marker + tolerance) ?? visible[visible.length - 1]!;
  const index = Number(selected.dataset.readingParagraph);
  return Number.isInteger(index) ? index : null;
}
