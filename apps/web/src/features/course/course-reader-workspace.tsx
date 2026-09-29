import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { readerVisibleTop, scrollReaderTo } from "./course-reader-scroll";

const FONT_KEY = "xuetu.reader.font-size.v1";
const DEFAULT_SIZE = 18;
const ReaderContext = createContext<{
  focused: boolean;
  fontSize: number;
  changeFontSize: (size: number) => void;
  toggleFocus: () => void;
} | null>(null);

export const useCourseReaderControls = () => useContext(ReaderContext);

function readFontSize() {
  try {
    const size = Number(localStorage.getItem(FONT_KEY));
    return [16, 18, 20, 22].includes(size) ? size : DEFAULT_SIZE;
  } catch { return DEFAULT_SIZE; }
}

export function CourseReaderWorkspace({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const [fontSize, setFontSize] = useState(readFontSize);
  const rootRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<{ element: HTMLElement; offset: number } | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const linkedSectionRef = useRef<HTMLElement | null>(null);

  function rememberAnchor() {
    const body = rootRef.current?.querySelector<HTMLElement>(".lesson-reading-body");
    if (!body) return;
    const top = readerVisibleTop(body);
    const element = Array.from(body.querySelectorAll<HTMLElement>("[data-reading-paragraph], .lesson-orientation, .lesson-figure-ledger"))
      .find((item) => item.getBoundingClientRect().bottom > top);
    anchorRef.current = element ? { element, offset: element.getBoundingClientRect().top - top } : null;
  }

  function toggleFocus() {
    rememberAnchor();
    if (!focused) returnFocusRef.current = rootRef.current?.querySelector<HTMLElement>("[data-reader-focus-toggle]") ?? null;
    setFocused((value) => !value);
  }

  function changeFontSize(size: number) {
    rememberAnchor();
    const next = Math.min(22, Math.max(16, size));
    setFontSize(next);
    try { localStorage.setItem(FONT_KEY, String(next)); } catch { /* The current session still keeps the preference. */ }
  }

  function followSectionLink(event: MouseEvent<HTMLElement>) {
    if (!focused || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    const hash = link?.getAttribute("href")?.slice(1);
    if (!hash) return;
    const target = document.getElementById(hash);
    if (!target || rootRef.current?.contains(target)) return;
    event.preventDefault();
    linkedSectionRef.current = target;
    anchorRef.current = null;
    setFocused(false);
  }

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!focused) {
      const target = linkedSectionRef.current;
      if (target?.isConnected) {
        const topbarHeight = document.querySelector(".learning-shell .topbar")?.getBoundingClientRect().height ?? 68;
        window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - topbarHeight - 24, behavior: "instant" });
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      } else returnFocusRef.current?.focus({ preventScroll: true });
      linkedSectionRef.current = null;
      returnFocusRef.current = null;
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const inertElements: Array<{ element: HTMLElement; inert: boolean }> = [];
    for (let current: HTMLElement | null = root; current?.parentElement; current = current.parentElement) {
      for (const sibling of Array.from(current.parentElement.children)) {
        if (sibling instanceof HTMLElement && sibling !== current) {
          inertElements.push({ element: sibling, inert: Boolean(sibling.inert) });
          sibling.inert = true;
        }
      }
      if (current.parentElement === document.body) break;
    }
    document.body.style.overflow = "hidden";
    root.querySelector<HTMLButtonElement>("[data-reader-focus-toggle]")?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      inertElements.forEach(({ element, inert }) => { element.inert = inert; });
    };
  }, [focused]);

  useLayoutEffect(() => {
    const body = rootRef.current?.querySelector<HTMLElement>(".lesson-reading-body");
    const anchor = anchorRef.current;
    if (body && anchor?.element.isConnected) scrollReaderTo(body, anchor.element, anchor.offset);
    anchorRef.current = null;
  }, [focused, fontSize]);

  useEffect(() => {
    if (!focused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      // A figure's native dialog handles its own Escape and focus before the workspace.
      if (!root || root.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        rememberAnchor();
        setFocused(false);
      } else if (event.key === "Tab") {
        const items = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'))
          .filter((item) => !item.closest('[hidden], [inert], dialog:not([open])'))
          .sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focused]);

  return <ReaderContext.Provider value={{ focused, fontSize, changeFontSize, toggleFocus }}>
    <section
      ref={rootRef}
      className={`course-study-grid course-reader-workspace${collapsed ? " is-chapter-map-collapsed" : ""}${focused ? " is-reading-focused" : ""}`}
      data-reading-focus={focused}
      onClick={followSectionLink}
      role={focused ? "dialog" : undefined}
      aria-modal={focused ? true : undefined}
      aria-label={focused ? "课程专注阅读" : undefined}
      style={{ "--reader-font-size": `${fontSize}px` } as CSSProperties}
    >{children}</section>
  </ReaderContext.Provider>;
}
