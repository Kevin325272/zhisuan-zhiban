import { AiWorkflowSlot } from "./ai-workflow-slot";

export function CourseAiExplanation({ courseId, conceptId }: { courseId: string; conceptId: string }) {
  return <AiWorkflowSlot manual actionLabel="讲解这个知识点" title="知识点讲解" slot="contextual_explanation" invocation={{
    contract_version: "0.2", capability: "explain", course_id: courseId, concept_id: conceptId,
    qa_id: null, attempt_id: null, user_message: null,
  }} />;
}
