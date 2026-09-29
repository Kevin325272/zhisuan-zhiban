import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDemoSession,
  createDemoSession,
  getDemoRoleHome,
  readDemoSession,
} from "./demo-session";

describe("local demo session", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("stores only the predefined student or administrator identity", () => {
    expect(createDemoSession("student")).toMatchObject({
      role: "student",
      userId: "user_student_001",
      authentication: "local_development_demo",
    });
    expect(readDemoSession()).toMatchObject({ role: "student" });

    expect(createDemoSession("admin")).toMatchObject({
      role: "admin",
      userId: "user_admin_001",
    });
    expect(readDemoSession()).toMatchObject({ role: "admin" });
  });

  it("rejects a corrupt or tampered browser session", () => {
    window.sessionStorage.setItem("xuetu.demo.session.v1", "not-json");
    expect(readDemoSession()).toBeNull();

    window.sessionStorage.setItem(
      "xuetu.demo.session.v1",
      JSON.stringify({ role: "admin", userId: "user_student_001" }),
    );
    expect(readDemoSession()).toBeNull();
  });

  it("clears the session and maps each role to one entry route", () => {
    createDemoSession("student");
    clearDemoSession();

    expect(readDemoSession()).toBeNull();
    expect(getDemoRoleHome("student")).toBe("/student/home");
    expect(getDemoRoleHome("admin")).toBe("/admin");
  });
});
