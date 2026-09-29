import type {
  CourseCatalogResponse,
  CourseChapterList,
  CourseContentPageQuery,
  CourseCurriculumMap,
  CourseKnowledgePage,
  CourseQaPage,
  CourseReadingProgress,
  CourseReadingProgressResponse,
  CourseReadingProgressUpdate,
} from "@xuetu/contracts";

export interface CourseContentService {
  listCourses(): Promise<CourseCatalogResponse>;
  listChapters(courseSlug: string): Promise<CourseChapterList>;
  getCurriculumMap(courseSlug: string): Promise<CourseCurriculumMap>;
  listKnowledge(
    courseSlug: string,
    query: CourseContentPageQuery,
  ): Promise<CourseKnowledgePage>;
  listQaExamples(
    courseSlug: string,
    query: CourseContentPageQuery,
  ): Promise<CourseQaPage>;
  getReadingProgress(
    userId: string,
    courseSlug: string,
  ): Promise<CourseReadingProgressResponse>;
  saveReadingProgress(
    userId: string,
    courseSlug: string,
    update: CourseReadingProgressUpdate,
  ): Promise<CourseReadingProgress>;
}

export class CourseContentNotFoundError extends Error {
  constructor(readonly courseSlug: string) {
    super(`Course content not found: ${courseSlug}`);
  }
}

export class CourseReadingPositionError extends Error {
  constructor(
    readonly courseSlug: string,
    readonly chunkId: string,
  ) {
    super(`Invalid course reading position: ${courseSlug}/${chunkId}`);
  }
}
