import type {
  StudentLearningOrchestration,
  StudentLearningTaskActivation,
  StudentLearningTaskCompletion,
} from "@xuetu/contracts";

export type { StudentLearningTaskActivation, StudentLearningTaskCompletion } from "@xuetu/contracts";

export interface StudentLearningOrchestrationService {
  getSnapshot(userId: string): Promise<StudentLearningOrchestration>;
  activateTask(userId: string, taskId: string): Promise<StudentLearningTaskActivation>;
  completeTask(userId: string, taskId: string): Promise<StudentLearningTaskCompletion>;
}

export class LearningTaskCompletionError extends Error {
  constructor(
    readonly code: "LEARNING_TASK_NOT_FOUND" | "LEARNING_TASK_EVIDENCE_MISSING",
    message: string,
    readonly statusCode: 404 | 409,
  ) {
    super(message);
    this.name = "LearningTaskCompletionError";
  }
}
