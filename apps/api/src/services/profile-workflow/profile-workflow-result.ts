import {
  aiWorkflowFailureSchema,
  studentProfileWorkflowResponseSchema,
  type StudentProfileWorkflowResponse,
} from "@xuetu/contracts";
import { z } from "zod";

import type { ProfileWorkflowContext } from "./profile-workflow-context.js";

const candidateSelectionSchema = z
  .object({
    candidate_id: z.string().trim().min(1).max(200),
  })
  .strict();

const candidateSelectionInputSchema = z.preprocess(
  (value) => typeof value === "string" ? { candidate_id: value } : value,
  candidateSelectionSchema,
);

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

const candidateSelectionListSchema = z.preprocess(
  parseJsonValue,
  z.array(candidateSelectionInputSchema).max(10),
);

export const profileCandidateSelectionsSchema = z
  .object({
    strengths: candidateSelectionListSchema,
    priority_gaps: candidateSelectionListSchema,
    next_tasks: candidateSelectionListSchema,
  })
  .strip();

export const profileWorkflowSelectionSchema = z
  .object({
    status: z.enum(["ready", "success", "succeeded"]),
    ...profileCandidateSelectionsSchema.shape,
  })
  // Narrative fields are never trusted as student-facing profile facts.
  .strip();

export type ProfileWorkflowSelection = z.infer<typeof profileWorkflowSelectionSchema>;

function resolveCandidates<T extends { evidence_ids: string[] }>(
  selections: Array<z.infer<typeof candidateSelectionSchema>>,
  candidates: ReadonlyMap<string, T>,
  allowedEvidenceIds: Set<string>,
): T[] | null {
  const seen = new Set<string>();
  const resolved: T[] = [];
  for (const selection of selections) {
    if (seen.has(selection.candidate_id)) return null;
    seen.add(selection.candidate_id);
    const candidate = candidates.get(selection.candidate_id);
    if (
      !candidate
      || candidate.evidence_ids.length === 0
      || candidate.evidence_ids.some((id) => !allowedEvidenceIds.has(id))
    ) {
      return null;
    }
    resolved.push(candidate);
  }
  return resolved;
}

function profileSummary(
  strengths: StudentProfileWorkflowResponse["strengths"],
  gaps: StudentProfileWorkflowResponse["priority_gaps"],
  tasks: StudentProfileWorkflowResponse["next_tasks"],
) {
  const statements: string[] = [];
  if (gaps[0]) {
    statements.push(`基于当前平台学习证据，${gaps[0].title}是当前优先补强方向。`);
  }
  if (strengths[0]) {
    statements.push(`${strengths[0].title}是当前已有证据支持的相对稳定方向。`);
  }
  if (tasks[0]) {
    statements.push(`下一步从“${tasks[0].title}”开始。`);
  }
  return statements.join("");
}

type FailureStatus = "unavailable" | "failed" | "insufficient_context";
type FailureCode =
  | "WORKFLOW_NOT_CONNECTED"
  | "CONTEXT_INCOMPLETE"
  | "UPSTREAM_UNAVAILABLE"
  | "WORKFLOW_TIMEOUT"
  | "WORKFLOW_FAILED";

export function profileWorkflowFailure(
  context: ProfileWorkflowContext,
  status: FailureStatus,
  code: FailureCode,
  message: string,
  retryable: boolean,
): StudentProfileWorkflowResponse {
  return studentProfileWorkflowResponseSchema.parse({
    contract_version: "0.2",
    request_id: context.request_id,
    status,
    profile_summary: "AI 画像解读暂不可用，确定性画像仍可查看。",
    course_progress: context.course_progress,
    strengths: [],
    priority_gaps: [],
    evidence_summary: context.evidence_summary,
    next_tasks: [],
    failure: aiWorkflowFailureSchema.parse({
      code,
      message,
      retryable,
      fallback_message: "雷达图、课程证据和学习入口仍可继续使用。",
    }),
  });
}

export function resolveProfileWorkflowSelection(
  context: ProfileWorkflowContext,
  selections: ProfileWorkflowSelection,
): StudentProfileWorkflowResponse {
  const strengths = resolveCandidates(
    selections.strengths,
    context.strength_candidates,
    context.allowed_evidence_ids,
  );
  const priorityGaps = resolveCandidates(
    selections.priority_gaps,
    context.gap_candidates,
    context.allowed_evidence_ids,
  );
  const nextTasks = resolveCandidates(
    selections.next_tasks,
    context.task_candidates,
    context.allowed_evidence_ids,
  );
  if (
    strengths === null
    || priorityGaps === null
    || nextTasks === null
    || strengths.length + priorityGaps.length + nextTasks.length === 0
  ) {
    return profileWorkflowFailure(
      context,
      "failed",
      "WORKFLOW_FAILED",
      "画像工作流响应未通过候选证据校验。",
      false,
    );
  }

  return studentProfileWorkflowResponseSchema.parse({
    contract_version: "0.2",
    request_id: context.request_id,
    status: "ready",
    profile_summary: profileSummary(strengths, priorityGaps, nextTasks).slice(0, 2_000),
    course_progress: context.course_progress,
    strengths,
    priority_gaps: priorityGaps,
    evidence_summary: context.evidence_summary,
    next_tasks: nextTasks,
    failure: null,
  });
}
