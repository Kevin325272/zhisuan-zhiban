import { describe, expect, it } from "vitest";
import { getCourseReadingSource } from "./course-source-excerpt";

const text = "正交链表按行列链接结点。\n\n4.4字符串\n\n字符串是一串文字和符号的序列。\n保留原式：n ≥ 0。";
const page = {
  page_id: "5b7373571eb2-p139", print_page: 125, physical_page: 139,
  title: "数据结构", width: 1489, height: 2221,
  image_url: "/api/v1/408/courses/data-structures/source-pages/5b7373571eb2-p139?v=bd7a56346fa246c3c48561b5bc1dc7957838c750de23fc85b7e6edd75a43a756",
};
const chunk = { chunk_id: "ds_k0125", text, source_page: page };

describe("reviewed course source excerpts", () => {
  it("starts at the exact section boundary and preserves every following character", () => {
    const result = getCourseReadingSource(chunk, "ds_c04_04");
    expect(result.text).toBe(text.slice(text.indexOf("4.4字符串")));
    expect(result.excerpt).not.toBeNull();
    expect(chunk.text).toBe(text);
  });

  it("does not remove matrix content when the same page is read for a different concept", () => {
    expect(getCourseReadingSource(chunk, "ds_c04_03")).toEqual({ text, excerpt: null });
  });

  it("leaves the next source page intact", () => {
    expect(getCourseReadingSource({ ...chunk, chunk_id: "ds_k0126" }, "ds_c04_04"))
      .toEqual({ text, excerpt: null });
  });

  it("does not reuse coordinates after the original image changes", () => {
    expect(getCourseReadingSource({ ...chunk, source_page: { ...page, image_url: page.image_url + "changed" } }, "ds_c04_04"))
      .toEqual({ text, excerpt: null });
  });

  it("leaves source text intact when the section boundary is missing or ambiguous", () => {
    for (const changed of ["只有正交链表。", text + "\n4.4字符串\n又一个小节标题。"])
      expect(getCourseReadingSource({ ...chunk, text: changed }, "ds_c04_04"))
        .toEqual({ text: changed, excerpt: null });
  });

  it("applies the same text boundary in installations without original page images", () => {
    expect(getCourseReadingSource({ ...chunk, source_page: null }, "ds_c04_04"))
      .toEqual({ text: text.slice(text.indexOf("4.4字符串")), excerpt: null });
  });
});
