import { describe, expect, it } from "vitest";

import { router } from "./router";

describe("student application routes", () => {
  it("registers the agent-driven course map route", () => {
    const studentRoute = router.routes.find((route) => route.path === "/student");
    const courseMapRoute = studentRoute?.children?.find(
      (route) => route.path === "course-map",
    );

    expect(courseMapRoute?.element).toBeTruthy();
  });

  it("registers the authenticated student pilot workspace", () => {
    const studentRoute = router.routes.find((route) => route.path === "/student");
    const pilotRoute = studentRoute?.children?.find(
      (route) => route.path === "pilot-study",
    );

    expect(pilotRoute?.element).toBeTruthy();
  });

  it("registers the authenticated student photo-tutor workspace", () => {
    const studentRoute = router.routes.find((route) => route.path === "/student");
    const photoTutorRoute = studentRoute?.children?.find(
      (route) => route.path === "practice/photo-tutor",
    );

    expect(photoTutorRoute?.element).toBeTruthy();
  });

  it("keeps the retired school-community routes offline", () => {
    const studentRoute = router.routes.find((route) => route.path === "/student");
    expect(studentRoute?.children?.find((route) => route.path === "community")).toBeUndefined();
    expect(studentRoute?.children?.find((route) => route.path === "community/:postId")).toBeUndefined();
  });

  it("keeps the retired four-course video library route offline", () => {
    const studentRoute = router.routes.find((route) => route.path === "/student");
    expect(studentRoute?.children?.find((route) => route.path === "courses/:courseSlug/videos")).toBeUndefined();
  });

  it("registers a protected teacher learning-visibility workspace", () => {
    const teacherRoute = router.routes.find((route) => route.path === "/teacher");
    expect(teacherRoute?.element).toBeTruthy();
  });

  it("does not expose the retired fixed-date review calendar", () => {
    const studentRoute = router.routes.find((route) => route.path === "/student");
    const reviewRoute = studentRoute?.children?.find((route) => route.path === "review");

    expect(reviewRoute).toBeUndefined();
  });
});
