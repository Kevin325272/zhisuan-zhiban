import type { StudentLearningOrchestration } from "@xuetu/contracts";

export function currentTaskHref(task: StudentLearningOrchestration["current_task"]) {
  const [pathAndQuery = "", hash = ""] = task.href.split("#", 2);
  const [base = "", query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("orchestration_task_id");
  if (task.source === "probe") {
    if (task.probe_session_id) params.set("probe_session_id", task.probe_session_id);
  } else {
    params.set("orchestration_task_id", task.task_id);
  }
  const search = params.toString();
  return `${base}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}
