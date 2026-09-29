export interface PastExamConfig {
  allowLocalDemoPastExams: boolean;
}

export function readPastExamConfig(
  environment: Record<string, string | undefined> = process.env,
): PastExamConfig {
  const value = environment.XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS?.trim().toLowerCase();
  if (value && value !== "true" && value !== "false") {
    throw new Error("XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS must be true or false.");
  }
  return { allowLocalDemoPastExams: value === "true" };
}
