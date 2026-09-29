import type {
  AiWorkflowInvocation,
  AiWorkflowRequest,
} from "@xuetu/contracts";

export interface BuildWorkflowContextInput {
  requestId: string;
  userId: string;
  invocation: AiWorkflowInvocation;
}

export interface WorkflowContextRepository {
  build(input: BuildWorkflowContextInput): Promise<AiWorkflowRequest>;
}

export class WorkflowContextIncompleteError extends Error {
  constructor(readonly reason:
    | "course"
    | "concept"
    | "source_chunks"
    | "qa_case"
    | "attempt"
    | "care_consent"
    | "care_task") {
    super("The requested AI workflow context is incomplete.");
    this.name = "WorkflowContextIncompleteError";
  }
}
