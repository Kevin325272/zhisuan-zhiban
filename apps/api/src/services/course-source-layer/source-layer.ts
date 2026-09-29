import type { SourceLayerCourseSummary } from "@xuetu/contracts";

export type { SourceLayerCourseSummary } from "@xuetu/contracts";

export interface SourceLayerSummaryService {
  getCourseSummary(courseId: string): Promise<SourceLayerCourseSummary | null>;
  listCourseSummaries(): Promise<SourceLayerCourseSummary[]>;
}
