import { describe, expect, it } from "vitest";

import {
  DEMO_408_COURSE_IDS,
  readStudentRegistrationConfig,
} from "../src/config/student-registration.js";

describe("student registration configuration", () => {
  it("defaults to self-service registration for the four 408 courses", () => {
    const config = readStudentRegistrationConfig({});

    expect(config).toEqual({
      mode: "self_service",
      courseIds: [...DEMO_408_COURSE_IDS],
    });
    expect(config.courseIds).not.toContain("course_408_001");
  });

  it("supports a controlled mode without silently falling back to open registration", () => {
    const config = readStudentRegistrationConfig({
      XUETU_STUDENT_REGISTRATION_MODE: "controlled",
      XUETU_DEMO_COURSE_IDS: "course_408_ds, course_408_cn",
    });

    expect(config).toEqual({
      mode: "controlled",
      courseIds: ["course_408_ds", "course_408_cn"],
    });
  });

  it("normalizes the legacy demo-open value without exposing it as a product mode", () => {
    expect(readStudentRegistrationConfig({
      XUETU_STUDENT_REGISTRATION_MODE: "demo_open",
    })).toEqual({
      mode: "self_service",
      courseIds: [...DEMO_408_COURSE_IDS],
    });
  });

  it("rejects unsupported registration modes", () => {
    expect(() => readStudentRegistrationConfig({
      XUETU_STUDENT_REGISTRATION_MODE: "open_to_everyone",
    })).toThrow("XUETU_STUDENT_REGISTRATION_MODE must be self_service or controlled");
  });
});
