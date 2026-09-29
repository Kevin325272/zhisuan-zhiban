import { describe, expect, it } from "vitest";

import {
  PRE_DEFENSE_CLASSES,
  PRE_DEFENSE_STUDENTS,
  PRE_DEFENSE_TEACHERS,
  buildPreDefenseCourseProgress,
} from "../src/database/pre-defense-demo-roster.js";
import type { SqlClient, SqlQueryablePool, SqlQueryResult } from "../src/database/client.js";
import { seedPreDefenseDemoRoster } from "../src/database/seed-pre-defense-demo-roster.js";

describe("pre-defense academic demo roster", () => {
  it("contains internally consistent 2022 and 2023 cohorts plus the user-provided student number", () => {
    const studentNumbers = PRE_DEFENSE_STUDENTS.map((student) => student.studentNumber);
    expect(new Set(studentNumbers).size).toBe(studentNumbers.length);
    expect(studentNumbers).toContain("2415929524");
    expect(PRE_DEFENSE_STUDENTS.filter((student) => student.cohortYear === 2022).length).toBeGreaterThanOrEqual(5);
    expect(PRE_DEFENSE_STUDENTS.filter((student) => student.cohortYear === 2023).length).toBeGreaterThanOrEqual(5);
    expect(PRE_DEFENSE_CLASSES.map((item) => item.className)).toEqual(expect.arrayContaining([
      "软件工程2201班",
      "计算机科学与技术2302班",
    ]));
    expect(PRE_DEFENSE_STUDENTS).toHaveLength(288);
    expect(PRE_DEFENSE_TEACHERS).toHaveLength(12);
    expect(PRE_DEFENSE_STUDENTS.length + PRE_DEFENSE_TEACHERS.length).toBe(300);
    expect(PRE_DEFENSE_STUDENTS.filter((student) => student.targetSchool).length)
      .toBeGreaterThanOrEqual(280);
  });

  it("uses a fictional display name for the user-provided student number", () => {
    const student = PRE_DEFENSE_STUDENTS.find((item) => item.studentNumber === "2415929524");

    expect(student?.displayName).toBe("程嘉树");
  });

  it("gives every roster student four bounded course snapshots and keeps progress explicitly synthetic", () => {
    const progress = buildPreDefenseCourseProgress();
    expect(progress).toHaveLength(PRE_DEFENSE_STUDENTS.length * 4);
    for (const item of progress) {
      expect(item.progressPercent).toBeGreaterThanOrEqual(0);
      expect(item.progressPercent).toBeLessThanOrEqual(100);
      expect(item.correctCount + item.incorrectCount).toBeGreaterThan(0);
      expect(item.weeklyStudyMinutes).toBeGreaterThanOrEqual(0);
      expect(item.dataProvenance).toBe("synthetic_demo");
    }
  });

  it("defines teacher numbers, departments, titles and bounded class assignments", () => {
    expect(PRE_DEFENSE_TEACHERS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(PRE_DEFENSE_TEACHERS.map((teacher) => teacher.teacherNumber)).size)
      .toBe(PRE_DEFENSE_TEACHERS.length);
    expect(PRE_DEFENSE_TEACHERS.every((teacher) => teacher.classIds.length > 0)).toBe(true);
    expect(PRE_DEFENSE_TEACHERS.every((teacher) => !teacher.displayName.endsWith("老师"))).toBe(true);
  });

  it("covers multiple learning stages without tying a class to a repeated topic and fixed clock time", () => {
    const progress = buildPreDefenseCourseProgress();
    const firstClass = PRE_DEFENSE_STUDENTS.filter(student => student.classId === "class_cs_2022_01");
    const course = progress.filter(item => item.courseId === "course_408_cn");
    const classRows = course.filter(item => firstClass.some(student => student.userId === item.userId));
    expect(new Set(course.map(item => item.currentFocus)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(classRows.map(item => item.currentFocus)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(course.map(item => item.lastActiveAt.slice(11, 16))).size).toBeGreaterThan(40);
    expect(progress).toEqual(buildPreDefenseCourseProgress());
    expect(progress.every(item => item.lastActiveAt <= "2026-08-24T23:59:59.999Z")).toBe(true);
  });

  it("does not seed students as completed before profile and plan artifacts exist", async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      async query<Row = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<Row>> {
        statements.push(sql);
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const pool: SqlQueryablePool = {
      query: client.query.bind(client),
      connect: async () => client,
    };

    await seedPreDefenseDemoRoster(pool, () => new Date("2026-08-26T00:00:00.000Z"));

    const onboardingInsert = statements.find((sql) => sql.includes("INSERT INTO student_onboarding_states")) ?? "";
    expect(onboardingInsert).toContain("'not_started','goals'");
    expect(onboardingInsert).not.toContain("'completed','plan'");
  });
});
