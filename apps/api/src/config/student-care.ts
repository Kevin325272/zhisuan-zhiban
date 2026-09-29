export interface StudentCareConfig {
  enabled: boolean;
  ruleVersion: "student_care_v1";
  invitationTtlHours: number;
  cooldownDays: {
    standard: number;
    dismiss: number;
  };
  returnAfterGap: {
    minActiveDays: number;
    minGapDays: number;
    medianGapMultiplier: number;
    recentSessionHours: number;
  };
  accuracyShift: {
    recentMinAttempts: number;
    recentMinConcepts: number;
    baselineMinAttempts: number;
    recentMinErrorRate: number;
    minErrorRateIncrease: number;
  };
  rhythmDrop: {
    baselineMinCompletedDays: number;
    recentMaxCompletedDays: number;
  };
}

type Environment = Record<string, string | undefined>;

function booleanValue(env: Environment, key: string, fallback: boolean) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${key} must be exactly true or false.`);
}

function integerValue(
  env: Environment,
  key: string,
  fallback: number,
  range: { min: number; max: number },
) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(`${key} must be an integer from ${range.min} to ${range.max}.`);
  }
  return value;
}

function rateValue(env: Environment, key: string, fallback: number) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${key} must be a number from 0 to 1.`);
  }
  return value;
}

export function readStudentCareConfig(env: Environment = process.env): StudentCareConfig {
  const ruleVersion = env.STUDENT_CARE_RULE_VERSION?.trim() || "student_care_v1";
  if (ruleVersion !== "student_care_v1") {
    throw new Error("STUDENT_CARE_RULE_VERSION must be student_care_v1.");
  }

  return {
    enabled: booleanValue(env, "STUDENT_CARE_ENABLED", false),
    ruleVersion,
    invitationTtlHours: 24,
    cooldownDays: { standard: 7, dismiss: 14 },
    returnAfterGap: {
      minActiveDays: 4,
      minGapDays: integerValue(
        env,
        "STUDENT_CARE_RETURN_MIN_GAP_DAYS",
        4,
        { min: 1, max: 30 },
      ),
      medianGapMultiplier: 2,
      recentSessionHours: 24,
    },
    accuracyShift: {
      recentMinAttempts: integerValue(
        env,
        "STUDENT_CARE_RECENT_MIN_ATTEMPTS",
        8,
        { min: 1, max: 100 },
      ),
      recentMinConcepts: 2,
      baselineMinAttempts: integerValue(
        env,
        "STUDENT_CARE_BASELINE_MIN_ATTEMPTS",
        20,
        { min: 1, max: 500 },
      ),
      recentMinErrorRate: rateValue(
        env,
        "STUDENT_CARE_RECENT_MIN_ERROR_RATE",
        0.6,
      ),
      minErrorRateIncrease: rateValue(
        env,
        "STUDENT_CARE_ERROR_RATE_INCREASE",
        0.25,
      ),
    },
    rhythmDrop: {
      baselineMinCompletedDays: 6,
      recentMaxCompletedDays: 1,
    },
  };
}
