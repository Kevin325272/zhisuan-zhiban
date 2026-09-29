import { defaultsFor, findLab } from "./lab-catalog";
import { runExperiment } from "./lab-engine";
import type { LabDefinition, LabInputs } from "./types";
export interface LabRecord { id: string; labId: string; title: string; savedAt: string; inputs: LabInputs; step: number }
const keyFor = (owner: string) => `xuetu.virtual-lab.records.v2:${encodeURIComponent(owner)}`;
export function readLabRecords(owner: string | null): LabRecord[] {
  if (!owner) return [];
  const raw: unknown = JSON.parse(localStorage.getItem(keyFor(owner)) ?? "[]");
  if (!Array.isArray(raw)) throw new Error("本机实验记录格式异常");
  return raw.slice(0, 30).flatMap((item: unknown): LabRecord[] => {
    if (!item || typeof item !== "object") return [];
    const r = item as Partial<LabRecord>; const lab = typeof r.labId === "string" ? findLab(r.labId) : undefined;
    if (!lab || typeof r.id !== "string" || typeof r.savedAt !== "string" || !Number.isFinite(Date.parse(r.savedAt)) || !r.inputs || typeof r.inputs !== "object" || !Number.isInteger(r.step) || r.step! < 0) return [];
    const defaults = defaultsFor(lab); const inputs: LabInputs = {};
    for (const name of Object.keys(defaults)) {
      const value = r.inputs[name];
      if (typeof value !== "string" || value.length > 2000) return [];
      inputs[name] = value;
    }
    const result = runExperiment(lab, inputs);
    if (result.status === "invalid") return [];
    return [{ id: r.id, labId: lab.id, title: lab.title, savedAt: r.savedAt, inputs, step: Math.min(r.step!, result.events.length - 1) }];
  });
}
export function saveLabRecord(owner: string | null, lab: LabDefinition, inputs: LabInputs, step: number) {
  if (!owner) throw new Error("请登录后保存实验记录");
  const result = runExperiment(lab, inputs);
  if (result.status === "invalid" || !Number.isInteger(step) || step < 0 || step >= result.events.length) throw new Error("请先运行有效实验再保存");
  const record: LabRecord = { id: crypto.randomUUID(), labId: lab.id, title: lab.title, savedAt: new Date().toISOString(), inputs: { ...inputs }, step };
  const records = [record, ...readLabRecords(owner)].slice(0, 30);
  localStorage.setItem(keyFor(owner), JSON.stringify(records));
  return records;
}
