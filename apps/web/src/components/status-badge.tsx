import type { LearningNode } from "@xuetu/contracts";

const labels: Record<LearningNode["status"], string> = {
  not_started: "未开始",
  in_progress: "学习中",
  needs_review: "待巩固",
  validation_ready: "待验证",
  mastered: "已掌握",
  unknown: "状态未知",
};

export function StatusBadge({ status }: { status: LearningNode["status"] }) {
  return <span className={`status-badge status-${status}`}>{labels[status]}</span>;
}
