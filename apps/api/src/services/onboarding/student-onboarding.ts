import type {
  OnboardingDiagnosticAnswer,
  OnboardingDiagnosticQuestionSetResponse,
  OnboardingGoalInput,
  OnboardingSelfAssessmentsUpdate,
  OnboardingState,
} from "@xuetu/contracts";

export class StudentOnboardingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 400 | 404 | 409 | 503,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "StudentOnboardingError";
  }
}

export interface StudentOnboardingService {
  getState(userId: string): Promise<OnboardingState>;
  getDiagnosticQuestions(userId: string): Promise<OnboardingDiagnosticQuestionSetResponse>;
  saveDiagnosticAnswer(userId: string, answer: OnboardingDiagnosticAnswer): Promise<OnboardingState>;
  completeDiagnostic(userId: string): Promise<OnboardingState>;
  saveGoals(userId: string, goals: OnboardingGoalInput): Promise<OnboardingState>;
  saveSelfAssessments(
    userId: string,
    update: OnboardingSelfAssessmentsUpdate,
  ): Promise<OnboardingState>;
  completeSetup(userId: string): Promise<OnboardingState>;
}
