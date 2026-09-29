export const SIMULATION_PROGRESS_STORAGE_KEY = "xuetu:simulation-progress:v1";
const MAX_RECORDS = 20;

export interface SimulationProgressInput {
  experiment_id: string;
  scenario_id: string;
  start_node: number;
  step_count: number;
  visited_order: number[];
  source?: "local";
}

export interface SimulationProgressRecord extends SimulationProgressInput {
  record_id: string;
  saved_at: string;
  source: "local";
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is SimulationProgressRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SimulationProgressRecord>;
  return typeof record.record_id === "string"
    && typeof record.experiment_id === "string"
    && typeof record.scenario_id === "string"
    && typeof record.start_node === "number"
    && Number.isInteger(record.start_node)
    && typeof record.step_count === "number"
    && Number.isInteger(record.step_count)
    && Array.isArray(record.visited_order)
    && record.visited_order.every((item) => typeof item === "number" && Number.isInteger(item))
    && typeof record.saved_at === "string"
    && record.source === "local";
}

function createRecordId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `sim_${uuid}` : `sim_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function listSimulationProgress(): SimulationProgressRecord[] {
  const target = storage();
  if (!target) return [];

  try {
    const raw = target.getItem(SIMULATION_PROGRESS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecord)
      .sort((left, right) => right.saved_at.localeCompare(left.saved_at))
      .slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

export function saveSimulationProgress(input: SimulationProgressInput): SimulationProgressRecord {
  const existing = listSimulationProgress();
  const previous = existing.find((item) => (
    item.experiment_id === input.experiment_id
    && item.scenario_id === input.scenario_id
    && item.start_node === input.start_node
  ));
  const record: SimulationProgressRecord = {
    ...input,
    source: "local",
    record_id: previous?.record_id ?? createRecordId(),
    saved_at: new Date().toISOString(),
    visited_order: [...input.visited_order],
  };
  const next = [record, ...existing.filter((item) => item.record_id !== record.record_id)].slice(0, MAX_RECORDS);
  const target = storage();
  if (target) {
    try {
      target.setItem(SIMULATION_PROGRESS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The simulation remains usable if browser storage is blocked or full.
    }
  }
  return record;
}

