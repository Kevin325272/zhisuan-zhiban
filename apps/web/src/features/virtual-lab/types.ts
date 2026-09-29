export type CourseId = "computer-networks" | "computer-organization" | "operating-systems";
export type LabInputs = Record<string, string>;
export interface LabField {
  key: string;
  label: string;
  value: string;
  type?: "number" | "text" | "select" | "textarea";
  options?: readonly string[];
  min?: number;
  max?: number;
  hint?: string;
  device?: string;
}
export interface LabDefinition {
  id: string;
  course: CourseId;
  title: string;
  description: string;
  task: string;
  duration: string;
  fields: LabField[];
  concepts: string[];
}
export interface Metric { label: string; value: string }
export interface LabCell { label: string; value: string; state?: "active" | "hit" | "miss" }
export interface LabEvent {
  title: string;
  detail: string;
  active: string[];
  metrics: Metric[];
  cells?: LabCell[];
  path?: string[];
  table?: { columns: string[]; rows: string[][] };
}
export interface LabRun {
  status: "success" | "blocked" | "invalid";
  summary: string;
  events: LabEvent[];
  metrics: Metric[];
}
