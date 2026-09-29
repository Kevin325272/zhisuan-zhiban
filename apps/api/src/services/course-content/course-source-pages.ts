import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { courseSourcePageSchema, type CourseSourcePage } from "@xuetu/contracts";

export interface CourseSourcePages {
  describe(courseSlug: string, sourceItemId: string): Promise<CourseSourcePage | null>;
  open(courseSlug: string, pageId: string): Promise<Buffer | null>;
}

const pageSchema = z.object({
  page_id: z.string().regex(/^[a-f0-9]{12}-p[1-9]\d*$/u),
  print_page: z.number().int().positive().nullable(),
  physical_page: z.number().int().positive(),
  width: z.number().int().positive(), height: z.number().int().positive(),
  file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const manifestSchema = z.object({
  schema_version: z.literal(1),
  courses: z.record(z.string().regex(/^[a-z-]+$/u), z.object({
    title: z.string(), chunks: z.record(z.string(), z.string()),
    pages: z.record(z.string(), pageSchema),
  })),
});
type Manifest = z.infer<typeof manifestSchema>;

/** Immutable, locally generated PDF raster archive. OCR text is not a source of equations. */
export class LocalCourseSourcePages implements CourseSourcePages {
  private manifest: Promise<Manifest | null> | undefined;
  private modifiedAt: number | undefined;
  constructor(private readonly root: string) {}

  private async load() {
    const path = join(this.root, "manifest.json");
    let modified: number;
    try { modified = (await stat(path)).mtimeMs; }
    catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    if (this.manifest && this.modifiedAt === modified) return this.manifest;
    this.modifiedAt = modified;
    this.manifest = readFile(path, "utf8")
      .then((text) => manifestSchema.parse(JSON.parse(text)))
      .catch((error: unknown) => {
        // A deployment without the optional archive keeps its existing reader.
        // Retry on the next request so creating/restoring the archive needs no restart.
        this.manifest = undefined;
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      });
    return this.manifest;
  }

  async describe(courseSlug: string, sourceItemId: string) {
    const course = (await this.load())?.courses[courseSlug];
    const id = course?.chunks[sourceItemId];
    const page = id ? course?.pages[id] : null;
    if (!course || !page) return null;
    return courseSourcePageSchema.parse({
      page_id: page.page_id, print_page: page.print_page, physical_page: page.physical_page,
      title: course.title, width: page.width, height: page.height,
      image_url: `/api/v1/408/courses/${courseSlug}/source-pages/${page.page_id}?v=${page.sha256}`,
    });
  }

  async open(courseSlug: string, pageId: string) {
    if (!/^[a-z-]+$/u.test(courseSlug) || !/^[a-f0-9]{12}-p[1-9]\d*$/u.test(pageId)) return null;
    const page = (await this.load())?.courses[courseSlug]?.pages[pageId];
    if (!page) return null;
    const expectedPath = `processed/${courseSlug}/${pageId}.webp`;
    if (page.file !== expectedPath || page.page_id !== pageId) throw new Error("Invalid source-page path");
    const buffer = await readFile(join(this.root, expectedPath));
    if (createHash("sha256").update(buffer).digest("hex") !== page.sha256) {
      throw new Error("Source-page integrity check failed");
    }
    return buffer;
  }
}
