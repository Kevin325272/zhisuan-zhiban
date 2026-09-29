import { useEffect, useRef } from "react";

import type { StudentTaskProgressStatus } from "./student-task-progress";

export interface PersistedCourseReadingPosition {
  chunkId: string;
  paragraphIndex: number;
  sourceExpanded: boolean;
}

interface CourseReadingTaskSettlementInput {
  taskId: string | null;
  taskStatus: StudentTaskProgressStatus;
  completeTask: () => Promise<unknown>;
  currentChunkId: string | null;
  persistedPosition: PersistedCourseReadingPosition | null;
}

/**
 * A reading task can settle only after its qualifying position is confirmed by
 * PostgreSQL. This keeps completion requests behind the progress write.
 */
export function useCourseReadingTaskSettlement({
  taskId,
  taskStatus,
  completeTask,
  currentChunkId,
  persistedPosition,
}: CourseReadingTaskSettlementInput) {
  const attemptedTaskRef = useRef<string | null>(null);

  useEffect(() => {
    attemptedTaskRef.current = null;
  }, [taskId]);

  useEffect(() => {
    if (
      !taskId
      || taskStatus !== "active"
      || attemptedTaskRef.current === taskId
      || !currentChunkId
      || persistedPosition?.chunkId !== currentChunkId
      || !persistedPosition.sourceExpanded
      || persistedPosition.paragraphIndex <= 0
    ) return;

    attemptedTaskRef.current = taskId;
    void completeTask();
  }, [completeTask, currentChunkId, persistedPosition, taskId, taskStatus]);
}
