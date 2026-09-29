import { afterEach, expect, it } from "vitest";
import { visibleReadingParagraph } from "./course-reader-scroll";

afterEach(() => { document.body.innerHTML = ""; });
it("does not restore the previous source band because of fractional sticky-header pixels", () => {
  document.body.innerHTML = '<section class="course-lesson-panel"><header class="course-reader-heading"></header><div class="lesson-reading-body"><span class="source-page-bookmark" data-reading-paragraph="2"></span><span class="source-page-bookmark" data-reading-paragraph="3"></span></div></section>';
  const bounds = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 800, height: bottom - top, width: 800, x: 0, y: top, toJSON() {} });
  const body = document.querySelector<HTMLElement>(".lesson-reading-body")!;
  body.getBoundingClientRect = () => bounds(-1300, 1700);
  document.querySelector(".course-reader-heading")!.getBoundingClientRect = () => bounds(68, 170.25);
  body.children[0]!.getBoundingClientRect = () => bounds(33.59, 195.28);
  body.children[1]!.getBoundingClientRect = () => bounds(195.29, 356.98);
  expect(visibleReadingParagraph(body)).toBe(3);
});
