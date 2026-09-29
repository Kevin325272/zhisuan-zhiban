import { useCallback, useEffect, useRef, useState } from "react";

import {
  activateStudentLearningTask,
  completeStudentLearningTask,
} from "../../api/client";

export type StudentTaskProgressStatus = "idle" | "activating" | "active" | "completing" | "completed" | "error";

export function useStudentTaskProgress(taskId: string | null | undefined) {
  const [status, setStatus] = useState<StudentTaskProgressStatus>(taskId ? "activating" : "idle");
  const [error, setError] = useState<unknown>(null);
  const [nextTaskId, setNextTaskId] = useState<string | null>(null);
  const activeTaskRef = useRef<string | null>(null);
  const settledTaskRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    activeTaskRef.current = taskId ?? null;
    settledTaskRef.current = null;
    setError(null);
    setNextTaskId(null);
    if (!taskId) {
      setStatus("idle");
      return () => { active = false; };
    }
    setStatus("activating");
    activateStudentLearningTask(taskId)
      .then(() => { if (active) setStatus("active"); })
      .catch((caught: unknown) => { if (active) { setError(caught); setStatus("error"); } });
    return () => { active = false; };
  }, [taskId]);

  const complete = useCallback(async () => {
    const currentTaskId = activeTaskRef.current;
    if (!currentTaskId || settledTaskRef.current === currentTaskId) return null;
    setStatus("completing");
    setError(null);
    try {
      const result = await completeStudentLearningTask(currentTaskId);
      settledTaskRef.current = currentTaskId;
      setNextTaskId(result.next_task_id);
      setStatus("completed");
      return result;
    } catch (caught) {
      setError(caught);
      setStatus("error");
      return null;
    }
  }, []);

  return { status, error, nextTaskId, complete };
}
