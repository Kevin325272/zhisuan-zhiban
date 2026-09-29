import { z } from "zod";

export const studentAiPreferencesPatchSchema = z.object({
  collaboration_enabled: z.boolean().optional(),
  visual_explanations_enabled: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose a preference to update.");

export const studentAiPreferencesSchema = z.object({
  collaboration_enabled: z.boolean(),
  visual_explanations_enabled: z.boolean(),
  updated_at: z.iso.datetime().nullable(),
}).strict();

export type StudentAiPreferences = z.infer<typeof studentAiPreferencesSchema>;
export type StudentAiPreferencesPatch = z.infer<typeof studentAiPreferencesPatchSchema>;

export const DEFAULT_STUDENT_AI_PREFERENCES: StudentAiPreferences = {
  collaboration_enabled: true,
  visual_explanations_enabled: true,
  updated_at: null,
};

const diagramId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/u);
export const learningDiagramSchema = z.object({
  kind: z.enum(["flow", "structure"]),
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(240),
  nodes: z.array(z.object({
    id: diagramId,
    label: z.string().trim().min(1).max(20),
    description: z.string().trim().min(1).max(220),
  }).strict()).min(2).max(6),
  edges: z.array(z.object({
    from: diagramId,
    to: diagramId,
    label: z.string().trim().min(1).max(24).optional(),
  }).strict()).min(1).max(8),
}).strict().superRefine((diagram, ctx) => {
  const ids = new Set(diagram.nodes.map((node) => node.id));
  if (ids.size !== diagram.nodes.length) ctx.addIssue({ code: "custom", path: ["nodes"], message: "Node IDs must be unique." });
  const edges = new Set<string>();
  diagram.edges.forEach((edge, index) => {
    const key = `${edge.from}:${edge.to}`;
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || edges.has(key)) {
      ctx.addIssue({ code: "custom", path: ["edges", index], message: "Edges must connect distinct existing nodes and be unique." });
    }
    edges.add(key);
  });
});
export type LearningDiagram = z.infer<typeof learningDiagramSchema>;
