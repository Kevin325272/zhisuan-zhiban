import { beforeEach, describe, expect, it } from "vitest";

import {
  listSimulationProgress,
  saveSimulationProgress,
  type SimulationProgressRecord,
} from "./simulation-progress-store";

const baseRecord: Omit<SimulationProgressRecord, "record_id" | "saved_at"> = {
  experiment_id: "ds-bfs-visited-v1",
  scenario_id: "diamond-seven",
  start_node: 1,
  step_count: 12,
  visited_order: [1, 2, 3, 4, 5, 6, 7],
  source: "local",
};

describe("simulation-progress-store", () => {
  beforeEach(() => window.localStorage.clear());

  it("saves and lists local simulation records newest first", () => {
    const saved = saveSimulationProgress(baseRecord);

    expect(saved.source).toBe("local");
    expect(listSimulationProgress()).toEqual([saved]);
  });

  it("replaces a record for the same experiment, scenario and start node", () => {
    const first = saveSimulationProgress({ ...baseRecord, step_count: 10 });
    const second = saveSimulationProgress({ ...baseRecord, step_count: 14, visited_order: [1, 3, 2] });

    expect(second.record_id).toBe(first.record_id);
    expect(listSimulationProgress()).toHaveLength(1);
    expect(listSimulationProgress()[0]?.step_count).toBe(14);
  });

  it("ignores malformed local storage data", () => {
    window.localStorage.setItem("xuetu:simulation-progress:v1", "{not-json");

    expect(listSimulationProgress()).toEqual([]);
  });

  it("caps stored history at twenty records", () => {
    for (let startNode = 1; startNode <= 25; startNode += 1) {
      saveSimulationProgress({ ...baseRecord, start_node: startNode, scenario_id: `scenario-${startNode}` });
    }

    expect(listSimulationProgress()).toHaveLength(20);
  });
});
