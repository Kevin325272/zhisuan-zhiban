export const DEMO_408_COURSE_IDS = [
  "course_408_ds",
  "course_408_co",
  "course_408_os",
  "course_408_cn",
] as const;

export type StudentRegistrationMode = "self_service" | "controlled";

export interface StudentRegistrationConfig {
  mode: StudentRegistrationMode;
  courseIds: readonly string[];
}

const courseIdPattern = /^course_[A-Za-z0-9_-]{1,96}$/u;

function parseCourseIds(raw: string | undefined) {
  const values = (raw?.trim() || DEMO_408_COURSE_IDS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (
    unique.length === 0
    || unique.length > 20
    || unique.some((courseId) => !courseIdPattern.test(courseId))
  ) {
    throw new Error(
      "XUETU_DEMO_COURSE_IDS must contain 1-20 comma-separated course IDs.",
    );
  }
  return unique;
}

export function readStudentRegistrationConfig(
  environment: Record<string, string | undefined> = process.env,
): StudentRegistrationConfig {
  const configuredMode = environment.XUETU_STUDENT_REGISTRATION_MODE?.trim().toLowerCase() || "self_service";
  const mode = configuredMode === "demo_open" ? "self_service" : configuredMode;
  if (mode !== "self_service" && mode !== "controlled") {
    throw new Error(
      "XUETU_STUDENT_REGISTRATION_MODE must be self_service or controlled.",
    );
  }
  return {
    mode,
    courseIds: parseCourseIds(environment.XUETU_DEMO_COURSE_IDS),
  };
}
