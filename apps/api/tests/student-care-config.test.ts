import { describe, expect, it } from "vitest";

import { readStudentCareConfig } from "../src/config/student-care.js";

describe("student care configuration", () => {
  it("is disabled by default with one fixed rule version", () => {
    const config = readStudentCareConfig({});

    expect(config.enabled).toBe(false);
    expect(config.ruleVersion).toBe("student_care_v1");
    expect(config.invitationTtlHours).toBe(24);
    expect(config.cooldownDays).toEqual({ standard: 7, dismiss: 14 });
  });

  it("accepts explicit enablement and bounded threshold overrides", () => {
    const config = readStudentCareConfig({
      STUDENT_CARE_ENABLED: "true",
      STUDENT_CARE_RETURN_MIN_GAP_DAYS: "5",
      STUDENT_CARE_RECENT_MIN_ATTEMPTS: "10",
      STUDENT_CARE_BASELINE_MIN_ATTEMPTS: "24",
      STUDENT_CARE_RECENT_MIN_ERROR_RATE: "0.65",
      STUDENT_CARE_ERROR_RATE_INCREASE: "0.30",
    });

    expect(config.enabled).toBe(true);
    expect(config.returnAfterGap.minGapDays).toBe(5);
    expect(config.accuracyShift).toMatchObject({
      recentMinAttempts: 10,
      baselineMinAttempts: 24,
      recentMinErrorRate: 0.65,
      minErrorRateIncrease: 0.3,
    });
  });

  it("rejects ambiguous booleans, unknown rule versions, and invalid ranges", () => {
    expect(() => readStudentCareConfig({ STUDENT_CARE_ENABLED: "1" }))
      .toThrow(/STUDENT_CARE_ENABLED/u);
    expect(() => readStudentCareConfig({ STUDENT_CARE_RULE_VERSION: "experimental" }))
      .toThrow(/STUDENT_CARE_RULE_VERSION/u);
    expect(() => readStudentCareConfig({ STUDENT_CARE_RECENT_MIN_ATTEMPTS: "0" }))
      .toThrow(/RECENT_MIN_ATTEMPTS/u);
    expect(() => readStudentCareConfig({ STUDENT_CARE_RECENT_MIN_ERROR_RATE: "1.2" }))
      .toThrow(/RECENT_MIN_ERROR_RATE/u);
  });
});
