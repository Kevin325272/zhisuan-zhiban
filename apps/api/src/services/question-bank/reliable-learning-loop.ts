import type {
  LearningRecord,
  PersonalLearningDashboard,
  PracticeMistakeRecord,
  PracticeMistakeStatus,
} from "@xuetu/contracts";

export interface PracticeMistakeFilter {
  courseId?: string;
  conceptId?: string;
  status?: PracticeMistakeStatus;
}

export interface ReliableLearningLoopService {
  listMistakes(
    userId: string,
    filter: PracticeMistakeFilter,
  ): Promise<{ items: PracticeMistakeRecord[] }>;
  updateMistake(
    userId: string,
    mistakeId: string,
    status: PracticeMistakeStatus,
  ): Promise<PracticeMistakeRecord>;
  getLearningRecord(userId: string, courseId?: string): Promise<LearningRecord>;
  getPersonalLearningDashboard(userId: string): Promise<PersonalLearningDashboard>;
}

export class PracticeMistakeNotFoundError extends Error {
  constructor(readonly mistakeId: string) {
    super(`Practice mistake not found: ${mistakeId}`);
    this.name = "PracticeMistakeNotFoundError";
  }
}
