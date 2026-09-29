import type { Readable } from "node:stream";

import type { SourceCourseOutline } from "@xuetu/contracts";

export interface StudentSourceFigureAsset {
  archive_sha256: string;
  archive_path: string;
  asset_sha256: string;
  mime_type: "image/webp";
}

export interface StudentSourceCourseService {
  getCourseOutline(courseSlug: string): Promise<SourceCourseOutline | null>;
  getFigureAsset(
    courseSlug: string,
    figureAssetId: string,
  ): Promise<StudentSourceFigureAsset | null>;
}

export interface SourceFigureArchive {
  open(asset: StudentSourceFigureAsset): Promise<{
    stream: Readable;
    content_length: number;
  }>;
}
