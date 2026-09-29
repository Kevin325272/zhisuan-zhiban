import type {
  CourseConceptVideoList,
  CourseVideoEpisodePage,
  CourseVideoKind,
  CourseVideoSeriesPage,
} from "@xuetu/contracts";

export interface CourseVideoSeriesQuery {
  q: string;
  kind: "all" | CourseVideoKind;
  page: number;
  pageSize: number;
}

export interface CourseVideoEpisodeQuery {
  page: number;
  pageSize: number;
}

export interface CourseVideoLibrary {
  listConceptVideos(courseSlug: string, conceptId: string): Promise<CourseConceptVideoList>;
  listCourseVideoSeries(
    courseSlug: string,
    query: CourseVideoSeriesQuery,
  ): Promise<CourseVideoSeriesPage>;
  listSeriesEpisodes(
    courseSlug: string,
    seriesId: string,
    query: CourseVideoEpisodeQuery,
  ): Promise<CourseVideoEpisodePage>;
}

export class CourseVideoCourseNotFoundError extends Error {
  constructor(readonly courseSlug: string) {
    super(`Course video course not found: ${courseSlug}`);
  }
}

export class CourseVideoConceptNotFoundError extends Error {
  constructor(readonly conceptId: string) {
    super(`Course video concept not found: ${conceptId}`);
  }
}

export class CourseVideoSeriesNotFoundError extends Error {
  constructor(readonly seriesId: string) {
    super(`Course video series not found: ${seriesId}`);
  }
}
