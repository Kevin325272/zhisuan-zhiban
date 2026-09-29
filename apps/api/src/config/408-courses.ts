export const COURSE_408_ID_BY_SLUG = {
  "data-structures": "course_408_ds",
  "computer-organization": "course_408_co",
  "operating-systems": "course_408_os",
  "computer-networks": "course_408_cn",
} as const;

export function resolve408CourseId(courseSlug: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(COURSE_408_ID_BY_SLUG, courseSlug)) {
    return null;
  }
  return COURSE_408_ID_BY_SLUG[courseSlug as keyof typeof COURSE_408_ID_BY_SLUG];
}
