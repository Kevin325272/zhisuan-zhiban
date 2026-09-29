import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultsFor, findLab } from "./lab-catalog";
import { readLabRecords, saveLabRecord } from "./lab-records";
describe("local lab records", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  it("restores inputs and playhead only for their owner", () => {
    const lab = findLab("os-pages")!; const inputs = defaultsFor(lab);
    saveLabRecord("student-a", lab, inputs, 2);
    expect(readLabRecords("student-a")[0]).toMatchObject({ labId: lab.id, inputs, step: 2 });
    expect(readLabRecords("student-b")).toEqual([]);
    expect(readLabRecords(null)).toEqual([]);
  });
  it("propagates blocked storage instead of reporting success", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota", "QuotaExceededError"); });
    const lab = findLab("co-cache")!;
    expect(() => saveLabRecord("a", lab, defaultsFor(lab), 0)).toThrow();
  });
  it("rejects anonymous saves and invalid inputs", () => {
    const lab = findLab("os-pages")!;
    expect(() => saveLabRecord(null, lab, defaultsFor(lab), 0)).toThrow();
    expect(() => saveLabRecord("a", lab, { ...defaultsFor(lab), frames: "0" }, 0)).toThrow();
  });
});
