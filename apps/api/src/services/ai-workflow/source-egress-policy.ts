import type { AiWorkflowRequest } from "@xuetu/contracts";

/**
 * Current imported course sources are explicitly local-demo-only and their
 * license has not been verified. They must not leave the server unless a
 * local operator makes that boundary explicit in server configuration.
 */
export function containsUnverifiedCourseSource(request: AiWorkflowRequest) {
  return request.context.source_chunks.length > 0 || request.context.qa_case !== null;
}

export function allowsUnverifiedSourceEgress(value: boolean | undefined) {
  return value === true;
}
