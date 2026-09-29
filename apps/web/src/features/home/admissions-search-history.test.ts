import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAdmissionsSearchHistory,
  loadAdmissionsSearchHistory,
  rememberAdmissionsSearch,
} from "./admissions-search-history";

describe("admissions search history", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps a small deduplicated history isolated by student", () => {
    rememberAdmissionsSearch("student_a", " 科大 ");
    rememberAdmissionsSearch("student_a", "081200");
    rememberAdmissionsSearch("student_a", "科大");
    rememberAdmissionsSearch("student_b", "清华");

    expect(loadAdmissionsSearchHistory("student_a")).toEqual(["科大", "081200"]);
    expect(loadAdmissionsSearchHistory("student_b")).toEqual(["清华"]);
  });

  it("can clear only the current student's history", () => {
    rememberAdmissionsSearch("student_a", "计算机");
    rememberAdmissionsSearch("student_b", "网络空间安全");

    clearAdmissionsSearchHistory("student_a");

    expect(loadAdmissionsSearchHistory("student_a")).toEqual([]);
    expect(loadAdmissionsSearchHistory("student_b")).toEqual(["网络空间安全"]);
  });
});
